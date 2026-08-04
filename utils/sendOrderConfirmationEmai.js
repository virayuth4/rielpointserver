const nodemailer = require("nodemailer");
const { formatPaymentMethod } = require("./formatDeliveryMethod");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

async function sendOrderConfirmationEmail({
  toEmail,
  orderId,
  enrichedProducts,
  shippingInfo,
  deliveryFee,
  totalAmount,
  discountCode,
  codeDiscount,
  pointsDiscount,
  firstOrderDiscount,
  paymentMethod,
  deliveryMethod,
}) {
  const formatCurrency = (n) => Number(n || 0).toFixed(2);

  const itemRows = enrichedProducts
    .map(
      (p) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px dashed #E5E7EB;">
          <span style="font-size:15px;font-weight:600;color:#0F0F0F;">${p.productName}</span><br/>
          <span style="color:#9CA3AF;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;margin-top:2px;display:inline-block;">
            ${[p.variant?.color ? `Color: ${p.variant.color}` : "", p.variant?.size ? `Size: ${p.variant.size}` : ""].filter(Boolean).join(" · ")}
          </span>
          ${p.storeLocation ? `<br/><span style="color:#0F0F0F;font-size:12px;font-weight:600;">📍 ${p.storeLocation.locationName}</span>` : ""}
        </td>
        <td style="padding:14px 0;border-bottom:1px dashed #E5E7EB;text-align:center;color:#6B7280;font-size:14px;">×${p.purchasedQuantity}</td>
        <td style="padding:14px 0;border-bottom:1px dashed #E5E7EB;text-align:right;color:#6B7280;font-size:14px;">$${formatCurrency(p.price)}</td>
        <td style="padding:14px 0;border-bottom:1px dashed #E5E7EB;text-align:right;font-weight:600;color:#0F0F0F;font-size:14px;">$${formatCurrency(p.price * p.purchasedQuantity)}</td>
      </tr>
    `
    )
    .join("");

  const subtotal = enrichedProducts.reduce(
    (sum, p) => sum + p.price * p.purchasedQuantity,
    0
  );

  const paymentLabel =
    paymentMethod === "delivery" ? "Cash on Delivery" : paymentMethod ?? "N/A";
  const deliveryLabel =
    deliveryMethod === "pickup" || deliveryMethod === "storePickup"
      ? "Store Pickup"
      : deliveryMethod === "grabExpress"
      ? "Grab Express"
      : "Standard Delivery";

  const address = [
    shippingInfo?.address,
    shippingInfo?.commune,
    shippingInfo?.district,
    shippingInfo?.city,
  ]
    .filter(Boolean)
    .join(", ");

  // Single consistent "info row" used for pickup location(s), payment, and delivery —
  // keeps everything in one column so it never breaks or goes lopsided across email clients.
  const renderInfoRow = ({ icon, label, value, subtext, linkUrl, linkText, isLast }) => `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:${isLast ? "0" : "10px"};">
      <tr>
        ${icon ? `
        <td width="52" style="padding:16px 0 16px 16px;vertical-align:top;">
          <table cellpadding="0" cellspacing="0" width="36" style="width:36px;">
            <tr>
              <td width="36" height="36" align="center" valign="middle" style="background:#0F0F0F;border-radius:8px;font-size:16px;line-height:36px;text-align:center;">${icon}</td>
            </tr>
          </table>
        </td>
        ` : ""}
        <td style="padding:16px 16px 16px ${icon ? "4px" : "16px"};vertical-align:top;">
          <p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;font-weight:600;">${label}</p>
          <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#0F0F0F;">${value}</p>
          ${subtext ? `<p style="margin:4px 0 0;font-size:13px;color:#6B7280;line-height:1.5;">${subtext}</p>` : ""}
          ${linkUrl ? `<a href="${linkUrl}" style="display:inline-block;margin-top:8px;font-size:12px;color:#0F0F0F;font-weight:600;text-decoration:none;border-bottom:1px solid #0F0F0F;">${linkText}</a>` : ""}
        </td>
      </tr>
    </table>
  `;

  const storeRows = enrichedProducts
    .filter((p) => p.storeLocation)
    .map((p) =>
      renderInfoRow({
        icon: "", 
        label: `Pickup Location for ${p.productName}`,
        value: p.storeLocation.locationName,
        subtext: [
          p.storeLocation.address,
          p.storeLocation.phoneNumber,
        ]
          .filter(Boolean)
          .join(" · "),
        linkUrl: p.storeLocation.googleMapUrl,
        linkText: "View on Maps →",
      })
    );

  const paymentRow = renderInfoRow({
    icon: "",
    label: "Payment Method",
    value: formatPaymentMethod(paymentLabel),
  });

  const deliveryRow = renderInfoRow({
    icon: "",
    label: "Delivery Method",
    value: deliveryLabel,
  });

  const allRows = [...storeRows, paymentRow, deliveryRow];
  const infoRowsHtml = allRows
    .map((row, i) => (i === allRows.length - 1 ? row.replace("margin-bottom:10px;", "margin-bottom:0;") : row))
    .join("");

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
      <title>Order Confirmed #${orderId}</title>
    </head>
    <body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

              <tr>
                <td style="background:#0F0F0F;border-radius:16px 16px 0 0;padding:40px 40px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6B7280;">Your Store</p>
                        <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#FFFFFF;">Order Confirmed</h1>
                        <div style="display:inline-block;background:#1A1A1A;border:1px solid #2D2D2D;border-radius:8px;padding:12px 18px;">
                          <p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#6B7280;">Order ID</p>
                          <p style="margin:4px 0 0;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.02em;">#${orderId}</p>
                        </div>
                      </td>

                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="background:#FFFFFF;padding:32px 40px 0;">
                  <p style="margin:0;font-size:15px;color:#374151;line-height:1.6;">
                    Hi <strong style="color:#0F0F0F;">${shippingInfo?.fullName ?? "there"}</strong>,<br/>
                    Thanks for your order! Here's your receipt — show it in-store upon picking up. You have 72 hours to collect your order.
                  </p>
                </td>
              </tr>

              <tr>
                <td style="background:#FFFFFF;padding:24px 40px 0;">
                  <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#9CA3AF;font-weight:600;">Items</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <thead>
                      <tr>
                        <th style="padding:10px 0;text-align:left;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;font-weight:600;border-bottom:2px solid #0F0F0F;">Product</th>
                        <th style="padding:10px 0;text-align:center;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;font-weight:600;border-bottom:2px solid #0F0F0F;">Qty</th>
                        <th style="padding:10px 0;text-align:right;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;font-weight:600;border-bottom:2px solid #0F0F0F;">Price</th>
                        <th style="padding:10px 0;text-align:right;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#9CA3AF;font-weight:600;border-bottom:2px solid #0F0F0F;">Total</th>
                      </tr>
                    </thead>
                    <tbody>${itemRows}</tbody>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="background:#FFFFFF;padding:20px 40px 0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:7px 0;color:#6B7280;font-size:14px;">Subtotal</td>
                      <td style="padding:7px 0;text-align:right;color:#374151;font-size:14px;">$${formatCurrency(subtotal)}</td>
                    </tr>
                    <tr>
                      <td style="padding:7px 0;color:#6B7280;font-size:14px;">Delivery fee</td>
                      <td style="padding:7px 0;text-align:right;color:#374151;font-size:14px;">$${formatCurrency(deliveryFee)}</td>
                    </tr>
                    ${
                      pointsDiscount > 0
                        ? `<tr>
                      <td style="padding:7px 0;color:#16A34A;font-size:14px;">⭐ Points discount</td>
                      <td style="padding:7px 0;text-align:right;color:#16A34A;font-size:14px;font-weight:600;">−$${formatCurrency(pointsDiscount)}</td>
                    </tr>`
                        : ""
                    }
                    ${
                      firstOrderDiscount > 0
                        ? `<tr>
                      <td style="padding:7px 0;color:#16A34A;font-size:14px;">🎉 First order discount</td>
                      <td style="padding:7px 0;text-align:right;color:#16A34A;font-size:14px;font-weight:600;">−$${formatCurrency(firstOrderDiscount)}</td>
                    </tr>`
                        : ""
                    }
                    ${
                      discountCode && codeDiscount > 0
                        ? `<tr>
                      <td style="padding:7px 0;color:#16A34A;font-size:14px;">🏷️ Code <span style="font-family:monospace;background:#F0FDF4;padding:2px 6px;border-radius:4px;">${discountCode}</span></td>
                      <td style="padding:7px 0;text-align:right;color:#16A34A;font-size:14px;font-weight:600;">−$${formatCurrency(codeDiscount)}</td>
                    </tr>`
                        : ""
                    }
                  </table>
                </td>
              </tr>

              <tr>
                <td style="background:#FFFFFF;padding:16px 40px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid #0F0F0F;padding-top:16px;">
                    <tr>
                      <td style="padding-top:14px;font-size:16px;font-weight:700;color:#0F0F0F;letter-spacing:-0.01em;">Total charged</td>
                      <td style="padding-top:14px;text-align:right;font-size:22px;font-weight:800;color:#0F0F0F;letter-spacing:-0.02em;">$${formatCurrency(totalAmount)}</td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td style="background:#FFFFFF;padding:0 40px;">
                  <div style="height:1px;background:#F3F4F6;"></div>
                </td>
              </tr>

              <tr>
                <td style="background:#FFFFFF;padding:28px 40px 32px;">
                  <p style="margin:0 0 12px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#9CA3AF;font-weight:600;">Order Details</p>
                  ${infoRowsHtml}
                </td>
              </tr>

              <tr>
                <td style="background:#0F0F0F;border-radius:0 0 16px 16px;padding:24px 40px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin:0;font-size:13px;color:#6B7280;">Questions? Reply to this email or reach out to support.</p>
                      </td>
                      <td style="text-align:right;">
                        <p style="margin:0;font-size:12px;color:#4B5563;">© ${new Date().getFullYear()} Your Store</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>

    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"33student.com" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: `Order Confirmed #${orderId} 🎉`,
    html,
  });
}

module.exports = { sendOrderConfirmationEmail };