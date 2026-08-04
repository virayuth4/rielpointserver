const zingoPool = require("../database/pgZingo");
const { sendOrderConfirmationEmail } = require("../lib/email");
const { sendOrderSoldEmail } = require("../lib/sendOrderSoldEmail");
const {generateOrderId} = require("../utils/generateOrderId")

// Custom error class for better error handling
class OrderError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}

async function checkProductOwnership(client, productIds, userId) {
    const query = `
        SELECT 
            p.id,
            p."productName",
            p."postedBy"
        FROM products p
        WHERE p.id = ANY($1)
        FOR UPDATE OF p NOWAIT
    `;
    
    try {
        const result = await client.query(query, [productIds]);
        
        // Group results by product ID
        const productOwnership = result.rows.reduce((acc, row) => {
            acc[row.id] = {
                postedBy: row.postedBy,
                productName: row.productName
            };
            return acc;
        }, {});
        
        // Check for products owned by the user
        const ownedProducts = [];
        const notFoundProducts = [];
        
        for (const id of productIds) {
            const product = productOwnership[id];
            
            // Handle missing products
            if (!product) {
                notFoundProducts.push(id);
                continue;
            }
            
            // Check if user is the owner
            if (product.postedBy === userId) {
                ownedProducts.push(id);
            }
        }

        return {
            canPurchase: ownedProducts.length === 0,
            ownedIds: ownedProducts,
            error: notFoundProducts.length > 0 
                ? `Products not found: ${notFoundProducts.join(', ')}`
                : undefined
        };
        
    } catch (error) {
        // Handle specific database errors
        const errorMap = {
            '55P03': 'Products are currently being processed by another request',
            '23505': 'Concurrent modification detected',
            '42P01': 'Database table not found',
            '42703': 'Invalid column reference'
        };
        
        return {
            canPurchase: false,
            error: error.code && errorMap[error.code]
                ? errorMap[error.code]
                : 'An unexpected error occurred while checking product ownership'
        };
    }
}


async function checkProductAvailability(client, productIds) {
    const query = `
        SELECT 
            p.id, 
            p."availableQuantity",
            p."productName"
        FROM products p
        WHERE p.id = ANY($1)
        FOR UPDATE OF p NOWAIT
    `;
    
    try {
        const result = await client.query(query, [productIds]);
        
        // Group results by product ID
        const productStatus = result.rows.reduce((acc, row) => {
            if (!acc[row.id]) {
                acc[row.id] = {
                    availableQuantity: row.availableQuantity,
                    productName: row.productName
                };
            }
            return acc;
        }, {});
        
        // Check for unavailable products
        const unavailableProducts = [];
        const notFoundProducts = [];
        
        for (const id of productIds) {
            const status = productStatus[id];
            
            // Handle missing products
            if (!status) {
                notFoundProducts.push(id);
                throw new OrderError(`Product with ID ${id} not found`, 404);
            }
            
            // Only check availableQuantity
            if (status.availableQuantity <= 0) {
                unavailableProducts.push({
                    id,
                    name: status.productName
                });
            }
        }
        
        // Handle not found products first
        if (notFoundProducts.length > 0) {
            throw new OrderError(
                `Products not found: ${notFoundProducts.join(', ')}`,
                404
            );
        }

        // Handle unavailable products
        if (unavailableProducts.length > 0) {
            const productList = unavailableProducts
                .map(p => `${p.name} (ID: ${p.id})`)
                .join(', ');

            throw new OrderError(
                `The following products are out of stock: ${productList}`,
                409
            );
        }
        
        return { 
            available: true,
            productIds: Object.entries(productStatus).map(([id, status]) => ({
                id,
                name: status.productName
            }))
        };
        
    } catch (error) {
        // Unified error handling
        if (error instanceof OrderError) {
            throw error; // Re-throw existing OrderErrors
        }
        // Handle specific database errors
        const errorMap = {
            '55P03': ['Products are currently being purchased by another user', 423],
            '23505': ['Concurrent modification detected', 409],
            '42P01': ['Database table not found', 500],
            '42703': ['Invalid column reference', 500]
        };
        
        if (error.code && errorMap[error.code]) {
            const [message, statusCode] = errorMap[error.code];
            throw new OrderError(message, statusCode);
        }
        
        // Handle unexpected errors
        throw new OrderError(
            'An unexpected error occurred while checking product availability',
            500
        );
    }
}

//-- Have code handle cart item the other one to handle single item in buy now (Buy now is removed)
//-- Function to extract and validate request data.[Check if req.body is valid and non-empty]
//-- Requires userId and req.body
//-- This function is used in the /order/create.
// -- Returns an array.Return validation error is missing items in req.
function extractAndValidateRequestData(req, userId) {
    let orderStatus = "ordered"; 
    console.log('req body', req.body)
    console.log('req body product', req.body.product)
    console.log('req body orderDetails', req.body.orderDetails)
    try {
        // Handle both single item and multiple items
        if (req.body.product) {
            // Single Item purchase
            const {
                product: { productPrice, id: productId, purchasedQuantity, productName, postedBy }, 
                shippingInfo: { firstName: buyerFirstName, lastName: buyerLastName, address: buyerAddress, city: buyerCity, phoneNumber: buyerPhoneNumber },
                paymentMethod, deliveryFee
            } = req.body;

            if (!userId || !orderStatus || !productPrice || !buyerAddress || !buyerCity || !buyerFirstName || !buyerLastName || !productId || !buyerPhoneNumber || !purchasedQuantity || !paymentMethod) {
                return { validationError: 'Missing required values for creating an order.' };
            }
            
            // Format single item as an array for consistency
            const items = [{
                productId,
                purchasedQuantity: purchasedQuantity,
                price: productPrice,
                name: productName,
                postedBy: postedBy
            }];
            console.log('=====items=====',items)
            return { 
                orderDetails: { 
                    userId, 
                    orderStatus, 
                    items,
                    buyerAddress, 
                    buyerCity, 
                    buyerFirstName, 
                    buyerLastName, 
                    buyerPhoneNumber, 
                    paymentMethod,
                    totalAmount: productPrice * purchasedQuantity,
                    deliveryFee
                } 
            };
        } else {
            // Cart purchase (multi items)
            const {
                orderDetails: {items},
                shippingInfo: { firstName: buyerFirstName, lastName: buyerLastName, address: buyerAddress, city: buyerCity, phoneNumber: buyerPhoneNumber },
                paymentMethod, deliveryFee,
            } = req.body;

            if (!userId || !items || !items.length || !buyerAddress || !buyerCity || 
                !buyerFirstName || !buyerLastName || !buyerPhoneNumber || !paymentMethod) {
                return { validationError: 'Missing required values for creating a cart order.' };
            }

            // Validate all items
            for (const item of items) {
                if (!item.productId || !item.purchasedQuantity || !item.price) {
                    return { validationError: 'Invalid item data in cart.'}
                }
            }

            // Calculate total amount
            const totalAmount = items.reduce((sum, item) => sum + (item.price * item.purchasedQuantity), 0);

            return {
                orderDetails: {
                    userId,
                    orderStatus,
                    items,
                    buyerAddress,
                    buyerCity,
                    buyerFirstName,
                    buyerLastName,
                    buyerPhoneNumber,
                    paymentMethod,
                    totalAmount,
                    deliveryFee,
     
                }
            };
        } 
    } catch (err) {
        if (err instanceof OrderError) throw err;
        throw new OrderError('Invalid request format', 400);
    }
}




//-- Function to insert order details into order_items and orders. Use in /cart/create.
//-- Requires orderDegails from extractAndValidateRequestData(req, userId).
//-- Client is required for complex transaction
//-- Return insertion result.
async function createOrder(client, orderDetails) {
    const productIds = orderDetails.items
    ? orderDetails.items.map(item=>item.productId)
    : [orderDetails.productId];

    // console.log('productIds:', productIds)

    // TODO: Check ownership
 
    //Check availability 
    const availability = await checkProductAvailability(client, productIds);
    if (!availability.available) {
        throw new orderError (
            availability.unavailableIds 
            ? `Products already sold: ${availability.unavailableIds.join(', ')}` 
            : availability.error
        )
    } else {
        console.log(`Product(s) ${productIds} available for purchase`)
    }

    const generatedOrderId = generateOrderId(
        orderDetails.items ? orderDetails.items[0].productId : orderDetails.productId
    );


    const orderQuery = `
        INSERT INTO orders (
            "userId", "orderId", "orderStatus", "buyerPhoneNumber", "totalAmount", "paymentMethod",
            "buyerAddress", "buyerCity", "buyerFirstName", "buyerLastName", "deliveryFee"
        ) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
    `;
    // Total Amount based on a single purchase or cart purchase
    console.log('delivery fee', orderDetails.deliveryFee)
    const totalAmount =  orderDetails.items
                            ? orderDetails.items.reduce((total, item) => total + ((item.price * item.purchasedQuantity) + orderDetails.deliveryFee), 0)
                            : orderDetails.productPrice * orderDetails.purchasedQuantity + orderDetails.deliveryFee;
    
    //orderDetails is from the extractAndValidateRequestData(req, userId).
    const orderValues = [
        orderDetails.userId, generatedOrderId,orderDetails.orderStatus, orderDetails.buyerPhoneNumber,
        totalAmount, orderDetails.paymentMethod, orderDetails.buyerAddress,
        orderDetails.buyerCity, orderDetails.buyerFirstName, orderDetails.buyerLastName, orderDetails.deliveryFee
    ];

    const orderResult = await client.query(orderQuery, orderValues);
    return orderResult.rowCount ? orderResult : null;
}

//-- Function to insert ordered items to order_items. Use in /cart/create.
//-- Use the orderId from the createOrder(client, orderDetails) & orderDetails from extractAndValidateRequestData(req, userId).
async function createOrderItems(client, orderId, orderDetails) {
    if (orderDetails.items) {
        console.log('==========CreateOrderItems Debug==============');
        console.log('OrderId:', orderId);
        console.log('OrderDetails:', JSON.stringify(orderDetails, null, 2));
      
        // Handle cart items
        const orderItemsPromises = orderDetails.items.map(async item => {
            try {
                // Debug log before insert
                console.log(`Attempting to insert order item for productId: ${item.productId}`);
                console.log(`Values: orderId=${orderId}, purchasedQuantity=${item.purchasedQuantity}, price=${item.price}`);

                // Check if product already exists in order
                const checkExisting = await client.query(`
                    SELECT * FROM order_items 
                    WHERE "orderId" = $1 AND "productId" = $2
                `, [orderId, item.productId]);
                
                console.log('Existing order items:', checkExisting.rows);

                // Insert order item
                const insertQuery = `
                    INSERT INTO order_items("orderId", "productId", "purchasedQuantity", "productPrice")
                    VALUES ($1, $2, $3, $4)
                    RETURNING *
                `;
                const insertValues = [orderId, item.productId, item.purchasedQuantity, item.price];
                
                const orderItemResult = await client.query(insertQuery, insertValues);
                console.log('Insert successful:', orderItemResult.rows[0]);

                // Update product quantity
                const updateQuery = `
                    UPDATE products 
                    SET "availableQuantity" = "availableQuantity" - $1
                    WHERE id = $2 AND "availableQuantity" >= $1
                    RETURNING "availableQuantity", id
                `;
                const updateValues = [item.purchasedQuantity, item.productId];
                
                const updateResult = await client.query(updateQuery, updateValues);
                console.log('Update result:', updateResult.rows[0]);

                if (!updateResult.rows.length) {
                    throw new OrderError(`Insufficient quantity available for product ID: ${item.productId}`, 400);
                }

                return orderItemResult;

            } catch (error) {
                console.error('Operation failed:', {
                    productId: item.productId,
                    error: {
                        code: error.code,
                        constraint: error.constraint,
                        detail: error.detail,
                        message: error.message
                    }
                });
                throw error;
            }
        });

        try {
            const results = await Promise.all(orderItemsPromises);
            console.log('All operations completed:', results.map(r => r.rows[0]));
            return results.every(result => result.rowCount > 0) ? results : null;
        } catch (error) {
            console.error('Promise.all failed:', error);
            throw error;
        }
    } else {
        // Handle single item purchase
        console.log('==========CreateOrderItems Single Item Debug==============');
        console.log('Single item details:', {
            orderId,
            productId: orderDetails.productId,
            purchasedQuantity: orderDetails.purchasedQuantity,
            price: orderDetails.productPrice
        });

        try {
            // Insert order item
            const orderItemsQuery = `
                INSERT INTO order_items ("orderId", "productId", "purchasedQuantity", "productPrice")
                VALUES ($1, $2, $3, $4)
                RETURNING *
            `;
            const orderItemsValues = [orderId, orderDetails.productId, orderDetails.purchasedQuantity, orderDetails.productPrice];
            const orderItemResult = await client.query(orderItemsQuery, orderItemsValues);
            console.log('Insert successful:', orderItemResult.rows[0]);

            // Update product quantity
            const updateQuery = `
                UPDATE products 
                SET "availableQuantity" = "availableQuantity" - $1
                WHERE id = $2 AND "availableQuantity" >= $1
                RETURNING "availableQuantity", id
            `;
            const updateValues = [orderDetails.purchasedQuantity, orderDetails.productId];
            const updateResult = await client.query(updateQuery, updateValues);
            console.log('Update result:', updateResult.rows[0]);

            if (!updateResult.rows.length) {
                throw new OrderError(`Insufficient quantity available for product ID: ${orderDetails.productId}`, 400);
            }

            return orderItemResult.rowCount ? orderItemResult : null;
        } catch (error) {
            console.error('Operation failed:', {
                productId: orderDetails.productId,
                error: {
                    code: error.code,
                    constraint: error.constraint,
                    detail: error.detail,
                    message: error.message
                }
            });
            throw error;
        }
    }
}

//-- Function to update the "isSold" state in the products table.
//-- Requires productId - Product Id or array of product IDs
//-- Returns {boolean} Success Status
async function updateProductStatus(client, orderDetails) {
    console.log('Order items in updateProductStatus:', orderDetails, 'type:', typeof(orderDetails))

    if (orderDetails.items && Array.isArray(orderDetails.items)) {
        // Extract product IDs from order items
        const productIds = orderDetails.items.map(item => item.productId);

        const updatePromises = productIds.map(id => {
            const query = `
                UPDATE products
                SET "isSold" = TRUE, "soldAt" = CURRENT_TIMESTAMP
                WHERE id = $1
            `;
            return client.query(query, [id]);
        });

        const results = await Promise.all(updatePromises);
        return results.every(result => result.rowCount > 0);
    } else {
        // Handle single product case
        const updateProductQuery = `
            UPDATE products
            SET "isSold" = TRUE, "soldAt" = CURRENT_TIMESTAMP
            WHERE id = $1
        `;
        const updateProductResult = await client.query(updateProductQuery, [orderDetails.productId]); //The orderItems being inserted into the db is the actual productId
        return updateProductResult.rowCount > 0;
    }
}


async function sendEmailVerificationToBuyer(orderResult, orderDetails, userId) {
    const logPrefix = `[EmailVerification][OrderID:${orderResult?.rows[0]?.id}][UserID:${userId}]`;
    
    try {
        console.log(`${logPrefix} Starting email verification process`);
        
        // Input validation
        if (!orderResult?.rows?.length) {
            throw new Error('Invalid orderResult structure');
        }
        if (!orderDetails?.items && !orderDetails?.productId) {
            throw new Error('Invalid orderDetails structure');
        }
        if (!userId) {
            throw new Error('Missing userId');
        }

        const productIds = orderDetails.items
            ? orderDetails.items.map(item => item.productId)
            : [orderDetails.productId];
        
        console.log(`${logPrefix} Processing products:`, productIds);

        // Get buyer's email with validation
        const getBuyerEmailQuery = `
            SELECT email 
            FROM users
            WHERE id = $1
        `;
        const userEmailResult = await zingoPool.query(getBuyerEmailQuery, [userId]);
        const buyerEmail = userEmailResult.rows[0]?.email;
        
        if (!buyerEmail) {
            throw new Error(`Buyer email not found for userId: ${userId}`);
        }
        
        // Get seller details with validation
        const getSellerDetailsQuery = `
            SELECT DISTINCT 
                u.email,
                u."firstName",
                u."lastName",
                p."sellerAddress",
                p."sellerCity",
                p."phoneNumber" AS "sellerPhoneNumber"
            FROM users u
            INNER JOIN products p ON p."postedBy" = u.id
            WHERE p.id = ANY($1)
        `;
        
        const sellerDetailsResult = await zingoPool.query(getSellerDetailsQuery, [productIds]);
        
        if (!sellerDetailsResult.rows.length) {
            throw new Error(`Seller details not found for products: ${productIds.join(', ')}`);
        }

        const sellerDetails = sellerDetailsResult.rows.map(row => ({
            email: row.email,
            sellerFirstName: row.firstName,
            sellerLastName: row.lastName,
            sellerCity: row.sellerCity,
            sellerPhoneNumber: row.sellerPhoneNumber
        }));

        console.log(`${logPrefix} Attempting to send buyer email to:`, buyerEmail);
        
        // Send buyer email with timeout and retry
        const buyerEmailResult = await Promise.race([
            sendOrderConfirmationEmail(
                {  
                    resultOrder: orderResult.rows[0],
                    orderDetails,
                },
                buyerEmail
            ),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Email timeout')), 30000)
            )
        ]).catch(async (error) => {
            console.error(`${logPrefix} First attempt to send buyer email failed:`, error);
            // Retry once
            return await sendOrderConfirmationEmail(
                {  
                    resultOrder: orderResult.rows[0],
                    orderDetails,
                },
                buyerEmail
            );
        });

        if (!buyerEmailResult.success) {
            throw new Error(`Failed to send buyer email: ${buyerEmailResult.error}`);
        }

        console.log(`${logPrefix} Attempting to send seller emails to:`, sellerDetails.map(s => s.email));
        
        // Send seller emails with timeout and retry
        const sellerEmailPromises = sellerDetails.map(async (seller) => {
            try {
                const result = await Promise.race([
                    sendOrderSoldEmail(
                        {
                            resultOrder: orderResult.rows[0],
                            orderDetails,
                        },
                        [seller]
                    ),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Email timeout')), 30000)
                    )
                ]).catch(async (error) => {
                    console.error(`${logPrefix} First attempt to send seller email failed:`, error);
                    // Retry once
                    return await sendOrderSoldEmail(
                        {
                            resultOrder: orderResult.rows[0],
                            orderDetails,
                        },
                        [seller]
                    );
                });

                if (!result.success) {
                    throw new Error(`Failed to send seller email: ${result.error}`);
                }
                return result;
            } catch (error) {
                console.error(`${logPrefix} Failed to send email to seller ${seller.email}:`, error);
                return { success: false, error: error.message };
            }
        });

        const sellerResults = await Promise.all(sellerEmailPromises);
        const failedSellerEmails = sellerResults.filter(r => !r.success);

        if (failedSellerEmails.length > 0) {
            console.error(`${logPrefix} Some seller emails failed:`, failedSellerEmails);
        }

        return { 
            success: true, 
            buyerEmailSent: true,
            sellerEmailResults: sellerResults
        };

    } catch (error) {
        console.error(`${logPrefix} Error in email verification process:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

module.exports = {
    extractAndValidateRequestData,
    createOrder,
    createOrderItems,
    updateProductStatus,
    sendEmailVerificationToBuyer
};