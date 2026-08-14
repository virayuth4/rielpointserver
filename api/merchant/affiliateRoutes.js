const express = require("express");
const zingoPool = require("../../database/pgZingo");
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
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const PREFERRED_ORDER = [
      'Flights',
      'Hotels - Singapore',
      'Hotels - Malaysia',
      'Hotels - Phnom Penh',
      'Hotels - Siem Reap'
    ];

    // Category mapping expression
    const categoryMappingSQL = `
      CASE 
        WHEN LOWER(TRIM(ao.category)) = 'travel' THEN 'Flights'
        WHEN LOWER(TRIM(ao.category)) = 'hotels' THEN
          CASE
            WHEN LOWER(ao.description) LIKE '%singapore%' THEN 'Hotels - Singapore'
            WHEN LOWER(ao.description) LIKE '%malaysia%' OR LOWER(ao.description) LIKE '%kuala%' THEN 'Hotels - Malaysia'
            WHEN LOWER(ao.description) LIKE '%siem reap%' THEN 'Hotels - Siem Reap'
            WHEN LOWER(ao.description) LIKE '%phnom penh%' THEN 'Hotels - Phnom Penh'
            WHEN LOWER(ao.description) LIKE '%tokyo%' THEN 'Hotels - Tokyo, Japan'
            WHEN LOWER(ao.description) LIKE '%seoul%' THEN 'Hotels - Seoul, Korea'
            WHEN LOWER(ao.description) LIKE '%shanghai%' THEN 'Hotels - Shanghai, China'
            WHEN LOWER(ao.description) LIKE '%jakarta%' THEN 'Hotels - Jakarta, Indonesia'
            WHEN LOWER(ao.description) LIKE '%hanoi%' THEN 'Hotels - Hanoi, Vietnam'
            ELSE 'Hotels - Other'
          END
        ELSE INITCAP(TRIM(COALESCE(ao.category, 'Other')))
      END
    `;

    // SCENARIO A: Clicking "Load More" for a specific category
   if (category) {
      const paginatedQuery = `
        WITH mapped_offers AS (
          SELECT 
            ao.*,
            to_jsonb(am.*) AS merchant,
            ${categoryMappingSQL} AS resolved_category
          FROM "affiliate_offers" ao
          JOIN "affiliate_merchants" am ON am.id = ao.merchant_id
          WHERE ao.is_active = true AND am.is_active = true
        )
        SELECT 
          to_jsonb(mo) - 'merchant' - 'resolved_category' AS offer,
          mo.merchant
        FROM mapped_offers mo
        WHERE mo.resolved_category = $1
        ORDER BY 
          CASE WHEN LOWER(mo.description) LIKE '%main%' THEN 0 ELSE 1 END,
          mo.created_at DESC
        LIMIT $2 OFFSET $3;
      `;

      const result = await zingoPool.query(paginatedQuery, [category, limit, offset]);

      return res.status(200).json({
        category,
        offers: result.rows.map((row) => ({
          offer: {
            ...row.offer,
            category // Ensure category name matches the resolved group
          },
          merchant: row.merchant
        })),
        hasMore: result.rows.length === parseInt(limit)
      });
    }

    // SCENARIO B: Initial homepage load (Top 8 per category + counts)
    const initialQuery = `
      WITH ranked_offers AS (
        SELECT 
          ao.*,
          to_jsonb(am.*) AS merchant,
          ${categoryMappingSQL} AS resolved_category,
          ROW_NUMBER() OVER (
            PARTITION BY ${categoryMappingSQL}
            ORDER BY 
              CASE WHEN LOWER(ao.description) LIKE '%main%' THEN 0 ELSE 1 END,
              ao.created_at DESC
          ) AS rank_in_cat,
          COUNT(*) OVER (
            PARTITION BY ${categoryMappingSQL}
          ) AS total_in_cat
        FROM "affiliate_offers" ao
        JOIN "affiliate_merchants" am ON am.id = ao.merchant_id
        WHERE ao.is_active = true AND am.is_active = true
      ),
      grouped_categories AS (
        SELECT 
          resolved_category AS category,
          json_agg(
            json_build_object(
              'offer', to_jsonb(ro) - 'merchant' - 'rank_in_cat' - 'resolved_category' - 'total_in_cat',
              'merchant', ro.merchant
            )
            ORDER BY ro.rank_in_cat ASC
          ) AS items,
          MAX(ro.total_in_cat) AS total_count
        FROM ranked_offers ro
        WHERE ro.rank_in_cat <= ${limit}
        GROUP BY resolved_category
      ),
      no_offer_merchants AS (
        SELECT json_agg(to_jsonb(am.*)) AS merchants
        FROM "affiliate_merchants" am
        WHERE am.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM "affiliate_offers" ao 
            WHERE ao.merchant_id = am.id AND ao.is_active = true
          )
      )
      SELECT 
        (
          SELECT json_object_agg(
            gc.category, 
            json_build_object(
              'items', gc.items, 
              'hasMore', (gc.total_count > ${limit})
            )
          ) 
          FROM grouped_categories gc
        ) AS categories,
        (SELECT COALESCE(merchants, '[]'::json) FROM no_offer_merchants) AS merchants_without_offers;
    `;

    const result = await zingoPool.query(initialQuery);
    const row = result.rows[0] || {};
    const categoriesMap = row.categories || {};
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

    return res.status(200).json({
      data: {
        categories: orderedCategories,
        merchantsWithoutOffers: row.merchants_without_offers || []
      }
    });
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