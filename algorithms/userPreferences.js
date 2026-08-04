const zingoPool = require("../database/pgZingo");


const UserPreferences = async (userId ) => {
  try {
      // Validate userId
        if (!userId) {
            throw new Error('userId is required');
        }

        // Query to fetch all productClick events for the user
        const query = `
            SELECT * FROM event_tracker_history 
            WHERE "userId" = $1 AND "eventType" = $2
            ORDER BY "timestamp" DESC
        `;

        const result = await zingoPool.query(query, [userId, 'productClick']);

        return {
            success: true,
            data: result.rows,
            count: result.rows.length
        };

  } catch (error) {
    console.error('Error fetching user preferences:', error);
        return {
            success: false,
            error: error.message,
            data: [],
            count: 0
        };
  }
   
}

  module.exports = {
    UserPreferences 
  };
