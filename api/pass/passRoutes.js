const express = require("express");
const router = express.Router();
const zingoPool = require("../../database/pgZingo");
const multer = require('multer');
const {upload, uploadFileToS3, deleteFileFromS3, uploadMediaFilesToS3} = require("../../database/s3")
const authenticateFirebaseToken = require("../../auth/authFirebaseToken")
const axios = require('axios');
const { generateAndUpdateProductTags } = require("../../helper/productRoutesHelper/addTagHelper");
const createRateLimiterMiddleware = require("../rateLimiter");
const { sanitizeProductDescription } = require("../../utils/sanatizeHtml");
const { sanitizeFileName } = require("../../utils/sanitzieFileName");
const path = require('path');
const fs = require('fs');


router.post('/generate-otp', authenticateFirebaseToken, async (req, res) => {
    console.log('33 students generate otp route hit')
    // console.log('Firebase UID from user-profile route', req.user.uid)
    
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  console.log("otp", otp)

        res.status(200).json({ 
            otp: otp,
          
        });


});

module.exports = router;