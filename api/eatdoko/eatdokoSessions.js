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

/* =========================================================
   Helpers
========================================================= */

function shuffledCopy(arr) {
  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function buildReelAndWinner(cafeIds) {
  if (!Array.isArray(cafeIds) || cafeIds.length === 0) {
    throw new Error("buildReelAndWinner received empty cafeIds");
  }

  const laps = Math.ceil(REEL_SIZE / cafeIds.length);

  let reel = Array.from(
    { length: laps },
    () => shuffledCopy(cafeIds)
  ).flat();

  reel = reel.slice(0, REEL_SIZE);

  const winnerId = reel[WINNER_INDEX];

  const jitter =
    (Math.random() - 0.5) * (CARD_WIDTH - 28);

  const targetOffset =
    -(WINNER_INDEX * TOTAL_SLOT_WIDTH + jitter);

  return {
    reel,
    winnerId,
    targetOffset,
  };
}

/* =========================================================
   POST /api/eatdoko/session/create
========================================================= */

router.post("/session/create", async (req, res) => {
  const { branch_location, selected_type } = req.body || {};

  const id = nanoid(8);

  try {
    const result = await zingoPool.query(
      `INSERT INTO eatdoko_sessions 
       (id, branch_location, selected_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        id,
        branch_location ?? "ALL",
        selected_type ?? "cafe",
      ]
    );

    res.json({ id });
  } catch (err) {
    res.status(500).json({
      error: "Failed to create session",
      details: err.message,
    });
  }
});

/* =========================================================
   GET /api/eatdoko/session/:id
========================================================= */

router.get("/session/:id", async (req, res) => {
  const sessionId = req.params.id;

  try {
    const result = await zingoPool.query(
      `SELECT * 
       FROM eatdoko_sessions 
       WHERE id = $1`,
      [sessionId]
    );

    const session = result.rows[0];

    if (!session) {
      return res.status(404).json({
        error: "Not found",
      });
    }

    const inProgress =
      session.spinning &&
      session.spin_state &&
      Date.now() -
        new Date(session.started_at).getTime() <
        session.spin_state.duration;

    const response = {
      branch_location: session.branch_location,
      selected_type: session.selected_type,
      spinning: inProgress,
      winner_store_id: session.winner_store_id,
      started_at: session.started_at
        ? new Date(session.started_at).getTime()
        : null,
      ...(session.spin_state || {}),
    };

    res.json(response);
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch session",
      details: err.message,
    });
  }
});

/* =========================================================
   POST /api/eatdoko/session/:id/spin
========================================================= */

router.post("/session/:id/spin", async (req, res) => {
  const sessionId = req.params.id;

  const { availableCafeIds } = req.body || {};

  if (
    !Array.isArray(availableCafeIds) ||
    availableCafeIds.length === 0
  ) {
    return res.status(400).json({
      error: "No cafes available",
    });
  }

  let reel;
  let winnerId;
  let targetOffset;

  try {
    ({
      reel,
      winnerId,
      targetOffset,
    } = buildReelAndWinner(availableCafeIds));
  } catch (err) {
    return res.status(500).json({
      error: "Failed to build spin reel",
      details: err.message,
    });
  }

  const spinState = {
    reel,
    targetOffset,
    duration: SPIN_DURATION,
  };

  try {
    const result = await zingoPool.query(
      `UPDATE eatdoko_sessions
       SET spinning = true,
           spin_state = $1,
           winner_store_id = $2,
           started_at = now(),
           last_active_at = now()
       WHERE id = $3
         AND (
           spinning = false
           OR started_at < now() - interval '6 seconds'
         )
       RETURNING *`,
      [
        spinState,
        winnerId,
        sessionId,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({
        error: "Spin already in progress",
      });
    }

    const payload = {
      ...spinState,
      winner_store_id: winnerId,
    };

    try {
      await pusherServer.trigger(
        `session-${sessionId}`,
        "spin",
        payload
      );
    } catch (pusherErr) {
      // We don't fail the HTTP request here because
      // the database spin was already created.
    }

    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to trigger spin",
      details: err.message,
    });
  }
});

module.exports = router;