const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");

const { randomUUID } = require('crypto');



router.post('/merchant/create',  async (req, res) => {
  console.log("merchant creation request body:", req.body);
  const { name, contact_phone } = req.body;


  if (!name || !contact_phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const ownerId = req.user?.id;
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  try {
   const result = await zingoPool.query(
      `INSERT INTO rielpoint_merchants
        (name, slug, contact_phone, timezone, status, settings, owner_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
      RETURNING id, name, slug, contact_email, contact_phone, timezone, status, settings, created_at, updated_at, owner_id`,
      [
        name.trim(),
        slug,
        contact_phone.trim(),
        'Asia/Phnom_Penh',
        'pending',
        {},
        ownerId,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // unique_violation, likely on slug
      return res.status(409).json({ error: 'A merchant with this name already exists' });
    }
    console.error('Error creating merchant:', err);
    return res.status(500).json({ error: 'Failed to create merchant' });
  }
});

router.get('/dashboard', authenticateFirebaseToken, async (req, res) => {
  try {
    const userId = req.user.id; // set by authenticateFirebaseToken

    // 1. Find the merchant owned by this user, pulling everything for the client
    const merchantResult = await zingoPool.query(
      'SELECT * FROM rielpoint_merchants WHERE owner_id = $1',
      [userId]
    );

    if (merchantResult.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant not found for this user' });
    }

    const merchant = merchantResult.rows[0];

    // 2. Pull all staff for that merchant
    const staffResult = await zingoPool.query(
      `SELECT
         s.id,
         s.staff_id,
         s.is_active,
         s.created_at,
         s."is_deleted",
         u.fullname,
         u.phone_number
       FROM rielpoint_staffs s
       JOIN rielpoint_users u ON u.id = s.staff_id
       WHERE s.merchant_id = $1`,
      [merchant.id]
    );

    const couponsResult = await zingoPool.query(
      'SELECT * FROM rielpoint_coupons WHERE merchant_id = $1',
      [merchant.id]
    );
    // console.log('Coupons result:', couponsResult.rows);
const couponClaimsResult = await zingoPool.query(
  `SELECT 
     rielpoint_coupon_claims.*,
     customer.phone_number AS customer_phone,
     staff.fullname AS staff_fullname
   FROM rielpoint_coupon_claims
   LEFT JOIN rielpoint_users AS customer 
     ON customer.id = rielpoint_coupon_claims.customer_id
   LEFT JOIN rielpoint_users AS staff 
     ON staff.id = rielpoint_coupon_claims.redeemed_by
   WHERE rielpoint_coupon_claims.merchant_id = $1
     AND rielpoint_coupon_claims.redeemed_at IS NOT NULL
   ORDER BY rielpoint_coupon_claims.redeemed_at DESC
   LIMIT 10`,
  [merchant.id]
)
  const pointTransactionResult = await zingoPool.query(
  `SELECT
     t.*,
     s.staff_id AS staff_user_id,
     u.fullname AS staff_fullname
   FROM rielpoint_point_transactions t
   LEFT JOIN rielpoint_staffs s ON s.id = t.staff_id
   LEFT JOIN rielpoint_users u ON u.id = s.staff_id
   WHERE t.merchant_id = $1
   ORDER BY t.created_at DESC
   LIMIT 10`,
  [merchant.id]
);

    // console.log("Point Transaction Result:", pointTransactionResult.rows);
    res.json({
      merchant,
      staffs: staffResult.rows,
      coupons: couponsResult.rows,
      couponClaims: couponClaimsResult.rows,
      recentPointTransactions: pointTransactionResult.rows
    });
  } catch (err) {
    console.error('Error fetching merchant dashboard:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.post('/staff/status/:rowId', authenticateFirebaseToken, async (req, res) => {
  const { rowId } = req.params;
  const { is_active } = req.body;
  const userId = req.user?.id;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean.' });
  }

  try {
    const merchantResult = await zingoPool.query(
      `SELECT rielpoint_merchants.id
       FROM rielpoint_merchants
       JOIN rielpoint_users ON rielpoint_users.id = rielpoint_merchants.owner_id
       WHERE rielpoint_merchants.owner_id = $1
         AND rielpoint_users.role = 'owner'`,
      [userId]
    );

    if (merchantResult.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to update staff.' });
    }

    const merchantId = merchantResult.rows[0].id;

    const updateResult = await zingoPool.query(
      `UPDATE rielpoint_staffs
       SET is_active = $1
       WHERE id = $2 AND merchant_id = $3
       RETURNING id, merchant_id, staff_id, is_active`,
      [is_active, rowId, merchantId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Staff record not found for this merchant.' });
    }

    return res.status(200).json({ staff: updateResult.rows[0] });
  } catch (err) {
    console.error('Update staff status error:', err);
    return res.status(500).json({ error: 'Failed to update staff status.' });
  }
});
router.post('/staff/add', authenticateFirebaseToken, async (req, res) => {
  const { staff_phone } = req.body;
  const userId = req.user?.id;

  if (!staff_phone || !staff_phone.trim()) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  try {
   const merchantResult = await zingoPool.query(
      `SELECT rielpoint_merchants.id
      FROM rielpoint_merchants
      JOIN rielpoint_users ON rielpoint_users.id = rielpoint_merchants.owner_id
      WHERE rielpoint_merchants.owner_id = $1
        AND rielpoint_users.role = 'owner'`,
      [userId]
    );

    if (merchantResult.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to add staff.' });
    }

    const merchantId = merchantResult.rows[0].id;

    const staffIdResult = await zingoPool.query(
      `SELECT id, name FROM rielpoint_users WHERE phone_number = $1`,
      [staff_phone.trim()]
    );

    if (staffIdResult.rows.length === 0) {
      return res.status(404).json({ error: 'No user found with that phone number.' });
    }

    const staffId = staffIdResult.rows[0].id;
    const staffName = staffIdResult.rows[0].name;

    const addStaffResult = await zingoPool.query(
      `INSERT INTO rielpoint_staffs (merchant_id, staff_id, is_active, created_at)
       VALUES ($1, $2, true, now())
       RETURNING id, merchant_id, staff_id, is_active, created_at`,
      [merchantId, staffId]
    );

    return res.status(201).json({
      staff: {
        ...addStaffResult.rows[0],
        staff_name: staffName,
      },
    });
  } catch (err) {
    console.error('Add staff error:', err);
    return res.status(500).json({ error: 'Failed to add staff.' });
  }
});

router.post('/staff/remove/:rowId', authenticateFirebaseToken, async (req, res) => {
  const { rowId } = req.params;
  const userId = req.user?.id;
  console.log("Remove staff", rowId, "by user", userId);

  if (!rowId) {
    return res.status(400).json({ error: 'rowId is required.' });
  }

  try {
    // Verify the requester owns the merchant this staff belongs to
    const merchantResult = await zingoPool.query(
      `SELECT rielpoint_merchants.id
       FROM rielpoint_merchants
       JOIN rielpoint_users ON rielpoint_users.id = rielpoint_merchants.owner_id
       WHERE rielpoint_merchants.owner_id = $1
         AND rielpoint_users.role = 'owner'`,
      [userId]
    );

    if (merchantResult.rows.length === 0) {
      return res.status(403).json({ error: 'You do not have permission to remove staff.' });
    }

    const merchantId = merchantResult.rows[0].id;

    // Soft-delete: only deactivate if the staff row actually belongs to this merchant
    const removeStaffResult = await zingoPool.query(
      `UPDATE rielpoint_staffs
       SET is_deleted = true
       WHERE id = $1 AND merchant_id = $2
       RETURNING id, merchant_id, staff_id, is_deleted`,
      [rowId, merchantId]
    );

    if (removeStaffResult.rows.length === 0) {
      return res.status(404).json({ error: 'Staff record not found for this merchant.' });
    }

    return res.status(200).json({ staff: removeStaffResult.rows[0] });
  } catch (err) {
    console.error('Remove staff error:', err);
    return res.status(500).json({ error: 'Failed to remove staff.' });
  }
});
module.exports = router;