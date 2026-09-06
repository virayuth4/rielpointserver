const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber, toFirebaseEmail } = require("../../lib/normalizePhoneNumber");
const jwt = require('jsonwebtoken');
const RESET_TOKEN_SECRET = process.env.OTP_ENCRYPTION_KEY;




async function sendOTPWithServiceAPI(phoneNumber, otp, fullName, requestNumber = 1) {
    console.log("\n--- [START] Sending OTP via External Service ---");
    console.log(`[Details] Phone: ${phoneNumber} | OTP: ${otp} | Name: ${fullName} | Attempt: ${requestNumber}`);

    const baseUrl = (process.env.NEXT_PUBLIC_OTP_BACKEND || '').replace(/\/+$/, '');
    const otpBackendUrl = `${baseUrl}/api/send-otp`;

    console.log("[Target Endpoint]:", otpBackendUrl);

    if (!baseUrl) {
        console.error("❌ [ERROR] process.env.NEXT_PUBLIC_OTP_BACKEND is undefined!");
        return { success: false, error: 'Configuration Error: Missing OTP Backend URL' };
    }

    // 👇 server-only secret, no NEXT_PUBLIC_ prefix
    if (!process.env.OTP_BACKEND_API_KEY) {
        console.error("❌ [ERROR] process.env.OTP_BACKEND_API_KEY is undefined!");
        return { success: false, error: 'Configuration Error: Missing OTP Backend API Key' };
    }

    const requestData = { phoneNumber, otp };

    try {
        console.log("⏳ Dispatching POST request to SMS Proxy...");

        const otpResponse = await axios.post(otpBackendUrl, requestData, {
            timeout: 8000,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.OTP_BACKEND_API_KEY, // 👈 added
            }
        });

        console.log('✅ [RESPONSE DATA]:', otpResponse.data);

        if (otpResponse.data && (otpResponse.data.success || otpResponse.status === 200)) {
            console.log("🎉 [SUCCESS] OTP sent successfully!");
            return { success: true, message: 'OTP sent successfully', data: otpResponse.data };
        } else {
            console.warn("⚠️ [WARNING] API responded but returned unsuccessful payload.");
            return { success: false, error: 'SMS Provider rejected OTP delivery', details: otpResponse.data };
        }

    } catch (error) {
        console.error("❌ [FAIL] Error sending OTP:");

        if (error.code === 'ECONNABORTED') {
            console.error("   └ Reason: Request timed out (Server did not respond within 8 seconds). Check firewall/UFW.");
        } else if (error.response) {
            console.error(`   └ Reason: HTTP ${error.response.status} Status Code`);
            console.error("   └ Response Body:", error.response.data);
        } else if (error.request) {
            console.error("   └ Reason: Connection refused / Unreachable network host. Check if port 3001 is open.");
        } else {
            console.error(`   └ Reason: ${error.message}`);
        }

        return {
            success: false,
            error: 'Failed to send OTP',
            details: error.response?.data || error.message
        };
    } finally {
        console.log("--- [END] OTP Process Completed ---\n");
    }
}

router.post("/user/anonId",  async (req, res) => {
  try {
    const { anonId } = req.body;
    const userId = req.user.id;
 
    if (!anonId) {
      return res.status(400).json({ error: "anonId is required" });
    }
 
    await zingoPool.query(
      `INSERT INTO anon_accounts (anon_id, user_id)
       VALUES ($1::uuid, $2)
       ON CONFLICT (anon_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [anonId, userId]
    );
 
    const backfill = await zingoPool.query(
      `UPDATE affiliate_clicks SET user_id = $2
       WHERE anon_id = $1::uuid AND user_id IS NULL
       RETURNING click_id`,
      [anonId, userId]
    );
 
    return res.json({ ok: true, backfilled_clicks: backfill.rowCount });
  } catch (err) {
    console.error("link anonId error:", err);
    return res.status(500).json({ error: "Failed to link anonId" });
  }
});

router.get('/user/profile', authenticateFirebaseToken, async (req, res) => {
    console.log('riel point user route hit')
    // console.log('Firebase UID from user-profile route', req.user.uid)
    // console.log("User Id", req.user.id)
    // console.log("userId", req.user)


    try {


     const query = `SELECT * FROM rielpoint_users WHERE id = $1`;
    const result = await zingoPool.query(query, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Not Found",
                message: "User not found"
            });
        }

        const userData = result.rows[0];

        const sessionInfo = {
            uid: req.user.uid,
            email: req.user.email,
            emailVerified: req.user.email_verified,
            ...(req.user.name && { name: req.user.name }),
            ...(req.user.picture && { picture: req.user.picture }),
            iat: req.user.iat,
            exp: req.user.exp,
            aud: req.user.aud,
            iss: req.user.iss
        };

        res.status(200).json({
            user: userData,
            session: sessionInfo
        });

    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'An unexpected error occurred'
        });
    }
});

router.get('/merchant/profile', authenticateFirebaseToken, async (req, res) => {
    console.log('riel point user + merchant route hit')

    try {
        const query = `
            SELECT
                ru.*,
                CASE
                    WHEN am.owner_id IS NOT NULL THEN row_to_json(am)
                    ELSE NULL
                END AS affiliate_merchant
            FROM rielpoint_users ru
            LEFT JOIN affiliate_merchants am ON am.owner_id = ru.id
            WHERE ru.id = $1
        `;
        const result = await zingoPool.query(query, [req.user.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Not Found",
                message: "User not found"
            });
        }

        const { affiliate_merchant, ...userFields } = result.rows[0];

        const userData = {
            ...userFields,
            role: affiliate_merchant ? "affiliate-merchant" : userFields.role ?? null,
            affiliate_merchant,
        };

        const sessionInfo = {
            uid: req.user.uid,
            email: req.user.email,
            emailVerified: req.user.email_verified,
            ...(req.user.name && { name: req.user.name }),
            ...(req.user.picture && { picture: req.user.picture }),
            iat: req.user.iat,
            exp: req.user.exp,
            aud: req.user.aud,
            iss: req.user.iss
        };

        res.status(200).json({
            user: userData,
            session: sessionInfo
        });

    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'An unexpected error occurred'
        });
    }
});

router.post("/user/registration/initiate", async (req, res) => {
    console.log("=========Registration Initiation===========");
    console.log("req body", req.body);
    let { phoneNumber, fullName, password } = req.body;
    const client = await zingoPool.connect();

    try {
        console.log("Full Name in register initiation", fullName);
        console.log("Original Phone Number in register initiation", phoneNumber);

        phoneNumber = normalizePhoneNumber(phoneNumber);
        const phoneEmail = toFirebaseEmail(phoneNumber);

        try {
            const userRecord = await auth.getUserByEmail(phoneEmail);
            if (userRecord) {
                return res.status(400).json({
                    success: false,
                    error: 'Phone number already registered'
                });
            }
        } catch (error) {
            if (error.code !== 'auth/user-not-found') {
                throw error;
            }
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log("Generated OTP:", otp);

        const query = `
            INSERT INTO rielpoint_otp (
                "phone_number", "otp_code", "user_info"
            )
            VALUES ($1, $2, $3)
            ON CONFLICT ("phone_number")
            DO UPDATE SET
                "otp_code" = EXCLUDED."otp_code",
                "attempts" = 0,
                "user_info" = EXCLUDED."user_info",
                "created_at" = CURRENT_TIMESTAMP,
                "expires_at" = CURRENT_TIMESTAMP + INTERVAL '1 minute'
            RETURNING *;
        `;

        // storing plaintext password here only for the ~1 min OTP window — see note below
        const values = [
            phoneNumber,
            otp,
            JSON.stringify({ fullName, password })
        ];

        const result = await client.query(query, values);
        console.log("Query Result:", result.rows[0]);

        const otpResult = await sendOTPWithServiceAPI(phoneNumber, otp, fullName);

            if (!otpResult.success) {
                console.error("OTP Delivery failed, notifying client...");
                return res.status(502).json({
                    success: false,
                    error: "Failed to deliver SMS OTP. Please try again.",
                    details: otpResult.details
                });
            }

        return res.json({ success: true, message: 'OTP sent successfully' });

    } catch (error) {
        console.error("Error in registration initiation:", error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release(); // ← runs no matter what happens above
    }
});

router.post("/user/registration/otp/confirmation/:phoneNumber", async (req, res) => {
    console.log("==========OTP Confirmation ==========");
    const { otp } = req.body;

    let phoneNumber = normalizePhoneNumber(req.params.phoneNumber.replace(/^:/, '').trim());
    console.log(`Raw phone number from params: "${req.params.phoneNumber}"`);
    console.log(`Standardized phone number: "${phoneNumber}"`);
    console.log(`Phone number length: ${phoneNumber.length}`);
    console.log(`OTP: ${otp}`);

    try {
        const getOtpQuery = `
        SELECT "otp_code", attempts, "created_at", "expires_at",
            EXTRACT(EPOCH FROM ("expires_at" - NOW())) as seconds_remaining
        FROM rielpoint_otp
        WHERE "phone_number" = $1
        `;

        const otpResult = await zingoPool.query(getOtpQuery, [phoneNumber]);

        if (otpResult.rows.length > 0) {
            const record = otpResult.rows[0];
            const storedOtp = record.otp_code; // fixed: was record.otpCode (undefined)
            const attempts = record.attempts || 0;
            const secondsRemaining = record.seconds_remaining;

            console.log(`Current record:`, record);
            console.log(`Seconds remaining until expiry: ${secondsRemaining}`);

            // Use the actual expires_at column set on insert, instead of a separate hardcoded window
            if (secondsRemaining <= 0) {
                console.log("OTP expired, deleting record");
                await zingoPool.query('DELETE FROM rielpoint_otp WHERE "phone_number" = $1', [phoneNumber]);
                return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
            }

            const newAttempts = attempts + 1;
            await zingoPool.query(`
                UPDATE rielpoint_otp
                SET attempts = $1
                WHERE "phone_number" = $2
            `, [newAttempts, phoneNumber]);

            console.log(`Updated attempts: ${newAttempts}`);

            if (newAttempts > 3) {
                console.log("Max attempts exceeded, deleting OTP");
                await zingoPool.query('DELETE FROM rielpoint_otp WHERE "phone_number" = $1', [phoneNumber]);
                return res.status(401).json({ success: false, message: "Too many attempts. Please request a new OTP." });
            }

            if (otp === storedOtp) {
                console.log("OTP confirmed successfully.");
                await zingoPool.query('DELETE FROM rielpoint_otp WHERE "phone_number" = $1', [phoneNumber]);
                // await sendSignUpNotificationToTelegram(phoneNumber, otp);
                return res.status(200).json({ success: true, message: "OTP confirmed successfully." });
            } else {
                console.log("Invalid OTP.");
                return res.status(400).json({
                    success: false,
                    message: `Invalid OTP. You have ${3 - newAttempts} attempts remaining.`
                });
            }
        } else {
            console.log("No OTP found for this phone number.");
            return res.status(404).json({ success: false, message: "No OTP found for this phone number." });
        }
    } catch (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});




router.post('/create-user-profile', async (req, res) => {
  const { email, fullName, referredBy, anonId } = req.body;
  const points = 0;

  // Phone-based signups use a synthetic placeholder email: 855<phone>@phone.com.
  // Real emails (Google sign-up, or any future email/password signup) are NOT
  // phone placeholders and must not be parsed as one.
  const isPhonePlaceholderEmail = /^855\d+@phone\.com$/i.test(email || '');
  const rawPhoneNumber = isPhonePlaceholderEmail ? email.split('@')[0].slice(3) : null;
  const phoneNumber = rawPhoneNumber ? normalizePhoneNumber(rawPhoneNumber) : null;

  // fullName is no longer collected at signup — fall back to "user" + phoneNumber
  // when we have one, otherwise fall back to the email local part.
  const resolvedFullName =
    fullName || (rawPhoneNumber ? `user${rawPhoneNumber}` : email.split('@')[0]);

  const username = `${resolvedFullName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, '_')}_${rawPhoneNumber || Date.now()}`;

    console.log("Creating user profile with ", email, resolvedFullName, referredBy, anonId);

  // Basic sanity check — don't let a malformed client value hit the DB as a bad UUID
  const isValidAnonId = typeof anonId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(anonId);

  const linkAnonId = async (userId) => {
    if (!isValidAnonId) return;
    try {
      // One anonId should only ever point to one user. If it's already linked
      // (e.g. duplicate signup attempt, or the row was created by an earlier
      // click-logging step before signup existed), update it rather than
      // failing — but never let a second, different user steal an anonId
      // that's already linked to someone else.
      await zingoPool.query(
        `INSERT INTO rielpoint_anon_users (anon_id, user_id, linked_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (anon_id) DO UPDATE
           SET user_id = EXCLUDED.user_id, linked_at = NOW()
           WHERE rielpoint_anon_users.user_id = EXCLUDED.user_id`,
        [anonId, userId]
      );
    } catch (linkErr) {
      // Don't fail account creation just because linking had an issue —
      // log it and move on, this is best-effort attribution, not core signup.
      console.error('Failed to link anonId to user:', linkErr);
    }
  };

  try {
    const checkUserQuery = 'SELECT * FROM rielpoint_users WHERE email = $1';
    const checkUserResult = await zingoPool.query(checkUserQuery, [email]);

    if (checkUserResult.rows.length > 0) {
      const existingUser = checkUserResult.rows[0];
      await linkAnonId(existingUser.id);
      return res.status(200).json({
        message: 'User profile already exists',
        user: { ...existingUser, isNew: false }
      });
    }

    // Validate referredBy: must be a real user, and can't be self-referral
    let validReferrerId = null;
    if (referredBy) {
      const referrerCheck = await zingoPool.query(
        'SELECT id FROM rielpoint_users WHERE id = $1',
        [referredBy]
      );
      if (referrerCheck.rows.length > 0) {
        validReferrerId = referrerCheck.rows[0].id;
      }
    }

    const insertUserQuery = `
      INSERT INTO rielpoint_users (email, role, fullname, phone_number, rielpoints, username, referred_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`;
    const insertUserValues = [
      email, 'customer', resolvedFullName, phoneNumber, points, username, validReferrerId
    ];

    const insertResult = await zingoPool.query(insertUserQuery, insertUserValues);
    const newUser = insertResult.rows[0];

    await linkAnonId(newUser.id);

    res.status(200).json({
      message: 'User profile created successfully',
      user: { ...newUser, isNew: true }
    });
  } catch (error) {
    console.error('Error in create-user-profile route:', error);
    res.status(500).json({ error: 'Failed to process user profile' });
  }
});
router.post("/user/forgot-password/initiate", async (req, res) => {
    console.log("==========Initiate Forgot Password ==========");
    let { phoneNumber } = req.body; // no password here — nothing sensitive yet

    phoneNumber = normalizePhoneNumber(phoneNumber);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const query = `
        INSERT INTO rielpoint_otp ("phone_number", "otp_code")
        VALUES ($1, $2)
        ON CONFLICT ("phone_number")
        DO UPDATE SET
            "otp_code" = EXCLUDED."otp_code",
            "attempts" = 0,
            "created_at" = CURRENT_TIMESTAMP,
            "expires_at" = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
        RETURNING *;
    `;

    try {
        const result = await zingoPool.query(query, [phoneNumber, otp]);
        console.log("Query Result:", result.rows[0]);
        await sendOTPWithServiceAPI(phoneNumber, otp);
        return res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

router.post("/user/forgot-password/otp-confirmation", async (req, res) => {
    console.log("=====Forgot Password OTP-Confirmation==========");
    const { phoneNumber, otpCode, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const formattedPhoneNumber = normalizePhoneNumber(phoneNumber);

    try {
        const getOtpQuery = `
            SELECT "otp_code", attempts,
                EXTRACT(EPOCH FROM ("expires_at" - NOW())) as seconds_remaining
            FROM rielpoint_otp
            WHERE "phone_number" = $1
        `;
        const otpResult = await zingoPool.query(getOtpQuery, [formattedPhoneNumber]);

        if (otpResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "No OTP found for this phone number." });
        }

        const record = otpResult.rows[0];
        const attempts = record.attempts || 0;

        if (record.seconds_remaining <= 0) {
            await zingoPool.query('DELETE FROM rielpoint_otp WHERE "phone_number" = $1', [formattedPhoneNumber]);
            return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
        }

        const newAttempts = attempts + 1;
        await zingoPool.query(
            `UPDATE rielpoint_otp SET attempts = $1 WHERE "phone_number" = $2`,
            [newAttempts, formattedPhoneNumber]
        );

        if (newAttempts > 3) {
            await zingoPool.query('DELETE FROM rielpoint_otp WHERE "phone_number" = $1', [formattedPhoneNumber]);
            return res.status(401).json({ success: false, message: "Too many attempts. Please request a new OTP." });
        }

        if (otpCode !== record.otp_code) {
            return res.status(400).json({
                success: false,
                message: `Invalid OTP. You have ${3 - newAttempts} attempts remaining.`
            });
        }

        // Verified — burn the OTP, then reset the password right away.
        // newPassword only ever existed in this one request; it's never
        // written to rielpoint_otp at all.
        await zingoPool.query('DELETE FROM rielpoint_otp WHERE "phone_number" = $1', [formattedPhoneNumber]);

        await resetFirebasePassword(formattedPhoneNumber, newPassword);

        return res.status(200).json({ success: true, message: "Password reset successfully." });
    } catch (error) {
        console.error("Error executing query or resetting password:", error);
        return res.status(500).json({ success: false, message: "Internal server error." });
    }
});

router.post("/user/registration/otp/resend/:phoneNumber", async (req, res) => {
    console.log("==========OTP Resend==========");

    const rawParam = req.params.phoneNumber;
    const trimmedParam = rawParam.replace(/^:/, '').trim();
    let phoneNumber = normalizePhoneNumber(trimmedParam);

    console.log("[DEBUG] raw param:", rawParam);
    console.log("[DEBUG] trimmed param:", trimmedParam);
    console.log("[DEBUG] normalized phoneNumber used for lookup:", phoneNumber);

    const client = await zingoPool.connect();
    try {
        // Debug: see exactly what phone_number values currently exist in the table
        const debugAllQuery = `SELECT "phone_number", "resend_count", "created_at", "expires_at" FROM rielpoint_otp`;
        const debugAllResult = await client.query(debugAllQuery);
        console.log("[DEBUG] all rows currently in rielpoint_otp:", debugAllResult.rows);

        const findQuery = `
            SELECT "user_info", "resend_count"
            FROM rielpoint_otp
            WHERE "phone_number" = $1
        `;
        console.log("[DEBUG] running findQuery with param:", [phoneNumber]);
        const findResult = await client.query(findQuery, [phoneNumber]);

        console.log("[DEBUG] findResult row count:", findResult.rows.length);

        if (findResult.rows.length === 0) {
            console.log("[DEBUG] No matching row for phoneNumber:", phoneNumber, "— check format above against rows dumped above");
            return res.status(404).json({
                success: false,
                message: "No pending registration found for this number. Please start sign up again."
            });
        }

        const { user_info, resend_count } = findResult.rows[0];
        const currentResendCount = resend_count || 0;
        console.log("[DEBUG] found row — user_info:", user_info, "resend_count:", currentResendCount);

        if (currentResendCount >= 3) {
            console.log("[DEBUG] resend limit hit for phoneNumber:", phoneNumber);
            return res.status(429).json({
                success: false,
                message: "Maximum resend attempts reached. Please start sign up again."
            });
        }

        let fullName;
        try {
            fullName = JSON.parse(user_info)?.fullName;
        } catch {
            fullName = undefined;
        }
        console.log("[DEBUG] parsed fullName:", fullName);

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log("[DEBUG] new OTP generated:", otp);

        const updateQuery = `
            UPDATE rielpoint_otp
            SET "otp_code" = $1,
                "attempts" = 0,
                "resend_count" = $2,
                "created_at" = CURRENT_TIMESTAMP,
                "expires_at" = CURRENT_TIMESTAMP + INTERVAL '1 minute'
            WHERE "phone_number" = $3
            RETURNING *;
        `;
        const updateResult = await client.query(updateQuery, [otp, currentResendCount + 1, phoneNumber]);
        console.log("[DEBUG] Resent OTP row:", updateResult.rows[0]);

        // Same as registration/initiate — currently disabled while testing without real SMS delivery.
        const otpResult = await sendOTPWithServiceAPI(phoneNumber, otp, fullName, currentResendCount + 1);
        if (!otpResult.success) {
            return res.status(502).json({ success: false, error: "Failed to resend OTP.", details: otpResult.details });
        }

        return res.json({
            success: true,
            message: "OTP resent successfully",
            resendCount: currentResendCount + 1
        });

    } catch (error) {
        console.error("[DEBUG] Error in OTP resend:", error);
        return res.status(500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
});

const resetFirebasePassword = async (phoneNumber, newPassword) => {
    const email = toFirebaseEmail(phoneNumber);
    console.log("Phone Email in Reset Firebase Password", email);

    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(userRecord.uid, { password: newPassword });
        console.log(`Password updated successfully for user ${userRecord.uid}`);
    } catch (error) {
        console.error('Error resetting password:', error);
        throw error;
    }
};



module.exports = router;