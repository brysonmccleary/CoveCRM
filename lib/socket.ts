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
  if (res.socket.server.io) {
    return res.socket.server.io;
  }

  const newIo = new SocketIOServer(res.socket.server, {
    path: "/api/socket",
    addTrailingSlash: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  res.socket.server.io = newIo;

  newIo.on("connection", (socket: Socket) => {
    console.log("🔌 New socket connection:", socket.id);

    socket.on("join", (userEmail: string) => {
      socket.join(userEmail);
      console.log(`👥 Socket ${socket.id} joined room: ${userEmail}`);
    });
  });

  return newIo;
}
