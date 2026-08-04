const zingoPool = require("../../database/pgZingo");

async function deleteExpiredOTPs() {
    const client = await zingoPool.connect()
    try {
        await client.query('DELETE FROM otp WHERE "expiresAt" <= NOW();');
        console.log('Expired OTPs deleted successfully');

    } catch (e) {
        console.error('Error deleting expired OTPs:', error);
    } finally {
        await client.end();
    }
}


module.exports = {deleteExpiredOTPs}