// api/merchant/telegramCouponRoutes.js
const express = require("express");
const router = express.Router();
const { verifyTelegramInitData } = require("../../lib/telegramAuth");
const zingoPool = require("../../database/pgZingo");

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