// routes/seo-establishments.js
const express = require('express');
const zingoPool = require('../../database/pgZingo');

const router = express.Router();

const CACHE_TTL_MS = 60 * 60 * 1000; // 1hr
const MAX_CACHE_ENTRIES = 500;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

// Only the WHERE clause differs between categories
const CATEGORIES = {
  cafes: {
    where: `"category" = 'cafe'`,
  },
  yakiniku: {
    where: `"category" = 'restaurant'
            AND (cuisines::text ILIKE '%yakiniku%' OR tags::text ILIKE '%yakiniku%')`,
  },
  bakeries: {
    where: `("category" ILIKE '%bakery%'
             OR cuisines::text ILIKE '%bakery%'
             OR tags::text ILIKE '%bakery%')`,
  },
};

const cache = new Map();

function cacheSet(key, payload) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value); // evict oldest
  }
  cache.set(key, { payload, ts: Date.now() });
}

// Escape LIKE wildcards so user input is matched literally
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

router.get('/seo/best/:type', async (req, res) => {
  const { type } = req.params;
  if (!Object.hasOwn(CATEGORIES, type)) {
    return res.status(404).json({ error: 'Unknown category.' });
  }

  try {
    const location = (req.query.location || '').trim();
    const rowLimit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const cacheKey = `${type}:${location.toLowerCase() || 'all'}:${rowLimit}`;

    res.set('Cache-Control', 'public, max-age=300');

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return res.status(200).json(cached.payload);
    }

    const conditions = [CATEGORIES[type].where];
    const values = [];

    if (location) {
      values.push(`%${escapeLike(location)}%`);
      conditions.push(`"branch_location" ILIKE $${values.length}`);
    }

    const result = await zingoPool.query(
      `SELECT *
       FROM eatdoko_establishments
       WHERE ${conditions.join(' AND ')}
       ORDER BY "id" DESC
       LIMIT ${rowLimit}`,
      values
    );

    const payload = { data: result.rows };
    cacheSet(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error) {
    console.error(`Error fetching SEO ${type}:`, error);
    return res.status(500).json({ error: `Failed to fetch ${type}.` });
  }
});

module.exports = router;