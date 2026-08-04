const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { formatCityName } = require('../utils/cityFormat');

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function sendOrderSoldEmail({ resultOrder, orderDetails }, sellerDetails) {
    console.log('Result Order in sendOrderSoldEmail', resultOrder);
    console.log('Order Details in sendOrderSoldEmail', orderDetails);
    console.log('sellerDetails in sendOrderSoldEmail:', sellerDetails);

    // Format items for email
    const itemsList = orderDetails.items.map(item => 
        `<tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">${item.productName}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">$${item.price}</td>
         </tr>`
    ).join('');

    // Format date
    const orderDate = new Date(resultOrder.createdAt).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Send emails to all sellers
    const emailResults = await Promise.all(sellerDetails.map(async (seller) => {
        // Find items for this seller
        const sellerItems = orderDetails.items.filter(item => item.sellerId === seller.id);
        const itemNames = sellerItems.map(item => item.productName).join(', ');

        const emailParams = {
            Destination: {
                ToAddresses: [seller.email]
            },
            Message: {
                Body: {
                    Html: {
                        Charset: 'UTF-8',
                        Data: `
                            <!DOCTYPE html>
                            <html>
                                <head>
                                    <meta charset="UTF-8">
                                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                </head>
                                <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
                                    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                                        <!-- Logo -->
                                        <div style="padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                                            <img src="${process.env.STORE_LOGO_URL || 'https://products-sale-bucket.s3.ap-southeast-1.amazonaws.com/logo/icon512_rounded.png'}" alt="Store Logo" style="max-height: 75px;">
                                        </div>
                                        
                                        <!-- Notification Header -->
                                        <div style="background-color: #28a745; color: white; padding: 20px; text-align: center; border-radius: 6px; margin-bottom: 25px;">
                                            <h2 style="margin: 0;">Item Sold!</h2>
                                            <p style="margin: 10px 0 0 0;">Order #${resultOrder.orderId}</p>
                                        </div>

                                        <!-- Pickup Notice -->
                                        <div style="background-color: #e8f5e9; padding: 15px; border-radius: 6px; margin-bottom: 25px; text-align: center;">
                                            <p style="margin: 0; color: #2e7d32; font-size: 16px;">Our delivery team will pick up item from your address shortly.</p>
                                        </div>

                                        <!-- Seller Information -->
                                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
                                            <h3 style="margin: 0 0 10px 0; color: #333;">Seller Information</h3>
                                            <div style="margin-bottom: 5px;"><strong>Name:</strong> ${seller.sellerFirstName} ${seller.sellerLastName}</div>
                                            <div style="margin-bottom: 5px;"><strong>Phone:</strong> ${seller.sellerPhoneNumber}</div>
                                            <div style="margin-bottom: 5px;"><strong>Email:</strong> ${seller.email}</div>
                                            <div><strong>City:</strong> ${formatCityName(seller.sellerCity)}</div>
                                        </div>

                                        <!-- Order Details -->
                                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
                                            <h3 style="margin: 0 0 10px 0; color: #333;">Order Details</h3>
                                            <div style="margin-bottom: 5px;"><strong>Order Date:</strong> ${orderDate}</div>
                                            <div style="margin-bottom: 5px;"><strong>Order Status:</strong> ${resultOrder.orderStatus}</div>
                                            <div><strong>Payment Method:</strong> ${orderDetails.paymentMethod}</div>
                                        </div>

                                        <!-- Items Table -->
                                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                                            <thead>
                                                <tr style="background-color: #f8f9fa;">
                                                    <th style="padding: 12px; text-align: left;">Item(s)</th>
                                                    <th style="padding: 12px; text-align: center;">Quantity</th>
                                                    <th style="padding: 12px; text-align: right;">Price</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${itemsList}
                                            </tbody>
                                            <tfoot>
                                                <tr>
                                                    <td colspan="2" style="padding: 15px; font-weight: bold; text-align: right;">Total:</td>
                                                    <td style="padding: 15px; font-weight: bold; text-align: right;">$${orderDetails.totalAmount}</td>
                                                </tr>
                                            </tfoot>
                                        </table>

                                        <!-- View Order Button -->
                                        <div style="text-align: center; margin-bottom: 25px;">
                                            <a href="${process.env.STORE_URL}/seller/orders/${resultOrder.orderId}" 
                                               style="display: inline-block; padding: 12px 24px; background-color: #FFA500; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
                                                View Order Details
                                            </a>
                                        </div>

                                        <!-- Footer -->
                                        <div style="text-align: center; color: #666; font-size: 14px;">
                                            <p>If you have any questions, please contact our seller support team:<br>
                                            Email: ${process.env.SES_VERIFIED_EMAIL}<br>
                                            Phone: 061-207-903</p>
                                        </div>
                                    </div>
                                </body>
                            </html>
                        `
                    },
                    Text: {
                        Charset: 'UTF-8',
                        Data: `
                            Item Sold Notification!

                            Order #${resultOrder.orderId}
                            Date: ${orderDate}

                            Important Notice:
                            Dear, ${seller.sellerFirstName}, Our delivery team will pick up item from your address shortly.

                            Your address and contact Information:
                            Name: ${seller.sellerFirstName} ${seller.sellerLastName}
                            Phone: ${seller.sellerPhoneNumber}
                            Email: ${seller.email}
                            City: ${formatCityName(seller.sellerCity)}

                            Order Details:
                            Status: ${resultOrder.orderStatus}
                            Payment Method: ${orderDetails.paymentMethod}

                            Items Sold:
                            ${orderDetails.items.map(item => `${item.productName} x ${item.quantity}: $${item.price}`).join('\n')}

                            Total Amount: $${orderDetails.totalAmount}

                            View your order details at: ${process.env.STORE_URL}/seller/orders/${resultOrder.orderId}

                            For seller support:
                            Email: ${process.env.SES_VERIFIED_EMAIL}
                            Phone: 061-207-903

                            Best regards,
                            Nerokart Seller Support Team
                        `
                    }
                },
                Subject: {
                    Charset: 'UTF-8',
                    Data: `Item Sold! Your items (${itemNames}) have been purchased`
                }
            },
            Source: process.env.SES_VERIFIED_EMAIL
        };

        try {
            const command = new SendEmailCommand(emailParams);
            const result = await sesClient.send(command);
            return {
                email: seller.email,
                success: true,
                messageId: result.MessageId
            };
        } catch (error) {
            console.error(`Error sending email to ${seller.email}:`, error);
            return {
                email: seller.email,
                success: false,
                error: error.message
            };
        }
    }));

    // Process results
    const failedEmails = emailResults.filter(result => !result.success);
    
    if (failedEmails.length > 0) {
        console.error('Failed to send emails to:', failedEmails);
        return {
            success: false,
            failedEmails,
            error: 'Failed to send emails to some recipients'
        };
    }

    return {
        success: true,
        results: emailResults
    };
}

module.exports = { sendOrderSoldEmail };