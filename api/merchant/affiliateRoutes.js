const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");
const crypto = require('crypto');
const {upload, uploadFileToS3, deleteFileFromS3, uploadMediaFilesToS3} = require("../../database/s3")
const multer = require('multer');
const { sanitizeProductDescription } = require("../../utils/sanatizeHtml");




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






router.post("/affiliate/click", async (req, res) => {
  console.log("Affliate Click Route hit")
  const { merchant_id, offer_id, ip_address, user_agent } = req.body;
  const userId = req.user?.id ?? null; // from your auth middleware, nullable

  const merchant = await zingoPool.query(
    `SELECT tracking_url FROM affiliate_merchants WHERE id = $1 AND is_active = TRUE`,
    [merchant_id]
  );
  console.log("Merchant", merchant.rows)
  if (!merchant.rows[0]) return res.status(404).json({ error: "not found" });

  const click = await zingoPool.query(
    `INSERT INTO affiliate_clicks
       (user_id, merchant_id, offer_id, destination_url, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING click_id`,
    [userId, merchant_id, offer_id, merchant.rows[0].tracking_url, ip_address, user_agent]
  );

  const destination_url = merchant.rows[0].tracking_url.replace(
    "{click_id}",
    click.rows[0].click_id
  );

  res.json({ data: { destination_url } });
});






module.exports = router;