import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer, type Socket } from "socket.io";

const PORT = Number(process.env.PORT || 3001);
const SOCKET_PATH = (process.env.SOCKET_PATH || "/socket").replace(/\/+$/, "");
const corsOrigins = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (corsOrigins.length === 0 || corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS not allowed"));
  },
  credentials: true
}));
app.get("/", (_req, res) => res.json({ ok: true, route: SOCKET_PATH + "/", ts: Date.now() }));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  path: SOCKET_PATH,
  addTrailingSlash: true,
  transports: ["websocket", "polling"],
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.length === 0 || corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"]
  }
});
io.on("connection", (socket: Socket) => {
  socket.on("join", (room: string) => {
    if (!room) return;
    socket.join(room.toLowerCase());
  });
  socket.on("ping", () => socket.emit("pong", Date.now()));
});
server.listen(PORT, () => console.log(`Socket service listening on :${PORT} at path ${SOCKET_PATH}`));
