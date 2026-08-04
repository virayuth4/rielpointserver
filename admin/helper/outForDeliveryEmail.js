const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { formatCityName } = require('../../utils/cityFormat');

const sesClient = new SESClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

async function sendDeliveryStatusEmail({ deliveryInfo }, userEmail) {
    console.log('Delivery Info Result in sendDeliveryStatusEmail', deliveryInfo);
    console.log('Products to be included:', deliveryInfo.products);
    console.log('delivery item length', deliveryInfo.products.length)


    // Dynamic content based on order status
    const getEmailContent = (status) => {
        switch(status) {
        
            case 'delivering':
                return {
                    title: 'Package out for delivery!',
                    message: `Your package with ${deliveryInfo.products.length} item(s) will be delivered today.`,
                    timeLabel: 'Out for Delivery:',
                    time: deliveryInfo.outForDeliveryTime,
                    buttonText: 'Track Your Order'
                };
            case 'delivered':
                return {
                    title: 'Order Delivered!',
                    message: `Your package with ${deliveryInfo.products.length} item(s) has been successfully delivered!`,
                    timeLabel: 'Delivered:',
                    time: deliveryInfo.deliveredTime,
                    buttonText: 'View Order Details'
                };
            default:
                return {
                    title: 'Order Status Update',
                    message: 'Here\'s an update on your order',
                    timeLabel: 'Last Updated:',
                    time: deliveryInfo.outForDeliveryTime || new Date(),
                    buttonText: 'View Order Details'
                };
        }
    };

    const content = getEmailContent(deliveryInfo.orderStatus);

    // Format status time
    const formattedTime = new Date(content.time).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Generate products HTML rows
    const productsHtml = deliveryInfo.products.map(product => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">${product.productName}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${product.purchasedQuantity}</td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">$${product.productPrice}</td>
        </tr>
    `).join('');

    // Generate products text for plain email
    const productsText = deliveryInfo.products.map(product => 
        `${product.productName} x ${product.purchasedQuantity}: $${product.productPrice}`
    ).join('\n');

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
                                        <h1 style="color: #333; margin: 0;">${content.title}</h1>
                                    </div>

                                    <!-- Main Content Card -->
                                    <div style="background-color: #ffffff; padding: 30px; margin-top: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                        <div style="text-align: center; margin-bottom: 30px;">
                                            <div style="font-size: 18px; color: #333; margin-bottom: 10px;">${content.message}</div>
                                            <div style="color: #666;">Order #${deliveryInfo.orderId}</div>
                                            <div style="color: #666;">${content.timeLabel} ${formattedTime}</div>
                                        </div>

                                        <!-- Customer Information -->
                                       <div style="background-color: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
                                            <h3 style="margin: 0 0 10px 0; color: #333 !important;">Delivery Information</h3>
                                            <div style="margin-bottom: 5px; color: #333 !important;"><strong style="color: #333 !important;">Name:</strong> <span style="color: #333 !important;">${deliveryInfo.buyerFirstName} ${deliveryInfo.buyerLastName}</span></div>
                                            <div style="margin-bottom: 5px; color: #333 !important;"><strong style="color: #333 !important;">Address:</strong> <span style="color: #333 !important;">${deliveryInfo.buyerAddress}</span></div>
                                            <div style="margin-bottom: 5px; color: #333 !important;"><strong style="color: #333 !important;">City:</strong> <span style="color: #333 !important;">${formatCityName(deliveryInfo.buyerCity)}</span></div>
                                        </div>

                                        <!-- Order Details -->
                                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                                            <thead>
                                                <tr style="background-color: #f8f9fa;">
                                                    <th style="padding: 12px; text-align: left;">Item</th>
                                                    <th style="padding: 12px; text-align: center;">Quantity</th>
                                                    <th style="padding: 12px; text-align: right;">Price</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${productsHtml}
                                            </tbody>
                                            <tfoot>
                                                <tr>
                                                    <td colspan="2" style="padding: 15px; font-weight: bold; text-align: right;">Total:</td>
                                                    <td style="padding: 15px; font-weight: bold; text-align: right;">$${deliveryInfo.totalAmount}</td>
                                                </tr>
                                            </tfoot>
                                        </table>

                                        <!-- Action Button -->
                                        <div style="text-align: center; margin: 30px 0;">
                                            <a href="${process.env.NEXT_PUBLIC_FRONTEND}/my-orders" 
                                            style="display: inline-block; padding: 14px 30px; background-color: #007bff; color: white !important; text-decoration: none; border-radius: 4px; font-weight: bold;">
                                                ${content.buttonText}
                                            </a>
                                        </div>

                                        <!-- Contact Support -->
                                        <div style="border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px; color: #666; font-size: 14px;">
                                            <p>If you have any questions about your delivery, please contact our customer service team.</p>
                                            <p>Email: <a href="${process.env.SES_VERIFIED_EMAIL}" style="color: #007bff !important; text-decoration: none;">${process.env.SES_VERIFIED_EMAIL}</a><br>
                                            Phone: <a href="tel: 061-207-903" style="color: #007bff !important; text-decoration: none;">061-207-903</a></p>
                                        </div>
                                    </div>

                                    <!-- Footer -->
                                    <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
                                        <p>This email was sent by Nerokart Support Team<br>
                                        Street 271, Phnom Penh, Cambodia</p>
                                    </div>
                                </div>
                            </body>
                        </html>
                    `
                },
                Text: {
                    Charset: 'UTF-8',
                    Data: `
                        ${content.title}

                        ${content.message}

                        ${content.timeLabel} ${formattedTime}

                        Delivery Information:
                        Name: ${deliveryInfo.buyerFirstName} ${deliveryInfo.buyerLastName}
                        Address: ${deliveryInfo.buyerAddress}
                        City: ${formatCityName(deliveryInfo.buyerCity)}

                        Order Details:
                        ${productsText}

                        Total Amount: $${deliveryInfo.totalAmount}

                        To track your order, visit: ${process.env.NEXT_PUBLIC_FRONTEND}/my-orders

                        If you have any questions about your delivery, please contact our customer service:
                        Email: ${process.env.SES_VERIFIED_EMAIL}
                        Phone: 061-207-903

                        Best regards,
                        Your Store Team
                    `
                }
            },
            Subject: {
                Charset: 'UTF-8',
                Data: `${content.title} - Order #${deliveryInfo.orderId}`
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

module.exports = { sendDeliveryStatusEmail };