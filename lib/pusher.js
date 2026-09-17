const Pusher = require("pusher");

console.log("Constructing Pusher client with:", {
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET ? "SET" : "MISSING",
  cluster: process.env.PUSHER_CLUSTER,
});

const pusherServer = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

module.exports = pusherServer;