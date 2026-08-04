const {Pool} = require('pg')
const config = require("../config/config")
require('dotenv').config();


const zingoPool = new Pool({
    user: process.env.POSTGRESQL_USERNAME,       // Database username
    host: process.env.POSTGRESQL_HOST,       // DigitalOcean database hostname
    database: process.env.POSTGRESQL_DATABASE,   // Database name
    password: process.env.POSTGRESQL_PASSWORD, // Database password
    port: process.env.POSTGRESQL_PORT,       // Typically 25060 for DigitalOcean
    ssl: {
      rejectUnauthorized: false,      // Necessary for DigitalOcean managed databases
    },
  });

// Test the connection
zingoPool.query('SELECT NOW()', (err, res) => {
  if (err) {
      console.error('Error connecting to the database:', err);
  } else {
      console.log('Successfully connected to product_sale database');
  }
});


module.exports = zingoPool