import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

let socket: Socket;

export function useSocket(userEmail: string, onMessage: (data: any) => void) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!userEmail || initialized.current) return;

    socket = io({
      path: "/api/socket",
    });

    socket.on("connect", () => {
      console.log("✅ Socket connected:", socket.id);
      socket.emit("join", userEmail);
    });

    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected");
    });

    socket.on("message:new", (data) => {
      console.log("📩 New socket message", data);
      onMessage(data);
    });

    initialized.current = true;

    return () => {
      socket.disconnect();
      initialized.current = false;
    };
  }, [userEmail, onMessage]);
}
