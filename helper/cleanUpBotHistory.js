const cron = require("node-cron");
const zingoPool = require("../database/pgZingo");

function startBotHistoryCleanup() {
  cron.schedule(
    "0 0 * * *",
    async () => {
      console.log("Running bot history cleanup...");
      try {
        const result = await zingoPool.query(
          `DELETE FROM eatdoko_history WHERE user_id = $1`,
          ["bot_user_simulation"]
        );
        console.log(`Bot history cleanup done. Deleted ${result.rowCount} rows.`);
      } catch (err) {
        console.error("Error in bot history cleanup:", err);
      }
    },
    { timezone: "Asia/Phnom_Penh" }
  );
}

module.exports = startBotHistoryCleanup;