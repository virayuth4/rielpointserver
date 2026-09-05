// api/merchant/telegramCouponRoutes.js
const express = require("express");
const router = express.Router();
const { verifyTelegramInitData } = require("../../lib/telegramAuth");
const zingoPool = require("../../database/pgZingo");
router.post("/merchant-status", async (req, res) => {
  try {
    const { initData } = req.body;

    // --- DEBUG ---
    console.log("DEBUG initData present:", !!initData, "length:", initData?.length);
    console.log("DEBUG TELEGRAM_CASHACK_BOT_TOKEN present:", !!process.env.TELEGRAM_CASHACK_BOT_TOKEN, "length:", process.env.TELEGRAM_CASHACK_BOT_TOKEN?.length);
    // --- END DEBUG ---

    if (!verifyTelegramInitData(initData, process.env.TELEGRAM_CASHACK_BOT_TOKEN)) {
      return res.status(401).json({ error: "Invalid Telegram session" });
    }

    const params = new URLSearchParams(initData);
    const telegramUser = JSON.parse(params.get("user"));

    const result = await zingoPool.query(
      `SELECT m.id, m.name, m.logo_url, m.cashback_rate
       FROM merchant_telegram_accounts mta
       JOIN affiliate_merchants m ON m.id = mta.merchant_id
       WHERE mta.telegram_user_id = $1`,
      [telegramUser.id]
    );

    if (!result.rows[0]) {
      return res.status(200).json({ linked: false });
    }

    return res.status(200).json({ linked: true, merchant: result.rows[0] });
  } catch (err) {
    console.error("Merchant status check error:", err);
    return res.status(500).json({ error: "Failed to check status" });
  }
});

router.post("/link-account", async (req, res) => {
  try {
    const { initData, code } = req.body;
    if (!verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      return res.status(401).json({ error: "Invalid Telegram session" });
    }
    if (!code) return res.status(400).json({ error: "Please enter a code" });

    const params = new URLSearchParams(initData);
    const telegramUser = JSON.parse(params.get("user"));

    const existing = await zingoPool.query(
      `SELECT merchant_id FROM merchant_telegram_accounts WHERE telegram_user_id = $1`,
      [telegramUser.id]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: "This Telegram account is already linked." });
    }

    const linkResult = await zingoPool.query(
      `SELECT id, merchant_id FROM merchant_link_codes
       WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [code.toUpperCase()]
    );
    const linkRow = linkResult.rows[0];
    if (!linkRow) {
      return res.status(400).json({ error: "That code is invalid or has expired." });
    }

    await zingoPool.query(
      `INSERT INTO merchant_telegram_accounts (merchant_id, telegram_user_id) VALUES ($1, $2)`,
      [linkRow.merchant_id, telegramUser.id]
    );
    await zingoPool.query(`UPDATE merchant_link_codes SET used_at = NOW() WHERE id = $1`, [linkRow.id]);

    const merchant = await zingoPool.query(
      `SELECT id, name, logo_url, cashback_rate FROM affiliate_merchants WHERE id = $1`,
      [linkRow.merchant_id]
    );

    return res.status(200).json({ linked: true, merchant: merchant.rows[0] });
  } catch (err) {
    console.error("Link account error:", err);
    return res.status(500).json({ error: "Failed to link account" });
  }
});

router.post("/coupon/redeem", async (req, res) => {
    console.log("Telegram Coupon redeem request body:", req.body);
  try {
        const { initData, code, amount } = req.body;

    if (!verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
      return res.status(401).json({ error: "Invalid Telegram session" });
    }

    const params = new URLSearchParams(initData);
    const telegramUser = JSON.parse(params.get("user"));

    // NEW: confirm this Telegram user is a registered merchant staff member
    const authResult = await zingoPool.query(
      `SELECT merchant_id FROM merchant_telegram_accounts WHERE telegram_user_id = $1`,
      [telegramUser.id]
    );
    const authorizedMerchantId = authResult.rows[0]?.merchant_id;
    if (!authorizedMerchantId) {
      return res.status(403).json({ error: "This Telegram account isn't registered as a merchant. Contact support to get set up." });
    }

    if (!code || !amount || amount <= 0) {
      return res.status(400).json({ error: "Code and a valid amount are required" });
    }

    const couponResult = await zingoPool.query(
      `SELECT cc.id, cc.merchant_id, m.name, m.cashback_rate
       FROM chat_coupons cc JOIN merchants m ON m.id = cc.merchant_id
       WHERE cc.code = $1`,
      [code]
    );
    const coupon = couponResult.rows[0];
    if (!coupon) {
      return res.status(404).json({ error: "Coupon code not found." });
    }

    // NEW: the authorized merchant must match the coupon's own merchant
    if (coupon.merchant_id !== authorizedMerchantId) {
      return res.status(403).json({ error: "This code doesn't belong to your store." });
    }
    const dupeCheck = await zingoPool.query(
      `SELECT id FROM coupon_redemptions
       WHERE coupon_id = $1 AND order_amount = $2 AND reported_at > NOW() - INTERVAL '2 minutes'`,
      [coupon.id, amount]
    );
    if (dupeCheck.rows[0]) {
      return res.status(409).json({ error: "Same code and amount was just submitted. Is this a duplicate?" });
    }

    const cashback_amount = parseFloat((amount * (coupon.cashback_rate / 100)).toFixed(2));

    await zingoPool.query(
      `INSERT INTO coupon_redemptions (coupon_id, order_amount, cashback_amount, status)
       VALUES ($1, $2, $3, 'approved')`,
      [coupon.id, amount, cashback_amount]
    );

    return res.status(200).json({ merchant_name: coupon.name, cashback_amount });
  } catch (err) {
    console.error("Coupon redeem error:", err);
    return res.status(500).json({ error: "Failed to redeem coupon" });
  }
});

module.exports = router;