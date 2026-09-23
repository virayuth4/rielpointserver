const express = require("express");
const zingoPool = require("../../database/pgZingo");
const { admin, auth } = require('../../auth/firebase-admin');
const NodeCache = require("node-cache");
const axios = require("axios");
const router = express.Router();
const authenticateFirebaseToken = require('../../auth/authFirebaseToken');
const { normalizePhoneNumber } = require("../../lib/normalizePhoneNumber");
const crypto = require('crypto');
const { upload, uploadFileToS3, deleteFileFromS3, uploadMediaFilesToS3 } = require("../../database/s3");
const multer = require('multer');
const { sanitizeProductDescription } = require("../../utils/sanatizeHtml");
const { invalidateFeedCache } = require("../../utils/feedCacheService");

async function recordEvent({ userId, eventType, shopId = null, properties = {} }) {
  await zingoPool.query(
    `INSERT INTO eatdoko_events (user_id, event_type, shop_id, properties)
     VALUES ($1, $2, $3, $4)`,
    [userId, eventType, shopId, JSON.stringify(properties)]
  );
}

router.post("/events/map", async (req, res) => {
  console.log("Logging events");
  try {
    const { userId, id, name, branch_location, action, isPartner, source } = req.body;
    console.log("req.body", req.body);

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }a
    if (!id || !name) {
      return res.status(400).json({ error: "cafe id and name are required" });
    }

    const validActions = ["map", "call", "telegram"];
    const resolvedAction = validActions.includes(action) ? action : "map";

    const eventTypeByAction = {
      map: "map_click",
      call: "call_click",
      telegram: "telegram_click",
    };

    await recordEvent({
      userId,
      eventType: eventTypeByAction[resolvedAction],
      shopId: String(id),
      properties: {
        name,
        branch_location: branch_location ?? null,
        isPartner: !!isPartner,
        source: source ?? "spin",
      },
    });

    return res.sendStatus(204);
  } catch (err) {
    console.error("Error recording event click:", err);
    return res.status(500).json({ error: "Failed to record event click" });
  }
});
module.exports = router;