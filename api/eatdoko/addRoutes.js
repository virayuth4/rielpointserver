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

async function sendEstablishmentListingTelegramNotification(data) {
  const { name, location, description } = data;

  const message =
    `☕ New Cafe Recommendation\n\n` +
    `Cafe Name: ${name || "N/A"}\n` +
    `Location: ${location || "N/A"}\n` +
    (description ? `${description}\n` : "");

    console.log("Message", message)

  try {
    const botToken = String(process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim());
    const chatId = Number(process.env.TELEGRAM_CHAT_ID?.trim());

    if (!botToken || !chatId) {
      throw new Error("Telegram bot token or chat ID is missing");
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    await axios.post(url, {
      chat_id: chatId,
      text: message,
    });

    console.log("Establishment recommendation sent to Telegram successfully");
    return { success: true };
  } catch (error) {
    console.error("Error sending Telegram notification:", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

async function sendPartnerRequestTelegramNotification(partnerRequest) {
  const {
    cafeName,
    location,
    tier,
    googleMapsUrl,
    contactTelegram,
    notes,
  } = partnerRequest;

  const message =
    `🤝 New Cafe Partner Request\n\n` +
    `Cafe Name: ${cafeName || "N/A"}\n` +
    `Tier: ${tier || "Free"}\n` +
    `Location: ${location || "N/A"}\n` +
    `Contact Telegram: ${contactTelegram || "N/A"}\n` +
    `Maps URL: ${googleMapsUrl || "N/A"}\n` +
    (notes ? `Notes: ${notes}\n` : "");

  try {
    const botToken = String(process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim());
    const chatId = Number(process.env.TELEGRAM_CHAT_ID?.trim());

    if (!botToken || !chatId) {
      throw new Error("Telegram bot token or chat ID is missing");
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    await axios.post(url, {
      chat_id: chatId,
      text: message,
    });

    console.log("Partner request sent to Telegram successfully");
    return { success: true };
  } catch (error) {
    console.error("Error sending Telegram notification:", error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

const TABLE = "eatdoko_establishments";
const MAX_IMAGES = 10;
const PRODUCTS_TABLE = 'eatdoko_products';
const ALLOWED_CATEGORIES = ['Drinks', 'Food'];

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

async function isProductSlugTaken(shopId, slug, excludeId = null) {
  const query = excludeId
    ? `SELECT 1 FROM "${PRODUCTS_TABLE}" WHERE "shop_id" = $1 AND "slug" = $2 AND "id" != $3`
    : `SELECT 1 FROM "${PRODUCTS_TABLE}" WHERE "shop_id" = $1 AND "slug" = $2`;
  const values = excludeId ? [shopId, slug, excludeId] : [shopId, slug];
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

function normalizeField(value) {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function parseCuisineInput(raw, category) {
  console.log("raw", raw)
  console.log("category", category)
  if (normalizeField(category).toLowerCase() !== 'restaurant') return null;

  const rawValue = Array.isArray(raw) ? raw[0] : raw;
  if (!rawValue) return null;

  let list;
  try {
    const parsed = JSON.parse(rawValue);
    list = Array.isArray(parsed) ? parsed : String(rawValue).split(',');
  } catch {
    list = String(rawValue).split(',');
  }

  const cleaned = list.map((c) => String(c).trim().toLowerCase()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}       

const uploadFields = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'images', maxCount: MAX_IMAGES },
  { name: 'image', maxCount: 1 },
  
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


const establishmentsCache = new Map();
const CACHE_TTL_MS = 600  * 1000;
// ---------------------------------------------------------------------------
// GET /establishments  (list all, optional ?category=)
// ---------------------------------------------------------------------------
router.get('/establishments', async (req, res) => {
  try {
    const { category } = req.query;
    const cacheKey = (category && category.trim().toLowerCase()) || 'all';
    const cached = establishmentsCache.get(cacheKey);

    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      const ageMs = Date.now() - cached.ts;
      console.log(`[establishments] CACHE HIT key="${cacheKey}" age=${ageMs}ms`);
      res.set('Cache-Control', 'public, max-age=30');
      return res.status(200).json(cached.payload);
    }

    console.log(`[establishments] CACHE MISS key="${cacheKey}" (${cached ? 'expired' : 'not found'}) — querying DB`);

    const conditions = [];
    const values = [];

    if (category && category.trim() && category.trim().toLowerCase() !== 'all') {
      values.push(`%${category.trim()}%`);
      conditions.push(`"category" ILIKE $${values.length}`);
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

    const payload = { data: rows, categories };
    establishmentsCache.set(cacheKey, { payload, ts: Date.now() });
    console.log(`[establishments] CACHE SET key="${cacheKey}" rows=${rows.length}`);

    res.set('Cache-Control', 'public, max-age=30');
    return res.status(200).json(payload);
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
      cuisine,
      price_range
    } = req.body;
        console.log("req body", req.body)

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

    const cuisineValue = parseCuisineInput(cuisine, category);


    const query = `
  INSERT INTO "${TABLE}" (
    "name", "slug", "category", "branch_location", "description",
    "logo_url", "image_paths", "map", "accent", "instagram", "is_sponsored", "in_roll", "cuisines", "price_range"
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
  cuisineValue ? JSON.stringify(cuisineValue) : null,
  price_range ? price_range.trim(): null,
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
      cuisine,
      price_range
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
    const cuisineValue = parseCuisineInput(cuisine, category);


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
      "in_roll" = $12,
      "cuisines" = $13,
      "price_range" = $14
  WHERE "id" = $15
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
  cuisineValue ? JSON.stringify(cuisineValue) : null,
  price_range ? price_range.trim() : null,
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


router.post('/establishments/listing/request', async (req, res) => {
  try {
    const requestData = req.body;

    // Send the notification without saving to any DB
    const result = await sendEstablishmentListingTelegramNotification(requestData);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send listing request notification',
        error: result.error
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Establishment listing request received and forwarded successfully'
    });
  } catch (error) {
    console.error('Listing request route error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.post('/establishment/partner/request', async (req,res) => {
  try {
    const requestData = req.body;
    const result = await sendPartnerRequestTelegramNotification(requestData);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: "Failed to send partner notification",
        error: result.error,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Partner request sent successfully",
    });
  } catch (error) {
    console.error("Partner route error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
})

// ---------------------------------------------------------------------------
// GET /product/eatdoko-products/:id
// ---------------------------------------------------------------------------
router.get('/product/eatdoko-products/:id', async (req, res) => {
  try {
    const { id } = req.params;
 
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid product id.' });
    }
 
    const result = await zingoPool.query(
      `SELECT * FROM "${PRODUCTS_TABLE}" WHERE "id" = $1`,
      [id]
    );
 
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }
 
    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching product:', error);
    return res.status(500).json({ error: 'Failed to fetch product. Please try again.' });
  }
});
 
// ---------------------------------------------------------------------------
// POST /products/add
// ---------------------------------------------------------------------------
router.post('/products/add', handleMulter, async (req, res) => {
  console.log("adding products")
  try {
    const {
      shop_id,
      name,
      category,
      subcategory,
      description,
      price,
      grab_link,
      foodpanda_link,
      is_sponsored,
      is_available,
    } = req.body;
 
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
 
    if (!shop_id || !/^\d+$/.test(String(shop_id))) {
      return res.status(400).json({ error: 'A valid shop is required.' });
    }
 
    if (!category || !ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}.` });
    }
 
    let parsedPrice = null;
    if (price !== undefined && price !== '') {
      parsedPrice = Number(price);
      if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
        return res.status(400).json({ error: 'Price must be a valid non-negative number.' });
      }
    }
 
    const slug = (req.body.slug || slugify(name)).trim().toLowerCase();
 
    if (!slug) {
      return res.status(400).json({ error: 'Slug is required.' });
    }
 
    if (await isProductSlugTaken(shop_id, slug)) {
      return res.status(400).json({ error: 'That slug is already in use by another product at this shop.' });
    }
 
    const imageFile = req.files?.['image']?.[0];
    let imageUrl = null;
    if (imageFile) {
      const uploaded = await uploadMediaFilesToS3([imageFile], slug, 'image', {
        pathPrefix: 'eatdoko/products',
      });
      imageUrl = uploaded[0] || null;
    }
 
   const query = `
  INSERT INTO "${PRODUCTS_TABLE}" (
    "shop_id", "name", "slug", "category", "subcategory",
    "description", "price", "image_url", "grab_link", "foodpanda_link",
    "is_sponsored", "is_available"
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING id
`;
const values = [
  shop_id,
  name.trim(),
  slug,
  category,
  subcategory ? subcategory.trim() : null,
  description ? description.trim() : null,
  parsedPrice,
  imageUrl,
  grab_link ? grab_link.trim() : null,
  foodpanda_link ? foodpanda_link.trim() : null,
  is_sponsored === 'true' || is_sponsored === true,
  is_available === undefined ? true : (is_available === 'true' || is_available === true),
];
 
    const result = await zingoPool.query(query, values);
    const productId = result.rows[0].id;
 
    invalidateFeedCache?.();
 
    return res.status(200).json({
      message: 'Product created successfully',
      data: { productId, image_url: imageUrl },
    });
  } catch (error) {
    console.error('Error processing product creation:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'That slug is already in use by another product at this shop.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'That shop does not exist.' });
    }
    return res.status(500).json({ error: 'Failed to process product creation. Please try again.' });
  }
});
 
// ---------------------------------------------------------------------------
// PUT /product/eatdoko-products/:id
// ---------------------------------------------------------------------------
router.put('/products/eatdoko-products/:id', handleMulter, async (req, res) => {
  console.log("editing products")
  const { id } = req.params;
 
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid product id.' });
  }
 
  try {
    const existingResult = await zingoPool.query(
      `SELECT * FROM "${PRODUCTS_TABLE}" WHERE "id" = $1`,
      [id]
    );
 
    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Product not found.' });
    }
 
    const existing = existingResult.rows[0];
 
    const {
      shop_id,
      name,
      category,
      subcategory,
      description,
      price,
        grab_link,
  foodpanda_link,
      is_sponsored,
      is_available,
      existing_image_url,
    } = req.body;
 
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
 
    const effectiveShopId = shop_id || existing.shop_id;
    if (!/^\d+$/.test(String(effectiveShopId))) {
      return res.status(400).json({ error: 'A valid shop is required.' });
    }
 
    const effectiveCategory = category || existing.category;
    if (!ALLOWED_CATEGORIES.includes(effectiveCategory)) {
      return res.status(400).json({ error: `Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}.` });
    }
 
    let parsedPrice = existing.price;
    if (price !== undefined) {
      parsedPrice = price === '' ? null : Number(price);
      if (parsedPrice !== null && (Number.isNaN(parsedPrice) || parsedPrice < 0)) {
        return res.status(400).json({ error: 'Price must be a valid non-negative number.' });
      }
    }
 
    const slug = (req.body.slug || slugify(name)).trim().toLowerCase();
 
    if (!slug) {
      return res.status(400).json({ error: 'Slug is required.' });
    }
 
    if (await isProductSlugTaken(effectiveShopId, slug, id)) {
      return res.status(400).json({ error: 'That slug is already in use by another product at this shop.' });
    }
 
    // ---- Image ----
    const imageFile = req.files?.['image']?.[0];
    let imageUrl = existing.image_url;
 
    if (imageFile) {
      const uploaded = await uploadMediaFilesToS3([imageFile], slug, 'image', {
        pathPrefix: 'eatdoko/products',
      });
      imageUrl = uploaded[0] || null;
 
      if (existing.image_url) {
        await deleteFileFromS3?.(existing.image_url).catch((e) =>
          console.error('Failed to delete old product image from S3:', e)
        );
      }
    } else if (existing.image_url && !existing_image_url) {
      await deleteFileFromS3?.(existing.image_url).catch((e) =>
        console.error('Failed to delete old product image from S3:', e)
      );
      imageUrl = null;
    }
 
  const query = `
  UPDATE "${PRODUCTS_TABLE}"
  SET "shop_id" = $1,
      "name" = $2,
      "slug" = $3,
      "category" = $4,
      "subcategory" = $5,
      "description" = $6,
      "price" = $7,
      "image_url" = $8,
      "grab_link" = $9,
      "foodpanda_link" = $10,
      "is_sponsored" = $11,
      "is_available" = $12
  WHERE "id" = $13
  RETURNING id
`;
const values = [
  effectiveShopId,
  name.trim(),
  slug,
  effectiveCategory,
  subcategory !== undefined ? (subcategory ? subcategory.trim() : null) : existing.subcategory,
  description !== undefined ? (description ? description.trim() : null) : existing.description,
  parsedPrice,
  imageUrl,
  grab_link !== undefined ? (grab_link ? grab_link.trim() : null) : existing.grab_link,
  foodpanda_link !== undefined ? (foodpanda_link ? foodpanda_link.trim() : null) : existing.foodpanda_link,
  is_sponsored !== undefined ? (is_sponsored === 'true' || is_sponsored === true) : existing.is_sponsored,
  is_available !== undefined ? (is_available === 'true' || is_available === true) : existing.is_available,
  id,
];
 
    await zingoPool.query(query, values);
 
    invalidateFeedCache?.();
 
    return res.status(200).json({
      message: 'Product updated successfully',
      data: { productId: id, image_url: imageUrl },
    });
  } catch (error) {
    console.error('Error processing product update:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'That slug is already in use by another product at this shop.' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'That shop does not exist.' });
    }
    return res.status(500).json({ error: 'Failed to process product update. Please try again.' });
  }
});


router.get('/products', async (req, res) => {
  try {
    const { category, shop_id } = req.query;

    const cacheKeyParts = [
      (category && category.trim().toLowerCase()) || 'all',
      (shop_id && String(shop_id).trim()) || 'all-shops',
    ];
    const cacheKey = cacheKeyParts.join(':');

    const cached = productsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      const ageMs = Date.now() - cached.ts;
      console.log(`[products] CACHE HIT key="${cacheKey}" age=${ageMs}ms`);
      res.set('Cache-Control', 'public, max-age=30');
      return res.status(200).json(cached.payload);
    }

    console.log(`[products] CACHE MISS key="${cacheKey}" (${cached ? 'expired' : 'not found'}) — querying DB`);

    const conditions = [];
    const values = [];

    if (category && category.trim() && category.trim().toLowerCase() !== 'all') {
      values.push(category.trim());
      conditions.push(`"category" = $${values.length}`);
    }

    if (shop_id && String(shop_id).trim()) {
      values.push(shop_id.trim());
      conditions.push(`"shop_id" = $${values.length}`);
    }

    // Only surface products that are actually purchasable for the roll
    conditions.push(`"is_available" = true`);

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await zingoPool.query(
      `SELECT * FROM "${PRODUCTS_TABLE}" ${whereClause} ORDER BY "id" DESC`,
      values
    );

    const categoriesResult = await zingoPool.query(
      `SELECT DISTINCT "category" FROM "${PRODUCTS_TABLE}" WHERE "category" IS NOT NULL AND "category" != '' ORDER BY "category" ASC`
    );
    const categories = categoriesResult.rows.map((r) => r.category);

    const payload = { data: result.rows, categories };
    productsCache.set(cacheKey, { payload, ts: Date.now() });

    console.log(`[products] CACHE SET key="${cacheKey}" rows=${result.rows.length}`);

    res.set('Cache-Control', 'public, max-age=30');
    return res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({ error: 'Failed to fetch products. Please try again.' });
  }
});

module.exports = router;