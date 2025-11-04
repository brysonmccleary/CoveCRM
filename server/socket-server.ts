import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";

const httpServer = createServer();

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "https://www.covecrm.com",
    credentials: true,
  },
  path: "/api/socket",
  transports: ["websocket", "polling"],
  pingTimeout: 30000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  socket.on("join", (room) => room && socket.join(room));
  socket.on("ping", () => socket.emit("pong", Date.now()));
  socket.on("disconnect", () => {});
});

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
  console.log("✅ Socket server running on port", port);
});
