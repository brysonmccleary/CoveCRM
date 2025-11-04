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

/** Create and bind a Socket.IO server to Next's HTTP server (once). */
function createIo(res: NextApiResponseWithSocket): SocketIOServer {
  const io = new SocketIOServer(res.socket.server, {
    path: "/api/socket/",           // NOTE: must match client (trailing slash)
    addTrailingSlash: true,
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    // Let client choose transports (polling → ws). Do not force here.
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
 * Return the singleton instance. If it's not created yet, use `res` to create it.
 * This function is typed to ALWAYS return a SocketIOServer (never undefined),
 * fixing the previous build error.
 */
export function getIO(res?: NextApiResponseWithSocket): SocketIOServer {
  // If we already have a process-level singleton, return it.
  if (_io) return _io;

  // If Vercel hot/cold start left one attached to the HTTP server, reuse it.
  if (res?.socket?.server?.io) {
    _io = res.socket.server.io as SocketIOServer;
    return _io;
  }

  // Otherwise, we must have `res` to create it right now.
  if (!res) {
    throw new Error("Socket.IO not initialized yet (no response object provided).");
  }

  _io = createIo(res);
  res.socket.server.io = _io;
  return _io;
}

/** Back-compat alias for existing imports in other files. */
export function initSocket(res: NextApiResponseWithSocket): SocketIOServer {
  return getIO(res);
}

/** Emit to a user's room (no-op if the server hasn't been created yet). */
export function emitToUser(userEmail: string, event: string, payload?: any) {
  if (!_io) return;
  if (!userEmail || !event) return;
  _io.to(String(userEmail).toLowerCase()).emit(event, payload);
}
