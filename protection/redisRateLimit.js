const { RateLimiterMemory, RateLimiterRedis } = require('rate-limiter-flexible');
const Redis = require('ioredis');

// Create multiple rate limiters for different time windows
const rateLimiters = {
  shortTerm: new RateLimiterRedis({
    storeClient: new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false
    }),
    keyPrefix: 'short_limit',
    points: 30, // 30 requests
    duration: 60, // per 1 minute
    blockDuration: 60 * 2 // Block for 2 minutes
  }),
  
  mediumTerm: new RateLimiterRedis({
    storeClient: new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false
    }),
    keyPrefix: 'medium_limit',
    points: 100, // 100 requests
    duration: 60 * 60, // per hour
    blockDuration: 60 * 15 // Block for 15 minutes
  }),

  globalIpLimit: new RateLimiterRedis({
    storeClient: new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD,
      enableOfflineQueue: false
    }),
    keyPrefix: 'global_ip',
    points: 1000, // 1000 requests
    duration: 60 * 60, // per hour
    blockDuration: 60 * 60 // Block for 1 hour
  })
};

// Enhanced middleware creator
const createRedisRateLimiter = async (req, res, next) => {
  const ip = req.ip;
  const userId = req.user?.id;
  
  try {
    // Check request body size
    const contentLength = parseInt(req.headers['content-length'] || 0);
    if (contentLength > 1000000) { // 1MB limit
      return res.status(413).json({ error: 'Request entity too large' });
    }

    // Implement tiered rate limiting
    const promises = [
      // Rate limit by IP (even for authenticated users)
      rateLimiters.globalIpLimit.consume(ip),
      
      // If authenticated, also rate limit by user ID
      userId ? rateLimiters.shortTerm.consume(`user_${userId}`) : Promise.resolve(),
      userId ? rateLimiters.mediumTerm.consume(`user_${userId}`) : Promise.resolve(),
      
      // Additional IP-based rate limit for non-authenticated users
      !userId ? rateLimiters.shortTerm.consume(`ip_${ip}`) : Promise.resolve(),
      !userId ? rateLimiters.mediumTerm.consume(`ip_${ip}`) : Promise.resolve(),
    ];

    await Promise.all(promises);

    // Add security headers
    res.set({
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block'
    });

    next();
  } catch (error) {
    const retryAfter = Math.ceil(error.msBeforeNext / 1000) || 60;
    
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: retryAfter
    });
  }
};


module.exports = {createRedisRateLimiter}