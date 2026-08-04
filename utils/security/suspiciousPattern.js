function logSuspiciousActivity(ip, username, userAgent) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ip: ip,
    username: username,
    userAgent: userAgent,
    type: 'SUSPICIOUS_USERNAME_PATTERN'
  };
  
  console.warn('SECURITY_LOG:', JSON.stringify(logEntry));
  

}


const suspiciousPatternDetector = (req, res, next) => {
console.log('🔍 suspiciousPatternDetector middleware hit for:', req.params.username);

  const username = req.params.username?.toLowerCase() || '';
  
  // Common malicious patterns
  const suspiciousPatterns = [
    /\.php$/i,
    /\.asp$/i,
    /\.jsp$/i,
    /\.txt$/i, 
    /robots\.txt$/i,
    /sitemap\.xml$/i,
    /admin/i,
    /config/i,
    /setup/i,
    /install/i,
    /backup/i,
    /test/i,
    /tmp/i,
    /upload/i,
    /\.\./, // Directory traversal
    /%2e%2e/, // URL encoded directory traversal
    /script/i,
    /eval/i,
    /exec/i
  ];
  
  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(username));
  
  if (isSuspicious) {
    console.warn(`🚨 Suspicious request detected from IP ${req.ip}: ${username}`);
    
    // Log for monitoring/alerting
    logSuspiciousActivity(req.ip, username, req.headers['user-agent']);
    
    // Return 404 to not reveal the validation logic
    return res.status(404).json({ message: 'User not found' });
  }
  
  next();
};

module.exports = suspiciousPatternDetector;