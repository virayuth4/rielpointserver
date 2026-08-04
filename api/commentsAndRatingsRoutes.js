const express = require("express");
const router = express.Router();
const zingoPool = require('../database/pgZingo')
const authenticateFirebaseToken = require('../auth/authFirebaseToken')
const rateLimiterMiddleware = require('./rateLimiter');
const multer = require('multer');
const { uploadFileToS3 } = require("../database/s3");
const { sanitizeFileName } = require("../utils/sanitzieFileName");


const MAX_FILE_SIZE = 5 * 1024 * 1024; // 2MB
const MAX_FILES = 8

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Not an image! Please upload only image files.'), false);
        }
    }
});



//==========================Route to fetch comments on the user [used in slug page] =============================
router.get('/comments/:id', async (req,res) => {
    console.log('/comments/:id route hit')
    console.log(req.params)
    const { id: commentedUserId } = req.params;
    const parsedCommentedUserId = parseInt(commentedUserId)
    console.log('commentedUserId:', commentedUserId, 'type:', typeof(parsedCommentedUserId));
    try {
        const result = await zingoPool.query(`
            SELECT 
              c.*,
              u."firstName" as "commenterFirstName",
              u."lastName" as "commenterLastName",
              u."userProfilePath" as "commenterProfilePath"
            FROM user_comments c
            JOIN users u ON c."commentedUserId" = u.id
            WHERE u."id" = $1
            ORDER BY c."createdAt" DESC
          `, [parseInt(parsedCommentedUserId)]);
    
          const commetsData = result.rows[0]
          res.status(200).json({
                commetsData 
            })
    } catch (err) {
        console.error(`Error with fetching comments`)
    }

}) 


//========Route to post comments. The id is the id of the owner of the post NOT the commenter =============
router.post('/comments/post' , authenticateFirebaseToken, (req, res) => {
    upload.array('images', MAX_FILES) (req,res, async (err) => {
        if (err instanceof multer.MulterError) {
                    if (err.code === 'LIMIT_FILE_SIZE') {
                        return res.status(400).json({ error: `File size is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` });
                    }
                    if (err.code === 'LIMIT_FILE_COUNT') {
                        return res.status(400).json({ error: `Too many files. Maximum is ${MAX_FILES} files.` });
                    }
                    return res.status(400).json({ error: err.message });
                } else if (err) {
                    return res.status(400).json({ error: err.message });
                }

    console.log('/comments/post/:id route hit')
    console.log('req.body', req.body)
    const commenterId = req.user.id
    const {commentText, rating, postedBy, productId} = req.body //posted by is the user that is receving the comments NOT the commeter.
    
    const _rating = Number(rating); // Converts to double/float
    const _postedBy = parseInt(postedBy); // Converts to integer
    const _productId = parseInt(productId)
    console.log(`rating:${_rating}, type: ${typeof(_rating)}`)
    console.log(`postedBy:${_postedBy}, type: ${typeof(_postedBy)}`)
    console.log('images', req.files)
    
    try {
        let imagePaths = [];

        // Upload image to s3
        if (req.files && req.files.length > 0) {
            console.log("adding image to s3...")
            console.log('req files',req.files)
            for (let file of req.files) {
                console.log('file',file)
                const timestamp = Date.now();
                console.log('original name', file.originalname)
                const sanitizedName = sanitizeFileName(file.originalname);
                console.log("sanitizedName", sanitizedName)
                const fileName = `product-images/comments/${timestamp}_${sanitizedName}`;
                const imagePath = await uploadFileToS3(file, fileName);
                console.log('imagePath', imagePath);
                imagePaths.push(imagePath);
                console.log('imagePaths', imagePaths)
            }
        }


        const commentQuery = `
            INSERT 
                INTO user_comments ("commenterUserId", "commentedUserId", "commentText", "imagePaths","productId", "createdAt"  )
                VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING *
        `
        const commentValues = [commenterId, _postedBy, commentText, JSON.stringify(imagePaths), _productId]
        const commentResult = await zingoPool.query(commentQuery, commentValues)

        const updateUserRatingsQuery = `
            UPDATE users
            SET 
                "totalRating" = "totalRating" + $1,
                "ratingCount" = "ratingCount" + 1
            WHERE id = $2
            RETURNING "totalRating", "ratingCount"
        `
        const ratingValues = [_rating, _postedBy]
        const ratingResult = await zingoPool.query(updateUserRatingsQuery, ratingValues)
        res.status(200).json({message: "Successfully added comments"})
    } catch (err) {
        console.error(`Error with addign comments.`)
    }
});
});

module.exports = router;