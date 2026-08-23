const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "with", "at", "in", "to", "of", "on", "by"
]);
function generatePromoBaseSlug(merchantName, title, wordLimit = 20) {
  const clean = (str) =>
    str
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim();

  const merchantWords = clean(merchantName)
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));

  const merchantWordSet = new Set(merchantWords);

  const titleWords = clean(title)
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w) && !merchantWordSet.has(w));

  const slugText = [...merchantWords, ...titleWords]
    .slice(0, wordLimit)
    .join("-");

  return slugText || "promo";
}
module.exports = { generatePromoBaseSlug };

