// routes/seo-cafes.js
const express = require("express");
const zingoPool = require("../../database/pgZingo");

const router = express.Router();



const seoCafesCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1hr, matches ISR revalidate

router.get('/seo/best-cafes', async (req, res) => {
    console.log("seo route hit")
  try {
    const { location, limit } = req.query;
    const cacheKey = (location && location.trim().toLowerCase()) || 'all';

    const cached = seoCafesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(200).json(cached.payload);
    }

    const conditions = [`"category" = 'cafe'`];
    const values = [];

    if (location && location.trim()) {
      values.push(`%${location.trim()}%`);
      conditions.push(`"branch_location" ILIKE $${values.length}`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const rowLimit = Math.min(parseInt(limit, 10) || 30, 50);

    const result = await zingoPool.query(
      `SELECT id, name, slug, category, branch_location, description,
              logo_url, map, accent, instagram, is_sponsored, image_paths
       FROM eatdoko_establishments ${whereClause}
       ORDER BY "id" DESC
       LIMIT ${rowLimit}`,
      values
    );

    const rows = result.rows.map((row) => ({
      ...row,
      
    }));

    const payload = { data: rows };
    seoCafesCache.set(cacheKey, { payload, ts: Date.now() });

    res.set('Cache-Control', 'public, max-age=300');
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching SEO cafes:', error);
    return res.status(500).json({ error: 'Failed to fetch cafes.' });
  }
});

module.exports = router;