function formatPaymentMethod(paymentMethod) {
  switch (paymentMethod) {
    case "delivery":
      return "Cash";

    case "cash":
      return "Cash";

    case "card":
      return "Card";

    case "aba":
      return "ABA";

    default:
      return paymentMethod
        ? paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)
        : "N/A";
  }
}

module.exports = { formatPaymentMethod };