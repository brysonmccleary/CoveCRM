// lib/socketClient.ts
import { io, Socket } from "socket.io-client";

declare global {
  // eslint-disable-next-line no-var
  var __crm_socket__: Socket | undefined;
  // eslint-disable-next-line no-var
  var __crm_socket_email__: string | null | undefined;
}

const PATH = "/api/socket"; // no trailing slash — must match server

const isBrowser = () => typeof window !== "undefined";

function createClient(): Socket {
  return io(undefined, {
    path: PATH,
    // Let it negotiate (polling -> websocket). Don’t force websocket-only on Vercel.
    transports: ["polling", "websocket"],
    autoConnect: false,
    withCredentials: true,
    reconnection: true,
  });
}

export function getSocket(): Socket | null {
  if (!isBrowser()) return null;
  if (!global.__crm_socket__) {
    const s = createClient();
    const rejoin = () => {
      const email = (global.__crm_socket_email__ || "").toLowerCase();
      if (email) s.emit("join", email);
    };
    s.on("connect", rejoin);
    s.on("reconnect", rejoin);
    s.on("connect_error", (err) => console.warn("[socket] connect_error:", err?.message || err));
    global.__crm_socket__ = s;
  }
  return global.__crm_socket__!;
}

export function connectAndJoin(email: string): Socket | null {
  const s = getSocket();
  if (!s) return null;
  const normalized = (email || "").toLowerCase();
  global.__crm_socket_email__ = normalized;
  if (!s.connected) s.connect();
  if (normalized) s.emit("join", normalized);
  return s;
}

export function disconnectSocket() {
  const s = getSocket();
  if (!s) return;
  s.removeAllListeners();
  s.disconnect();
  global.__crm_socket__ = undefined;
  global.__crm_socket_email__ = null;
}
