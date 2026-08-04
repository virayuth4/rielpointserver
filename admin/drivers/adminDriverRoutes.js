const express = require("express");
const router = express.Router();
const zingoPool = require("../../database/pgZingo");
const multer = require('multer');
const {uploadFileToS3} = require("../../database/s3");
const authenticateFirebaseToken = require("../../auth/authFirebaseToken");
const { sendDeliveryStatusEmail } = require("../helper/outForDeliveryEmail");




const ADMIN_USER_ID = parseInt(process.env.ADMIN_ID)

router.get('/drivers', authenticateFirebaseToken, async(req, res) =>{
    console.log('===================Get Driver Route hit===================')
   
    try {
       const query = `
       SELECT * FROM drivers
       `
     const result = await zingoPool.query(query)
 
       return res.status(200).json({
         message: "Successfully fetch all drivers",
         drivers: result.rows
       })
    } catch (err) {
     console.error(`Error with assigning driver`)
    }
 })
 

 router.post('/driver/assigned', authenticateFirebaseToken, async (req, res) => {
   console.log('=================Driver Assigned route hit=================');
   console.log('req body', req.body);

   const { orderId, driverId, orderStatus } = req.body;

   // Validate `orderStatus`
   if (orderStatus !== "delivering") {
      return res.status(400).json({ message: "Update Order State can only be 'delivering'" });
   }
   if (orderStatus === "delivered") {
      return res.status(400).json({ message: "Status cannot be set to 'delivered' in this update" });
   }

   console.log(`orderId: ${orderId}, type: ${typeof orderId}, driverId: ${driverId}, type: ${typeof driverId}`);

   try {
      const currentTime = new Date().toISOString();

      const assignedQuery = `
         UPDATE orders
         SET "assignedDriver" = $1,
             "assignedTime" = $2,
             "outForDeliveryTime" = $3,
             "currentStatus" = $4
         WHERE "orderId" = $5
         RETURNING *;
      `;

      const values = [driverId, currentTime, currentTime, orderStatus, orderId];
      const assignedResult = await zingoPool.query(assignedQuery, values);

      if (assignedResult.rowCount === 0) {
         return res.status(404).json({ error: 'Order not found' });
      }

      // Get detailed delivery information including all products
      const deliveryInfoQuery = `
          WITH order_details AS (
             SELECT 
                orders."currentStatus",
                orders."totalAmount",
                orders."buyerFirstName",
                orders."buyerLastName",
                orders."buyerAddress",
                orders."buyerCity",
                orders."outForDeliveryTime",
                orders."deliveredTime",
                orders."orderId",
                users."email" AS "userEmail"
             FROM orders
             LEFT JOIN users ON orders."userId" = users.id
             WHERE orders."orderId" = $1
          ),
          product_details AS (
             SELECT 
                json_agg(
                   json_build_object(
                      'productName', products."productName",
                      'productPrice', products."productPrice",
                      'purchasedQuantity', order_items."purchasedQuantity"
                   )
                ) AS products
             FROM order_items
             LEFT JOIN products ON order_items."productId" = products.id
             WHERE order_items."orderId" = $1
          )
          SELECT 
             order_details.*,
             product_details.products
          FROM order_details, product_details
      `;
      
      const deliveryInfoResult = await zingoPool.query(deliveryInfoQuery, [orderId]);
      console.log('deliveryInfoResult', deliveryInfoResult.rows[0]);
     
      await sendDeliveryStatusEmail(
         {
            deliveryInfo: deliveryInfoResult.rows[0]
         }, 
         deliveryInfoResult.rows[0].userEmail
      );
    
      res.status(200).json({ 
         message: 'Driver assigned successfully', 
         order: assignedResult.rows[0] 
      });
   } catch (err) {
      console.error(`Error with assigning driver`, err);
      res.status(500).json({ message: 'Error with assigning driver' });
   }
});

module.exports = router
