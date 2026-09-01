const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const requireAdmin = require("../../middleware/requireAdmin");
const axios = require("axios");


async function sendWithdrawalRequestToSupportTelegramNotification(withdrawalRequest, currentBalance) {
  const {
    id,
    user_id: userId,
    amount,
    currency,
    payout_method: payoutMethod,
    aba_account_number: abaAccountNumber,
    aba_account_name: abaAccountName,
    telegram_phone: telegramPhone,
  } = withdrawalRequest;

  const message =
    `New Withdrawal Request:\n\n` +
    `Request ID: ${id}\n` +
    `User ID: ${userId}\n` +
    `Amount: ${Number(amount).toFixed(2)} ${currency}\n` +
    `Remaining Balance: ${Number(currentBalance).toFixed(2)} ${currency}\n` +
    `Payout Method: ${payoutMethod}\n` +
    (payoutMethod === "aba"
      ? `ABA Account Number: ${abaAccountNumber}\nABA Account Name: ${abaAccountName}\n`
      : "") +
    (telegramPhone ? `Telegram Phone: ${telegramPhone}\n` : "");

  // console.log("Sending Withdrawal Request to Telegram notification with message:", message);

  try {
    const botToken = String(process.env.TELEGRAM_SUPPORT_BOT_TOKEN.trim());
    const chatId = Number(process.env.TELEGRAM_CHAT_ID.trim());

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    console.log("Telegram API URL:", url);

    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
    });

    console.log("Telegram notification sent successfully");
    return { success: true };
  } catch (error) {
    console.error("Error sending Telegram notification:", error.message);
    return { success: false, error: error.message };
  }
}

const WITHDRAWAL_STATUSES = ["requested", "processing", "paid", "failed"];

// Minimum withdrawal — adjust or remove if you don't want a floor
const MIN_WITHDRAWAL_AMOUNT = 1;

// --- shared helper: compute a user's current balance from the ledger ---
// SUM(credit) - SUM(debit) - SUM(reversal is itself a credit-type entry,
// so it's included in the credit sum, not subtracted again)
// Read-only balance check — no locking. Safe to call outside a transaction,
// e.g. for displaying the balance on the wallet page.
async function getUserBalanceReadOnly(client, userId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN entry_type IN ('credit', 'reversal') THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END), 0) AS balance
     FROM wallet_ledger_entries
     WHERE user_id = $1`,
    [userId]
  );
  return Number(rows[0]?.balance ?? 0);
}

// Locking balance check — must be called inside an open BEGIN...COMMIT
// transaction. Prevents two concurrent withdrawal requests from both
// reading the same balance before either has debited it.
async function getUserBalanceForUpdate(client, userId) {
  // FOR UPDATE can't be combined with an aggregate directly, so lock the raw
  // rows in a subquery first, then sum over the already-locked set.
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN entry_type IN ('credit', 'reversal') THEN amount ELSE 0 END), 0)
       - COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END), 0) AS balance
     FROM (
       SELECT entry_type, amount
       FROM wallet_ledger_entries
       WHERE user_id = $1
       FOR UPDATE
     ) locked_entries`,
    [userId]
  );
  return Number(rows[0]?.balance ?? 0);
}

// ---------------------------------------------------------------------
// USER: request a withdrawal
// ---------------------------------------------------------------------
router.post(
  "/wallet/withdrawals",
  authenticateFirebaseToken,
  async (req, res) => {
    const userId = req.user?.id;
    const {
      amount,
      currency = "USD",
      payoutMethod = "aba",
      abaAccountNumber,
      abaAccountName,
      telegramPhone,
    } = req.body;

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "A valid withdrawal amount is required." });
    }

    if (numericAmount < MIN_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        message: `Minimum withdrawal is ${MIN_WITHDRAWAL_AMOUNT} ${currency}.`,
      });
    }

    // ABA is the only payout method right now, so its fields are required.
    // If other payout methods are added later, branch validation on payoutMethod.
    if (payoutMethod === "aba") {
      if (!abaAccountNumber || !String(abaAccountNumber).trim()) {
        return res.status(400).json({ message: "ABA account number is required." });
      }
      if (!abaAccountName || !String(abaAccountName).trim()) {
        return res.status(400).json({ message: "ABA account name is required." });
      }
    }

    const client = await zingoPool.connect();
    try {
      await client.query("BEGIN");

      const currentBalance = await getUserBalanceForUpdate(client, userId);

      console.log("[withdrawal request]", { userId, numericAmount, currentBalance });

      if (numericAmount > currentBalance) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Insufficient balance. Available: ${currentBalance.toFixed(2)} ${currency}.`,
        });
      }

      // Create the withdrawal request
      const { rows: requestRows } = await client.query(
        `INSERT INTO withdrawal_requests
           (user_id, amount, currency, status, payout_method,
            aba_account_number, aba_account_name, telegram_phone)
         VALUES ($1, $2, $3, 'requested', $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          numericAmount,
          currency,
          payoutMethod,
          payoutMethod === "aba" ? abaAccountNumber.trim() : null,
          payoutMethod === "aba" ? abaAccountName.trim() : null,
          telegramPhone ? String(telegramPhone).trim() : null,
        ]
      );
      const withdrawalRequest = requestRows[0];

      // Debit immediately — this is what actually locks the funds so the
      // user can't submit a second overlapping request before an admin
      // processes this one.
      await client.query(
        `INSERT INTO wallet_ledger_entries
           (user_id, withdrawal_request_id, entry_type, amount, currency)
         VALUES ($1, $2, 'debit', $3, $4)`,
        [userId, withdrawalRequest.id, numericAmount, currency]
      );

      await client.query("COMMIT");

      sendWithdrawalRequestToSupportTelegramNotification(
        withdrawalRequest,
        currentBalance - numericAmount
      ).catch((err) =>
        console.error("[withdrawal request] telegram notify failed:", err)
      );
      return res.status(201).json({ withdrawal: withdrawalRequest });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[withdrawal request] error:", err);
      return res.status(500).json({ message: "Failed to submit withdrawal request." });
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------------------
// ADMIN: list all withdrawal requests (for the review table)
// ---------------------------------------------------------------------
router.get(
  "/admin/wallet/withdrawals",
  authenticateFirebaseToken,
  requireAdmin,
  async (req, res) => {
    const client = await zingoPool.connect();
    try {
      const { rows } = await client.query(
        `SELECT
           wr.id,
           wr.user_id,
           u.fullname AS user_fullname,
           u.phone_number AS user_phone,
           wr.amount,
           wr.currency,
           wr.status,
           wr.payout_method,
           wr.aba_account_number,
           wr.aba_account_name,
           wr.telegram_phone,
           wr.payout_reference,
           wr.admin_notes,
           wr.requested_at,
           wr.processed_at
         FROM withdrawal_requests wr
         LEFT JOIN rielpoint_users u ON u.id = wr.user_id
         ORDER BY wr.requested_at DESC`
      );
      return res.status(200).json({ withdrawals: rows });
    } catch (err) {
      console.error("[admin withdrawals list] error:", err);
      return res.status(500).json({ message: "Failed to load withdrawal requests." });
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------------------
// USER: list own withdrawal requests (for the wallet page history)
// ---------------------------------------------------------------------
router.get(
  "/wallet/withdrawals",
  authenticateFirebaseToken,
  async (req, res) => {
    const userId = req.user?.id;
    const client = await zingoPool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, amount, currency, status, payout_method, payout_reference,
                requested_at, processed_at
         FROM withdrawal_requests
         WHERE user_id = $1
         ORDER BY requested_at DESC`,
        [userId]
      );
      return res.status(200).json({ withdrawals: rows });
    } catch (err) {
      console.error("[user withdrawals list] error:", err);
      return res.status(500).json({ message: "Failed to load withdrawal history." });
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------------------
router.post(
  "/admin/wallet/withdrawals/:id/status",
  authenticateFirebaseToken,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { status, payoutMethod, payoutReference, adminNotes } = req.body;
    const adminId = req.user?.id;

    if (!["paid", "failed", "processing"].includes(status)) {
      return res.status(400).json({
        message: `Status must be one of: paid, failed, processing.`,
      });
    }

    const client = await zingoPool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Withdrawal request not found." });
      }

      const withdrawal = rows[0];

      // paid/failed are terminal; only requested/processing can transition further
      if (!["requested", "processing"].includes(withdrawal.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: `Cannot change status from "${withdrawal.status}" to "${status}".`,
        });
      }

      console.log("[withdrawal status]", { id, from: withdrawal.status, to: status });

      // If it failed, reverse the original debit so the funds go back
      // into the user's available balance. Never edit the original debit row.
      if (status === "failed") {
        await client.query(
          `INSERT INTO wallet_ledger_entries
             (user_id, withdrawal_request_id, entry_type, amount, currency)
           VALUES ($1, $2, 'reversal', $3, $4)`,
          [withdrawal.user_id, withdrawal.id, withdrawal.amount, withdrawal.currency]
        );
      }

      const updated = await client.query(
        `UPDATE withdrawal_requests
         SET status = $1,
             payout_method = COALESCE($2, payout_method),
             payout_reference = COALESCE($3, payout_reference),
             admin_notes = COALESCE($4, admin_notes),
             processed_at = CASE WHEN $1 IN ('paid', 'failed') THEN NOW() ELSE processed_at END,
             processed_by = $5
         WHERE id = $6
         RETURNING *`,
        [status, payoutMethod || null, payoutReference || null, adminNotes || null, adminId, id]
      );

      await client.query("COMMIT");
      return res.status(200).json({ withdrawal: updated.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("[withdrawal status] error:", err);
      return res.status(500).json({ message: "Failed to update withdrawal status." });
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------------------
// Update this to replace your existing balance query — reads from the
// ledger instead of SUM-ing affiliate_transactions by status.
// ---------------------------------------------------------------------
router.get(
  "/wallet/balance",
  authenticateFirebaseToken,
  async (req, res) => {
    const userId = req.user?.id;
    const client = await zingoPool.connect();
    try {
      const balance = await getUserBalanceReadOnly(client, userId);
      return res.status(200).json({ balance });
    } catch (err) {
      console.error("[wallet balance] error:", err);
      return res.status(500).json({ message: "Failed to fetch balance." });
    } finally {
      client.release();
    }
  }
);

 
module.exports = router;