
const NodeCache = require("node-cache");

// stdTTL: 86400 (24 hours in seconds)
// checkperiod: 3600 (checks for expired keys once every hour)
const feedCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

const getCachedFeed = (key) => {
  return feedCache.get(key);
};

const setCachedFeed = (key, data, ttl) => {
  if (ttl) {
    feedCache.set(key, data, ttl);
  } else {
    feedCache.set(key, data);
  }
};

const invalidateFeedCache = () => {
  feedCache.flushAll();
  console.log("[CACHE FLUSH] Homepage feed cache cleared.");
};

module.exports = {
  feedCache,
  getCachedFeed,
  setCachedFeed,
  invalidateFeedCache
};