// /lib/socket.ts
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
 * Initializes (or reuses) a singleton Socket.IO server bound to the path (/api/socket/).
 * Matching the client path (including the trailing slash) avoids Next.js redirect quirks.
 * Safe to call from any API route. Idempotent. No dialer logic touched.
 */
export function initSocket(res: NextApiResponseWithSocket): SocketIOServer {
  // Reuse instance if already attached (hot/cold starts)
  if (res.socket?.server?.io) {
    _io = res.socket.server.io;
    return _io!;
  }

  if (_io) return _io;

  const io = new SocketIOServer(res.socket.server, {
    path: "/api/socket/",            // <— trailing slash
    addTrailingSlash: true,
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    // Allow polling so it works reliably on Vercel; Socket.IO will try to upgrade when possible.
    transports: ["polling", "websocket"],
    allowEIO3: false,
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
 * Small helper to emit to a user's room.
 * No-op if server isn't initialized yet.
 */
export function emitToUser(userEmail: string, event: string, payload?: any) {
  if (!_io) return;
  if (!userEmail || !event) return;
  _io.to(userEmail).emit(event, payload);
}
