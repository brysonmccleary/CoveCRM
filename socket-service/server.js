import http from "http";
import { Server as IOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import express from "express";

// Config (env-first with safe defaults)
const PORT = process.env.PORT || 8080;
const SOCKET_PATH = process.env.SOCKET_PATH || "/socket";
const ALLOW_ORIGINS = (process.env.CORS_ORIGIN || "https://www.covecrm.com")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const app = express();

// Basic hardening for the health endpoint (not for the WS upgrade)
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // allow same-origin/no-origin
      cb(null, ALLOW_ORIGINS.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    path: SOCKET_PATH,
    origins: ALLOW_ORIGINS,
  });
});

const server = http.createServer(app);

// Socket.IO (Engine.IO) server
const io = new IOServer(server, {
  path: SOCKET_PATH, // e.g. "/socket"
  addTrailingSlash: true,
  transports: ["websocket", "polling"],
  allowEIO3: false,
  cors: {
    origin: ALLOW_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  },
});

io.on("connection", (socket) => {
  try {
    // clients call "join" with their email (lowercased) or userId
    socket.on("join", (room) => {
      if (room && typeof room === "string") socket.join(room.toLowerCase());
    });

    socket.on("ping", () => socket.emit("pong", Date.now()));

    socket.on("disconnect", () => {
      // nothing special
    });
  } catch (e) {
    console.error("socket handler error:", e);
  }
});

server.listen(PORT, () => {
  console.log(`CoveCRM Socket Service listening on :${PORT} (path ${SOCKET_PATH})`);
});
