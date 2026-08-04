const express = require("express");
const authenticateFirebaseToken = require("../../auth/authFirebaseToken");
const zingoPool = require("../../database/pgZingo");
const router = express.Router();
const axios = require("axios");



async function sendSellerApplicationToSupportTelegramNotification(storeName, productCategory, phoneNumber, moreInfo) {
    const message = `New Seller Application Submission:\n\nStore Name: ${storeName}\nProduct Category: ${productCategory}\nPhone Number: ${phoneNumber}\nMore Info: ${moreInfo}`;
    console.log('Sending Seller Application to Telegram notification with message:', message);
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
//New route for seller application
router.post('/application/apply-application', async(req,res) => {
    console.log("============ New Seller Application Route ===========")
    console.log('req body', req.body);
    const {storeName, productCategory, phoneNumber, moreInfo} = req.body
    try {
      
        sendSellerApplicationToSupportTelegramNotification(storeName, productCategory, phoneNumber, moreInfo)
        res.status(200).json({
            message: "Seller application received successfully",
        });
        console.log("Seller application sent to Telegram successfully")
        
    } catch (error) {
        console.error("Error in seller application submission:", error);
        res.status(500).json({
            message: "Internal server error",
        });
    }
   


})

router.post("/application/seller/apply", authenticateFirebaseToken, async (req, res) => {
    console.log("============ Seller Application ==========");
    console.log('req body', req.body);
    const userId = req.user.id

    // New logic to insert the request body into the business_info table
    const { fullName, businessName, phoneNumber, address, city, category } = req.body;
    const status = "pending";

    const insertBusinessInfoQuery = `
    INSERT INTO business_application ("userId","fullName", "businessName", "phoneNumber", address, city, "productCategory")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id;
    `;

    const updateUserStatusQuery = `
    UPDATE users
    SET "sellerApplicationStatus" = $1
    WHERE id = $2;
    `;

    try {
        const result = await zingoPool.query(insertBusinessInfoQuery, [userId, fullName, businessName, phoneNumber, address, city, category]);
        const newId = result.rows[0].id;
        const updateUserStatusResult = await zingoPool.query(updateUserStatusQuery, [status, userId]);


        res.status(200).json({ message: "Business information added successfully.", id: newId });
    } catch (error) {
        console.error("Error inserting business information:", error);
        res.status(500).json({ error: "Failed to add business information." });
    }
});

router.get("/application/seller/status", authenticateFirebaseToken, async (req,res) => {
    console.log("==========Application Seller Status==========")
    const userId = req.user.id
    const query = `
    SELECT b.*, u."sellerApplicationStatus" 
    FROM users u
    LEFT JOIN business_application b ON u.id = b."userId"
    WHERE u.id = $1
    `
    try {
        const result = await zingoPool.query(query,[userId])
        console.log("result", result.rows[0])
        res.status(200).json({status:result.rows?.[0]})
    } catch (e) {
        console.error("Error fetching business application status:", e);
        res.status(500).json({ error: "Failed to fetch business application status." });
    }
   
})

module.exports = router