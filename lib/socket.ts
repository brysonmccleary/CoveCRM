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
    // IMPORTANT: client uses wss://.../api/socket/?EIO=4&transport=websocket
    // Accept both with/without trailing slash
    path: "/api/socket",
    transports: ["websocket", "polling"],
    cors: {
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
    },
    // Make the WS more tolerant for Safari / proxies that delay frames
    pingTimeout: 30000,          // default 20000 — increase
    pingInterval: 25000,         // default 25000 — keep
    connectTimeout: 45000,       // help initial handshake across slow paths
    allowEIO3: false,
    perMessageDeflate: true,
    // If client reconnects quickly (tab sleep), let it resume room state
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });

  io.on("connection", (socket: Socket) => {
    try {
      // Rooms: clients call socket.emit("join", email)
      socket.on("join", (room: string) => {
        if (!room) return;
        socket.join(room);
      });

      // Optional RPC pong (client may send .emit("ping"))
      socket.on("ping", () => {
        socket.emit("pong", Date.now());
      });

      // --- Gentle heartbeat to keep intermediaries from idling the connection ---
      // Socket.IO already pings, but some stacks (Safari + certain CDNs) benefit from
      // a user-space event to keep the data path alive.
      const hb = setInterval(() => {
        // tiny, infrequent message; won’t flood
        socket.emit("hb", Date.now());
      }, 20000);

      socket.on("disconnect", () => {
        clearInterval(hb);
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
