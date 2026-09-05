// lib/telegramAuth.js
const crypto = require("crypto");

// lib/telegramAuth.js
function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) {
    console.error("verifyTelegramInitData: missing initData or botToken");
    return false;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const isValid = computedHash === hash;
  console.log("DEBUG hash comparison:", { computedHash, receivedHash: hash, isValid });

  return isValid;
}
module.exports = { verifyTelegramInitData };