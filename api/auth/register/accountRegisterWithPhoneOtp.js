// Using Express.js and Twilio
const express = require('express');
const twilio = require('twilio');
const zingoPool = require('../../../database/pgZingo');
const { admin, auth } = require('../../../auth/firebase-admin');
const router = express.Router();
var request = require('request');


router.post('/register/initiate', async (req, res) => {
  console.log("==========Register Initiate ===========")
  const client = await zingoPool.connect();
  
  try {
    const { phone, name, email, password } = req.body;
    console.log("req.body", req.body)
 

    
    // Check if user already exists in Firebase
    try {
      const userRecord = await auth.getUserByPhoneNumber(phone);
      if (userRecord) {
        return res.status(400).json({ 
          success: false, 
          error: 'Phone number already registered' 
        });
      }
    } catch (error) {
      // User does not exist, continue with registration
      if (error.code !== 'auth/user-not-found') {
        throw error;
      }
    }

    console.log("Generating OTP")
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("OTP", otp)
    console.log("=====Start Query=====")
    await client.query('BEGIN');

    // Store OTP and user info temporarily
    const query = `
       INSERT INTO otp ("phoneNumber", "otpCode", "userInfo")
            VALUES ($1, $2, $3)
            ON CONFLICT ("phoneNumber") 
            DO UPDATE SET 
            "otpCode" = EXCLUDED."otpCode",
            attempts = 0,
            "userInfo" = EXCLUDED."userInfo",
            "createdAt" = CURRENT_TIMESTAMP
            RETURNING *;
    `;

    const values = [
      phone,
      otp,
      JSON.stringify({ name, email, password }),

    ];

    console.log("Insert Value")
    console.log("Phone",phone)
    console.log("otp",otp)
    console.log("userInfo",JSON.stringify({ name, email, password }))



    try {
      // Execute the query and store the result
      console.log("Executing query with values:", values);
      const result = await client.query(query, values);
      await client.query('COMMIT');
      
      console.log("=====Finish Query====="); // This should now be reached if no errors occur
      console.log("Query Result:", result.rows[0]); // Log the result for debugging
  } catch (error) {
      await client.query('ROLLBACK'); // Rollback in case of error
      console.error("Error executing query:", error); // Log the error
      res.status(500).json({ success: false, error: error.message });
  }

  console.log("Sending OTP via Relean")

    

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// Step 2: Verify OTP and create Firebase user
router.post('/register/verify', async (req, res) => {
  const client = await zingoPool.connect();
  console.log("==========Start Verifying==========")
  
  try {
    const { phone, code } = req.body;
    
    await client.query('BEGIN');

    // Verify OTP from database
    const getOtpQuery = `
      UPDATE otp
      SET attempts = attempts + 1
      WHERE phone = $1
      RETURNING *
    `;

    const otpResult = await client.query(getOtpQuery, [phone]);
    const otpRecord = otpResult.rows[0];

    if (!otpRecord) {
      await client.query('COMMIT');
      return res.status(400).json({ 
        success: false, 
        error: 'No OTP request found' 
      });
    }

    // Validate OTP expiration and attempts
    const expirationTime = new Date(otpRecord.created_at.getTime() + 10 * 60000);
    if (new Date() > expirationTime) {
      await client.query('DELETE FROM otp WHERE phone = $1', [phone]);
      await client.query('COMMIT');
      return res.status(400).json({ 
        success: false, 
        error: 'OTP expired' 
      });
    }

    if (otpRecord.attempts >= 3) {
      await client.query('DELETE FROM otp WHERE phone = $1', [phone]);
      await client.query('COMMIT');
      return res.status(400).json({ 
        success: false, 
        error: 'Too many attempts' 
      });
    }

    if (otpRecord.code !== code) {
      await client.query('COMMIT');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP' 
      });
    }

    // OTP is valid, create Firebase user
    const userInfo = JSON.parse(otpRecord.user_info);
    
    const userRecord = await admin.auth().createUser({
      phoneNumber: phone,
      email: userInfo.email,
      password: userInfo.password,
      displayName: userInfo.name,
      emailVerified: false
    });

    // Create custom token for client-side sign-in
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    // Clean up OTP record
    await client.query('DELETE FROM otp WHERE phone = $1', [phone]);
    await client.query('COMMIT');

    res.json({ 
      success: true, 
      customToken,
      userId: userRecord.uid
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;

