const zingoPool = require("../../database/pgZingo")

const addToSearchHistory = async (q, userId) => {
    console.log('q in addToSearchHistory', q)

    // First delete any existing duplicate entry
    const deleteQuery = `DELETE FROM search_history 
    WHERE query = $1 AND "userId" = $2`

    // Insert the new entry
    const insertQuery = `INSERT INTO search_history 
    (query, "userId") 
    VALUES ($1, $2)`

    // Delete oldest entries if count exceeds 10
    const trimQuery = `DELETE FROM search_history 
    WHERE id IN (
        SELECT id FROM search_history 
        WHERE "userId" = $1 
        ORDER BY "createdAt" DESC 
        OFFSET 10
    )`

    const values = [q, userId]
    
    try {
        await zingoPool.query('BEGIN')
        await zingoPool.query(deleteQuery, values)
        await zingoPool.query(insertQuery, values)
        await zingoPool.query(trimQuery, [userId])
        await zingoPool.query('COMMIT')
    } catch (e) {
        await zingoPool.query('ROLLBACK')
        console.error('Error with adding query to search history:', e)
    }
}

module.exports = {
    addToSearchHistory
};