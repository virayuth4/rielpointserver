const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { route } = require("./merchantRoutes");

// Server-side constants — never trust these from the client
const KHR_PER_USD = 4001;
const ALLOWED_RATES = [10, 25, 50];


router.get('/points/transactions', authenticateFirebaseToken, async (req, res) => {
    console.log('Fetching transactions for user:', req.user.id);
    const userId = req.user.id;

    try {
        const userPhoneNumberResult = await zingoPool.query(
            `SELECT phone_number FROM rielpoint_users WHERE id = $1`,
            [userId]
        );

        const rawPhone = userPhoneNumberResult.rows[0]?.phone_number;

        if (!rawPhone) {
            return res.status(404).json({ error: 'User phone number not found' });
        }

        // Normalize: build both "855..." and "0..." variants regardless of
        // which format is stored on the user row.
        let intlFormat, localFormat;

        if (rawPhone.startsWith('855')) {
            intlFormat = rawPhone;
            localFormat = '0' + rawPhone.slice(3);
        } else if (rawPhone.startsWith('0')) {
            localFormat = rawPhone;
            intlFormat = '855' + rawPhone.slice(1);
        } else {
            // Fallback: assume it's missing both prefixes, e.g. "61207903"
            intlFormat = '855' + rawPhone;
            localFormat = '0' + rawPhone;
        }

        const result = await zingoPool.query(
            `SELECT 
                t.*,
                m.name AS merchant_name
             FROM rielpoint_point_transactions t
             LEFT JOIN rielpoint_merchants m ON t.merchant_id = m.id
             WHERE t.customer_phone = ANY($1::text[])`,
            [[intlFormat, localFormat]]
        );

        res.status(200).json({ transactions: result.rows });
    } catch (err) {
        console.error('Error fetching transactions:', err);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

router.post('/points/add', authenticateFirebaseToken, async (req, res) => {
    const { phone, amount, currency, rate, idempotencyKey } = req.body;
    console.log("Staff Id", req.user.id, "is attempting to credit points:", { phone, amount, currency, rate, idempotencyKey });

    if (!idempotencyKey) {
        return res.status(400).json({ message: 'idempotencyKey is required.' });
    }

    const client = await zingoPool.connect();

    try {
        // ---- Check for a prior attempt with this key first ----
        const existing = await client.query(
            `SELECT id, created_at, merchant_id, customer_phone, amount, currency,
                    usd_amount, points_rate, points
             FROM rielpoint_point_transactions
             WHERE idempotency_key = $1`,
            [idempotencyKey]
        );
        if (existing.rows.length > 0) {
            const tx = existing.rows[0];
            return res.status(200).json({
                transactionId: tx.id,
                createdAt: tx.created_at,
                merchantId: tx.merchant_id,
                phone: tx.customer_phone,
                amount: tx.amount,
                currency: tx.currency,
                usdAmount: tx.usd_amount,
                rate: tx.points_rate,
                points: tx.points,
                idempotent: true, // optional flag so the client knows this was a replay
            });
        }

        // ---- Resolve merchant_id (UUID) from rielpoint_staffs ----
        const staffLinks = await client.query(
            `SELECT id, merchant_id FROM rielpoint_staffs
             WHERE staff_id = $1 AND is_active = true`,
            [req.user.id]
        );

        console.log("Staff links found for user:", staffLinks.rows);

        if (staffLinks.rows.length === 0) {
            return res.status(403).json({ message: 'This phone number is not registered as active staff at any merchant.' });
        }
        if (staffLinks.rows.length > 1) {
            return res.status(409).json({ message: 'Staff is linked to multiple active merchants.' });
        }

        const merchantId = staffLinks.rows[0].merchant_id;
        const staffId = staffLinks.rows[0].id;
        console.log("Staff Links", staffLinks.rows);
      
        console.log("staffId", staffId, "is linked to merchantId:", merchantId);

        // ---- Validation ----
       
        const numericAmount = Number(amount);
        const numericRate = Number(rate);

        if (phone.length < 8) {
            return res.status(400).json({ message: 'A valid phone number is required.' });
        }
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ message: 'Amount must be a positive number.' });
        }
        if (currency !== 'USD' && currency !== 'KHR') {
            return res.status(400).json({ message: 'Currency must be USD or KHR.' });
        }
        if (!ALLOWED_RATES.includes(numericRate)) {
            return res.status(400).json({ message: `Rate must be one of: ${ALLOWED_RATES.join(', ')}.` });
        }

        const usdAmount = currency === 'USD' ? numericAmount : numericAmount / KHR_PER_USD;
        const points = Math.round(usdAmount * numericRate * 10);

        if (points <= 0) {
            return res.status(400).json({ message: 'Calculated points must be greater than zero.' });
        }

        await client.query('BEGIN');

        const txResult = await client.query(
            `INSERT INTO rielpoint_point_transactions
                (staff_id, merchant_id, customer_phone, amount, currency, usd_amount,
                exchange_rate, points_rate, points, idempotency_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, created_at`,
            [
                staffId,
                merchantId,
                phone,
                numericAmount,
                currency,
                usdAmount,
                currency === 'KHR' ? KHR_PER_USD : 1,
                numericRate,
                points,
                idempotencyKey,
            ]
        );

        await client.query('COMMIT');

        return res.status(200).json({
            transactionId: txResult.rows[0].id,
            createdAt: txResult.rows[0].created_at,
            merchantId,
            phone,
            amount: numericAmount,
            currency,
            usdAmount,
            rate: numericRate,
            points,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error crediting points:', err);
        return res.status(500).json({ message: 'Failed to credit points. Please try again.' });
    } finally {
        client.release();
    }
});

module.exports = router;