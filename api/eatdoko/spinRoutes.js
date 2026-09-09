const express = require("express");
const zingoPool = require("../../database/pgZingo");
const router = express.Router();

router.post("/history/add", async (req, res) => {
  console.log("Eat Doko History Add Route Hit");

  try {
    const { userId, id, name, branch_location, logo_url, accentColor } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (!id || !name) {
      return res.status(400).json({ error: "cafe id and name are required" });
    }

    const result = await zingoPool.query(
      `INSERT INTO eat_doko_history
        (user_id, cafe_id, name, branch_location, logo_url, accent_color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [userId, id, name, branch_location ?? null, logo_url ?? null, accentColor ?? null]
    );

    return res.status(201).json({ success: true, entry: result.rows[0] });
  } catch (err) {
    console.error("Error adding history entry:", err);
    return res.status(500).json({ error: "Failed to add history entry" });
  }
});

module.exports = router;