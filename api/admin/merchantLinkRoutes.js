// api/admin/merchantLinkRoutes.js
const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const zingoPool = require("../../database/pgZingo");

function generateCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase(); // e.g. "A1B2C3D4"
}

router.post("/merchants/:merchant_id/generate-link-code", async (req, res) => {
  try {
    const { merchant_id } = req.params;
    const code = generateCode();
    const expires_at = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await zingoPool.query(
      `INSERT INTO merchant_link_codes (merchant_id, code, expires_at) VALUES ($1, $2, $3)`,
      [merchant_id, code, expires_at]
    );

    return res.status(200).json({ code, expires_at });
  } catch (err) {
    console.error("Link code generation error:", err);
    return res.status(500).json({ error: "Failed to generate link code" });
  }
});

module.exports = router;