// /lib/socket.ts
// Socket.IO server singleton for API routes.
// Back-compatible: exports `initSocket` so older imports keep working.

import type { NextApiResponse } from "next";
import { Server as NetServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & { io?: SocketIOServer };
  };
};

let _io: SocketIOServer | undefined;

/**
 * Create and bind a Socket.IO server to Next's HTTP server (once).
 * Uses the **trailing-slash** path to avoid Next 308 redirects on Vercel.
 */
function createIo(res: NextApiResponseWithSocket): SocketIOServer {
  const io = new SocketIOServer(res.socket.server, {
    path: "/api/socket/", // NOTE: trailing slash must match client
    addTrailingSlash: true,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Do NOT force transports here. Let the client pick (polling upgrade → ws).
  });

  io.on("connection", (socket: Socket) => {
    try {
      const ip =
        (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        socket.handshake.address ||
        "unknown";
      console.log(`🔌 socket connected ${socket.id} from ${ip}`);
    } catch {
      console.log(`🔌 socket connected ${socket.id}`);
    }

    // multi-tenant room join
    socket.on("join", (userEmail: string) => {
      if (!userEmail) return;
      const room = String(userEmail).toLowerCase();
      socket.join(room);
      console.log(`👥 ${socket.id} joined room: ${room}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`⚪︎ ${socket.id} disconnected: ${reason}`);
    });
    socket.on("error", (err) => {
      console.warn(`⚠️ ${socket.id} error:`, err);
    });
    socket.on("connect_error", (err) => {
      console.warn(`⚠️ ${socket.id} connect_error:`, (err as any)?.message || err);
    });
  });

  return io;
}

/**
 * Public getter: returns the singleton if present, otherwise uses `res`
 * to initialize it (idempotent across hot/cold starts).
 */
export function getIO(res?: NextApiResponseWithSocket): SocketIOServer {
  if (_io) return _io;
  if (!res) throw new Error("Socket.IO not initialized yet");
  if (res.socket?.server?.io) {
    _io = res.socket.server.io;
    return _io;
  }
  _io = createIo(res);
  res.socket.server.io = _io;
  return _io;
}

/**
 * Back-compat alias for older code that imported `{ initSocket }` from "@/lib/socket".
 * Safe to keep indefinitely.
 */
export function initSocket(res: NextApiResponseWithSocket): SocketIOServer {
  return getIO(res);
}

/**
 * Emit to a user's room (no-op if server not created yet).
 */
export function emitToUser(userEmail: string, event: string, payload?: any) {
  if (!_io) return;
  if (!userEmail || !event) return;
  _io.to(String(userEmail).toLowerCase()).emit(event, payload);
}
