// /lib/socket.ts
import { Server as NetServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import type { NextApiResponse } from "next";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & { io?: SocketIOServer };
  };
};

let _io: SocketIOServer | null = null;

/** Create a Socket.IO server bound to our Next.js Node server under /api/socket/. */
function createIo(res: NextApiResponseWithSocket): SocketIOServer {
  const io = new SocketIOServer(res.socket.server, {
    path: "/api/socket", // we force no trailing slash; client mirrors this
    addTrailingSlash: true, // accept /api/socket/ too
    transports: ["websocket", "polling"],
    cors: {
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
    },
    allowEIO3: false,
  });

  io.on("connection", (socket: Socket) => {
    try {
      const ip =
        (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
        (socket.handshake.address as any) ||
        "unknown";

      // Clients call socket.emit("join", email)
      socket.on("join", (room: string) => {
        if (!room) return;
        socket.join(room);
      });

      socket.on("ping", () => {
        socket.emit("pong", Date.now());
      });

      socket.on("disconnect", () => {
        // no-op; rooms are auto-learned by Socket.IO
      });
    } catch (e) {
      // swallow to avoid tearing down the whole server
      console.error("socket connection handler error:", e);
    }
  });

  return io;
}

/** Initialize (or reuse) the singleton Socket.IO server. Safe to call on every request. */
export function initSocket(res: NextApiResponseWithSocket): SocketIOServer {
  if (_io) return _io;
  const srv = res?.socket?.server as NetServer & { io?: SocketIOServer };
  if (srv && !srv.io) {
    srv.io = createIo(res);
  }
  _io = srv.io as SocketIOServer;
  return _io!;
}

/** Optional getter. Will be null until initSocket has run at least once. */
export function getIO(): SocketIOServer | null {
  return _io;
}

/** Helper to emit to a specific user/email "room". */
export function emitToUser(userEmail: string, event: string, payload?: any) {
  if (!_io) return;
  if (!userEmail || !event) return;
  _io.to(userEmail).emit(event, payload);
}
