// lib/telegramAuth.js
const crypto = require("crypto");

// lib/telegramAuth.js
function verifyTelegramInitData(initData, botToken) {
  console.log("DEBUG verifyTelegramInitData called. initData?:", !!initData, "botToken?:", !!botToken);

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

  return computedHash === hash;
}
module.exports = { verifyTelegramInitData };