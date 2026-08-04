const admin = require('firebase-admin');

class NotificationService {
  constructor() {
    this.messaging = admin.messaging();
  }

  async sendNotification(token,title,body,data = {}) {
    try {
      if (!token) {
        console.log("No FCM Token provided");
        return;
      }
      
      const message = {
        notification: {
          title,
          body,
        },
        data,
        token,
      };

      const response = await admin.messaging().send(message);
      console.log("Sucessfully sent notification:",response);
      return response;

    } catch (e) {
      console.error('Error sending notification:',error);
      throw error;
    }
  }

  async sendOrderStatusNotification(token, action, orderId, productId, notificationType = 'order') {
    console.log("Action:", action);
    console.log("Notification Type:", notificationType);
    // Define notification configurations for different types
    const notificationConfigs = {
        order: {
          accepted: {
            title:'Order Accepted',
            body: 'Order #${orderId} has been accepted and being processed by the seller.'
          },
            pending: {
                title: 'New Order Received',
                body: `Order #${orderId} has been placed successfully.`
            },
            preparingForDelivery: {
              title: 'Order ready',
              body: `Order #${orderId} is ready to be delivered.`
          },
  
            confirmed: {
                title: 'Order Confirmed',
                body: `Order #${orderId} has been confirmed by the seller.`
            },
            outForDelivery: {
                title: 'Order Shipped',
                body: `Order #${orderId} is on its way!`
            },
            delivered: {
                title: 'Order Delivered',
                body: `Order #${orderId} has been marked as delivered.`
            },
            cancelled: {
                title: 'Order Cancelled',
                body: `Order #${orderId} has been cancelled.`
            }
        },
        payment: {
            pending: {
                title: 'Payment Required',
                body: `Payment pending for order #${orderId}.`
            },
            success: {
                title: 'Payment Successful',
                body: `Payment received for order #${orderId}.`
            },
            failed: {
                title: 'Payment Failed',
                body: `Payment failed for order #${orderId}. Please try again.`
            }
        },
        shipping: {
            pickup: {
                title: 'Ready for Pickup',
                body: `Order #${orderId} is ready for pickup.`
            },
            transit: {
                title: 'In Transit',
                body: `Order #${orderId} is in transit to your location.`
            },
            delivery_attempt: {
                title: 'Delivery Attempted',
                body: `Delivery attempted for order #${orderId}.`
            }
        },
        promotional: {
            discount: {
                title: 'Special Discount',
                body: `Special offer on your order #${orderId}!`
            },
            feedback: {
                title: 'Share Your Experience',
                body: `How was your experience with order #${orderId}? Share your feedback!`
            }
        }
    };

    // Get the configuration for the specific notification type
    const typeConfig = notificationConfigs[notificationType] || notificationConfigs.order;
    
    // Get the specific action configuration or use default
    const config = typeConfig[action] || {
        title: `${notificationType.charAt(0).toUpperCase() + notificationType.slice(1)} Update`,
        body: `Order #${orderId} has a new ${notificationType} update: ${action}`
    };

    const data = {
        orderId: orderId.toString(),
        productId: productId.toString(),
        action,
        notificationType,
        timestamp: new Date().toISOString()
    };

    return this.sendNotification(token, config.title, config.body, data);
}

async createNotificationLog(notificationId, userDeviceToken, orderDetails) {
    const logRef = admin.firestore().collection('notification_logs').doc(notificationId);
    
    await logRef.set({
      notificationId,
      userDeviceToken,
      orderId: orderDetails.orderId,
      status: 'pending',
      orderStatus: orderDetails.status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      platform: this.detectPlatform(userDeviceToken),
      // For debugging
      testDevice: true,
      environment: 'testflight'
    });

    return logRef;
  }

  async updateNotificationLog(logRef, updateData) {
    await logRef.update({
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  detectPlatform(token) {
    // FCM tokens have different formats for iOS and Android
    if (token.startsWith('e') || token.startsWith('f')) {
      return 'ios';
    }
    return 'android';
  }

  getNotificationTitle(status) {
    const titles = {
      accepted: 'Order Accepted',
      out_for_delivery: 'Order Out for Delivery',
      delivered: 'Order Delivered'
    };
    return titles[status] || 'Order Update';
  }

  getNotificationBody(orderDetails) {
    const bodies = {
      accepted: `Your order #${orderDetails.orderId} has been accepted!`,
      out_for_delivery: `Your order #${orderDetails.orderId} is on its way!`,
      delivered: `Your order #${orderDetails.orderId} has been delivered!`
    };
    return bodies[orderDetails.status] || `Update on your order #${orderDetails.orderId}`;
  }
}

module.exports = new NotificationService();