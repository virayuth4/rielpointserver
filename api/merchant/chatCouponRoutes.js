const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");
const crypto = require('crypto');
const { getMerchant } = require("../../lib/getMerchant");

router.post("/coupons/claim", async (req, res) => {
    console.log("coupon claim request body:", req.body);
  try {
    const { merchant_id, customer_number } = req.body;

    if (!merchant_id || !customer_number) {
      return res.status(400).json({ error: "merchant_id and customer_number are required" });
    }

    const merchant = await getMerchant(merchant_id);
    if (!merchant) {
      return res.status(404).json({ error: "Merchant not found" });
    }

    const code = `${merchant.coupon_prefix}-${customer_number}`;

    // Try to insert; if a row already exists for this merchant+customer, do nothing
    const insertResult = await zingoPool.query(
      `INSERT INTO chat_coupons (merchant_id, customer_number, code)
       VALUES ($1, $2, $3)
       ON CONFLICT (merchant_id, customer_number) DO NOTHING
       RETURNING code`,
      [merchant_id, customer_number, code]
    );

    if (insertResult.rows[0]) {
      return res.status(200).json({ code: insertResult.rows[0].code });
    }

    // Conflict happened — fetch the existing code instead
    const existing = await zingoPool.query(
      `SELECT code FROM chat_coupons WHERE merchant_id = $1 AND customer_number = $2`,
      [merchant_id, customer_number]
    );

    return res.status(200).json({ code: existing.rows[0].code });
  } catch (err) {
    console.error("Coupon claim error:", err);
    return res.status(500).json({ error: "Failed to claim coupon" });
  }
});

router.get("/coupons/:merchant_id", async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const { customer_number } = req.query;

    if (!customer_number) {
      return res.status(400).json({ error: "customer_number is required" });
    }

    const { rows } = await zingoPool.query(
      `SELECT code FROM chat_coupons WHERE merchant_id = $1 AND customer_number = $2`,
      [merchant_id, customer_number]
    );

    if (!rows[0]) {
      return res.status(404).json({ code: null });
    }

    return res.status(200).json({ code: rows[0].code });
  } catch (err) {
    console.error("Coupon fetch error:", err);
    return res.status(500).json({ error: "Failed to fetch coupon" });
  }
});

module.exports = router;