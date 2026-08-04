/**
 * Normalizes a Cambodian phone number so it's consistently formatted
 * starting with "0". Handles numbers stored with the "855" country
 * code, with or without a leading "+".
 *
 * e.g. "85512345678" -> "012345678"
 *      "+85512345678" -> "012345678"
 *      "012345678"    -> "012345678"
 */
function normalizePhoneNumber(phone) {
  if (!phone) return phone;

  // strip anything that isn't a digit (spaces, dashes, +, etc.)
  let cleaned = String(phone).replace(/\D/g, '');

  // if it starts with the country code, swap it for a leading 0
  if (cleaned.startsWith('855')) {
    cleaned = '0' + cleaned.slice(3);
  }

  // if somehow it's missing the leading 0 entirely (e.g. "12345678")
  if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }

  return cleaned;
}

module.exports = { normalizePhoneNumber };