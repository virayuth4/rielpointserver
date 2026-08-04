const express = require("express");
const router = express.Router();
const zingoPool = require("../../database/pgZingo");
const multer = require('multer');
const {uploadFileToS3} = require("../../database/s3");
const authenticateFirebaseToken = require("../../auth/authFirebaseToken");
const { sendDeliveryStatusEmail } = require("../helper/outForDeliveryEmail");


const ADMIN_USER_ID = parseInt(process.env.ADMIN_ID)

router.get('/orders/accepted', authenticateFirebaseToken, async (req, res) => {
  console.log('/orders/active route hit');
   
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  
  const orderState = 'accepted'; // Set orderState dynamically if needed
  
  try {
    // First, get total count of orders
    const countQuery = `
      SELECT COUNT(DISTINCT orders.id) 
      FROM orders 
      WHERE orders."currentStatus" = $1
    `;
    const totalResult = await zingoPool.query(countQuery, [orderState]);
    const total = parseInt(totalResult.rows[0].count);
  
    // Then get paginated orders
    const query = `
      SELECT
        orders.*, order_items.*, products.*
      FROM orders
      LEFT JOIN order_items ON orders."orderId" = order_items."orderId"
      LEFT JOIN products ON order_items."productId" = products.id
      WHERE orders."currentStatus" = $1
      ORDER BY orders."createdAt" DESC
      LIMIT $2 OFFSET $3
    `;
    
    const queryResult = await zingoPool.query(query, [orderState, limit, offset]);
    
    res.status(200).json({
      orders: queryResult.rows,
      total: total,
      page: page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/orders/ordered', authenticateFirebaseToken, async (req, res) => {
    console.log('/orders/active route hit');
     
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const orderState = 'ordered'; // Set orderState dynamically if needed
    
    try {
      // First, get total count of orders
      const countQuery = `
        SELECT COUNT(DISTINCT orders.id) 
        FROM orders 
        WHERE orders."currentStatus" = $1
      `;
      const totalResult = await zingoPool.query(countQuery, [orderState]);
      const total = parseInt(totalResult.rows[0].count);
    
      // Then get paginated orders
      const query = `
        SELECT
          orders.*, order_items.*, products.*
        FROM orders
        LEFT JOIN order_items ON orders."orderId" = order_items."orderId"
        LEFT JOIN products ON order_items."productId" = products.id
        WHERE orders."currentStatus" = $1
        ORDER BY orders."createdAt" DESC
        LIMIT $2 OFFSET $3
      `;
      
      const queryResult = await zingoPool.query(query, [orderState, limit, offset]);
      
      res.status(200).json({
        orders: queryResult.rows,
        total: total,
        page: page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

router.get('/orders/delivering', authenticateFirebaseToken, async (req, res) => {
    console.log('/orders/delivering route hit');
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const orderState = 'delivering'; // Set orderState dynamically if needed
    
    try {
      // First, get total count of orders
      const countQuery = `
        SELECT COUNT(DISTINCT orders.id) 
        FROM orders 
        WHERE orders."currentStatus" = $1
      `;
      const totalResult = await zingoPool.query(countQuery, [orderState]);
      const total = parseInt(totalResult.rows[0].count);
    
      // Then get paginated orders
      const query = `
        SELECT
            orders.*,
            order_items.*,
            products.*,
            drivers."firstName" AS "driverFirstName",
            drivers."lastName" AS "driverLastName",
            drivers."phoneNumber" AS "driverPhoneNumber"
        FROM orders
        LEFT JOIN order_items ON orders."orderId" = order_items."orderId"
        LEFT JOIN products ON order_items."productId" = products.id
        LEFT JOIN drivers ON orders."assignedDriver" = drivers.id
        WHERE orders."currentStatus" = $1
        ORDER BY orders."createdAt" DESC
        LIMIT $2 OFFSET $3;
      `;
      
      const queryResult = await zingoPool.query(query, [orderState, limit, offset]);
      
      res.status(200).json({
        orders: queryResult.rows,
        total: total,
        page: page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });


  router.get('/orders/delivered', authenticateFirebaseToken, async (req, res) => {
    console.log('==========/orders/active route hit==========');
     
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const orderState = 'delivered'; // Set orderState dynamically if needed
    console.log('orderState', orderState)
    try {
      // First, get total count of orders
      const countQuery = `
        SELECT COUNT(DISTINCT orders.id) 
        FROM orders 
        WHERE orders."currentStatus" = $1
      `;
      const totalResult = await zingoPool.query(countQuery, [orderState]);
      const total = parseInt(totalResult.rows[0].count);
    
      // Then get paginated orders
      const query = `
        SELECT
          orders.*, order_items.*, products.*
        FROM orders
        LEFT JOIN order_items ON orders."orderId" = order_items."orderId"
        LEFT JOIN products ON order_items."productId" = products.id
        WHERE orders."currentStatus" = $1
        ORDER BY orders."createdAt" DESC
        LIMIT $2 OFFSET $3
      `;
      
      const queryResult = await zingoPool.query(query, [orderState, limit, offset]);
      
      res.status(200).json({
        orders: queryResult.rows,
        total: total,
        page: page,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

router.get('/all-orders/admin', authenticateFirebaseToken, async(req, res) =>{
    console.log('/add-orders/admin route hit')
    console.log('userId', req.user.id, `type:${typeof(req.user.id)}, ADMIN_USER_ID:${ADMIN_USER_ID}, type: ${typeof(ADMIN_USER_ID)}`)
    if (req.user.id != ADMIN_USER_ID) {
        return res.status(500).json({message: "User doesn't have admin previledge"})
    } 

    const query = `
    SELECT
        orders.*, order_items.*, products.*
        FROM orders
        LEFT JOIN order_items ON orders."orderId" = order_items."orderId"
        LEFT JOIN products ON order_items."productId" = products.id;
    `
    const queryResult = await zingoPool.query(query)
    
    res.status(200).json(queryResult.rows)

})

router.post('/orders/status/update', authenticateFirebaseToken, async (req, res) => {
  console.log('==========order/state-update route hit==========');
  console.log('req body', req.body);
  const { status, orderId, description } = req.body;
  console.log('updateOrderStatus', status, typeof(status));

  if (!["accepted", "delivered", "ordered", "delivering", "cancelled", "preparingForDelivery","userConfirmedOrder", "userCanelOrder"].includes(status)) {
      return res.status(400).json({ error: "Update Order State can only be 'accepted', 'delivered', 'ordered', 'delivering', 'cancelled', 'preparingForDelivery'." });
  }

  try {
    const statusHistoryEntry = JSON.stringify([{
      status: status,
      timestamp: new Date().toISOString(),
      description: description || "Status updated"
  }]);
  
  const updateStatusQuery = `
      UPDATE orders
      SET "currentStatus" = $1, 
          "statusHistories" = COALESCE("statusHistories", '[]'::jsonb) || $2::jsonb
      WHERE "orderId" = $3
  `;
    const values = [status, statusHistoryEntry, orderId];
    const updateStatusResult = await zingoPool.query(updateStatusQuery, values);

    if (updateStatusResult.rowCount === 0) {
        return res.status(404).json({ error: "Unable to update order status" });
    }

    const updateOrderItemsQuery = `
        UPDATE order_items
        SET "currentStatus" = $1,
            "statusHistories" = COALESCE("statusHistories", '[]'::jsonb) || $2::jsonb
        WHERE "orderId" = $3
    `;
    await zingoPool.query(updateOrderItemsQuery, values);

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

    await sendDeliveryStatusEmail(
        {
            deliveryInfo: deliveryInfoResult.rows[0]
        },
        deliveryInfoResult.rows[0].userEmail
    );

    res.status(200).json({ message: "Update status successfully" });
  } catch (err) {
      console.error(`Error with assigning driver`, err);
      res.status(500).json({ message: 'Error with assigning driver' });
  }
});




module.exports = router
