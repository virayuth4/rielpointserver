const express = require("express");
const router = express.Router();
const zingoPool = require('../database/pgZingo')
const authenticateFirebaseToken = require('../auth/authFirebaseToken')


const PORT = 9000

router.get('/test', async(req,res) => {
    console.log(`App is running on PORT:${PORT}`)
    res.status(200).json({message: (`App is running on PORT:${PORT}, Environment: ${process.env.NODE_ENV}`)})
  })

router.get('/env', (req, res) => {
    res.status(200).json({ 
      message: (`Environment: ${process.env.NODE_ENV}`)
      
    });
  });
  


  module.exports = router;