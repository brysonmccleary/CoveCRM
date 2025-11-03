import { Server as NetServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { NextApiResponse } from "next";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & { io?: SocketIOServer };
  };
};

let _io: SocketIOServer | undefined;

/**
 * Initializes (or reuses) a singleton Socket.IO server bound to **/api/socket/**.
 * We bind to the *trailing-slash* path to avoid Next.js 308 redirects causing 400s.
 * Safe to call from any API route. Idempotent. No dialer logic touched.
 */
export function initSocket(res: NextApiResponseWithSocket): SocketIOServer {
  // Reuse instance already attached to the HTTP server (hot/cold starts)
  if (res.socket?.server?.io) {
    _io = res.socket.server.io;
    return _io!;
  }

  // Reuse in-process singleton if present
  if (_io) return _io;

  const io = new SocketIOServer(res.socket.server, {
    // IMPORTANT: trailing slash to match Next's redirect behavior
    path: "/api/socket/",
    cors: {
      origin: "*", // tighten if you want to restrict to your domain
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket"], // prefer websocket (matches your client)
  });

  res.socket.server.io = io;
  _io = io;

  io.on("connection", (socket: Socket) => {
    try {
      const ip =
        (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        socket.handshake.address ||
        "unknown";
      console.log(`🔌 Socket connected ${socket.id} from ${ip}`);
    } catch {
      console.log(`🔌 Socket connected ${socket.id}`);
    }

    // Per-user room join
    socket.on("join", (userEmail: string) => {
      if (!userEmail) return;
      socket.join(userEmail);
      console.log(`👥 ${socket.id} joined room: ${userEmail}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`⚪︎ ${socket.id} disconnected: ${reason}`);
    });
    socket.on("error", (err) => {
      console.warn(`⚠️ ${socket.id} error:`, err);
    });
    socket.on("connect_error", (err) => {
      console.warn(`⚠️ ${socket.id} connect_error:`, err?.message || err);
    });
  });

  return io;
}

/**
 * ✅ Minimal, safe helper used by server routes to notify a user.
 * No changes to init, transports, or dialer flows.
 * No-op if the socket server hasn't been initialized yet.
 */
export function emitToUser(userEmail: string, event: string, payload?: any) {
  if (!_io) return;
  if (!userEmail || !event) return;
  _io.to(userEmail).emit(event, payload);
}
