const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken')

router.post('/stamp/add', authenticateFirebaseToken, async (req, res) => {
    console.log("Stamp Route Hit")
})

module.exports = router;