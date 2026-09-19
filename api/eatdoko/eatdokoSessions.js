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
  console.log("[shuffledCopy] Input length:", arr.length);

  const a = [...arr];

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }

  return a;
}

function buildReelAndWinner(cafeIds) {
  console.log("[buildReelAndWinner] cafeIds:", cafeIds);
  console.log("[buildReelAndWinner] cafe count:", cafeIds.length);

  if (!Array.isArray(cafeIds) || cafeIds.length === 0) {
    throw new Error("buildReelAndWinner received empty cafeIds");
  }

  const laps = Math.ceil(REEL_SIZE / cafeIds.length);

  console.log("[buildReelAndWinner] laps:", laps);

  let reel = Array.from(
    { length: laps },
    () => shuffledCopy(cafeIds)
  ).flat();

  reel = reel.slice(0, REEL_SIZE);

  console.log("[buildReelAndWinner] reel length:", reel.length);
  console.log("[buildReelAndWinner] reel:", reel);

  const winnerId = reel[WINNER_INDEX];

  console.log("[buildReelAndWinner] winnerId:", winnerId);

  const jitter =
    (Math.random() - 0.5) * (CARD_WIDTH - 28);

  const targetOffset =
    -(WINNER_INDEX * TOTAL_SLOT_WIDTH + jitter);

  console.log("[buildReelAndWinner] jitter:", jitter);
  console.log("[buildReelAndWinner] targetOffset:", targetOffset);

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
  console.log("\n========================================");
  console.log("[SESSION CREATE] Request received");
  console.log("[SESSION CREATE] Body:", req.body);
  console.log("========================================");

  const { branch_location, selected_type } = req.body || {};

  const id = nanoid(8);

  console.log("[SESSION CREATE] Generated session ID:", id);
  console.log("[SESSION CREATE] branch_location:", branch_location);
  console.log("[SESSION CREATE] selected_type:", selected_type);

  try {
    console.log("[SESSION CREATE] Inserting into database...");

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

    console.log("[SESSION CREATE] Database insert successful");
    console.log("[SESSION CREATE] Created row:", result.rows[0]);

    res.json({ id });

    console.log("[SESSION CREATE] Response sent");
  } catch (err) {
    console.error("[SESSION CREATE] FAILED");
    console.error("[SESSION CREATE] Error message:", err.message);
    console.error("[SESSION CREATE] Error stack:", err.stack);

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

  console.log("\n========================================");
  console.log("[SESSION GET] Request received");
  console.log("[SESSION GET] Session ID:", sessionId);
  console.log("========================================");

  try {
    console.log("[SESSION GET] Querying database...");

    const result = await zingoPool.query(
      `SELECT * 
       FROM eatdoko_sessions 
       WHERE id = $1`,
      [sessionId]
    );

    console.log(
      "[SESSION GET] Database rows:",
      result.rowCount
    );

    const session = result.rows[0];

    if (!session) {
      console.log(
        "[SESSION GET] Session NOT FOUND:",
        sessionId
      );

      return res.status(404).json({
        error: "Not found",
      });
    }

    console.log("[SESSION GET] Session found:", {
      id: session.id,
      branch_location: session.branch_location,
      selected_type: session.selected_type,
      spinning: session.spinning,
      winner_store_id: session.winner_store_id,
      started_at: session.started_at,
      spin_state: session.spin_state,
    });

    const inProgress =
      session.spinning &&
      session.spin_state &&
      Date.now() -
        new Date(session.started_at).getTime() <
        session.spin_state.duration;

    console.log(
      "[SESSION GET] Calculated inProgress:",
      inProgress
    );

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

    console.log("[SESSION GET] Sending response:", response);

    res.json(response);
  } catch (err) {
    console.error("[SESSION GET] FAILED");
    console.error("[SESSION GET] Error message:", err.message);
    console.error("[SESSION GET] Error stack:", err.stack);

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

  console.log("\n========================================");
  console.log("[SESSION SPIN] Request received");
  console.log("[SESSION SPIN] Session ID:", sessionId);
  console.log("[SESSION SPIN] Body:", req.body);
  console.log("========================================");

  const { availableCafeIds } = req.body || {};

  console.log(
    "[SESSION SPIN] availableCafeIds:",
    availableCafeIds
  );

  console.log(
    "[SESSION SPIN] availableCafeIds type:",
    typeof availableCafeIds
  );

  console.log(
    "[SESSION SPIN] Is array:",
    Array.isArray(availableCafeIds)
  );

  console.log(
    "[SESSION SPIN] Cafe count:",
    Array.isArray(availableCafeIds)
      ? availableCafeIds.length
      : 0
  );

  if (
    !Array.isArray(availableCafeIds) ||
    availableCafeIds.length === 0
  ) {
    console.error(
      "[SESSION SPIN] FAILED: No cafes available"
    );

    return res.status(400).json({
      error: "No cafes available",
    });
  }

  let reel;
  let winnerId;
  let targetOffset;

  try {
    console.log(
      "[SESSION SPIN] Building reel..."
    );

    ({
      reel,
      winnerId,
      targetOffset,
    } = buildReelAndWinner(availableCafeIds));

    console.log("[SESSION SPIN] Reel created");
    console.log("[SESSION SPIN] Winner:", winnerId);
    console.log(
      "[SESSION SPIN] Target offset:",
      targetOffset
    );
  } catch (err) {
    console.error(
      "[SESSION SPIN] Failed while building reel"
    );
    console.error(
      "[SESSION SPIN] Error message:",
      err.message
    );
    console.error(
      "[SESSION SPIN] Error stack:",
      err.stack
    );

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

  console.log(
    "[SESSION SPIN] spinState:",
    spinState
  );

  try {
    console.log(
      "[SESSION SPIN] Updating database..."
    );

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

    console.log(
      "[SESSION SPIN] Database update rowCount:",
      result.rowCount
    );

    if (result.rowCount === 0) {
      console.error(
        "[SESSION SPIN] Database update affected 0 rows"
      );

      console.error(
        "[SESSION SPIN] Possible reasons:"
      );
      console.error(
        "1. Session does not exist"
      );
      console.error(
        "2. Spin is already in progress"
      );
      console.error(
        "3. started_at is within the last 6 seconds"
      );

      return res.status(409).json({
        error: "Spin already in progress",
      });
    }

    console.log(
      "[SESSION SPIN] Database update successful"
    );

    const updatedSession = result.rows[0];

    console.log(
      "[SESSION SPIN] Updated session:",
      updatedSession
    );

    const payload = {
      ...spinState,
      winner_store_id: winnerId,
    };

    console.log(
      "[SESSION SPIN] Pusher payload:",
      payload
    );

    console.log(
      "[SESSION SPIN] Triggering Pusher..."
    );

    try {
      const pusherResult = await pusherServer.trigger(
        `session-${sessionId}`,
        "spin",
        payload
      );

      console.log(
        "[SESSION SPIN] Pusher trigger successful:",
        pusherResult
      );
    } catch (pusherErr) {
      console.error(
        "[SESSION SPIN] PUSHER FAILED"
      );
      console.error(
        "[SESSION SPIN] Pusher error message:",
        pusherErr.message
      );
      console.error(
        "[SESSION SPIN] Pusher error stack:",
        pusherErr.stack
      );

      // We don't fail the HTTP request here because
      // the database spin was already created.
    }

    console.log(
      "[SESSION SPIN] Sending HTTP response..."
    );

    res.json({
      ok: true,
      ...payload,
    });

    console.log(
      "[SESSION SPIN] Response sent successfully"
    );
  } catch (err) {
    console.error(
      "[SESSION SPIN] DATABASE / SERVER FAILED"
    );
    console.error(
      "[SESSION SPIN] Error message:",
      err.message
    );
    console.error(
      "[SESSION SPIN] Error stack:",
      err.stack
    );
    console.error(
      "[SESSION SPIN] Full error:",
      err
    );

    res.status(500).json({
      error: "Failed to trigger spin",
      details: err.message,
    });
  }
});

module.exports = router;