const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");
const crypto = require('crypto');


function generateOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}



// Turn (user_id, merchant_id) into a single bigint for the advisory lock
function lockKey(userId, merchantId) {
  return crypto
    .createHash('sha256')
    .update(`${userId}:${merchantId}`)
    .digest()
    .readBigInt64BE(0);
}


const ALGORITHM = 'aes-256-gcm';
if (!process.env.OTP_ENCRYPTION_KEY || process.env.OTP_ENCRYPTION_KEY.length !== 64) {
  throw new Error('OTP_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)');
}
const OTP_KEY = Buffer.from(process.env.OTP_ENCRYPTION_KEY, 'hex');


function encryptOtp(otp) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, OTP_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(otp, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptOtp(payload) {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, OTP_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

router.get('/coupons/my/:claimId/otp', authenticateFirebaseToken, async (req, res) => {
  const { claimId } = req.params;
  const userId = req.user.id;
  try {
    const result = await zingoPool.query(
      `SELECT otp_encrypted, otp_expires_at FROM rielpoint_coupon_claims
       WHERE claim_id = $1 AND customer_id = $2`,
      [claimId, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Claim not found' });
    }
    const { otp_encrypted, otp_expires_at } = result.rows[0];
    if (new Date(otp_expires_at) <= new Date()) {
      return res.status(410).json({ error: 'Code has expired' });
    }

    let otp;
    try {
      otp = decryptOtp(otp_encrypted);
    } catch (decryptErr) {
      // Row predates the encryption migration (still holds an old sha256
      // hash, or is malformed) — can't be recovered.
      console.error('Legacy/invalid otp_encrypted for claim', claimId, decryptErr.message);
      return res.status(410).json({ error: 'Code is unavailable, please reach out to support' });
    }

    const expiresInSeconds = Math.max(0, Math.round((new Date(otp_expires_at) - new Date()) / 1000));
    res.json({ otp, expiresInSeconds });
  } catch (err) {
    console.error('Error fetching OTP:', err);
    res.status(500).json({ error: 'Failed to fetch code' });
  }
});
router.post('/coupons/:id/claim', authenticateFirebaseToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;
  const idempotencyKey = req.headers['idempotency-key'];
  console.log("idempotencyKey:", idempotencyKey, "userId:", userId, "couponId:", id);

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing Idempotency-Key header' });
  }
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const client = await zingoPool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT phone_number FROM rielpoint_users WHERE id = $1`,
      [userId]
    );
    const phoneNumber = normalizePhoneNumber(userResult.rows[0]?.phone_number);
    console.log('phoneNumber', phoneNumber);

    const couponResult = await client.query(
      `SELECT * FROM rielpoint_coupons
       WHERE coupon_id = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())
       FOR UPDATE`,
      [id]
    );
    if (couponResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Coupon not found, inactive, or expired' });
    }
    const coupon = couponResult.rows[0];
    const pointsCost = Number(coupon.points_cost);

    // Serialize any concurrent claims for this user+merchant so the
    // balance check below can't race with another claim's deduction
    await client.query('SELECT pg_advisory_xact_lock($1)', [
      lockKey(userId, coupon.merchant_id),
    ]);

    const balanceResult = await client.query(
      `SELECT COALESCE(SUM(points), 0) AS balance
       FROM rielpoint_point_transactions
       WHERE customer_phone = $1 AND merchant_id = $2`,
      [phoneNumber, coupon.merchant_id]
    );
    const currentPoints = Number(balanceResult.rows[0].balance);

    if (currentPoints < pointsCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient points' });
    }

    const previousBalance = currentPoints;
    const newBalance = currentPoints - pointsCost;
    const otp = generateOtp();
        const otpEncrypted = encryptOtp(otp);

      const claimResult = await client.query(
      `INSERT INTO rielpoint_coupon_claims
        (coupon_id, customer_id, merchant_id, otp_encrypted, otp_expires_at, claimed_at)
      VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days', NOW())
      ON CONFLICT (coupon_id, customer_id) WHERE redeemed_at IS NULL DO NOTHING
      RETURNING claim_id`,
      [id, userId, coupon.merchant_id, otpEncrypted]
    );

    if (claimResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Coupon already claimed' });
    }
    const claimId = claimResult.rows[0].claim_id;

    // Deduct by inserting a negative ledger entry, tied back to the claim
   const txnResult = await client.query(
  `INSERT INTO rielpoint_point_transactions
    (user_id, merchant_id, points, type, customer_phone, amount, currency,
    usd_amount, exchange_rate, points_rate, previous_balance, new_balance,
    reference_claim_id, idempotency_key, created_at)
  VALUES ($1, $2, $3, 'coupon_claim', $4, 0, 'USD', 0, 1.0, 1.0, $5, $6, $7, $8, NOW())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id`,
  [userId, coupon.merchant_id, -pointsCost, phoneNumber,
   previousBalance, newBalance, claimId, idempotencyKey]
);

    // If this idempotency key was already used, the insert above was a no-op.
    // That means this is a retried request for a claim we already created
    // earlier in this same transaction attempt — but since claimResult
    // succeeded (rows.length > 0), the claim itself is new, so a conflicting
    // idempotency key here means the *key* was reused across a different
    // claim, which is a client bug, not a legitimate retry. Guard against it:
    if (txnResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Idempotency key already used for a different transaction' });
    }

    await client.query('COMMIT');

    res.status(200).json({ claimId, otp, expiresInSeconds: 604800 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error claiming coupon:', err);
    res.status(500).json({ error: 'Failed to claim coupon' });
  } finally {
    client.release();
  }
});



router.post('/coupon/verify', authenticateFirebaseToken, async (req, res) => {
  const userId = req.user.id;
  const { otp } = req.body;

  if (!otp || typeof otp !== 'string' || !otp.trim()) {
    return res.status(400).json({ error: 'OTP code is required' });
  }
  const enteredOtp = otp.trim();

  const client = await zingoPool.connect();
  try {
    await client.query('BEGIN');

    const merchantResult = await client.query(
      `SELECT id FROM rielpoint_merchants WHERE owner_id = $1`,
      [userId]
    );
    const merchantId = merchantResult.rows[0]?.id;
    if (!merchantId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'No merchant associated with this account' });
    }


    const claimsResult = await client.query(
      `SELECT cl.claim_id, cl.otp_encrypted, cl.customer_id,
              c.coupon_id, c.discount_type, c.discount_value, c.points_cost
       FROM rielpoint_coupon_claims cl
       JOIN rielpoint_coupons c ON c.coupon_id = cl.coupon_id
       WHERE cl.merchant_id = $1
         AND cl.redeemed_at IS NULL
         AND cl.otp_expires_at > NOW()
       FOR UPDATE OF cl`,
      [merchantId]
    );

    let matchedClaim = null;
    for (const row of claimsResult.rows) {
      let decrypted;
      try {
        decrypted = decryptOtp(row.otp_encrypted);
      } catch {
        continue; // legacy/corrupt row — skip, not a match
      }
      if (decrypted === enteredOtp) {
        matchedClaim = row;
        break;
      }
    }

    if (!matchedClaim) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invalid or expired code' });
    }

    const updateResult = await client.query(
      `UPDATE rielpoint_coupon_claims
       SET redeemed_at = NOW(), redeemed_by = $2
       WHERE claim_id = $1 AND redeemed_at IS NULL
       RETURNING claim_id`,
      [matchedClaim.claim_id, userId]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Coupon already redeemed' });
    }

    const customerResult = await client.query(
      `SELECT phone_number FROM rielpoint_users WHERE id = $1`,
      [matchedClaim.customer_id]
    );

    await client.query('COMMIT');

    res.status(200).json({
      claimId: matchedClaim.claim_id,
      couponId: matchedClaim.coupon_id,
      discountType: matchedClaim.discount_type,
      discountValue: matchedClaim.discount_value,
      pointsCost: matchedClaim.points_cost,
      customerPhone: customerResult.rows[0]?.phone_number ?? null,
      redeemedAt: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error verifying coupon:', err);
    res.status(500).json({ error: 'Failed to verify coupon' });
  } finally {
    client.release();
  }
});
router.get('/coupons/my', authenticateFirebaseToken, async (req, res) => {
  console.log('Fetching claimed coupons for user:', req.user);
  const userId = req.user.id;
  try {
    const result = await zingoPool.query(
      `SELECT 
         cl.claim_id,
         cl.claimed_at,
         cl.otp_expires_at,
         cl.otp_attempts,
         cl.redeemed_at,
         c.*,
         m.name AS merchant_name
       FROM rielpoint_coupon_claims cl
       JOIN rielpoint_coupons c ON c.coupon_id = cl.coupon_id
       LEFT JOIN rielpoint_merchants m ON c.merchant_id = m.id
       WHERE cl.customer_id = $1
       ORDER BY cl.claimed_at DESC`,
      [userId]
    );
    res.json({ coupons: result.rows });
  } catch (err) {
    console.error('Error fetching claimed coupons:', err);
    res.status(500).json({ error: 'Failed to fetch claimed coupons' });
  }
});

router.get('/coupons', async (req, res) => {
  const { userPhoneNumber } = req.query;

  try {
    const couponsResult = await zingoPool.query(
      `SELECT 
         c.*, 
         m.name AS merchant_name,
         COALESCE(pt.balance, 0) AS user_points
       FROM rielpoint_coupons c
       LEFT JOIN rielpoint_merchants m ON c.merchant_id = m.id
       LEFT JOIN (
         SELECT merchant_id, SUM(points) AS balance
         FROM rielpoint_point_transactions
         WHERE customer_phone = $1
         GROUP BY merchant_id
       ) pt ON pt.merchant_id = c.merchant_id
       ORDER BY m.name NULLS LAST, c.created_at DESC`,
      [userPhoneNumber || null]
    );
    // console.log("couponsResult:", couponsResult.rows);

    res.status(200).json({ coupons: couponsResult.rows });
  } catch (err) {
    console.error('Error fetching coupons:', err);
    res.status(500).json({ error: 'Failed to fetch coupons' });
  }
});

router.post('/coupon/create', authenticateFirebaseToken, async (req, res) => {
    console.log('Received request to create coupon:', req.body);
  
  try {
    const userId= req.user.id;
    const getMerchantIdResult = await zingoPool.query(
      'SELECT id FROM rielpoint_merchants WHERE owner_id = $1',
      [userId]
    ); 
    const merchantId = getMerchantIdResult.rows[0]?.id;
    console.log("merchantId:", merchantId);
    if (!merchantId) {
      return res.status(403).json({ error: 'No merchant associated with this account' });
    }

    const { points_cost, discount_type, discount_value, expires_at } = req.body;

    if (!points_cost || !discount_type || !discount_value) {
      return res.status(400).json({ error: 'points_cost, discount_type, and discount_value are required' });
    }
    if (!['percent', 'amount'].includes(discount_type)) {
      return res.status(400).json({ error: 'discount_type must be "percent" or "amount"' });
    }

    const result = await zingoPool.query(
      `INSERT INTO rielpoint_coupons
         (merchant_id, points_cost, discount_type, discount_value, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING coupon_id, points_cost, discount_type, discount_value, expires_at, is_active, created_at`,
      [merchantId, points_cost, discount_type, discount_value, expires_at || null]
    );

    const row = result.rows[0];
    const discount =
      row.discount_type === 'percent'
        ? `${row.discount_value}% off`
        : `-$${row.discount_value} on everything`;

    res.status(201).json({ coupon: { ...row, discount } });
  } catch (err) {
    console.error('Error creating coupon:', err);
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});
 

router.post('/coupon/status/:couponId', authenticateFirebaseToken, async (req, res) => {
  console.log("patching", req.body.couponId, "with body", req.body);
  const userId = req.user.id;
  const { couponId } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active must be a boolean' });
  }

  try {
    const merchantResult = await zingoPool.query(
      'SELECT id FROM rielpoint_merchants WHERE owner_id = $1',
      [userId]
    );
    const merchantId = merchantResult.rows[0]?.id;
    if (!merchantId) {
      return res.status(403).json({ error: 'No merchant associated with this account' });
    }

    const result = await zingoPool.query(
      `UPDATE rielpoint_coupons
       SET is_active = $1
       WHERE coupon_id = $2 AND merchant_id = $3
       RETURNING coupon_id, points_cost, discount_type, discount_value, expires_at, is_active, created_at`,
      [is_active, couponId, merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    res.status(200).json({ coupon: result.rows[0] });
  } catch (err) {
    console.error('Error updating coupon:', err);
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

router.delete('/coupon/:couponId', authenticateFirebaseToken, async (req, res) => {
  const userId = req.user.id;
  const { couponId } = req.params;

  try {
    const merchantResult = await zingoPool.query(
      'SELECT id FROM rielpoint_merchants WHERE owner_id = $1',
      [userId]
    );
    const merchantId = merchantResult.rows[0]?.id;
    if (!merchantId) {
      return res.status(403).json({ error: 'No merchant associated with this account' });
    }

    // Coupons that have already been claimed can't be hard-deleted without
    // orphaning rielpoint_coupon_claims rows, so fall back to deactivating.
    const claimCheck = await zingoPool.query(
      'SELECT 1 FROM rielpoint_coupon_claims WHERE coupon_id = $1 LIMIT 1',
      [couponId]
    );

    if (claimCheck.rows.length > 0) {
      const result = await zingoPool.query(
        `UPDATE rielpoint_coupons
         SET is_active = false
         WHERE coupon_id = $1 AND merchant_id = $2
         RETURNING coupon_id`,
        [couponId, merchantId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Coupon not found' });
      }
      return res.status(200).json({
        deactivatedInsteadOfDeleted: true,
        couponId: result.rows[0].coupon_id,
      });
    }

    const result = await zingoPool.query(
      `DELETE FROM rielpoint_coupons
       WHERE coupon_id = $1 AND merchant_id = $2
       RETURNING coupon_id`,
      [couponId, merchantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Coupon not found' });
    }

    res.status(200).json({ deleted: true, couponId: result.rows[0].coupon_id });
  } catch (err) {
    console.error('Error deleting coupon:', err);
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

module.exports = router;