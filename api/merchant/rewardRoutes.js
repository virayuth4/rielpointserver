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


router.get('/rewards',  async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    const result = await zingoPool.query(
      `SELECT *
       FROM "rielpoint_rewards"
 
       `,
      []
    );

    return res.status(200).json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching rewards:', error);
    return res.status(500).json({ error: 'Failed to fetch rewards.' });
  }
});

router.delete('/rewards/:id', authenticateFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || req.user?.userId;

    const result = await zingoPool.query(
      `DELETE FROM "rielpoint_rewards" WHERE id = $1 AND posted_by = $2 RETURNING id, image_paths`,
      [id, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Reward not found or not owned by you.' });
    }

    // Optional: delete the associated S3 objects too
    // const paths = result.rows[0].image_paths || [];
    // await Promise.all(paths.map((url) => deleteFileFromS3(url)));

    return res.status(200).json({ message: 'Reward deleted successfully' });
  } catch (error) {
    console.error('Error deleting reward:', error);
    return res.status(500).json({ error: 'Failed to delete reward.' });
  }
});

router.get('/rewards/:id', authenticateFirebaseToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await zingoPool.query(
      `SELECT id, title, description, affiliate_link, cashback_reward, image_paths, is_reviewed, posted_by
       FROM "rielpoint_rewards" WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Reward not found' });
    }
    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching reward:', error);
    return res.status(500).json({ error: 'Failed to fetch reward.' });
  }
});

// PUT /api/merchant/rewards/:id — update an existing reward
router.put('/rewards/:id',
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
        const userId = req.user?.id || req.user?.userId;
        const { title, affiliate_link, cashback_reward, existing_images, category, affiliator } = req.body;
        const description = sanitizeProductDescription(req.body.description);

        if (!title || !description || !affiliate_link || cashback_reward === undefined || !category || !affiliator) {
          return res.status(400).json({
            error: 'title, description, affiliate_link, cashback_reward, category, and affiliator are required.'
          });
        }

        const parsedCashbackReward = parseFloat(cashback_reward);
        if (isNaN(parsedCashbackReward) || parsedCashbackReward < 0) {
          return res.status(400).json({ error: 'cashback_reward must be a valid non-negative number.' });
        }

        // Images the client wants to keep (already-uploaded URLs)
        const keptImages = existing_images ? JSON.parse(existing_images) : [];

        // Optionally: diff keptImages against what's currently in the DB and
        // call deleteFileFromS3 for any that were dropped, to avoid orphaned files.

        const newImageFiles = req.files['images'] || [];
        const newImageUrls = await uploadMediaFilesToS3(newImageFiles, userId, 'image', {
          pathPrefix: 'rielpoint/rewards'
        });

        const allImageUrls = [...keptImages, ...newImageUrls];

        const query = `
          UPDATE "rielpoint_rewards"
          SET "title" = $1, "description" = $2, "affiliate_link" = $3,
              "cashback_reward" = $4, "image_paths" = $5, "category" = $6, "affiliator" = $7
          WHERE id = $8 AND posted_by = $9
          RETURNING id
        `;
        const values = [
          title, description, affiliate_link, parsedCashbackReward,
          JSON.stringify(allImageUrls), category, affiliator, id, userId
        ];

        const result = await zingoPool.query(query, values);
        if (!result.rows.length) {
          return res.status(404).json({ error: 'Reward not found or not owned by you.' });
        }

        return res.status(200).json({
          message: 'Reward updated successfully',
          data: { rewardId: id, imageUrls: allImageUrls }
        });
      } catch (error) {
        console.error('Error processing reward update:', error);
        return res.status(500).json({ error: 'Failed to process reward update. Please try again.' });
      }
    });
  }
);

router.post('/rewards/add',

  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([
      { name: 'images', maxCount: 10 }
    ])(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        // Handle multer-specific errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: `File size is too large. Maximum size is 50MB.`
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            error: `Too many files. Maximum is 10 images.`
          });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }

      try {
        console.log("===== Merchant Reward Posting reached");
        const userId = req.user?.id || req.user?.userId;

        console.log("Text data:", req.body);
        console.log("req.user:", req.user);
        console.log("userId", userId);

        const {
          title,
          affiliate_link,
          cashback_reward,
          category,
          affiliator
        } = req.body;

        const description = sanitizeProductDescription(req.body.description);

        let reviewState = false;

        // Basic required-field validation
        if (!title || !description || !affiliate_link || cashback_reward === undefined || !category || !affiliator) {
          return res.status(400).json({
            error: 'title, description, affiliate_link, cashback_reward, category, and affiliator are required.'
          });
        }

        const parsedCashbackReward = parseFloat(cashback_reward);
        if (isNaN(parsedCashbackReward) || parsedCashbackReward < 0) {
          return res.status(400).json({
            error: 'cashback_reward must be a valid non-negative number.'
          });
        }

        // Access the files from multer
        const imageFiles = req.files['images'] || [];

        console.log(`Received ${imageFiles.length} images`);

        const imageUrls = await uploadMediaFilesToS3(imageFiles, userId, 'image', { pathPrefix: 'rielpoint/rewards' });

        console.log("Image URLs:", imageUrls);

        // Insert data into PostgreSQL
        const query = `
          INSERT INTO "rielpoint_rewards" (
            "title", "description", "affiliate_link", "cashback_reward",
            "image_paths", "is_reviewed", "posted_by", "category", "affiliator"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id
        `;

        const values = [
          title,
          description,
          affiliate_link,
          parsedCashbackReward,
          JSON.stringify(imageUrls),
          reviewState,
          userId,
          category,
          affiliator
        ];

        const result = await zingoPool.query(query, values);
        const rewardId = result.rows[0].id;
        console.log('Inserted reward:', result.rows[0]);

        // Return success with the S3 URLs
        return res.status(200).json({
          message: 'Reward posted successfully',
          data: {
            rewardId,
            imageUrls
          }
        });

      } catch (error) {
        console.error('Error processing reward upload:', error);
        return res.status(500).json({
          error: 'Failed to process reward upload. Please try again.'
        });
      }
    });
  }
);



module.exports = router;