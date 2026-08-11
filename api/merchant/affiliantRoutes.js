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





router.get('')






module.exports = router;