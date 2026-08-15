const express = require("express");
const zingoPool = require("../../database/pgZingo");
const NodeCache = require("node-cache");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");
const {crypto, randomUUID} = require('crypto');
const {upload, uploadFileToS3, deleteFileFromS3, uploadMediaFilesToS3} = require("../../database/s3")
const multer = require('multer');
const { sanitizeProductDescription } = require("../../utils/sanatizeHtml");
const optionalFirebaseAuth = require("../../auth/optionalAuthenticateFirebaseToken");
const { getCachedFeed, setCachedFeed } = require("../../utils/feedCacheService");



router.get('/affiliate/offers/:merchantId', async (req, res) => {
  console.log("Affiliate Offers Merchant Route hit")
  try {
    const { merchantId } = req.params;

    const result = await zingoPool.query(
      `SELECT * FROM affiliate_offers WHERE merchant_id = $1`,
      [merchantId]
    );

    return res.status(200).json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching affiliate offers:', error);
    return res.status(500).json({ error: 'Failed to fetch affiliate offers.' });
  }
});



// GET /api/merchant/affiliate/homepage-feed
router.get('/affiliate/homepage-feed', async (req, res) => {
  try {
    const { category, page = 1, limit = 8 } = req.query;
    const parsedLimit = parseInt(limit, 10);
    const parsedPage = parseInt(page, 10);
    const offset = (parsedPage - 1) * parsedLimit;

    // Cache key
    const cacheKey = `feed:${category || 'initial'}:p${parsedPage}:l${parsedLimit}`;
    const cachedResponse = getCachedFeed(cacheKey);
    
    if (cachedResponse) {
      console.log(`[CACHE HIT] Serving from memory for key: ${cacheKey}`);
      return res.status(200).json(cachedResponse);
    }

    console.log(`[CACHE MISS] Fetching from DB & calculating for key: ${cacheKey}`);

    const PREFERRED_ORDER = [
      'Flights',
      'Hotels - Singapore',
      'Hotels - Malaysia',
      'Hotels - Phnom Penh',
      'Hotels - Siem Reap'
    ];

    // Helper to resolve category dynamically in JS
    const resolveCategory = (rawCategory, description = '') => {
      const cat = (rawCategory || '').trim().toLowerCase();
      const desc = (description || '').toLowerCase();

      if (cat === 'travel') return 'Flights';
      if (cat === 'hotels') {
        if (desc.includes('singapore')) return 'Hotels - Singapore';
        if (desc.includes('malaysia') || desc.includes('kuala')) return 'Hotels - Malaysia';
        if (desc.includes('siem reap')) return 'Hotels - Siem Reap';
        if (desc.includes('phnom penh')) return 'Hotels - Phnom Penh';
        if (desc.includes('tokyo')) return 'Hotels - Tokyo, Japan';
        if (desc.includes('seoul')) return 'Hotels - Seoul, Korea';
        if (desc.includes('shanghai')) return 'Hotels - Shanghai, China';
        if (desc.includes('jakarta')) return 'Hotels - Jakarta, Indonesia';
        if (desc.includes('hanoi')) return 'Hotels - Hanoi, Vietnam';
        if (desc.includes('minh')) return 'Hotels - Ho Chi Minh, Vietnam';
        return 'Hotels - Other';
      }

      if (!rawCategory) return 'Other';
      return rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1).toLowerCase();
    };

    // Helper to sort offers: descriptions with 'main' come first, then newest
    const sortOffers = (a, b) => {
      const aMain = (a.description || '').toLowerCase().includes('main') ? 0 : 1;
      const bMain = (b.description || '').toLowerCase().includes('main') ? 0 : 1;
      if (aMain !== bMain) return aMain - bMain;
      return new Date(b.created_at) - new Date(a.created_at);
    };

    // -------------------------------------------------------------
    // SCENARIO A: Load More for a specific category
    // -------------------------------------------------------------
    if (category) {
      const query = `
        SELECT 
          ao.*,
          to_jsonb(am.*) AS merchant
        FROM affiliate_offers ao
        JOIN affiliate_merchants am ON am.id = ao.merchant_id
        WHERE ao.is_active = true AND am.is_active = true
      `;
      const result = await zingoPool.query(query);

      // Filter and group in JS
      const filteredOffers = result.rows
        .filter((row) => resolveCategory(row.category, row.description) === category)
        .sort(sortOffers);

      const paginatedOffers = filteredOffers.slice(offset, offset + parsedLimit);

      const responsePayload = {
        category,
        offers: paginatedOffers.map((row) => {
          const { merchant, ...offerData } = row;
          return {
            offer: {
              ...offerData,
              category
            },
            merchant
          };
        }),
        hasMore: offset + parsedLimit < filteredOffers.length
      };

      setCachedFeed(cacheKey, responsePayload);
      console.log(`[CACHE SET] Cached response for key: ${cacheKey}`);
      return res.status(200).json(responsePayload);
    }

    // -------------------------------------------------------------
    // SCENARIO B: Initial homepage load
    // -------------------------------------------------------------
    const [offersResult, merchantsResult] = await Promise.all([
      zingoPool.query(`
        SELECT 
          ao.*,
          to_jsonb(am.*) AS merchant
        FROM affiliate_offers ao
        JOIN affiliate_merchants am ON am.id = ao.merchant_id
        WHERE ao.is_active = true AND am.is_active = true
      `),
      zingoPool.query(`
        SELECT am.*
        FROM affiliate_merchants am
        WHERE am.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM affiliate_offers ao 
            WHERE ao.merchant_id = am.id AND ao.is_active = true
          )
      `)
    ]);

    // Group offers by resolved category
    const categoryBuckets = {};

    offersResult.rows.forEach((row) => {
      const resolvedCat = resolveCategory(row.category, row.description);
      if (!categoryBuckets[resolvedCat]) {
        categoryBuckets[resolvedCat] = [];
      }
      categoryBuckets[resolvedCat].push(row);
    });

    const categoriesMap = {};
    Object.keys(categoryBuckets).forEach((catName) => {
      const sorted = categoryBuckets[catName].sort(sortOffers);
      const items = sorted.slice(0, parsedLimit).map((row) => {
        const { merchant, ...offerData } = row;
        return {
          offer: {
            ...offerData,
            category: catName
          },
          merchant
        };
      });

      categoriesMap[catName] = {
        items,
        hasMore: sorted.length > parsedLimit
      };
    });

    // Apply preferred ordering
    const allCategories = Object.keys(categoriesMap);
    const orderedKeys = [
      ...PREFERRED_ORDER.filter((c) => allCategories.includes(c)),
      ...allCategories
        .filter((c) => !PREFERRED_ORDER.includes(c))
        .sort((a, b) => a.localeCompare(b))
    ];

    const orderedCategories = {};
    orderedKeys.forEach((key) => {
      orderedCategories[key] = categoriesMap[key];
    });

    const responsePayload = {
      data: {
        categories: orderedCategories,
        merchantsWithoutOffers: merchantsResult.rows || []
      }
    };

    setCachedFeed(cacheKey, responsePayload);
    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('Error fetching homepage feed:', error);
    return res.status(500).json({ error: 'Failed to fetch homepage feed.' });
  }
});

router.get('/affiliate/merchants', async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    const result = await zingoPool.query(
      `SELECT
         am.*,
         COALESCE(
           json_agg(to_jsonb(ao) ORDER BY ao."created_at" DESC)
             FILTER (WHERE ao."id" IS NOT NULL),
           '[]'
         ) AS offers
       FROM "affiliate_merchants" am
       LEFT JOIN "affiliate_offers" ao
         ON ao."merchant_id" = am."id"
       GROUP BY am."id"
      `
    );

    return res.status(200).json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching affiliate merchants:', error);
    return res.status(500).json({ error: 'Failed to fetch affiliate merchants.' });
  }
});




router.post("/affiliate/click", optionalFirebaseAuth, async (req, res) => {
  try {
    const { merchant_id, offer_id, ip_address, user_agent } = req.body;
    const userId = req.user?.id ?? null;

    if (!merchant_id) {
      return res.status(400).json({ error: "merchant_id is required" });
    }

    const clickId = randomUUID();

      const result = await zingoPool.query(
      `WITH merchant AS (
  SELECT id, tracking_url, name, logo_url FROM affiliate_merchants
  WHERE id = $1 AND is_active = TRUE
),
target AS (
  SELECT COALESCE(o.redirect_url, m.tracking_url) AS raw_url,
         m.name AS merchant_name,
         m.logo_url AS merchant_logo_url
  FROM merchant m
  LEFT JOIN affiliate_offers o
    ON o.id = $4 AND o.merchant_id = m.id
)
INSERT INTO affiliate_clicks
  (click_id, user_id, merchant_id, offer_id, destination_url, ip_address, user_agent)
SELECT $2::uuid, $3, $1, $4,
       replace(target.raw_url, '{click_id}', $2::text),
       $5, $6
FROM target
RETURNING destination_url,
          (SELECT merchant_name FROM target) AS merchant_name,
          (SELECT merchant_logo_url FROM target) AS merchant_logo_url`,
      [merchant_id, clickId, userId, offer_id ?? null, ip_address, user_agent]
    );

    if (result.rows.length === 0) {
      return res.status(422).json({ error: "Merchant has no tracking URL configured, or offer/merchant not found" });
    }

    const { destination_url, merchant_name, merchant_logo_url } = result.rows[0];

    if (!destination_url) {
      return res.status(422).json({ error: "No destination URL available for this offer/merchant" });
    }

    return res.json({
      data: {
        destination_url,
        merchant_name,
        merchant_logo_url,
      },
    });
  } catch (err) {
    console.error("affiliate click error:", err);
    return res.status(500).json({ error: "Failed to log click" });
  }
});


module.exports = router;