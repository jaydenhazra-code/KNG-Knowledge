require("dotenv").config();

const express = require("express");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Events,
} = require("discord.js");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configuration ────────────────────────────────────

const GUILD_ID = process.env.DISCORD_GUILD_ID;
const APPY_CHANNEL_ID = process.env.APPY_CHANNEL_ID;

const ACCEPT_MARKERS = (process.env.ACCEPT_MARKERS ||
  "application accepted,accepted application,application approved,accepted")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const DENY_MARKERS = (process.env.DENY_MARKERS ||
  "application denied,denied application,application rejected,rejected,denied")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ─── Dashboard stats ──────────────────────────────────

const stats = {
  total: Number(process.env.BASELINE_TOTAL || 2766),
  accepted: Number(process.env.BASELINE_ACCEPTED || 1098),
  denied: Number(process.env.BASELINE_DENIED || 1651),
  pending: Number(process.env.BASELINE_PENDING || 17),
};

const startedAt = new Date().toISOString();
let botOnline = false;
let lastDiscordEvent = null;
let discordError = null;

// Track message IDs to avoid counting updates as new applications.
const trackedMessages = new Map();

// ─── Discord bot ──────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function classifyMessage(content) {
  const text = String(content || "").toLowerCase();

  if (ACCEPT_MARKERS.some((marker) => text.includes(marker))) {
    return "accepted";
  }

  if (DENY_MARKERS.some((marker) => text.includes(marker))) {
    return "denied";
  }

  return null;
}

function updateStatsForMessage(message, isNew = false) {
  if (!message || message.author?.bot === false) {
    // Continue processing ordinary messages too.
  }

  if (message.channelId !== APPY_CHANNEL_ID) return;
  if (GUILD_ID && message.guildId !== GUILD_ID) return;

  const messageId = message.id;
  const newStatus = classifyMessage(message.content);
  const previousStatus = trackedMessages.get(messageId);

  if (isNew && !previousStatus) {
    stats.total += 1;
    stats.pending += 1;
  }

  if (previousStatus === newStatus) return;

  if (previousStatus === "accepted") stats.accepted -= 1;
  if (previousStatus === "denied") stats.denied -= 1;

  if (newStatus === "accepted") {
    stats.accepted += 1;
    stats.pending = Math.max(0, stats.pending - 1);
  } else if (newStatus === "denied") {
    stats.denied += 1;
    stats.pending = Math.max(0, stats.pending - 1);
  }

  trackedMessages.set(messageId, newStatus);
  lastDiscordEvent = new Date().toISOString();
}

client.once(Events.ClientReady, (readyClient) => {
  botOnline = true;
  discordError = null;

  console.log(`Discord bot logged in as ${readyClient.user.tag}`);
  console.log(`Watching Appy channel: ${APPY_CHANNEL_ID}`);
  console.log(`Guild: ${GUILD_ID}`);
});

client.on(Events.MessageCreate, (message) => {
  updateStatsForMessage(message, true);
});

client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
  updateStatsForMessage(newMessage, false);
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
  discordError = error.message;
});

// ─── API routes ───────────────────────────────────────

app.get("/api/stats", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ...stats,
    rejected: stats.denied,
    applications: stats.total,
  });
});

app.get("/api/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    online: botOnline,
    guildId: GUILD_ID || null,
    channelId: APPY_CHANNEL_ID || null,
    startedAt,
    lastDiscordEvent,
    error: discordError,
  });
});

// ─── Website routes ───────────────────────────────────

// Serve the homepage explicitly.
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve frontend assets while blocking private/config files.
app.use(
  express.static(__dirname, {
    dotfiles: "deny",
    index: false,
    setHeaders(res, filePath) {
      const name = path.basename(filePath).toLowerCase();

      if (
        name === ".env" ||
        name === "server.js" ||
        name === "package.json" ||
        name === "state.json"
      ) {
        res.status(404);
      }
    },
  })
);

// ─── Start server ─────────────────────────────────────

app.listen(PORT, () => {
  console.log("Knowledge Team Dashboard");
  console.log(`Website: http://localhost:${PORT}`);
});

if (
  process.env.DISCORD_TOKEN &&
  process.env.DISCORD_TOKEN !== "PASTE_YOUR_BOT_TOKEN_HERE"
) {
  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    botOnline = false;
    discordError = error.message;
    console.error("Discord login failed:", error.message);
  });
} else {
  console.warn(
    "Discord bot token is missing. Website will run, but Discord stats will not update."
  );
}