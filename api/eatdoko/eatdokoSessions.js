const express = require("express");
const { nanoid } = require("nanoid");
const zingoPool = require("../../database/pgZingo");
const pusherServer = require("../../lib/pusher");
const router = express.Router();
require("dotenv").config();


const REEL_SIZE = 65;
const WINNER_INDEX = 50;
const CARD_WIDTH = 180;
const CARD_GAP = 12;
const TOTAL_SLOT_WIDTH = CARD_WIDTH + CARD_GAP;
const SPIN_DURATION = 5200;

function shuffledCopy(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildReelAndWinner(cafeIds) {
  const laps = Math.ceil(REEL_SIZE / cafeIds.length);
  let reel = Array.from({ length: laps }, () => shuffledCopy(cafeIds)).flat();
  reel = reel.slice(0, REEL_SIZE);

  const winnerId = reel[WINNER_INDEX];
  const jitter = (Math.random() - 0.5) * (CARD_WIDTH - 28);
  const targetOffset = -(WINNER_INDEX * TOTAL_SLOT_WIDTH + jitter);

  return { reel, winnerId, targetOffset };
}

// POST /api/eatdoko/session/create
router.post("/session/create", async (req, res) => {
  const { branch_location, selected_type } = req.body || {};
  const id = nanoid(8);

  try {
    await zingoPool.query(
      `INSERT INTO eatdoko_sessions (id, branch_location, selected_type)
       VALUES ($1, $2, $3)`,
      [id, branch_location ?? "ALL", selected_type ?? "cafe"]
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
      spinning: inProgress,
      winner_store_id: session.winner_store_id,
      started_at: session.started_at ? new Date(session.started_at).getTime() : null,
      ...(session.spin_state || {}),
    });
  } catch (err) {router.post("/session/:id/spin", async (req, res) => {
  const { availableCafeIds } = req.body || {};
  if (!Array.isArray(availableCafeIds) || availableCafeIds.length === 0) {
    return res.status(400).json({ error: "No cafes available" });
  }

  const { reel, winnerId, targetOffset } = buildReelAndWinner(availableCafeIds);
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

    pusherServer.trigger(`session-${req.params.id}`, "spin", payload, socketId ? { socket_id: socketId } : undefined)

    res.json({ ok: true, ...payload }); // CHANGED — return the payload directly
  } catch (err) {
    console.error("Failed to trigger spin:", err);
    res.status(500).json({ error: "Failed to trigger spin" });
  }
});
    console.error("Failed to fetch session:", err);
    res.status(500).json({ error: "Failed to fetch session" });
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