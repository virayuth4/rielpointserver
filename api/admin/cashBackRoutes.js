const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const requireAdmin = require("../../middleware/requireAdmin");

// Server-side constants — never trust these from the client
const ALLOWED_CASHBACK_RATES = [10, 25, 50, 70, 80, 90]; // % of commission returned to user as cashback

const ALLOWED_STATUSES = [
  "merchant_confirmed",
  "rielpoint_confirmed",
  "confirmed",
  "rejected",
]; // pending is the only initial state, never client-settable

const VALID_TRANSITIONS = {
  pending: ["merchant_confirmed", "rejected"],
  merchant_confirmed: ["rielpoint_confirmed", "rejected"],
  rielpoint_confirmed: ["confirmed", "rejected"],
  confirmed: [],   // terminal — no further changes once confirmed
  rejected: [],    // terminal
};


router.post(
  "/cashback/transactions/:id/status",
  authenticateFirebaseToken,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { status, cashbackAmount, reason } = req.body;
    const adminId = req.user?.id;

    console.log("[PATCH status] incoming:", { id, status, cashbackAmount, reason, adminId });

    if (!ALLOWED_STATUSES.includes(status)) {
      console.log("[PATCH status] rejected: not in ALLOWED_STATUSES", { status, ALLOWED_STATUSES });
      return res.status(400).json({
        message: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}.`,
      });
    }

    let numericCashbackAmount = null;
    if (status === "confirmed") {
      numericCashbackAmount = Number(cashbackAmount);
      if (!Number.isFinite(numericCashbackAmount) || numericCashbackAmount <= 0) {
        console.log("[PATCH status] rejected: bad cashbackAmount", { cashbackAmount });
        return res.status(400).json({
          message: "A valid cashback amount is required to confirm.",
        });
      }
    }

    const client = await zingoPool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT id, status, cashback_amount FROM affiliate_transactions WHERE id = $1 FOR UPDATE`,
        [id]
      );

      if (rows.length === 0) {
        console.log("[PATCH status] rejected: transaction not found", { id });
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Transaction not found." });
      }

      const current = rows[0].status;
      const allowedNext = VALID_TRANSITIONS[current] || [];

      console.log("[PATCH status] transition check:", {
        current,
        requested: status,
        allowedNext,
        isAllowed: allowedNext.includes(status),
      });

      if (!allowedNext.includes(status)) {
        console.log("[PATCH status] rejected: invalid transition", { current, status, allowedNext });
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: `Cannot change status from "${current}" to "${status}".`,
        });
      }

      const finalAmount =
        status === "confirmed" ? numericCashbackAmount : rows[0].cashback_amount;

      const updated = await client.query(
        `UPDATE affiliate_transactions
         SET status = $1,
             cashback_amount = $2,
             status_reason = $3,
             status_updated_by = $4,
             status_updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [status, finalAmount, reason || null, adminId, id]
      );

      console.log("[PATCH status] success:", updated.rows[0]);

      await client.query("COMMIT");
      return res.status(200).json({ transaction: updated.rows[0] });
    } catch (err) {
      console.error("[PATCH status] DB error updating cashback status:", err);
      await client.query("ROLLBACK");
      return res.status(500).json({ message: "Failed to update status." });
    } finally {
      client.release();
    }
  }
);


router.get('/cashback/transactions/all',  authenticateFirebaseToken, requireAdmin, async (req, res) => {
    const client = await zingoPool.connect();
    const userId = req.user?.id
    console.log("Getting All Cashback transactions")
    console.log("userId", userId)
    try {
       const result = await client.query(
        `
        SELECT * FROM affiliate_transactions
        `
       ) 
       



        return res.status(200).json({
            transactions: result.rows,
            
        });
    } catch (err) {
        console.error('Error fetching cashback transactions:', err);
        return res.status(500).json({ message: 'Failed to load transactions.' });
    } finally {
        client.release();
    }
});

router.get('/cashback/transactions', authenticateFirebaseToken, async (req, res) => {
    const client = await zingoPool.connect();
    const userId = req.user?.id
    console.log("userId", userId)
    try {
        // NOTE: adapt this lookup to however your other customer-facing routes
        // (e.g. coupons/my) resolve the rielpoint_users.id from the decoded
        // firebase token. Assuming the middleware attaches the firebase uid
        // as req.user.uid — swap this for whatever helper you already use.
       

        const { rows } = await client.query(
            `SELECT
                at.id,
                at.merchant_id,
                m.name AS merchant_name,
                at.external_transaction_id,
                at.order_amount,
                at.currency,
                at.commission_amount,
                at.cashback_rate,
                at.cashback_amount,
                at.status,
                at.transaction_at,
                at.created_at
             FROM affiliate_transactions at
             LEFT JOIN affiliate_merchants m ON m.id = at.merchant_id
             WHERE at.user_id = $1
             ORDER BY at.transaction_at DESC, at.created_at DESC
             LIMIT 100`,
            [userId]
        );

        const balanceResult = await client.query(
            `SELECT COALESCE(SUM(cashback_amount), 0) AS balance
             FROM affiliate_transactions
             WHERE user_id = $1 AND status = 'confirmed'`,
            [userId]
        );

        return res.status(200).json({
            transactions: rows,
            balance: Number(balanceResult.rows[0].balance),
        });
    } catch (err) {
        console.error('Error fetching cashback transactions:', err);
        return res.status(500).json({ message: 'Failed to load transactions.' });
    } finally {
        client.release();
    }
});

router.post('/cashback/add', authenticateFirebaseToken, async (req, res) => {
    const {
        merchantId, // client-supplied — validated below, never trusted outright
        phone,
        externalTransactionId,
        orderAmount,
        currency,
        commission,
        cashbackRate,
        clickId,        // optional — only set if this order is tied to a tracked affiliate click
        transactionAt,  // optional — when the underlying order happened; defaults to now
    } = req.body;

    console.log(
        "Staff Id", req.user.id, "is attempting to credit cashback:",
        { merchantId, phone, externalTransactionId, orderAmount, currency, commission, cashbackRate }
    );

    if (!externalTransactionId) {
        return res.status(400).json({ message: 'externalTransactionId is required.' });
    }

    const client = await zingoPool.connect();

    try {
    
   

      

        // ---- Idempotency: external_transaction_id is unique per merchant ----
        const existing = await client.query(
            `SELECT id, created_at, merchant_id, user_id, order_amount, currency,
                    commission_amount, cashback_rate, cashback_amount, status, transaction_at
             FROM affiliate_transactions
             WHERE merchant_id = $1 AND external_transaction_id = $2`,
            [merchantId, externalTransactionId]
        );
        if (existing.rows.length > 0) {
            const tx = existing.rows[0];
            return res.status(200).json({
                transactionId: tx.id,
                createdAt: tx.created_at,
                merchantId: tx.merchant_id,
                userId: tx.user_id,
                orderAmount: tx.order_amount,
                currency: tx.currency,
                commission: tx.commission,
                cashbackRate: tx.cashback_rate,
                cashbackAmount: tx.cashback_amount,
                status: tx.status,
                transactionAt: tx.transaction_at,
                idempotent: true,
            });
        }

        // ---- Resolve user_id from phone ----
        const userLookup = await client.query(
            `SELECT id, fullname FROM rielpoint_users WHERE phone_number = $1`,
            [phone]
        );
        if (userLookup.rows.length === 0) {
            return res.status(404).json({ message: 'No user found with this phone number.' });
        }
        const userId = userLookup.rows[0].id;
        const userName = userLookup.rows[0].name ?? 'Customer';

        // ---- Validation ----
        const numericOrderAmount = Number(orderAmount);
        const numericCommission = Number(commission);
        const numericCashbackRate = Number(cashbackRate);

        if (!phone || phone.length < 8) {
            return res.status(400).json({ message: 'A valid phone number is required.' });
        }
        if (!Number.isFinite(numericOrderAmount) || numericOrderAmount <= 0) {
            return res.status(400).json({ message: 'Order amount must be a positive number.' });
        }
        if (currency !== 'USD' && currency !== 'KHR') {
            return res.status(400).json({ message: 'Currency must be USD or KHR.' });
        }
        if (!Number.isFinite(numericCommission) || numericCommission < 0) {
            return res.status(400).json({ message: 'Commission must be a non-negative number.' });
        }
        if (!ALLOWED_CASHBACK_RATES.includes(numericCashbackRate)) {
            return res.status(400).json({ message: `Cashback rate must be one of: ${ALLOWED_CASHBACK_RATES.join(', ')}.` });
        }

        // amount mirrors order_amount (kept as a separate column per schema)
        const amount = numericOrderAmount;
        const cashbackAmount = Math.round(numericCommission * (numericCashbackRate / 100) * 100) / 100;

        if (cashbackAmount <= 0) {
            return res.status(400).json({ message: 'Calculated cashback amount must be greater than zero.' });
        }

        await client.query('BEGIN');

        const txResult = await client.query(
            `INSERT INTO affiliate_transactions
                (merchant_id, user_id, click_id, external_transaction_id, order_amount,
                 commission_amount,  currency, cashback_rate, cashback_amount, status, transaction_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, created_at`,
            [
                merchantId,
                userId,
                clickId || null,
                externalTransactionId,
                numericOrderAmount,
                numericCommission,
            
                currency,
                numericCashbackRate,
                cashbackAmount,
                'pending', // confirmation is handled by a separate route
                transactionAt || new Date(),
            ]
        );

        await client.query('COMMIT');

        return res.status(200).json({
            transactionId: txResult.rows[0].id,
            createdAt: txResult.rows[0].created_at,
            merchantId,
            userId,
            userName,
            orderAmount: numericOrderAmount,
            currency,
            commission: numericCommission,
            amount,
            cashbackRate: numericCashbackRate,
            cashbackAmount,
            status: 'pending',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error crediting cashback:', err);
        return res.status(500).json({ message: 'Failed to credit cashback. Please try again.' });
    } finally {
        client.release();
    }
});

module.exports = router;