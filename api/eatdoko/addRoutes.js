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

const TABLE = "eatdoko_establishments";
const MAX_IMAGES = 10;

function slugify(text) {
  return (text || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// excludeId should be the numeric id of the row being edited (or null/undefined when creating)
async function isSlugTaken(slug, excludeId = null) {
  const query = excludeId
    ? `SELECT 1 FROM "${TABLE}" WHERE "slug" = $1 AND "id" != $2`
    : `SELECT 1 FROM "${TABLE}" WHERE "slug" = $1`;
  const values = excludeId ? [slug, excludeId] : [slug];
  const result = await zingoPool.query(query, values);
  return result.rowCount > 0;
}

// Safely parse a JSON array of existing image urls sent from the frontend
function parseExistingImagePaths(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === "string" && u.trim()) : [];
  } catch {
    return [];
  }
}

const uploadFields = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'images', maxCount: MAX_IMAGES },
]);

function handleMulter(req, res, next) {
  uploadFields(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size is too large. Maximum size is 50MB.' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: `You can upload up to ${MAX_IMAGES} images.` });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

// ---------------------------------------------------------------------------
// GET /establishments  (list all, optional ?category=)
// ---------------------------------------------------------------------------
router.get('/establishments', async (req, res) => {
    console.log("Getting all Establishments")
  try {
    const { category } = req.query;

    const conditions = [];
    const values = [];

    if (category && category.trim() && category.trim().toLowerCase() !== 'all') {
      values.push(category.trim());
      conditions.push(`"category" = $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await zingoPool.query(
      `SELECT * FROM "${TABLE}" ${whereClause} ORDER BY "id" DESC`,
      values
    );

    const rows = result.rows.map((row) => ({
      ...row,
      image_paths: parseExistingImagePaths(row.image_paths),
    }));

    const categoriesResult = await zingoPool.query(
      `SELECT DISTINCT "category" FROM "${TABLE}" WHERE "category" IS NOT NULL AND "category" != '' ORDER BY "category" ASC`
    );
    const categories = categoriesResult.rows.map((r) => r.category);

    return res.status(200).json({ data: rows, categories });
  } catch (error) {
    console.error('Error fetching establishments:', error);
    return res.status(500).json({ error: 'Failed to fetch establishments. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /establishment/eatdoko-establishments/:id
// ---------------------------------------------------------------------------
router.get('/establishment/eatdoko-establishments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid establishment id.' });
    }

    const result = await zingoPool.query(
      `SELECT * FROM "${TABLE}" WHERE "id" = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    const row = result.rows[0];
    // image_paths comes back already parsed as an array from pg's jsonb handling,
    // but guard against it being null/stringified depending on driver config.
    row.image_paths = parseExistingImagePaths(row.image_paths);

    return res.status(200).json({ data: row });
  } catch (error) {
    console.error('Error fetching establishment:', error);
    return res.status(500).json({ error: 'Failed to fetch establishment. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /establishments/add
// ---------------------------------------------------------------------------
router.post('/establishments/add', handleMulter, async (req, res) => {
  console.log("eatdoko establishment add route hit")

  try {
    const {
      name,
      category,
      branch_location,
      description,
      map,
      accent,
      instagram,
      is_sponsored,
      in_roll,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const slug = (req.body.slug || slugify(name)).trim().toLowerCase();

    if (!slug) {
      return res.status(400).json({ error: 'Slug is required.' });
    }

    if (await isSlugTaken(slug)) {
      return res.status(400).json({ error: 'That slug is already in use by another establishment.' });
    }

    const imageFiles = req.files?.['images'] || [];
    if (imageFiles.length > MAX_IMAGES) {
      return res.status(400).json({ error: `You can upload up to ${MAX_IMAGES} images.` });
    }

    const logoFile = req.files?.['logo']?.[0];
    let logoUrl = null;
    if (logoFile) {
      const uploaded = await uploadMediaFilesToS3([logoFile], slug, 'image', {
        pathPrefix: 'eatdoko/establishments',
      });
      logoUrl = uploaded[0] || null;
    }

    let imagePaths = [];
    if (imageFiles.length) {
      imagePaths = await uploadMediaFilesToS3(imageFiles, slug, 'image', {
        pathPrefix: 'eatdoko/establishments/gallery',
      });
    }

    const query = `
      INSERT INTO "${TABLE}" (
        "name", "slug", "category", "branch_location", "description",
        "logo_url", "image_paths", "map", "accent", "instagram", "is_sponsored", "in_roll"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `;
    const values = [
      name.trim(),
      slug,
      category ? category.trim() : null,
      branch_location ? branch_location.trim() : null,
      description ? description.trim() : null,
      logoUrl,
      JSON.stringify(imagePaths),
      map ? map.trim() : null,
      accent ? accent.trim() : null,
      instagram ? instagram.trim() : null,
      is_sponsored === 'true' || is_sponsored === true,
      in_roll !== undefined ? Boolean(in_roll) : true,
    ];

    const result = await zingoPool.query(query, values);
    const establishmentId = result.rows[0].id;

    invalidateFeedCache?.();

    return res.status(200).json({
      message: 'Establishment created successfully',
      data: { establishmentId, logo_url: logoUrl, image_paths: imagePaths },
    });
  } catch (error) {
    console.error('Error processing establishment creation:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'That slug is already in use by another establishment.' });
    }
    return res.status(500).json({ error: 'Failed to process establishment creation. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /establishment/eatdoko-establishments/:id
// ---------------------------------------------------------------------------
router.put('/establishment/eatdoko-establishments/:id', handleMulter, async (req, res) => {
  const { id } = req.params;

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid establishment id.' });
  }

  try {
    const existingResult = await zingoPool.query(
      `SELECT * FROM "${TABLE}" WHERE "id" = $1`,
      [id]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Establishment not found.' });
    }

    const existing = existingResult.rows[0];
    const existingImagePaths = parseExistingImagePaths(existing.image_paths);

    const {
      name,
      category,
      branch_location,
      description,
      map,
      accent,
      instagram,
      is_sponsored,
      in_roll,
      existing_logo_url,
      existing_image_paths, // JSON-stringified array of urls the user chose to KEEP
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const slug = (req.body.slug || slugify(name)).trim().toLowerCase();

    if (!slug) {
      return res.status(400).json({ error: 'Slug is required.' });
    }

    if (await isSlugTaken(slug, id)) {
      return res.status(400).json({ error: 'That slug is already in use by another establishment.' });
    }

    // ---- Logo ----
    const logoFile = req.files?.['logo']?.[0];
    let logoUrl = existing.logo_url;

    if (logoFile) {
      const uploaded = await uploadMediaFilesToS3([logoFile], slug, 'image', {
        pathPrefix: 'eatdoko/establishments',
      });
      logoUrl = uploaded[0] || null;

      if (existing.logo_url) {
        await deleteFileFromS3?.(existing.logo_url).catch((e) =>
          console.error('Failed to delete old logo from S3:', e)
        );
      }
    } else if (existing.logo_url && !existing_logo_url) {
      await deleteFileFromS3?.(existing.logo_url).catch((e) =>
        console.error('Failed to delete old logo from S3:', e)
      );
      logoUrl = null;
    }

    // ---- Gallery images ----
    const keptImagePaths = parseExistingImagePaths(existing_image_paths);
    const removedImagePaths = existingImagePaths.filter((url) => !keptImagePaths.includes(url));

    const newImageFiles = req.files?.['images'] || [];

    if (keptImagePaths.length + newImageFiles.length > MAX_IMAGES) {
      return res.status(400).json({ error: `You can upload up to ${MAX_IMAGES} images total.` });
    }

    let uploadedImagePaths = [];
    if (newImageFiles.length) {
      uploadedImagePaths = await uploadMediaFilesToS3(newImageFiles, slug, 'image', {
        pathPrefix: 'eatdoko/establishments/gallery',
      });
    }

    if (removedImagePaths.length) {
      await Promise.all(
        removedImagePaths.map((url) =>
          deleteFileFromS3?.(url).catch((e) =>
            console.error('Failed to delete removed gallery image from S3:', e)
          )
        )
      );
    }

    const finalImagePaths = [...keptImagePaths, ...uploadedImagePaths];

    const query = `
      UPDATE "${TABLE}"
      SET "name" = $1,
          "slug" = $2,
          "category" = $3,
          "branch_location" = $4,
          "description" = $5,
          "logo_url" = $6,
          "image_paths" = $7,
          "map" = $8,
          "accent" = $9,
          "instagram" = $10,
          "is_sponsored" = $11,
          "in_roll" = $12
      WHERE "id" = $13
      RETURNING id
    `;
    const values = [
      name.trim(),
      slug,
      category ? category.trim() : null,
      branch_location ? branch_location.trim() : null,
      description ? description.trim() : null,
      logoUrl,
      JSON.stringify(finalImagePaths),
      map ? map.trim() : null,
      accent ? accent.trim() : null,
      instagram ? instagram.trim() : null,
      is_sponsored !== undefined ? Boolean(is_sponsored) : false,
      in_roll !== undefined ? Boolean(in_roll) : true,
      id,
    ];

    await zingoPool.query(query, values);

    invalidateFeedCache?.();

    return res.status(200).json({
      message: 'Establishment updated successfully',
      data: { establishmentId: id, logo_url: logoUrl, image_paths: finalImagePaths },
    });
  } catch (error) {
    console.error('Error processing establishment update:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'That slug is already in use by another establishment.' });
    }
    return res.status(500).json({ error: 'Failed to process establishment update. Please try again.' });
  }
});

module.exports = router;