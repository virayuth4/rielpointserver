// middleware/auth.js (or wherever authenticateFirebaseToken lives)

const optionalAuthenticateFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    // No token — guest user, continue without blocking
    req.user = null
    return next()
  }

  try {
    const token = authHeader.split('Bearer ')[1]
    const decodedToken = await admin.auth().verifyIdToken(token)
    
    // Look up your DB user record the same way authenticateFirebaseToken does
    const result = await zingoPool.query(
      'SELECT * FROM users WHERE userId = $1',
      [decodedToken.uid]
    )
    req.user = result.rows[0] || null
  } catch (err) {
    // Invalid/expired token — treat as guest rather than rejecting
    req.user = null
  }

  next()
}

module.exports = { optionalAuthenticateFirebaseToken }