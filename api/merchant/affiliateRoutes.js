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
         SELECT id, tracking_url FROM affiliate_merchants
         WHERE id = $1 AND is_active = TRUE
       ),
       target AS (
         SELECT COALESCE(o.redirect_url, m.tracking_url) AS raw_url
         FROM merchant m
         LEFT JOIN affiliate_offers o
           ON o.id = $4 AND o.merchant_id = m.id
       )
       INSERT INTO affiliate_clicks
         (click_id, user_id, merchant_id, offer_id, destination_url, ip_address, user_agent)
       SELECT $2::uuid, $3, $1, $4,
              replace(target.raw_url, '{click_id}', $2::text),
              $5, $6
       FROM merchant, target
       RETURNING destination_url`,
      [merchant_id, clickId, userId, offer_id ?? null, ip_address, user_agent]
    );

    if (result.rows.length === 0) {
      return res.status(422).json({ error: "Merchant has no tracking URL configured, or offer/merchant not found" });
    }

    const destinationUrl = result.rows[0].destination_url;

    if (!destinationUrl) {
      return res.status(422).json({ error: "No destination URL available for this offer/merchant" });
    }

    return res.json({ data: { destination_url: destinationUrl } });
  } catch (err) {
    console.error("affiliate click error:", err);
    return res.status(500).json({ error: "Failed to log click" });
  }
});


module.exports = router;