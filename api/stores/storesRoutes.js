const express = require("express");
const zingoPool = require("../../database/pgZingo");
const createRateLimiterMiddleware = require("../rateLimiter");
const authenticateFirebaseToken = require("../../auth/authFirebaseToken");
const { upload, uploadMediaFilesToS3 } = require("../../database/s3");
const multer = require("multer");
const router = express.Router();


router.get("/stores/by-product", async (req, res) => {
  try {
    // Accept comma-separated: ?productIds=67,88,102
    const { productIds } = req.query;

    if (!productIds) {
      return res.status(400).json({ message: "productIds query parameter is required" });
    }

    const ids = productIds.split(",").map(id => parseInt(id)).filter(Boolean);

    if (!ids.length) {
      return res.status(400).json({ message: "No valid product IDs provided" });
    }

    const query = `
      SELECT sl.*, psl."productId"
      FROM "33storeLocations" sl
      INNER JOIN "33productStoreLocations" psl ON sl."storeId" = psl."storeLocationId"
      WHERE psl."productId" = ANY($1::int[])
        AND sl."isActive" = true
    `;

    const result = await zingoPool.query(query, [ids]);

    // Group stores by productId: { 67: [...stores], 88: [...stores] }
    const grouped = {};
    for (const row of result.rows) {
      const pid = row.productId;
      if (!grouped[pid]) grouped[pid] = [];
      grouped[pid].push(row);
    }

    res.status(200).json({ message: "Success", storesByProduct: grouped });
  } catch (e) {
    console.error("Error", e);
    res.status(500).json({ message: "Error" });
  }
});

router.get("/stores/all-stores", async (req,res) => {
    console.log("========= All stores router hit =========")
    try {
        const query = `
            SELECT * FROM "33storeLocations"
            WHERE "userId" = $1
        `
        const result = await zingoPool.query(query);
        res.status(200).json({ 
            message: 'Success',
            stores: result.rows
        });
    } catch (e) {
        console.error("Error",e)
        res.status(500).json({message: "Error"})
    }
})



router.post('/stores/add-store',
  createRateLimiterMiddleware,
  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([
      { name: 'bannerImage', maxCount: 1 }
    ])(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: `File size is too large. Maximum size is 50MB.`
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error: `Too many files. Maximum is 1 banner image.`
          });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }

      try {
        console.log("===== Store Location Posting reached");
        const userId = req.user?.uid || req.user?.user_id;

        console.log("Text data:", req.body);
        console.log("userId", userId);


        const locationData = req.body.locationData
          ? JSON.parse(req.body.locationData)
          : req.body;

        const {
          locationName,
          address,
          city,
          googleMapUrl,
          phoneNumber,
          openingHours,
        } = locationData;

        if (!locationName?.trim() || !address?.trim() || !city?.trim()) {
          return res.status(400).json({
            error: 'locationName, address, and city are required'
          });
        }

        // Access banner file from multer
        const bannerFiles = req.files['bannerImage'] || [];

        console.log(`Received ${bannerFiles.length} banner image(s)`);

        let bannerUrl = null;
        if (bannerFiles.length > 0) {
          const bannerUrls = await uploadMediaFilesToS3(bannerFiles, userId, 'image', { pathPrefix: 'store/banner' });
          bannerUrl = bannerUrls[0] || null;
        }

        console.log("Banner URL:", bannerUrl);

        const query = `
          INSERT INTO "33storeLocations" (
            "locationName", "address", "city", "googleMapUrl",
            "phoneNumber", "openingHours", "bannerUrl", "isActive", "userId"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING "storeId"
        `;

        const values = [
          locationName.trim(),
          address.trim(),
          city.trim(),
          googleMapUrl?.trim() || null,
          phoneNumber?.trim() || null,
          openingHours?.trim() || null,
          bannerUrl,
          true,
          userId
        ];

        const result = await zingoPool.query(query, values);
        const storeLocationId = result.rows[0].storeId;
        console.log('Inserted store location:', result.rows[0]);

        return res.status(200).json({
          message: 'Store location created successfully',
          data: {
            storeLocationId,
            bannerUrl
          }
        });

      } catch (error) {
        console.error('Error processing store location upload:', error);
        return res.status(500).json({
          error: 'Failed to process store location upload. Please try again.'
        });
      }
    });
  }
);

module.exports = router;