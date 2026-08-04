const express = require("express");
const router = express.Router();
const zingoPool = require("../database/pgZingo");
const authenticateFirebaseToken = require("../auth/authFirebaseToken")

/**Route to GET all users' posts
 * required: userId 
 * returns: JSON
 */
router.get('/user-posts/:userId', authenticateFirebaseToken, async(req,res) => {
    router.get('/user-posts/userId route hit')
    const userId = req.user.id
    console.log('userId', userId) 
    try {
        const query = `
                    SELECT id, "productName", "productCategory", "sellerName", "phoneNumber", "productPrice", "purchasedQuantity", "productDescription", 
                    "productImagePaths", "saleState", "reviewState", "verifyState", "featureState", "slug", "postedBy", "isDeleted", "createdAt"
                    FROM products
                    WHERE "postedBy" = $1 
                    AND "isDeleted" = false
                    ORDER BY id DESC
                    `
  
        const result = await zingoPool.query(query, [userId])
  
        if (result.rows.length === 0) {
            return res.status(200).json({
                message: "No posts found",
                products: []
            });
        }
  
        res.status(200).json({
            products: result.rows
        })
  
  
  
    } catch (error) {
        console.error('Error with fetching user posts')
    }
  })
  

module.exports = router