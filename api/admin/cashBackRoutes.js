const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');

// Server-side constants — never trust these from the client
const ALLOWED_CASHBACK_RATES = [10, 25, 50]; // % of commission returned to user as cashback

router.post('/cashback/add', authenticateFirebaseToken, async (req, res) => {
    const {
        merchantId, // client-supplied — validated below, never trusted outright
        phone,
        externalTransactionId,
        orderAmount,
        currency,
        commission,
        cashbackRate,
        clickId,        // optional — only set if this order is tied to a tracked affiliate click
        transactionAt,  // optional — when the underlying order happened; defaults to now
    } = req.body;

    console.log(
        "Staff Id", req.user.id, "is attempting to credit cashback:",
        { merchantId, phone, externalTransactionId, orderAmount, currency, commission, cashbackRate }
    );

    if (!externalTransactionId) {
        return res.status(400).json({ message: 'externalTransactionId is required.' });
    }

    const client = await zingoPool.connect();

    try {
    
   

      

        // ---- Idempotency: external_transaction_id is unique per merchant ----
        const existing = await client.query(
            `SELECT id, created_at, merchant_id, user_id, order_amount, currency,
                    commission_amount, cashback_rate, cashback_amount, status, transaction_at
             FROM affiliate_transactions
             WHERE merchant_id = $1 AND external_transaction_id = $2`,
            [merchantId, externalTransactionId]
        );
        if (existing.rows.length > 0) {
            const tx = existing.rows[0];
            return res.status(200).json({
                transactionId: tx.id,
                createdAt: tx.created_at,
                merchantId: tx.merchant_id,
                userId: tx.user_id,
                orderAmount: tx.order_amount,
                currency: tx.currency,
                commission: tx.commission,
                cashbackRate: tx.cashback_rate,
                cashbackAmount: tx.cashback_amount,
                status: tx.status,
                transactionAt: tx.transaction_at,
                idempotent: true,
            });
        }

        // ---- Resolve user_id from phone ----
        const userLookup = await client.query(
            `SELECT id, fullname FROM rielpoint_users WHERE phone_number = $1`,
            [phone]
        );
        if (userLookup.rows.length === 0) {
            return res.status(404).json({ message: 'No user found with this phone number.' });
        }
        const userId = userLookup.rows[0].id;
        const userName = userLookup.rows[0].name ?? 'Customer';

        // ---- Validation ----
        const numericOrderAmount = Number(orderAmount);
        const numericCommission = Number(commission);
        const numericCashbackRate = Number(cashbackRate);

        if (!phone || phone.length < 8) {
            return res.status(400).json({ message: 'A valid phone number is required.' });
        }
        if (!Number.isFinite(numericOrderAmount) || numericOrderAmount <= 0) {
            return res.status(400).json({ message: 'Order amount must be a positive number.' });
        }
        if (currency !== 'USD' && currency !== 'KHR') {
            return res.status(400).json({ message: 'Currency must be USD or KHR.' });
        }
        if (!Number.isFinite(numericCommission) || numericCommission < 0) {
            return res.status(400).json({ message: 'Commission must be a non-negative number.' });
        }
        if (!ALLOWED_CASHBACK_RATES.includes(numericCashbackRate)) {
            return res.status(400).json({ message: `Cashback rate must be one of: ${ALLOWED_CASHBACK_RATES.join(', ')}.` });
        }

        // amount mirrors order_amount (kept as a separate column per schema)
        const amount = numericOrderAmount;
        const cashbackAmount = Math.round(numericCommission * (numericCashbackRate / 100) * 100) / 100;

        if (cashbackAmount <= 0) {
            return res.status(400).json({ message: 'Calculated cashback amount must be greater than zero.' });
        }

        await client.query('BEGIN');

        const txResult = await client.query(
            `INSERT INTO affiliate_transactions
                (merchant_id, user_id, click_id, external_transaction_id, order_amount,
                 commission_amount,  currency, cashback_rate, cashback_amount, status, transaction_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id, created_at`,
            [
                merchantId,
                userId,
                clickId || null,
                externalTransactionId,
                numericOrderAmount,
                numericCommission,
            
                currency,
                numericCashbackRate,
                cashbackAmount,
                'pending', // confirmation is handled by a separate route
                transactionAt || new Date(),
            ]
        );

        await client.query('COMMIT');

        return res.status(200).json({
            transactionId: txResult.rows[0].id,
            createdAt: txResult.rows[0].created_at,
            merchantId,
            userId,
            userName,
            orderAmount: numericOrderAmount,
            currency,
            commission: numericCommission,
            amount,
            cashbackRate: numericCashbackRate,
            cashbackAmount,
            status: 'pending',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error crediting cashback:', err);
        return res.status(500).json({ message: 'Failed to credit cashback. Please try again.' });
    } finally {
        client.release();
    }
});

module.exports = router;