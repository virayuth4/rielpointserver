
const express = require('express');
const cors = require('cors');
const { admin, auth, db } = require('./auth/firebase-admin');
const config = require('./config/config')
const { testS3Connection } = require('./database/s3');
const cron = require('node-cron');
const axios = require("axios");


require('dotenv').config();



const initializeDatabases = require('./database/pgInit')



const userRoutes = require('./api/user/userRoutes')
//For Merchant Related Routes
const merchantPointRoutes = require('./api/merchant/pointsRoutes')
const merchantRoutes = require('./api/merchant/merchantRoutes')


// CORS configuration
const corsOptions = {
  origin: config.CORS_ORIGINS,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'x-client-type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    '*',
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
};


const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow:'); // or your preferred robots.txt content
});

app.get('/sitemap.xml', (req, res) => {
  res.status(404).send('Not Found'); // or serve actual sitemap
});

app.get('/favicon.ico', (req, res) => {
  res.status(404).send('Not Found'); // or serve actual favicon
});




const isProduction = 'production';



app.get('/health', (req, res) => {
  res.json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: Date.now()
  });
});


app.use('/api', userRoutes)
app.use('/api/merchant', merchantPointRoutes)
app.use('/api/merchant', merchantRoutes)
app.use ('/api/merchant', require('./api/merchant/couponRoutes'))
app.use('/api/merchant', require('./api/merchant/rewardRoutes'))
app.use('/api/merchant', require('./api/merchant/affiliateRoutes'))
app.use('/api/merchant', require('./api/merchant/affiliateOfferRoutes'))



async function startServer() {
  const PORT = 9000
  const isProductionTest = config.isProductionTest?.() || false;



  console.log('\n🚀 Starting server...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔧 Environment: ${process.env.NODE_ENV}${isProductionTest ? ' (Production Test)' : ''}`);
  console.log(`🌐 Port: ${PORT}`);
  console.log(`🔌 Backend URL: ${process.env.NEXT_PUBLIC_BACKEND || 'Not set'}`);

//   cron.schedule('* * * * *', () => {
//     console.log('Running cleanup task...');
//     deleteExpiredOTPs();
// });

  try {
    const s3Connected = await testS3Connection();
    if (s3Connected) {
      console.log("S3 bucket is configured correctly")
    }
  } catch (error) {
    console.error("S3 bucket configuration failed")
  }

  initializeDatabases().catch(console.error);

  app.listen(PORT,'0.0.0.0', () => {
    console.log(`Server is running on port: ${PORT}`),
    console.log(`Environment: ${process.env.NODE_ENV}`)
    console.log('Client:', process.env.NEXT_PUBLIC_BACKEND)
  })

 

}

startServer()