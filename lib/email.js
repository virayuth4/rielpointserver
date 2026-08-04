const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const {  formatCityName } = require('../utils/cityFormat');

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function sendOrderConfirmationEmail({ resultOrder, orderDetails }, userEmail) {
    console.log('Result Order in sendOrderConfirmationEmail', resultOrder);
    console.log('Order Details in sendOrderConfirmationEmail', orderDetails);

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

    const emailParams = {
        Destination: {
            ToAddresses: [userEmail]
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
                                    <!-- Header -->
                                    <div style="background-color: #ffffff; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                                        <h1 style="color: #333; margin: 0;">Order Confirmation</h1>
                                    </div>

                                    <!-- Main Content Card -->
                                    <div style="background-color: #ffffff; padding: 30px; margin-top: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                        <div style="text-align: center; margin-bottom: 30px;">
                                            <div style="font-size: 18px; color: #333; margin-bottom: 10px;">Thank you for your order!</div>
                                            <div style="color: #666;">Order #${resultOrder.orderId}</div>
                                            <div style="color: #666; margin-top: 5px;">${orderDate}</div>
                                        </div>

                                        <!-- Customer Information -->
                                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
                                            <h3 style="margin: 0 0 10px 0; color: #333;">Delivery Information</h3>
                                            <div style="margin-bottom: 5px;"><strong>Name:</strong> ${orderDetails.buyerFirstName} ${orderDetails.buyerLastName}</div>
                                            <div style="margin-bottom: 5px;"><strong>Phone:</strong> ${orderDetails.buyerPhoneNumber}</div>
                                            <div style="margin-bottom: 5px;"><strong>Address:</strong> ${orderDetails.buyerAddress}</div>
                                            <div style="margin-bottom: 5px;"><strong>City:</strong> ${formatCityName(orderDetails.buyerCity)}</div>
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
                                        <div style="text-align: center; margin: 30px 0;">
                                            <a href="${process.env.NEXT_PUBLIC_FRONTEND}/my-orders" 
                                               style="display: inline-block; padding: 14px 30px; background-color: #FFA500; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
                                                View Order Details
                                            </a>
                                        </div>

                                        <!-- Contact Support -->
                                       <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px; color: #666; font-size: 14px;">
                                            <p>If you have any questions about your delivery, please contact our customer service team.</p>
                                            <p>Email: <a href="${process.env.SES_VERIFIED_EMAIL}" style="color: #007bff !important; text-decoration: none;">support@yourstore.com</a><br>
                                            Phone: <a href="tel: 061-207-903" style="color: #007bff !important; text-decoration: none;">1-800-123-4567</a></p>
                                        </div>
                                    </div>

                                    <!-- Footer -->
                                    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
                                        <p>This email was sent by Your Store Name<br>
                                        123 Store Street, City, Country</p>
                                    </div>
                                </div>
                            </body>
                        </html>
                    `
                },
                Text: {
                    Charset: 'UTF-8',
                    Data: `
                        Order Confirmation

                        Thank you for your order!

                        Order #${resultOrder.orderId}
                        Date: ${orderDate}

                        Delivery Information:
                        Name: ${orderDetails.buyerFirstName} ${orderDetails.buyerLastName}
                        Phone: ${orderDetails.buyerPhoneNumber}
                        Address: ${orderDetails.buyerAddress}
                        City: ${formatCityName(orderDetails.buyerCity)}
                        Payment Method: ${orderDetails.paymentMethod}

                        Order Status: ${resultOrder.orderStatus}

                        Items:
                        ${orderDetails.items.map(item => `${item.name} x ${item.quantity}: $${item.price}`).join('\n')}

                        Total Amount: $${orderDetails.totalAmount}

                        To view your order details, visit: ${process.env.STORE_URL}/orders/${resultOrder.orderId}

                        If you have any questions about your order, please contact our customer service:
                        Email: ${process.env.SES_VERIFIED_EMAIL}
                        Phone: 061-207-903

                        Best regards,
                        Nerokart support team
                    `
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: `Order Confirmation - Order #${resultOrder.orderId}`
            }
        },
        Source: process.env.SES_VERIFIED_EMAIL
    };

    try {
        const command = new SendEmailCommand(emailParams);
        const result = await sesClient.send(command);
        
        return {
            success: true,
            messageId: result.MessageId
        };
    } catch (error) {
        console.error('Error sending email:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = { sendOrderConfirmationEmail };