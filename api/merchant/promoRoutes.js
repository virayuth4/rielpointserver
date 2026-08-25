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
const { generatePromoBaseSlug } = require("../../lib/promoSlugGenerator");


router.get('/promos', async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM rielpoint_promo
      ORDER BY created_at DESC
    `;

    const result = await zingoPool.query(query);

    return res.status(200).json({
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching promos:', error);

    return res.status(500).json({
      error: 'Failed to fetch promos',
    });
  }
});

router.get(
  "/promos/:identifier",
  authenticateFirebaseToken,
  async (req, res) => {
    try {
      const { identifier } = req.params;
      const isNumeric = /^\d+$/.test(identifier);

      const query = `
        SELECT
          id,
          slug,
          merchant_name,
          category,
          title,
          description,
          promo,
          map,
          is_international,
          terms,
          start_at,
          end_at,
          image_paths,
          created_at,
          updated_at,
          foodpanda,
          grabfood
        FROM rielpoint_promo
        WHERE ${isNumeric ? "id = $1" : "slug = $1"}
      `;

      const result = await zingoPool.query(query, [identifier]);

      if (!result.rows.length) {
        return res.status(404).json({ error: "Promo not found." });
      }

      return res.status(200).json({
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Error fetching promo:", error);
      return res.status(500).json({
        error: "Failed to fetch promo.",
      });
    }
  }
);

router.post(
  "/promos/add",
  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([{ name: "images", maxCount: 10 }])(
      req,
      res,
      async (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size is too large. Maximum size is 50MB." });
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({ error: "Too many files. Maximum is 10 images." });
          }
          return res.status(400).json({ error: err.message });
        }
        if (err) return res.status(400).json({ error: err.message });

        try {
          const {
            title,
            category,
            merchant_name,
            promo,
            map,
            is_international,
            terms,
            start_at,
            end_at,
            foodpanda,
            grabfood,
          } = req.body;

          const description = sanitizeProductDescription(req.body.description);

          if (!title?.trim()) return res.status(400).json({ error: "Title is required." });
          if (!category) return res.status(400).json({ error: "Category is required." });
          if (!merchant_name?.trim()) return res.status(400).json({ error: "Merchant name is required." });
          if (!description?.trim()) return res.status(400).json({ error: "Description is required." });
          if (!promo?.trim()) return res.status(400).json({ error: "Promo is required." });
          const isFoodpanda = foodpanda === "true" || foodpanda === true;
          const isGrabfood = grabfood === "true" || grabfood === true;

          if (start_at && end_at && new Date(start_at) > new Date(end_at)) {
            return res.status(400).json({ error: "End date cannot be before start date." });
          }

          const imageFiles = req.files?.images || [];
          const imageUrls = await uploadMediaFilesToS3(
            imageFiles,
            "promos",
            "image",
            { pathPrefix: "affiliate/promos" }
          );

          const isInternational = is_international === "true" || is_international === true;
        const baseSlug = generatePromoBaseSlug(merchant_name, title);

          const query = `
        WITH next_id AS (
          SELECT nextval(pg_get_serial_sequence('rielpoint_promo', 'id')) AS id
        )
        INSERT INTO rielpoint_promo (
          id,
          slug,
          merchant_name,
          category,
          title,
          description,
          promo,
          map,
          is_international,
          foodpanda,
          grabfood,
          terms,
          start_at,
          end_at,
          image_paths
        )
        SELECT
          next_id.id,
          $14 || '-' || next_id.id,
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11, $12, $13
        FROM next_id
        RETURNING id, slug;
      `;

      const values = [
        merchant_name.trim(),
        category,
        title.trim(),
        description.trim(),
        promo.trim(),
        map,
        isInternational,
        isFoodpanda,
        isGrabfood,
        terms?.trim() || null,
        start_at || null,
        end_at || null,
        JSON.stringify(imageUrls),
        baseSlug, // $14
      ];

      const result = await zingoPool.query(query, values);
      const { id: promoId, slug } = result.rows[0];

       

          invalidateFeedCache();

          return res.status(200).json({
            message: "Promo posted successfully",
            data: {
              promoId,
              slug,
              imageUrls,
            },
          });
        } catch (error) {
          console.error("Error processing promo creation:", error);
          return res.status(500).json({
            error: "Failed to process promo creation. Please try again.",
          });
        }
      }
    );
  }
);
router.put(
  "/promos/:id",
  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([{ name: "images", maxCount: 10 }])(
      req,
      res,
      async (err) => {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size is too large. Maximum size is 50MB." });
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({ error: "Too many files. Maximum is 10 images." });
          }
          return res.status(400).json({ error: err.message });
        }
        if (err) return res.status(400).json({ error: err.message });

        try {
          const { id } = req.params;
          const {
            title,
            category,
            merchant_name,
            promo,
            map,
            is_international,
            foodpanda,
            grabfood,
            terms,
            start_at,
            end_at,
            existing_images,
          } = req.body;

          const description = sanitizeProductDescription(req.body.description);

          if (!title?.trim()) return res.status(400).json({ error: "Title is required." });
          if (!category) return res.status(400).json({ error: "Category is required." });
          if (!merchant_name?.trim()) return res.status(400).json({ error: "Merchant name is required." });
          if (!description?.trim()) return res.status(400).json({ error: "Description is required." });
          if (!promo?.trim()) return res.status(400).json({ error: "Promo is required." });

          if (start_at && end_at && new Date(start_at) > new Date(end_at)) {
            return res.status(400).json({ error: "End date cannot be before start date." });
          }

          let keptImages = [];
          if (existing_images) {
            try {
              keptImages = typeof existing_images === "string" ? JSON.parse(existing_images) : existing_images;
              if (!Array.isArray(keptImages)) {
                return res.status(400).json({ error: "Invalid existing images." });
              }
            } catch {
              return res.status(400).json({ error: "Invalid existing images format." });
            }
          }

          const newImageFiles = req.files?.images || [];
          const newImageUrls = await uploadMediaFilesToS3(
            newImageFiles,
            "promos",
            "image",
            { pathPrefix: "affiliate/promos" }
          );

          const allImageUrls = [...keptImages, ...newImageUrls];
          const isInternational = is_international === "true" || is_international === true;
          const isFoodpanda = foodpanda === "true" || foodpanda === true;
          const isGrabfood = grabfood === "true" || grabfood === true;

          // Recalculate slug (Deterministic: merchant + title + ID)
          const baseSlug = generatePromoBaseSlug(merchant_name, title);
          const slug = `${baseSlug}-${id}`;

       const query = `
  UPDATE rielpoint_promo
  SET
    merchant_name = $1,
    title = $2,
    description = $3,
    category = $4,
    promo = $5,
    map = $6,
    is_international = $7,
    foodpanda = $8,
    grabfood = $9,
    terms = $10,
    start_at = $11,
    end_at = $12,
    image_paths = $13,
    slug = $14 || '-' || id::text,
    updated_at = NOW()
  WHERE id = $15
  RETURNING id, slug, image_paths;
`;

const values = [
  merchant_name.trim(),
  title.trim(),
  description.trim(),
  category,
  promo.trim(),
  map || null,
  isInternational,
  isFoodpanda,
  isGrabfood,
  terms?.trim() || null,
  start_at || null,
  end_at || null,
  JSON.stringify(allImageUrls),
  baseSlug, // $14
  id,       // $15
];

          const result = await zingoPool.query(query, values);

          if (!result.rows.length) {
            return res.status(404).json({ error: "Promo not found." });
          }

          invalidateFeedCache();

          return res.status(200).json({
            message: "Promo updated successfully",
            data: {
              promoId: id,
              slug: result.rows[0].slug,
              imageUrls: allImageUrls,
            },
          });
        } catch (error) {
          console.error("Error processing promo update:", error);
          return res.status(500).json({
            error: "Failed to process promo update. Please try again.",
          });
        }
      }
    );
  }
);
module.exports = router;