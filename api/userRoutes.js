const express = require("express");
const zingoPool = require('../database/pgZingo')
const authenticateFirebaseToken = require('../auth/authFirebaseToken')
const rateLimiterMiddleware = require('./rateLimiter');
const multer = require('multer');
const { uploadFileToS3, deleteFileFromS3 } = require("../database/s3");
const createRateLimiterMiddleware = require("./rateLimiter");
const {admin} = require("../auth/firebase-admin");
const suspiciousPatternDetector = require("../utils/security/suspiciousPattern");

const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto"); // To generate MD5 hash
const zingoPool = require("../../../database/pgZingo");
const { admin, auth } = require('../../../auth/firebase-admin');

require('dotenv').config();
    async function sendNotificationForRegistrationAttemptsToTelegram(phoneNumber, otp, fullName) {
        const message = `New User Registration Attempt:\n\nPhone Number: ${phoneNumber}\nOTP: ${otp}\nFull Name: ${fullName}`;
        console.log('Sending Registration Attempt notification to Telegram with message:', message);
        try {
            const botToken = String(process.env.TELEGRAM_SUPPORT_BOT_TOKEN.trim());
            const chatId = Number(process.env.TELEGRAM_CHAT_ID.trim());
        
            const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
            console.log('Telegram API URL:', url);
            
            await axios.post(url, {
                chat_id: chatId,
                text: message,
                
            });
            
            console.log('Telegram notification sent successfully');
            return { success: true };
        } catch (error) {
            console.error('Error sending Telegram notification:', error.message);
            if (error.response) {
                console.error('Response data:', JSON.stringify(error.response.data));
                console.error('Response status:', error.response.status);
            }
            return { success: false, error: error.message };
        }
    }


    async function sendSignUpNotificationToTelegram(phoneNumber, otp) {
        const message = `New User Registration Completed:\n\nPhone Number: ${phoneNumber}\nOTP: ${otp}`;
        console.log('Sending Sign Up notification to Telegram with message:', message);
        try {
        const botToken = String(process.env.TELEGRAM_SUPPORT_BOT_TOKEN.trim());
        const chatId = Number(process.env.TELEGRAM_CHAT_ID.trim());
    
    
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        console.log('Telegram API URL:', url);
        
        await axios.post(url, {
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        });
        
        console.log('Telegram notification sent successfully');
        return { success: true };
      } catch (error) {
        console.error('Error sending Telegram notification:', error.message);
        return { success: false, error: error.message };
      }
    }


function generateRandomOTP() {
    return Math.floor(1000 + Math.random() * 9000); // Generates a random number between 1000 and 9999
}



async function sendOTPWithServiceAPI(phoneNumber, otp, fullName, requestNumber=1) {
    console.log("Sending OTP with external service API");
    console.log("Phone Number:", phoneNumber);
    console.log("OTP:", otp);
    console.log("Full Name:", fullName);
    console.log("Number of times this has been request", requestNumber);
    
    // Use localhost when calling your own server
    const otpBackendUrl = `${process.env.NEXT_PUBLIC_OTP_BACKEND}/api/send-otp`;
    // Or if the service is truly external, keep using https://fuzingo.com/api/send-otp
    
    console.log("OTP Backend URL:", otpBackendUrl);

    const requestData = {
        phoneNumber,
        otp
    };
    
    try {
        const otpResponse = await axios.post(otpBackendUrl, requestData);
    
        console.log('OTP API response:', otpResponse.data);

        if (!otpResponse.data.success) {
            throw new Error('Failed to send OTP');
        }

        return { success: true, message: 'OTP sent successfully' };
    } catch (error) {
        console.error('Error sending OTP:', error);
        // Return the error instead of throwing it to avoid unhandled rejections
        return { success: false, error: 'Failed to send OTP', details: error.message };
    }
}

router.post("/user/registration/otp/resend/:phoneNumber", async (req, res) => {
    console.log("=========Resending OTP===========");
    const { phoneNumber } = req.params;
    const {fullName, attempts} = req.body
    console.log("Phone Number in resend OTP", phoneNumber)
    console.log("Attempts number:  ", attempts)
    console.log("generating new otp")

    if (attempts >= 3) {
        const client = await zingoPool.connect();
    
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log("Generated OTP:", otp);
    
        await sendOTPWithServiceAPI(phoneNumber, otp, fullName)
    
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
        phoneNumber,
        otp,
        JSON.stringify({  fullName }),
      ];
      
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
        await sendNotificationForRegistrationAttemptsToTelegram(phoneNumber, otp, fullName)
        res.json({ success: true, message: 'OTP sent successfully' });
    } else {
        return res.status(400).json({ success: false, message: "You have reached the maximum number of attempts. Please request a new OTP." });
    }
 

})

router.post("/user/registration/initiate", async (req, res) => {
    console.log("=========Registration Initiation===========");
    console.log("req body", req.body)
    let {phoneNumber, fullName} = req.body
    const client = await zingoPool.connect();
    console.log("Full Name in register initiation", fullName)
    console.log("Original Phone Number in register initiation", phoneNumber)
    
    // Standardize phone number: remove leading 0 or 855
    if (phoneNumber.startsWith('0')) {
        phoneNumber = phoneNumber.substring(1);
    } else if (phoneNumber.startsWith('855')) {
        phoneNumber = phoneNumber.substring(3);
    }
    
    console.log("Standardized Phone Number", phoneNumber)
  
    const phoneEmail = phoneNumber + "@phone.com";
    console.log("Phone Email", phoneEmail)
    console.log("Checking if user already exists in Firebase")
     // Check if user already exists in Firebase
     try {
        const userRecord = await auth.getUserByEmail(phoneEmail);
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
    
    console.log("generating otp")
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log("Generated OTP:", otp);

    // await sendOTP(phoneNumber, otp)
    // For the OTP, make an external api endpoint call 

    await sendOTPWithServiceAPI(phoneNumber, otp, fullName)

    
    console.log('storing otp in database')
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
    phoneNumber,
    otp,
    JSON.stringify({  fullName }),
  ];
  
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
await sendNotificationForRegistrationAttemptsToTelegram(phoneNumber, otp, fullName)
res.json({ success: true, message: 'OTP sent successfully' });

});


router.post("/user/registration/otp/confirmation/:phoneNumber", async (req, res) => {
    console.log("==========OTP Confirmation ==========");
    const { otp } = req.body; 
    
    // Get the raw phone number and remove any leading colon and trim whitespace
    let phoneNumber = req.params.phoneNumber.replace(/^:/, '').trim();
    console.log(`Raw phone number from params: "${req.params.phoneNumber}"`);
    
    // Standardize phone number: remove leading 0 or 855
    if (phoneNumber.startsWith('0')) {
        phoneNumber = phoneNumber.substring(1);
    } else if (phoneNumber.startsWith('855')) {
        phoneNumber = phoneNumber.substring(3);
    }
    
    console.log(`Standardized phone number: "${phoneNumber}"`);
    console.log(`Phone number length: ${phoneNumber.length}`);
    console.log(`OTP: ${otp}`);

    try {
        // Get current OTP record
        const getOtpQuery = `
        SELECT "otpCode", attempts, "createdAt", 
            EXTRACT(EPOCH FROM (NOW() - "createdAt"))/60 as minutes_elapsed
        FROM otp 
        WHERE "phoneNumber" = $1
        `;

        const otpResult = await zingoPool.query(getOtpQuery, [phoneNumber]);
        
        // Check if an OTP was found for the given phone number
        if (otpResult.rows.length > 0) {
            const record = otpResult.rows[0];
            const storedOtp = record.otpCode;
            const attempts = record.attempts || 0;
            const minutesElapsed = record.minutes_elapsed;
            
            console.log(`Current record:`, record);
            console.log(`Minutes elapsed since creation: ${minutesElapsed}`);
            
            // Check if OTP is expired (more than 10 minutes old)
            if (minutesElapsed > 10) {
                console.log("OTP expired, deleting record");
                await zingoPool.query('DELETE FROM otp WHERE "phoneNumber" = $1', [phoneNumber]);
                return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
            }
            
            // Increment attempts counter
            const newAttempts = attempts + 1;
            await zingoPool.query(`
                UPDATE otp 
                SET attempts = $1
                WHERE "phoneNumber" = $2
            `, [newAttempts, phoneNumber]);
            
            console.log(`Updated attempts: ${newAttempts}`);
            
            // Check if max attempts exceeded
            if (newAttempts > 3) {
                console.log("Max attempts exceeded, deleting OTP");
                await zingoPool.query('DELETE FROM otp WHERE "phoneNumber" = $1', [phoneNumber]);
                return res.status(401).json({ success: false, message: "Too many attempts. Please request a new OTP." });
            }

            // Compare the received OTP with the stored OTP
            if (otp === storedOtp) {
                console.log("OTP confirmed successfully.");
                // Delete the OTP after successful verification
                await zingoPool.query('DELETE FROM otp WHERE "phoneNumber" = $1', [phoneNumber]);
                await sendSignUpNotificationToTelegram(phoneNumber, otp)
                return res.status(200).json({ success: true, message: "OTP confirmed successfully." });
            } else {
                console.log("Invalid OTP.");
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid OTP. You have ${3-newAttempts} attempts remaining.` 
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

    async function sendOTP(phoneNumber, otp) {
        console.log("Sending OTP");
        
        // Clean the phone number: replace initial 855 with 0
        let cleanedPhoneNumber = phoneNumber;
        if (phoneNumber.startsWith('855')) {
            cleanedPhoneNumber = '0' + phoneNumber.substring(3);
        }
        
        const md5Password = crypto.createHash("md5").update(process.env.MEKONG_PASSWORD).digest("hex");
        console.log("md5Password", md5Password);
        const apiUrl = process.env.MEKONG_API_POST_URL;
        console.log("apiUrl", apiUrl);
        console.log("gsm ", cleanedPhoneNumber);
    
        const message = `OTP code: ${otp}. Do not share it or use it elsewhere!`;
        
        // Prepare request parameters
        const postData = new URLSearchParams();
        postData.append('username', process.env.MEKONG_USERNAME);
        postData.append('pass', process.env.MEKONG_PASSWORD);
        postData.append('sender', process.env.MEKONG_SENDER);
        postData.append('smstext', message);
        postData.append('gsm', cleanedPhoneNumber);
        postData.append('int', "0");
        postData.append('cd', "Test Data" || "");
    
        // Send the SMS request
        const response = await axios.post(apiUrl, postData);
        console.log("response status", response.status);
        console.log("response", response);
    
        return response.data; // Return the response data
    }

router.post("/user/registration/otp/send", async(req,res) => {
    try {

    // convert password to MD5 hash
    console.log('md5Password', md5Password)

    //req params
    const postData = new URLSearchParams();
    postData.append('username', process.env.MEKONG_USERNAME);
    postData.append('pass', md5Password);
    postData.append('sender', process.env.MEKONG_SENDER);
    postData.append('smstext', "Hello this is a test message.");
    postData.append('gsm', "85561207903");
    postData.append('int', "0");
    postData.append('cd', "Test Data" || "");

    console.log("params", postData)
   
        const response = await axios.post(apiUrl, postData);
        console.log("response status", response.status)
        console.log("response", response)


        // Send the API response back to the client
        res.status(200).json({
            message: "SMS sent successfully",
            data: response.data,
        });
    } catch (error) {
        console.error(`Error with initiate registration: ${error.message}`);
        res.status(500).json({
            message: "Failed to send SMS",
            error: error.message,
        });
    }
})

module.exports = router;



