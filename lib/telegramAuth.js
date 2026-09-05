// lib/telegramAuth.js
const crypto = require("crypto");

function verifyTelegramInitData(initData, botToken) {
  if (!initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");
  params.delete("signature"); // <-- add this

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return computedHash === hash;
}

module.exports = { verifyTelegramInitData };