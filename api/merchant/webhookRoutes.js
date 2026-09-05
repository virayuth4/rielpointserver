const express = require("express");
const zingoPool = require("../../database/pgZingo");
const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_CASHBACK_BOT_TOKEN;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

router.post("/webhook", async (req, res) => {
  res.sendStatus(200); // ack immediately

  const message = req.body.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const telegramUserId = message.from.id;
  const text = message.text.trim();

  if (text === "/start") {
    return sendMessage(chatId, "Welcome! If you're a merchant, link your account by sending:\n/link YOUR_CODE\n\n(Get your code from your RielPoint merchant dashboard.)");
  }

  if (text.startsWith("/link")) {
    const parts = text.split(/\s+/);
    const code = parts[1];

    if (!code) {
      return sendMessage(chatId, "Please include your code, like: /link A1B2C3D4");
    }

    // Already linked?
    const existing = await zingoPool.query(
      `SELECT merchant_id FROM merchant_telegram_accounts WHERE telegram_user_id = $1`,
      [telegramUserId]
    );
    if (existing.rows[0]) {
      return sendMessage(chatId, "This Telegram account is already linked to a merchant.");
    }

    const linkResult = await zingoPool.query(
      `SELECT id, merchant_id FROM merchant_link_codes
       WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [code.toUpperCase()]
    );
    const linkRow = linkResult.rows[0];

    if (!linkRow) {
      return sendMessage(chatId, "That code is invalid or has expired. Ask your admin for a new one.");
    }

    await zingoPool.query(
      `INSERT INTO merchant_telegram_accounts (merchant_id, telegram_user_id) VALUES ($1, $2)`,
      [linkRow.merchant_id, telegramUserId]
    );

    await zingoPool.query(
      `UPDATE merchant_link_codes SET used_at = NOW() WHERE id = $1`,
      [linkRow.id]
    );

    return sendMessage(chatId, "✅ Your Telegram account is now linked. You can redeem coupons using the menu button below.");
  }

  return sendMessage(chatId, "Send /start to get started, or use the menu button to redeem a coupon.");
});

module.exports = router;