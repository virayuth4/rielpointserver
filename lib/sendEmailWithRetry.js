const { sendEmailVerificationToBuyer } = require("../helper/orderRoutesHelper");

async function sendEmailWithRetry(orderResult, orderDetails, userId) {
    const maxRetries = 2;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            attempt++;
            console.log(`Attempting to send email (attempt ${attempt}/${maxRetries})`);
            
            const result = await sendEmailVerificationToBuyer(orderResult, orderDetails, userId);
            console.log('Email verification completed successfully');
            return result;
            
        } catch (emailError) {
            console.error(`Email verification attempt ${attempt} failed:`, emailError);
            
            if (attempt === maxRetries) {
                console.error('All email verification attempts failed');
                // You might want to log this to a monitoring service or database
                // Consider implementing a queue system for failed emails
                return { success: false, error: emailError.message };
            }
            
            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}

module.exports = {
    sendEmailWithRetry
};