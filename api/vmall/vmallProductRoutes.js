const express = require("express");
const router = express.Router();
const zingoPool = require("../../database/pgZingo");
const multer = require('multer');
const {upload, uploadFileToS3, deleteFileFromS3, uploadMediaFilesToS3} = require("../../database/s3")
const authenticateFirebaseToken = require("../../auth/authFirebaseToken")
const createRateLimiterMiddleware = require("../rateLimiter");
const { sanitizeProductDescription } = require("../../utils/sanatizeHtml");

require('dotenv').config();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 11; // 8 images + 3 videos

  router.get("/vmall/individual-product/:slug(*)", async (req, res) => {
    console.log("=====Vmall Slug Route Hit====")
    console.log("slug", req.params)
     try {
      // Validate if slug parameter exists
      if (!req.params[0]) {
        return res.status(400).json({
          error: 'Bad Request',
          message: "Product slug is required" 
        })
      }

      let fullSlug = '/' + req.params[0];
      // console.log('Full slug:', fullSlug);
  
      const result = await zingoPool.query(
        `SELECT * FROM "vintage_products" p
         WHERE p.slug = $1`,
        [fullSlug]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Product not found'
        });
      }
     
      res.status(200).json(result.rows[0]);
     
    } catch (error) {
      console.error('Error fetching product:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred'
      });
    }
  })

//Route to fetch all products with pagination 
router.get('/vmall/all-products', createRateLimiterMiddleware, async (req, res) => {
  console.log('=== Vmall all-products route hit ===');
  
  const page = parseInt(req.query.page) || 1;
  const brandsPerPage = parseInt(req.query.brandsPerPage) || 8;
  const itemsPerBrand = parseInt(req.query.itemsPerBrand) || 8;
  
  // Calculate limit based on brands and items per brand
  const limit = brandsPerPage * itemsPerBrand;
  const offset = (page - 1) * limit;

  try {
    const query = `
      SELECT * FROM "vintage_products"
      ORDER BY "createdAt" DESC
      LIMIT $1 OFFSET $2
    `;
    const values = [limit, offset];

    const result = await zingoPool.query(query, values);
    const products = result.rows;

    // Get total count for pagination
    const countResult = await zingoPool.query('SELECT COUNT(*) FROM "vintage_products"');
    const totalCount = parseInt(countResult.rows[0].count);
    
    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    console.log(`📊 Page ${page}: ${products.length} products, ${totalCount} total, hasMore: ${hasMore}`);

    res.status(200).json({
      message: 'Products fetched successfully',
      products: products, // Match frontend expectation
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalBrands: Math.ceil(totalCount / itemsPerBrand), // Approximate brand count
        brandsPerPage: brandsPerPage,
        itemsPerBrand: itemsPerBrand,
        hasMore: hasMore,
        brandsInThisPage: Math.min(brandsPerPage, Math.ceil(products.length / itemsPerBrand))
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({
      error: 'Failed to fetch products. Please try again.'
    });
  }
});
// Simplified product posting route
router.post('/vmall/product/posting', 
  (req, res) => {
    upload.fields([
      { name: 'productImages', maxCount: 8 },
      { name: 'productVideos', maxCount: 3 }
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
            error: `Too many files. Maximum is 11 files (8 images + 3 videos).` 
          });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }

      try {
        console.log("===== 1464 Simple Product Posting reached");
        console.log("Text data:", req.body);
        
        const userId = 272; // Default user ID
        console.log("userId", userId);
        
        // Extract only the simplified fields
        const {
          productName,
          productDescription,
          productPrice,
          productCondition,
          sellerCity,
          phoneNumber
        } = req.body;
        
        // Sanitize description
        const sanitizedDescription = sanitizeProductDescription(productDescription);
        

        
        // Generate simple slug
        const timestamp = Date.now();
        const slug = `/${productName.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase()}/${timestamp}`;

        console.log("productName", productName);
        console.log("productPrice", productPrice);
        console.log("productCondition", productCondition);
        console.log("sellerCity", sellerCity);
        
        // Access the files from multer
        const imageFiles = req.files['productImages'] || [];
        const videoFiles = req.files['productVideos'] || [];
        
        console.log(`Received ${imageFiles.length} images and ${videoFiles.length} videos`);
        
        // Validate that at least one image is provided
        if (imageFiles.length === 0) {
          return res.status(400).json({
            error: 'At least one product image is required'
          });
        }

        // Upload media files to S3
        const imageUrls = await uploadMediaFilesToS3(imageFiles, userId, 'image', {pathPrefix:'vmall/products'});
        const videoUrls = await uploadMediaFilesToS3(videoFiles, userId, 'video', {pathPrefix:'vmall/products'});
        
        console.log("Image URLs:", imageUrls);
        console.log("Video URLs:", videoUrls);

        // Insert data into PostgreSQL with simplified schema
        const query = `
          INSERT INTO "vintage_products" (
             "productName",  "productPrice",  "productCondition", "productDescription", 
             "productImagePaths", "productMediaPaths", "phoneNumber", "sellerCity", 
              "slug", "postedBy", 
               "createdAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,  NOW())
          RETURNING id
        `;

        const values = [
          productName,
          parseFloat(productPrice),
          productCondition,
          sanitizedDescription,
          imageUrls,
          videoUrls,
          phoneNumber,
          sellerCity,
          slug,
          userId,
        ];

        const result = await zingoPool.query(query, values);
        const productId = result.rows[0].id;
        console.log('Inserted simple product:', result.rows[0]);

        // Return success response
        return res.status(200).json({
          message: 'Product posted successfully',
          data: {
            productId,
            imageUrls,
            videoUrls,
            slug
          }
        });
        
      } catch (error) {
        console.error('Error processing simple product upload:', error);
        return res.status(500).json({
          error: 'Failed to process product upload. Please try again.'
        });
      }
    });
  }
);

// Simplified product editing route
router.post('/vmall/product/editing/simple/:productId', 
  createRateLimiterMiddleware,
  authenticateFirebaseToken,
  (req, res) => {
    upload.fields([
      { name: 'newProductImages', maxCount: 8 },
      { name: 'newProductVideos', maxCount: 3 }
    ])(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ 
            error: `File size is too large. Maximum size is 50MB.` 
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ 
            error: `Too many files. Maximum is 11 files (8 images + 3 videos).` 
          });
        }
        return res.status(400).json({ error: err.message });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }

      try {
        console.log("===== 1464 Simple Editing Route Hit =====");
        console.log("User Id:", req.user.id);
        console.log("Text data:", req.body);
        
        const userId = req.user.id;
        const { productId } = req.params;
        
        console.log("productId", productId);

        const client = await zingoPool.connect();
        await client.query('BEGIN');

        // Extract simplified fields
        const {
          productName,
          productDescription,
          productPrice,
          sellerCity,
          phoneNumber,
          existingImagePaths,
          existingVideoPaths,
          deletedImagePaths,
          deletedVideoPaths
        } = req.body;

        // Parse existing and deleted paths
        const _deletedImagePaths = JSON.parse(deletedImagePaths || '[]');
        const _deletedVideoPaths = JSON.parse(deletedVideoPaths || '[]');
        const _existingImagePaths = JSON.parse(existingImagePaths || '[]');
        const _existingVideoPaths = JSON.parse(existingVideoPaths || '[]');

        // Access new files from multer
        const newImageFiles = req.files['newProductImages'] || [];
        const newVideoFiles = req.files['newProductVideos'] || [];

        console.log(`Received ${newImageFiles.length} new images and ${newVideoFiles.length} new videos`);

        // Delete removed files from S3
        for (const deletedPath of _deletedImagePaths) {
          await deleteFileFromS3(deletedPath);
        }
        for (const deletedPath of _deletedVideoPaths) {
          await deleteFileFromS3(deletedPath);
        }

        // Upload new files to S3
        const [newImageUrls, newVideoUrls] = await Promise.all([
          uploadMediaFilesToS3(newImageFiles, userId, 'image', {pathPrefix:'1464/products'}),
          uploadMediaFilesToS3(newVideoFiles, userId, 'video', {pathPrefix:'1464/products'})
        ]);

        // Combine existing (not deleted) and new file paths
        const updatedImagePaths = [
          ..._existingImagePaths.filter(path => !_deletedImagePaths.includes(path)),
          ...newImageUrls
        ];

        const updatedVideoPaths = [
          ..._existingVideoPaths.filter(path => !_deletedVideoPaths.includes(path)),
          ...newVideoUrls
        ];

        // Validate that at least one image remains
        if (updatedImagePaths.length === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'At least one product image is required'
          });
        }

        // Generate new slug
        const timestamp = Date.now();
        const slug = `/${productName.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase()}/${timestamp}`;

        // Sanitize description
        const sanitizedDescription = sanitizeProductDescription(productDescription);

        // Update query for simplified fields
        const updateQuery = `
          UPDATE "1464_products" 
          SET 
            "productName" = $1,
            "productDescription" = $2,
            "productPrice" = $3,
            "sellerCity" = $4,
            "sellerPhoneNumber" = $5,
            "productImagePaths" = $6,
            "productMediaPaths" = $7,
            "slug" = $8,
            "updatedAt" = NOW()
          WHERE id = $9 AND "postedBy" = $10
          RETURNING *
        `;

        const updateValues = [
          productName,
          sanitizedDescription,
          parseFloat(productPrice),
          sellerCity,
          phoneNumber,
          JSON.stringify(updatedImagePaths),
          JSON.stringify(updatedVideoPaths),
          slug,
          productId,
          userId
        ];

        const result = await client.query(updateQuery, updateValues);

        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({
            error: 'Product not found or you do not have permission to edit it'
          });
        }

        await client.query('COMMIT');

        res.status(200).json({
          message: 'Successfully updated product details',
          data: result.rows[0]
        });

      } catch (error) {
        console.error('Error updating simple product:', error);
        await client.query('ROLLBACK');
        return res.status(500).json({
          error: 'Failed to update product. Please try again.'
        });
      } finally {
        if (client) {
          client.release();
        }
      }
    });
  }
);

module.exports = router;