const express = require("express");
const { nanoid } = require("nanoid");
const zingoPool = require("../../database/pgZingo");
const pusherServer = require("../../lib/pusher");
const router = express.Router();
require("dotenv").config();

const SPIN_DURATION = 5200;

// POST /api/eatdoko/session/create
router.post("/session/create", async (req, res) => {
  const { branch_location, selected_type, excluded_ids } = req.body || {};
  const id = nanoid(8);
  const initialExcluded = Array.isArray(excluded_ids) ? excluded_ids.map(String) : [];

  try {
    await zingoPool.query(
      `INSERT INTO eatdoko_sessions (id, branch_location, selected_type, excluded_ids)
       VALUES ($1, $2, $3, $4)`,
      [id, branch_location ?? "ALL", selected_type ?? "cafe", initialExcluded]
    );
    res.json({ id });
  } catch (err) {
    console.error("Failed to create session:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// GET /api/eatdoko/session/:id
router.get("/session/:id", async (req, res) => {
  try {
    const result = await zingoPool.query(
      `SELECT * FROM eatdoko_sessions WHERE id = $1`,
      [req.params.id]
    );
    const session = result.rows[0];
    if (!session) return res.status(404).json({ error: "Not found" });

    const inProgress =
      session.spinning &&
      session.spin_state &&
      Date.now() - new Date(session.started_at).getTime() < session.spin_state.duration;

    res.json({
      branch_location: session.branch_location,
      selected_type: session.selected_type,
      excluded_ids: session.excluded_ids || [],
      spinning: inProgress,
      winner_store_id: session.winner_store_id,
      started_at: session.started_at ? new Date(session.started_at).getTime() : null,
      ...(session.spin_state || {}),
    });
  } catch (err) {
    console.error("Failed to fetch session:", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// POST /api/eatdoko/session/:id/exclude
router.post("/session/:id/exclude", async (req, res) => {
  const { cafeId } = req.body || {};
  if (cafeId == null) return res.status(400).json({ error: "cafeId required" });
  const cid = String(cafeId);

  try {
    // Atomic append (no duplicates), so two people excluding at once don't clobber each other
    const result = await zingoPool.query(
      `UPDATE eatdoko_sessions
       SET excluded_ids = CASE
             WHEN $1 = ANY(excluded_ids) THEN excluded_ids
             ELSE array_append(excluded_ids, $1)
           END,
           last_active_at = now()
       WHERE id = $2
       RETURNING excluded_ids`,
      [cid, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });

    const excluded_ids = result.rows[0].excluded_ids;
    res.json({ ok: true, excluded_ids });

    pusherServer
      .trigger(`session-${req.params.id}`, "exclude", { excluded_ids })
      .catch((err) => console.error("Pusher trigger failed:", err));
  } catch (err) {
    console.error("Failed to exclude:", err);
    res.status(500).json({ error: "Failed to exclude" });
  }
});

// POST /api/eatdoko/session/:id/exclude/reset
router.post("/session/:id/exclude/reset", async (req, res) => {
  try {
    const result = await zingoPool.query(
      `UPDATE eatdoko_sessions
       SET excluded_ids = '{}', last_active_at = now()
       WHERE id = $1
       RETURNING excluded_ids`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Not found" });

    const excluded_ids = result.rows[0].excluded_ids;
    res.json({ ok: true, excluded_ids });

    pusherServer
      .trigger(`session-${req.params.id}`, "exclude", { excluded_ids })
      .catch((err) => console.error("Pusher trigger failed:", err));
  } catch (err) {
    console.error("Failed to reset exclusions:", err);
    res.status(500).json({ error: "Failed to reset exclusions" });
  }
});

// POST /api/eatdoko/session/:id/spin
router.post("/session/:id/spin", async (req, res) => {
  const { reel, winnerId, targetOffset } = req.body || {};
  if (!Array.isArray(reel) || reel.length === 0 || winnerId == null) {
    return res.status(400).json({ error: "Invalid spin payload" });
  }

  const spinState = { reel, targetOffset, duration: SPIN_DURATION };

  try {
    const result = await zingoPool.query(
      `UPDATE eatdoko_sessions
       SET spinning = true, spin_state = $1, winner_store_id = $2,
           started_at = now(), last_active_at = now()
       WHERE id = $3 AND (spinning = false OR started_at < now() - interval '6 seconds')
       RETURNING *`,
      [spinState, winnerId, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Spin already in progress" });
    }

    const payload = { ...spinState, winner_store_id: winnerId };
    res.json({ ok: true, ...payload });

    pusherServer
      .trigger(`session-${req.params.id}`, "spin", payload)
      .catch((err) => console.error("Pusher trigger failed:", err));
  } catch (err) {
    console.error("Failed to trigger spin:", err);
    res.status(500).json({ error: "Failed to trigger spin" });
  }
});

module.exports = router;