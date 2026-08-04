const express = require("express");
const router = express.Router();
const zingoPool = require("../../database/pgZingo");

const {uploadFileToS3} = require("../../database/s3")


require('dotenv').config();


const ADMIN_USER_ID = process.env.ADMIN_ID

router.get('/all-products-for-review', async (req,res) => {
    console.log('/all-products-for-review route hit')
    try {
        const query = `
        SELECT id, "productName", "productCategory", "phoneNumber", "productPrice", "purchasedQuantity", "productDescription", 
        "productImagePaths", "saleState", "reviewState", "verifyState", "featureState", "slug", "postedBy", "isDeleted", "createdAt"
        FROM products
        WHERE "reviewState" = false
        AND "isDeleted" = false
        ORDER BY id DESC
        `;

        const result = await zingoPool.query(query);

        if (result.rows.length === 0) {
            return res.status(200).json({
                message: "No products pending review",
                products: []
            });
            
        }

        res.status(200).json({
            products: result.rows
        });

    } catch(error) {
        console.error("Error with fetching all products for review")
        res.status(500).json({
            error: "An error occurred while fetching products for review"
        })
    }
})


router.post('/product/verify/:productId', async(req,res) => {
    console.log('==========Product Verify ProductId route hit==========')
    const {productId} = req.params
    const intProductId = parseInt(productId)
    console.log(`productId:${intProductId}, type:${typeof(intProductId)}`)
    try {
        const query = `
            UPDATE products
            SET "verifyState" = TRUE
            WHERE id = $1
            RETURNING *
        `
        const result = await zingoPool.query(query, [intProductId])

        
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Product not found' });
     }

     res.status(200).json({ message: 'Product verified successfully'});

    } catch (err) {
        console.error(`Unexpected error with verifying product`)
        res.status(500).json({ message: 'Error with assigning verifying product' });
    }
})



module.exports = router
