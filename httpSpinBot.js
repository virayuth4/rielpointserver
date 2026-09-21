// httpSpinBot.js

const zingoPool = require("./database/pgZingo");

const PORT = process.env.PORT || 9000;
const BACKEND_URL =
  process.env.SPIN_BOT_URL ||
  `http://localhost:${PORT}/api/eatdoko/history/add`;

// ---- Behaviour tuning ------------------------------------------------------
const WINDOW_MS = 60 * 1000; // one "minute" of activity
const SESSIONS_PER_WINDOW = { min: 1, max: 2 }; // sessions started per window
const ROLLS_PER_SESSION = { min: 2, max: 5 }; // spins per session
const ROLL_GAP_MS = 5 * 1000; // pause between spins inside a session
const ROLL_GAP_JITTER_MS = 500; // +/- jitter so timing isn't robotic (0 = off)
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // reload establishments hourly

// Longest a session can take (used to spread sessions inside a window)
const MAX_SESSION_MS =
  (ROLLS_PER_SESSION.max - 1) * (ROLL_GAP_MS + ROLL_GAP_JITTER_MS);

// category -> [establishment rows]
let establishmentsByCategory = new Map();
let started = false;
let currentRun = 0; // bumped on every start so stale loops can detect they're dead
let refreshTimer = null;
let sleepTimer = null;
let wakeSleeper = null;

// ---- Helpers ---------------------------------------------------------------
function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Pick a random item, avoiding an immediate repeat of the previous one
function pickAvoiding(pool, previous) {
  if (pool.length < 2) return pool[0];
  let choice;
  do {
    choice = pick(pool);
  } while (choice === previous);
  return choice;
}

function rollGap() {
  return ROLL_GAP_MS + randInt(-ROLL_GAP_JITTER_MS, ROLL_GAP_JITTER_MS);
}

// Cancellable sleep so stopSpinBot() takes effect immediately
function sleep(ms) {
  return new Promise((resolve) => {
    wakeSleeper = resolve;
    sleepTimer = setTimeout(() => {
      wakeSleeper = null;
      resolve();
    }, Math.max(0, ms));
  });
}

// ---- Data ------------------------------------------------------------------
async function loadEstablishments() {
  // NOTE: assumes eatdoko_establishments has a `category` column.
  // Rename it here if your column is called something else.
  const query = `
    SELECT id, name, branch_location, logo_url, category
    FROM eatdoko_establishments
  `;
  const res = await zingoPool.query(query);

  const grouped = new Map();
  for (const row of res.rows) {
    const category =
      typeof row.category === "string" ? row.category.trim() : row.category;
    if (!category) continue; // can't pick by category without one

    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(row);
  }

  establishmentsByCategory = grouped;
  console.log(
    `Loaded ${res.rows.length} establishments across ${grouped.size} categories: ${[
      ...grouped.keys(),
    ].join(", ")}`
  );
}

// ---- Bot actions -----------------------------------------------------------
async function hitSpinRoute(cafe, category) {
  const payload = {
    userId: "bot_user_simulation",
    id: cafe.id, // Maps to shop_id in your Express handler
    name: cafe.name,
    branch_location: cafe.branch_location ?? null,
    logo_url: cafe.logo_url ?? null,
    category,
  };

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log(
      `[${new Date().toISOString()}] [${category}] ${cafe.name} -> HTTP ${res.status}:`,
      data
    );
  } catch (err) {
    console.error(
      "Error hitting history route:",
      err.message,
      err.cause?.code || err.cause || ""
    );
  }
}

// One "person" opens the app, picks a category and spins 2-5 times in it
async function runSession(isActive) {
  const categories = [...establishmentsByCategory.keys()];
  if (categories.length === 0) return;

  const category = pick(categories);
  const pool = establishmentsByCategory.get(category);
  const rolls = randInt(ROLLS_PER_SESSION.min, ROLLS_PER_SESSION.max);

  console.log(`Session: ${rolls} spins in category "${category}"`);

  let previous = null;
  for (let i = 0; i < rolls; i++) {
    if (!isActive()) return;

    const cafe = pickAvoiding(pool, previous);
    previous = cafe;
    await hitSpinRoute(cafe, category);

    if (i < rolls - 1) await sleep(rollGap());
  }
}

// Every minute: 1-2 sessions at random moments, never overlapping
async function runLoop(runId) {
  const isActive = () => started && runId === currentRun;

  while (isActive()) {
    const windowStart = Date.now();
    const sessions = randInt(SESSIONS_PER_WINDOW.min, SESSIONS_PER_WINDOW.max);
    const slotMs = WINDOW_MS / sessions;
    const slack = Math.max(0, slotMs - MAX_SESSION_MS);

    for (let i = 0; i < sessions; i++) {
      const startAt = windowStart + i * slotMs + randInt(0, slack);
      await sleep(startAt - Date.now());
      if (!isActive()) return;

      try {
        await runSession(isActive);
      } catch (err) {
        console.error("Testing History session failed:", err.message);
      }
    }

    if (!isActive()) return;
    await sleep(windowStart + WINDOW_MS - Date.now()); // wait out the minute
  }
}

// ---- Lifecycle -------------------------------------------------------------
async function startSpinBot() {
  if (started) return;
  started = true;
  const runId = ++currentRun;

  try {
    await loadEstablishments();
  } catch (err) {
    console.error("Testing History failed to load establishments:", err.message);
    started = false;
    return;
  }

  // stopSpinBot() (or a newer start) happened during the load
  if (!started || runId !== currentRun) return;

  refreshTimer = setInterval(() => {
    loadEstablishments().catch((err) =>
      console.error("Testing History refresh failed:", err.message)
    );
  }, REFRESH_INTERVAL_MS);

  runLoop(runId).catch((err) =>
    console.error("Testing History loop crashed:", err.message)
  );

  console.log(`Testing History target: ${BACKEND_URL}`);
  console.log(
    `Testing History running: ${SESSIONS_PER_WINDOW.min}-${SESSIONS_PER_WINDOW.max} sessions/min, ` +
      `${ROLLS_PER_SESSION.min}-${ROLLS_PER_SESSION.max} spins per session, ` +
      `~${ROLL_GAP_MS / 1000}s between spins.`
  );
}

function stopSpinBot() {
  if (!started) return;
  started = false;
  clearInterval(refreshTimer);
  clearTimeout(sleepTimer);
  refreshTimer = null;
  sleepTimer = null;

  if (wakeSleeper) {
    const wake = wakeSleeper;
    wakeSleeper = null;
    wake(); // let the loop notice it's stopped and exit
  }

  console.log("Testing History stopped.");
}

module.exports = { startSpinBot, stopSpinBot };