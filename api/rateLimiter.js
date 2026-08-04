// const { RateLimiterMemory } = require('rate-limiter-flexible');

// // Create a specific rate limiter for post routes
// const postRoutesLimiter = new RateLimiterMemory({
//   points: 30, // Allow 100 attempts
//   duration: 60 * 60, // Per 1 hour
//   blockDuration: 60 * 15 // Block for 15 minutes if limit is exceeded
// });

// // Middleware creator
// const createRateLimiterMiddleware = async (req, res, next) => {
//   try {
//     const key = req.user?.id || req.ip;
//     await postRoutesLimiter.consume(key);
//     next();
//   } catch (error) {
//     res.status(429).json({
//       error: 'Too many post attempts. Please try again later.',
//       retryAfter: Math.ceil(error.msBeforeNext / 1000)
//     });
//   }
// };

// module.exports = createRateLimiterMiddleware;


const { RateLimiterMemory } = require('rate-limiter-flexible');

// Define different rate limits for development and production
const rateLimiterConfig = {
  development: {
    points: 1000,        // Higher limit for development
    duration: 60 * 60,   // Per 1 hour
    blockDuration: 60    // Shorter block duration (1 minute) for development
  },
  production: {
    points: 1000,          // Stricter limit for production
    duration: 60 * 60,   // Per 1 hour
    blockDuration: 60 * 15 // 15 minutes block for production
  }
};

// Use environment-specific config
const config = rateLimiterConfig[process.env.NODE_ENV || 'development'];

// Create a specific rate limiter for post routes
const postRoutesLimiter = new RateLimiterMemory(config);

// Middleware creator
const createRateLimiterMiddleware = async (req, res, next) => {
  // Skip rate limiting in development if needed
  if (process.env.DISABLE_RATE_LIMIT === 'true') {
    return next();
  }

  try {
    const key = req.user?.id || req.ip;
    await postRoutesLimiter.consume(key);
    next();
  } catch (error) {
    res.status(429).json({
      error: 'Too many post attempts. Please try again later.',
      retryAfter: Math.ceil(error.msBeforeNext / 1000)
    });
  }
};

module.exports = createRateLimiterMiddleware;