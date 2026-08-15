const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const NodeCache = require("node-cache");
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");
const crypto = require('crypto');
const { upload, uploadFileToS3, deleteFileFromS3, uploadMediaFilesToS3 } = require("../../database/s3");
const multer = require('multer');
const { sanitizeProductDescription } = require("../../utils/sanatizeHtml");
const { invalidateFeedCache } = require("../../utils/feedCacheService");



const CASHBACK_TYPES = ["percentage", "fixed"];

function injectClickIdMacro(url, paramNames = ['trip_sub1']) {
  if (!url) return url;

  let result = url;
  for (const param of paramNames) {
    // matches ?param= or &param= followed by & or end of string (i.e. empty value)
    const emptyParamRegex = new RegExp(`([?&]${param}=)(&|$)`);
    result = result.replace(emptyParamRegex, `$1{click_id}$2`);
  }
  return result;
}

function validateOfferPayload(body) {
  const {
    title,
    category,
    cashback_type,
    cashback_rate,
    fixed_cashback_amount,
    redirect_url,
    merchant_id,
  } = body;

  if (!title || !category || !cashback_type || !redirect_url ||  !merchant_id) {
    return "title, category, cashback_type, redirect_url and merchant_id are required.";
  }

  if (!CASHBACK_TYPES.includes(cashback_type)) {
    return `cashback_type must be one of: ${CASHBACK_TYPES.join(", ")}.`;
  }

  if (cashback_type === "percentage") {
    const rate = parseFloat(cashback_rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      return "cashback_rate must be a valid number between 0 and 100 for percentage offers.";
    }
  }

  if (cashback_type === "fixed") {
    const amount = parseFloat(fixed_cashback_amount);
    if (isNaN(amount) || amount < 0) {
      return "fixed_cashback_amount must be a valid non-negative number for fixed offers.";
    }
  }

  return null;
}


router.get('/affiliate/offers/:merchantId', async (req, res) => {
  try {
    const { merchantId } = req.params;

    const result = await zingoPool.query(
      `SELECT id, merchant_id, category, title, description, cashback_rate, cashback_type,
              fixed_cashback_amount, currency, min_purchase_amount, max_cashback_amount,
              terms, start_at, end_at, is_active, redirect_url, image_paths, created_at, updated_at
       FROM "affiliate_offers"
       WHERE merchant_id = $1
       ORDER BY created_at DESC`,
      [merchantId]
    );

    return res.status(200).json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching offers for merchant:', error);
    return res.status(500).json({ error: 'Failed to fetch offers.' });
  }
});

router.get('/offers', async (req, res) => {
  try {
    const result = await zingoPool.query(
      `SELECT * FROM "affiliate_offers"`,
      []
    );
    return res.status(200).json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching offers:', error);
    return res.status(500).json({ error: 'Failed to fetch offers.' });
  }
});

router.get('/offers/:id', authenticateFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await zingoPool.query(
      `SELECT id, merchant_id, category, title, description, cashback_rate, cashback_type,
              fixed_cashback_amount, currency, min_purchase_amount, max_cashback_amount,
              terms, start_at, end_at, is_active, redirect_url, image_paths, created_at, updated_at
       FROM "affiliate_offers" WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Offer not found' });
    }
    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching offer:', error);
    return res.status(500).json({ error: 'Failed to fetch offer.' });
  }
});

router.delete('/offers/:id', authenticateFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const merchantId = req.user?.id || req.user?.userId;

    const result = await zingoPool.query(
      `DELETE FROM "affiliate_offers" WHERE id = $1 AND merchant_id = $2 RETURNING id, image_paths`,
      [id, merchantId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Offer not found or not owned by you.' });
    }

    const imagePaths = result.rows[0].image_paths || [];
    await Promise.all(
      imagePaths.map((url) =>
        deleteFileFromS3(url).catch((err) =>
          console.error('Error deleting offer image from S3:', err)
        )
      )
    );

    return res.status(200).json({ message: 'Offer deleted successfully' });
  } catch (error) {
    console.error('Error deleting offer:', error);
    return res.status(500).json({ error: 'Failed to delete offer.' });
  }
});

// PUT /api/merchant/offers/:id — update an existing offer
router.put('/offers/:id',
  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([{ name: 'images', maxCount: 10 }])(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size is too large. Maximum size is 50MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files. Maximum is 10 images.' });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }

      try {
        const { id } = req.params;
        const {
          title,
          category,
          cashback_type,
          cashback_rate,
          fixed_cashback_amount,
          currency,
          min_purchase_amount,
          max_cashback_amount,
          terms,
          start_at,
          end_at,
          is_active,
          redirect_url,
          merchant_id,
          existing_images,
        } = req.body;

        const description = sanitizeProductDescription(req.body.description);

        const validationError = validateOfferPayload({ ...req.body, description });
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }

        // Images the client wants to keep (already-uploaded URLs)
        const keptImages = existing_images ? JSON.parse(existing_images) : [];

        // Optionally: diff keptImages against what's currently in the DB and
        // call deleteFileFromS3 for any that were dropped, to avoid orphaned files.

        const newImageFiles = req.files['images'] || [];
        const newImageUrls = await uploadMediaFilesToS3(newImageFiles, merchant_id, 'image', {
          pathPrefix: 'affiliate/offers',
        });

        const allImageUrls = [...keptImages, ...newImageUrls];

        const query = `
          UPDATE "affiliate_offers"
          SET "title" = $1, "description" = $2, "category" = $3, "cashback_rate" = $4,
              "cashback_type" = $5, "fixed_cashback_amount" = $6, "currency" = $7,
              "min_purchase_amount" = $8, "max_cashback_amount" = $9, "terms" = $10,
              "start_at" = $11, "end_at" = $12, "is_active" = $13, "redirect_url" = $14, 
              "image_paths" = $15, "updated_at" = NOW()
          WHERE id = $16 AND merchant_id = $17
          RETURNING id
        `;
        const values = [
          title,
          description,
          category,
          cashback_type === "percentage" ? parseFloat(cashback_rate) : null,
          cashback_type,
          cashback_type === "fixed" ? parseFloat(fixed_cashback_amount) : null,
          currency || "USD",
          min_purchase_amount !== undefined && min_purchase_amount !== "" ? parseFloat(min_purchase_amount) : null,
          max_cashback_amount !== undefined && max_cashback_amount !== "" ? parseFloat(max_cashback_amount) : null,
          terms || null,
          start_at || null,
          end_at || null,
          is_active !== undefined ? Boolean(is_active) : true,
          injectClickIdMacro(redirect_url),
          JSON.stringify(allImageUrls),
          id,
          merchant_id,
       
        ];

        const result = await zingoPool.query(query, values);
        if (!result.rows.length) {
          return res.status(404).json({ error: 'Offer not found or not owned by you.' });
        }

        return res.status(200).json({
          message: 'Offer updated successfully',
          data: { offerId: id, imageUrls: allImageUrls },
        });
      } catch (error) {
        console.error('Error processing offer update:', error);
        return res.status(500).json({ error: 'Failed to process offer update. Please try again.' });
      }
    });
  }
);

// POST /api/merchant/offers/add — create a new offer
router.post('/offers/add',
  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([{ name: 'images', maxCount: 10 }])(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size is too large. Maximum size is 50MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files. Maximum is 10 images.' });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      console.log("offer routes hit")
      try {
        const {
          title,
          category,
          merchant_id,
          cashback_type,
          cashback_rate,
          fixed_cashback_amount,
          currency,
          min_purchase_amount,
          max_cashback_amount,
          terms,
          start_at,
          end_at,
          is_active,
          redirect_url,
        } = req.body;

        const description = sanitizeProductDescription(req.body.description);

        const validationError = validateOfferPayload({ ...req.body, description });
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }

        const imageFiles = req.files['images'] || [];
        const imageUrls = await uploadMediaFilesToS3(imageFiles, merchant_id, 'image', {
          pathPrefix: 'affiliate/offers',
        });

        const query = `
          INSERT INTO "affiliate_offers" (
            "merchant_id", "category", "title", "description", "cashback_rate",
            "cashback_type", "fixed_cashback_amount", "currency", "min_purchase_amount",
            "max_cashback_amount", "terms", "start_at", "end_at", "is_active",
            "redirect_url", "image_paths"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id
        `;
        const values = [
          merchant_id,
          category,
          title,
          description,
          cashback_type === "percentage" ? parseFloat(cashback_rate) : null,
          cashback_type,
          cashback_type === "fixed" ? parseFloat(fixed_cashback_amount) : null,
          currency || "USD",
          min_purchase_amount !== undefined && min_purchase_amount !== "" ? parseFloat(min_purchase_amount) : null,
          max_cashback_amount !== undefined && max_cashback_amount !== "" ? parseFloat(max_cashback_amount) : null,
          terms || null,
          start_at || null,
          end_at || null,
          is_active !== undefined ? Boolean(is_active) : true,
          injectClickIdMacro(redirect_url),
          JSON.stringify(imageUrls),
        ];

        const result = await zingoPool.query(query, values);
        const offerId = result.rows[0].id;


        invalidateFeedCache();
        return res.status(200).json({
          message: 'Offer posted successfully',
          data: { offerId, imageUrls },
        });
      } catch (error) {
        console.error('Error processing offer creation:', error);
        return res.status(500).json({ error: 'Failed to process offer creation. Please try again.' });
      }
    });
  }
);

module.exports = router;