// infra/socket-service/src/index.ts
import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";

// -------------------------
// Config
// -------------------------
const PORT = Number(process.env.PORT || 8080);
const EMIT_BEARER_SECRET = process.env.EMIT_BEARER_SECRET || "";

// Allow your app domains + localhost for dev
const ALLOWED_ORIGINS = [
  "https://www.covecrm.com",
  "https://covecrm.com",
  "http://localhost:3000",
];

const SOCKET_PATH = "/socket/"; // <— keep this exact (already used by client)

// -------------------------
// App + HTTP server
// -------------------------
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "256kb" }));

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

const server = http.createServer(app);

// -------------------------
// Socket.IO
// -------------------------
const io = new Server(server, {
  path: SOCKET_PATH,
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  // Stick with sensible defaults; no sticky-sessions needed for Render single instance
});

io.on("connection", (socket) => {
  // client calls: socket.emit('join', email)
  socket.on("join", (email?: string) => {
    const room = (email || "").trim().toLowerCase();
    if (!room) return;
    socket.join(room);
  });

  socket.on("disconnect", () => {
    // no-op
  });
});

// -------------------------
// Health
// -------------------------
app.get(SOCKET_PATH, (_req, res) => {
  res.json({ ok: true });
});

// -------------------------
// Secure emit endpoint
// POST /emit/call-incoming
// Authorization: Bearer <EMIT_BEARER_SECRET>
// Body: { email, leadId, leadName, phone }
// -------------------------
app.post("/emit/call-incoming", (req, res) => {
  try {
    // Auth
    const auth = String(req.get("authorization") || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!EMIT_BEARER_SECRET || token !== EMIT_BEARER_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    // Validate body
    const { email, leadId, leadName, phone } = req.body || {};
    const normEmail = String(email || "").trim().toLowerCase();
    if (!normEmail) {
      return res.status(400).json({ ok: false, error: "Missing email" });
    }

    const payload = {
      email: normEmail,
      leadId: String(leadId || ""),
      leadName: String(leadName || ""),
      phone: String(phone || ""),
      ts: Date.now(),
      // client will listen to this channel:
      event: "call:incoming",
    };

    // Emit to the agent’s email room
    io.to(normEmail).emit("call:incoming", payload);

    return res.json({ ok: true, delivered: true });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Internal error" });
  }
});

// -------------------------
// Start
// -------------------------
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[socket-service] listening on :${PORT} path=${SOCKET_PATH}`);
});
