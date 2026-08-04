const express = require("express");

const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authenticateFirebaseToken = require("../auth/authFirebaseToken");
const zingoPool = require("../database/pgZingo");
require('dotenv').config();

//-----------------Route to log Admin User In--------------------
router.post('/admin/login', async (req, res) => {
    console.log('/admin/login route hit');
    console.log('req body:', req.body);
    try {
        const { username, password } = req.body;

        // Check if username and password are provided
        if (!username || !password) {
            console.error("Username and password are required")
            return res.status(400).json({ error: "Username and password are required" });
        }

        const ADMIN_USER = process.env.ADMIN_USER;
        const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

        // Check if the username matches the admin username
        if (username !== ADMIN_USER) {
            console.error("Invalid credentials")
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Validate the password
        const isPasswordValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Generate a JWT token
        const token = jwt.sign({ username: ADMIN_USER }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({ message: "Successfully logged in", token });

    } catch (error) {
        console.error("Error authenticating admin:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


router.get('/admin/users', authenticateFirebaseToken, async (req, res) => {
    console.log('================/admin/users route hit================');
    try {
        const userId = req.user.id; 
        
        // Fixed authorization check
       
        
        console.log('req user', userId);
        
        const query = `SELECT 
        "id",
        CASE 
            WHEN LENGTH("fullName") <= 2 THEN "fullName"
            ELSE CONCAT(LEFT("fullName", 1), REPEAT('*', LENGTH("fullName") - 2), RIGHT("fullName", 1))
        END as "fullName",
        CASE 
            WHEN LENGTH("phoneNumber") <= 2 THEN "phoneNumber"
            ELSE CONCAT(LEFT("phoneNumber", 1), REPEAT('*', LENGTH("phoneNumber") - 2), RIGHT("phoneNumber", 1))
        END as "phoneNumber",
        "userProfilePath",
        "username",
        "createdAt"
        FROM "users"`;
        const result = await zingoPool.query(query);
        console.log('Query result:', result.rows);
        
        res.status(200).json({ message: "Admin user management endpoint" , users: result.rows });
    } catch (error) {
        console.error("Error fetching admin users:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
module.exports = router;