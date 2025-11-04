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
 * Initializes (or reuses) a singleton Socket.IO server bound to **/api/socket/**
 * (note the trailing slash). Matching the client path avoids Next.js 308 redirects.
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
    path: "/api/socket/",             // <-- trailing slash
    addTrailingSlash: true,           // be explicit
    cors: {
      origin: true,                   // reflect request origin
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Keep both; client is set to polling only for stability on Vercel
    transports: ["polling", "websocket"],
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
 * Minimal helper to emit to a user-scoped room.
 * No-op if server not initialized.
 */
export function emitToUser(userEmail: string, event: string, payload?: any) {
  if (!_io) return;
  if (!userEmail || !event) return;
  _io.to(userEmail).emit(event, payload);
}
