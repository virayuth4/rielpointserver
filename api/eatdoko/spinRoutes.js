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
      `INSERT INTO eatdoko_history
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

router.patch("/history/:historyId/visited", async (req, res) => {
  console.log("Reacching eatdoko patch")
  try {
    const { historyId } = req.params;
    const { userId, visited } = req.body;
    console.log("History Id: ", historyId, "userId: ", userId, "visted: ", visited)

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (typeof visited !== "boolean") {
      return res.status(400).json({ error: "visited must be a boolean" });
    }

    const result = await zingoPool.query(
      `UPDATE eatdoko_history
         SET visited = $1,
             visited_at = CASE WHEN $1 THEN now() ELSE NULL END
       WHERE id = $2 AND user_id = $3
       RETURNING id, visited, visited_at`,
      [visited, historyId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "History entry not found" });
    }

    return res.status(200).json({ success: true, entry: result.rows[0] });
  } catch (err) {
    console.error("Error updating visited status:", err);
    return res.status(500).json({ error: "Failed to update visited status" });
  }
});

module.exports = router;