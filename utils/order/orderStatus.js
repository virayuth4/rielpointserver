const OrderStatus = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    PREPARING: 'preparing-for-delivery',
    OUT: 'out-for-delivery',
    PARTIALLY_PREPARING: 'partially-preparing',
    PARTIALLY_DELIVERED: 'partially-delivered',
    PARTIALLY_DELIVERING: 'partially-delivering',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  };
  
  const OrderItemStatus = {
    ORDERED: 'ordered',
    ACCEPTED: 'accepted',
    PREPARING: 'preparing-for-delivery',
    OUT: 'out-for-delivery',
    DELIVERING: 'delivering',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled'
  };
  
 function calculateOrderStatus(orderItems) {
    const statuses = orderItems.map(item => item.currentStatus);
    console.log('Current statuses:', statuses);
    
    if (statuses.every(status => status === OrderItemStatus.CANCELLED)) {
        return OrderStatus.CANCELLED;
    }

    // Check if ALL items are preparing first
    if (statuses.every(status => status === OrderItemStatus.PREPARING)) {
        return OrderStatus.PREPARING;
    }

    // Then check if SOME items are preparing
    if (statuses.some(status => status === OrderItemStatus.PREPARING)) {
        return OrderStatus.PARTIALLY_PREPARING;
    }

      if (statuses.every(status => status === OrderItemStatus.OUT)) {
        return OrderStatus.OUT;
    }

    if (statuses.some(status => status === OrderItemStatus.OUT)) {
        return OrderStatus.OUT;
    }
    
    if (statuses.every(status => status === OrderItemStatus.DELIVERED)) {
        return OrderStatus.COMPLETED;
    }
    
    if (statuses.some(status => status === OrderItemStatus.DELIVERED)) {
        return OrderStatus.PARTIALLY_DELIVERED;
    }

    if (statuses.some(status => status === OrderItemStatus.DELIVERING)) {
        return OrderStatus.PARTIALLY_DELIVERING;
    }
    
    return OrderStatus.ACCEPTED;
}
  
  module.exports = {
    OrderStatus,
    OrderItemStatus,
    calculateOrderStatus
  };