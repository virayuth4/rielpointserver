const admin = require('firebase-admin');
const zingoPool = require('../database/pgZingo');

const optionalFirebaseAuth = async (req, res, next) => {
    // console.log("Authorization header:", req.headers.authorization ? "present" : "MISSING");

  const authHeader = req.headers.authorization;
  const userIdentifier = req.headers['x-user-identifier'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next(); // no token — proceed as anonymous, don't block
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const userEmail = decodedToken.email;
    const userPhone = decodedToken.phone_number;

    let query;
    let params;

    if (userEmail) {
      query = 'SELECT id FROM rielpoint_users WHERE email = $1';
      params = [userEmail];
    } else if (userPhone || userIdentifier) {
      const phoneNumber = userPhone ? userPhone.replace('+', '') : userIdentifier;
      query = 'SELECT id FROM rielpoint_users WHERE phone = $1'; // fixed column
      params = [phoneNumber];
    } else {
      req.user = null;
      return next();
    }

    const result = await zingoPool.query(query, params);

    req.user = result.rows.length > 0
      ? { id: result.rows[0].id, email: userEmail, phone: userPhone || userIdentifier, ...decodedToken }
      : null; // token valid but no matching app user — treat as anonymous rather than failing

    next();
  } catch (error) {
    console.error('optionalFirebaseAuth: token verification/db error:', error.message);
    req.user = null; // any failure → anonymous, never block
    next();
  }
};

module.exports = optionalFirebaseAuth;