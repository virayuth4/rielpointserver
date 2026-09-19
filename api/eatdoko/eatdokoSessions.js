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

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------
function log(reqId, msg, extra) {
  const ts = new Date().toISOString();
  const prefix = `[eatdoko-session ${ts}]${reqId ? ` [${reqId}]` : ""}`;
  if (extra !== undefined) console.log(prefix, msg, extra);
  else console.log(prefix, msg);
}

function logError(reqId, msg, err) {
  const ts = new Date().toISOString();
  console.error(`[eatdoko-session ${ts}]${reqId ? ` [${reqId}]` : ""} ${msg}`, {
    message: err?.message,
    code: err?.code, // Postgres error code, e.g. 42P01 = table does not exist
    detail: err?.detail,
    status: err?.status, // Pusher HTTP status
    body: err?.body, // Pusher response body
    stack: err?.stack,
  });
}

// Log every request that hits this router: method, url, origin, body keys, status, timing.
// If bodyKeys prints null, express.json() isn't mounted before this router.
router.use((req, res, next) => {
  const reqId = nanoid(6);
  req.reqId = reqId;
  const start = Date.now();

  log(reqId, `-> ${req.method} ${req.originalUrl}`, {
    origin: req.headers.origin,
    contentType: req.headers["content-type"],
    bodyKeys: req.body ? Object.keys(req.body) : null,
  });

  res.on("finish", () => {
    log(reqId, `<- ${res.statusCode} ${req.method} ${req.originalUrl} (${Date.now() - start}ms)`);
  });

  next();
});

// One-time startup diagnostics: is the DB reachable, and does the table exist?
(async () => {
  try {
    await zingoPool.query("SELECT 1");
    log(null, "DB connection OK");

    const t = await zingoPool.query("SELECT to_regclass('public.eatdoko_sessions') AS tbl");
    if (t.rows[0].tbl) log(null, "Table eatdoko_sessions exists");
    else console.error("[eatdoko-session] Table eatdoko_sessions DOES NOT EXIST in this database");
  } catch (err) {
    logError(null, "Startup DB check failed", err);
  }

  log(null, "Env check", {
    NODE_ENV: process.env.NODE_ENV,
    hasDbUrl: Boolean(process.env.DATABASE_URL), // rename to whatever pgZingo uses
    hasPusherAppId: Boolean(process.env.PUSHER_APP_ID),
    hasPusherKey: Boolean(process.env.PUSHER_KEY),
    hasPusherSecret: Boolean(process.env.PUSHER_SECRET),
    hasPusherCluster: Boolean(process.env.PUSHER_CLUSTER),
  });
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// POST /api/eatdoko/session/create
// ---------------------------------------------------------------------------
router.post("/session/create", async (req, res) => {
  const { reqId } = req;
  const { branch_location, selected_type } = req.body || {};
  const id = nanoid(8);

  log(reqId, "Creating session", { id, branch_location, selected_type });

  try {
    await zingoPool.query(
      `INSERT INTO eatdoko_sessions (id, branch_location, selected_type)
       VALUES ($1, $2, $3)`,
      [id, branch_location ?? "ALL", selected_type ?? "cafe"]
    );
    log(reqId, "Session created", { id });
    res.json({ id });
  } catch (err) {
    logError(reqId, "Failed to create session", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/eatdoko/session/:id
// ---------------------------------------------------------------------------
router.get("/session/:id", async (req, res) => {
  const { reqId } = req;

  try {
    const result = await zingoPool.query(
      `SELECT * FROM eatdoko_sessions WHERE id = $1`,
      [req.params.id]
    );
    const session = result.rows[0];

    if (!session) {
      log(reqId, "Session not found", { id: req.params.id });
      return res.status(404).json({ error: "Not found" });
    }

    const elapsed = session.started_at
      ? Date.now() - new Date(session.started_at).getTime()
      : null;

    const inProgress = Boolean(
      session.spinning && session.spin_state && elapsed < session.spin_state.duration
    );

    log(reqId, "Session state", {
      id: req.params.id,
      spinning: session.spinning,
      elapsedMs: elapsed,
      inProgress,
    });

    res.json({
      branch_location: session.branch_location,
      selected_type: session.selected_type,
      spinning: inProgress,
      winner_store_id: session.winner_store_id,
      started_at: session.started_at ? new Date(session.started_at).getTime() : null,
      ...(session.spin_state || {}),
    });
  } catch (err) {
    logError(reqId, "Failed to fetch session", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/eatdoko/session/:id/spin
// ---------------------------------------------------------------------------
router.post("/session/:id/spin", async (req, res) => {
  const { reqId } = req;
  const { reel, winnerId, targetOffset, socketId } = req.body || {};

  log(reqId, "Spin requested", {
    sessionId: req.params.id,
    reelLength: Array.isArray(reel) ? reel.length : null,
    winnerId,
    targetOffset,
    socketId,
  });

  if (!Array.isArray(reel) || reel.length === 0 || winnerId == null) {
    log(reqId, "Rejected: invalid spin payload");
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
      // Either the session doesn't exist, or a spin is already running. Tell them apart.
      const existing = await zingoPool.query(
        `SELECT spinning, started_at FROM eatdoko_sessions WHERE id = $1`,
        [req.params.id]
      );
      log(
        reqId,
        existing.rowCount === 0
          ? "Spin rejected: session does not exist"
          : "Spin rejected: spin already in progress",
        existing.rows[0]
      );
      return res.status(409).json({ error: "Spin already in progress" });
    }

    const payload = { ...spinState, winner_store_id: winnerId };
    res.json({ ok: true, ...payload });

    // Exclude the initiator's socket; they already animated optimistically.
    const channel = `session-${req.params.id}`;
    log(reqId, "Triggering Pusher", { channel, excludingSocket: socketId || null });

    pusherServer
      .trigger(channel, "spin", payload, socketId ? { socket_id: socketId } : undefined)
      .then(() => log(reqId, "Pusher trigger OK", { channel }))
      .catch((err) => logError(reqId, "Pusher trigger failed", err));
  } catch (err) {
    logError(reqId, "Failed to trigger spin", err);
    res.status(500).json({ error: "Failed to trigger spin" });
  }
});

module.exports = router;