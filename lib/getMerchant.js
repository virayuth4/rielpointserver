const zingoPool = require("../database/pgZingo");

async function getMerchant(merchant_id) {
  if (!merchant_id) {
    throw new Error("merchant_id is required");
  }

  const { rows } = await zingoPool.query(
    `SELECT id, name, coupon_prefix, logo_url, max_cashback, chat_commerce
     FROM affiliate_merchants
     WHERE id = $1
     LIMIT 1`,
    [merchant_id]
  );

  return rows[0] ?? null; // null if not found — caller should handle that
}

module.exports = { getMerchant };