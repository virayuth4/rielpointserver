// httpSpinBot.js

const zingoPool = require("./database/pgZingo");

const PORT = process.env.PORT || 9000;
const BACKEND_URL =
  process.env.SPIN_BOT_URL ||
  `http://localhost:${PORT}/api/eatdoko/history/add`;

const MIN_DELAY_MS = 5 * 1000;
const MAX_DELAY_MS = 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // reload establishments hourly

let establishments = [];
let started = false;

async function loadEstablishments() {
  const query = `
    SELECT id, name, branch_location, logo_url
    FROM eatdoko_establishments
  `;
  const res = await zingoPool.query(query);
  establishments = res.rows;
  console.log(`Loaded ${establishments.length} establishments.`);
}

async function hitSpinRoute() {
  if (establishments.length === 0) return;

  const cafe =
    establishments[Math.floor(Math.random() * establishments.length)];

  const payload = {
    userId: "bot_user_simulation",
    id: cafe.id, // Maps to shop_id in your Express handler
    name: cafe.name,
    branch_location: cafe.branch_location ?? null,
    logo_url: cafe.logo_url ?? null,
  };

  try {
    const res = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log(`[${new Date().toISOString()}] HTTP ${res.status}:`, data);
  } catch (err) {
    console.error(
      "Error hitting history route:",
      err.message,
      err.cause?.code || err.cause || ""
    );
  }
}

function randomDelay() {
  return (
    MIN_DELAY_MS +
    Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1))
  );
}

function scheduleNextHit() {
  setTimeout(async () => {
    try {
      await hitSpinRoute();
    } catch (err) {
      console.error("Testing History hit failed:", err.message);
    } finally {
      scheduleNextHit(); // always queue the next one, even after an error
    }
  }, randomDelay());
}

async function startSpinBot() {
  if (started) return;
  started = true;

  try {
    await loadEstablishments();
  } catch (err) {
    // Don't let a bot failure take down your API
    console.error("Testing History failed to load establishments:", err.message);
    started = false;
    return;
  }

  // Refresh the list hourly so new/removed shops get picked up
  setInterval(() => {
    loadEstablishments().catch((err) =>
      console.error("Testing History refresh failed:", err.message)
    );
  }, REFRESH_INTERVAL_MS);

  scheduleNextHit();

  console.log(`Testing History target: ${BACKEND_URL}`);
  console.log(
    `Testing History running with a random ${MIN_DELAY_MS / 1000}-${
      MAX_DELAY_MS / 1000
    }s delay between hits.`
  );
}

module.exports = { startSpinBot };