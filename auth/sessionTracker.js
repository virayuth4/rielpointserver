const trackUserSession = async (req, res, next) => {
    // Skip tracking for certain routes (optional)
    const skipRoutes = ['/health', '/favicon.ico', '/_next', '/api/health'];
    const shouldSkip = skipRoutes.some(route => req.path.startsWith(route));
    
    if (shouldSkip) {
        return next();
    }

    try {
        // Only track if user is authenticated
        if (req.user && req.user.id) {
            const userId = req.user.id;
            const route = req.originalUrl || req.path;
            const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
            const userAgent = req.headers['user-agent'];
            
            // Check if user has an active session
            const existingSessionQuery = `
                SELECT id FROM user_sessions 
                WHERE user_id = $1 AND is_active = true 
                ORDER BY updated_at DESC 
                LIMIT 1
            `;
            
            const existingSession = await zingoPool.query(existingSessionQuery, [userId]);
            
            if (existingSession.rows.length > 0) {
                // Update existing session
                const updateQuery = `
                    UPDATE user_sessions 
                    SET route_accessed = $1, updated_at = CURRENT_TIMESTAMP
                    WHERE id = $2
                `;
                await zingoPool.query(updateQuery, [route, existingSession.rows[0].id]);
            } else {
                // Create new session
                const insertQuery = `
                    INSERT INTO user_sessions (user_id, route_accessed, ip_address, user_agent)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id
                `;
                await zingoPool.query(insertQuery, [userId, route, ipAddress, userAgent]);
            }
        }
    } catch (error) {
        console.error('Session tracking error:', error);
        // Don't block the request if session tracking fails
    }
    
    next();
};

module.exports = trackUserSession;