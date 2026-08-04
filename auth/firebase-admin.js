const admin = require("firebase-admin")
const config = require("../config/config")

require('dotenv').config();

const privateKey = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;


try {
  admin.initializeApp({
    credential: admin.credential.cert(config.firebase)
  });
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
  throw error;
}

const auth = admin.auth();
const db = admin.firestore();

module.exports = { admin, auth, db };