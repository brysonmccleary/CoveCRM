// /lib/socket.ts
import { Server as NetServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { NextApiResponse } from "next";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: {
    server: NetServer & {
      io?: SocketIOServer;
    };
  };
};

let io: SocketIOServer | undefined;

export function initSocket(res: NextApiResponseWithSocket): SocketIOServer {
  // Reuse if already initialized (hot reload safe)
  if (res.socket.server.io) {
    return res.socket.server.io;
  }

  const newIo = new SocketIOServer(res.socket.server, {
    path: "/api/socket",
    addTrailingSlash: false,
    cors: {
      // If you want to lock this down, replace "*" with your app origin.
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket"], // prefer websocket
  });

  res.socket.server.io = newIo;
  io = newIo;

  newIo.on("connection", (socket: Socket) => {
    console.log("🔌 New socket connection:", socket.id);

    // Per-user room join
    socket.on("join", (userEmail: string) => {
      if (!userEmail) return;
      socket.join(userEmail);
      console.log(`👥 Socket ${socket.id} joined room: ${userEmail}`);
    });

    // Basic diagnostics
    socket.on("disconnect", (reason) => {
      console.log(`⚪︎ Socket ${socket.id} disconnected: ${reason}`);
    });
    socket.on("error", (err) => {
      console.warn(`⚠️ Socket ${socket.id} error:`, err);
    });
    socket.on("connect_error", (err) => {
      console.warn(`⚠️ Socket ${socket.id} connect_error:`, err?.message || err);
    });
  });

  return newIo;
}
