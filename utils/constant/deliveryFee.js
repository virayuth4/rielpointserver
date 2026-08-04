
//Utils to calculate delivery fee
function getDeliveryFee(paymentMethod, deliveryMethod = 'normal') {
  if (deliveryMethod === 'storePickup') return 0;

  if (deliveryMethod === 'grabExpress') {
    const grabFees = {
      aba: 2.0,
      cod: 3.0,
    };
    return grabFees[paymentMethod] ?? 3.0;
  }

  const fees = {
    aba: 1.0,
    cod: 2.0,
  };

  return fees[paymentMethod] ?? 1.0;
}

module.exports = {
  getDeliveryFee
}