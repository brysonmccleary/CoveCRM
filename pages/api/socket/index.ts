// pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as HTTPServer } from "http";
import { Server as IOServer, Socket } from "socket.io";

type ResWithSocket = NextApiResponse & {
  socket: {
    server: HTTPServer & { io?: IOServer };
  };
};

let ioSingleton: IOServer | undefined;

function ensureIO(res: ResWithSocket): IOServer {
  // Reuse if already attached to the Node HTTP server
  if (res.socket.server.io) {
    ioSingleton = res.socket.server.io;
    return ioSingleton;
  }
  // Reuse in-process (cold starts)
  if (ioSingleton) {
    res.socket.server.io = ioSingleton;
    return ioSingleton;
  }

  const io = new IOServer(res.socket.server, {
    // IMPORTANT: no trailing slash. Clients must use the same.
    path: "/api/socket",
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    // Let the platform negotiate; polling is fine for handshake, WS upgrades when possible
    transports: ["polling", "websocket"],
  });

  io.on("connection", (socket: Socket) => {
    // join a per-user room by email
    socket.on("join", (email: string) => {
      const room = (email || "").toLowerCase();
      if (!room) return;
      socket.join(room);
      // optional: ack
      socket.emit("joined", room);
    });

    socket.on("disconnect", () => { /* no-op */ });
  });

  res.socket.server.io = io;
  ioSingleton = io;
  return io;
}

export default function handler(_req: NextApiRequest, res: ResWithSocket) {
  // Initialize (idempotent). DO NOT write JSON here—engine.io needs this route.
  ensureIO(res);
  res.status(200).end();
}

// Disable Next.js body parsing; not required but keeps the route lean
export const config = {
  api: { bodyParser: false },
};
