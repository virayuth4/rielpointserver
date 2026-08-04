const crypto = require('crypto');

const generateOrderId = () => {
  // Get current timestamp in milliseconds (13 digits)
  const timestamp = Date.now().toString();
  
  // Generate cryptographically secure random 6-digit number
  const random = crypto.randomInt(100000, 999999).toString();
  
  // Combine for 19-digit number with excellent collision resistance
  return parseInt(`${timestamp}${random}`);
};

module.exports = {
  generateOrderId
};