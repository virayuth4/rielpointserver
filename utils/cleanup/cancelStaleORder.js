const cron = require('node-cron');
const zingoPool = require('../../database/pgZingo');
const { calculateOrderStatus } = require("../../utils/order/orderStatus");

const SYSTEM_USER_ID = 'system-auto-cancel';

async function cancelStaleOrders() {
    try {
        await zingoPool.query('BEGIN');

        // 1. Find orders still pending after 72 hours
        const { rows: staleOrders } = await zingoPool.query(
            `SELECT "orderId" FROM "33orders"
             WHERE "currentStatus" = 'pending'
             AND "createdAt" < NOW() - INTERVAL '72 hours'`
        );

        for (const { orderId } of staleOrders) {
            // 2. Cancel all items for this order
            await zingoPool.query(
                `UPDATE "33orderItems"
                 SET "currentStatus" = 'cancelled'
                 WHERE "orderId" = $1`,
                [orderId]
            );

            // 3. Log item-level history for each item
            const { rows: items } = await zingoPool.query(
                `SELECT "productId" FROM "33orderItems" WHERE "orderId" = $1`,
                [orderId]
            );
            for (const { productId } of items) {
                await zingoPool.query(
                    `INSERT INTO "33orderItemStatusHistories" ("orderId", "productId", "status", "changedById")
                     VALUES ($1, $2, 'cancelled', $3)`,
                    [orderId, productId, SYSTEM_USER_ID]
                );
            }

            // 4. Update order status
            await zingoPool.query(
                `UPDATE "33orders" SET "currentStatus" = 'cancelled' WHERE "orderId" = $1`,
                [orderId]
            );

            // 5. Log order-level history
            await zingoPool.query(
                `INSERT INTO "33orderStatusHistories" ("orderId", "status")
                 VALUES ($1, 'cancelled')`,
                [orderId]
            );
        }

        await zingoPool.query('COMMIT');
        console.log(`Auto-cancelled ${staleOrders.length} stale orders`);

    } catch (error) {
        await zingoPool.query('ROLLBACK');
        console.error("Error auto-cancelling stale orders:", error);
    }
}

// Run every hour
cron.schedule('0 * * * *', cancelStaleOrders);

module.exports = { cancelStaleOrders };