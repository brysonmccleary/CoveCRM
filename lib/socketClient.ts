// /lib/socketClient.ts
import { io, Socket } from "socket.io-client";

declare global {
  var __crm_socket__: Socket | undefined;
  var __crm_socket_email__: string | null | undefined;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function createClient(): Socket {
  // Vercel-compatible client (polling first, then upgrades)
  return io({
    path: "/api/socket/", // exact match with trailing slash
    transports: ["polling", "websocket"], // allow both
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });
}

/** Singleton getter (browser only) */
export function getSocket(): Socket | null {
  if (!isBrowser()) return null;

  if (!global.__crm_socket__) {
    const s = createClient();

    const rejoin = () => {
      const email = (global.__crm_socket_email__ || "").toLowerCase();
      if (email) s.emit("join", email);
    };

    s.on("connect", () => console.log("[socket] connected", s.id));
    s.on("connect_error", (err) =>
      console.warn("[socket] connect_error:", err?.message || err)
    );
    s.on("error", (err) =>
      console.warn("[socket] error:", err?.message || err)
    );
    s.on("disconnect", (reason) =>
      console.log("[socket] disconnected:", reason)
    );

    s.on("reconnect", rejoin);
    s.on("connect", rejoin);

    global.__crm_socket__ = s;
  }

  return global.__crm_socket__!;
}

/** Connect (if needed) and join user’s room by email */
export function connectAndJoin(email: string): Socket | null {
  const s = getSocket();
  if (!s) return null;
  const normalized = (email || "").toLowerCase();
  global.__crm_socket_email__ = normalized;
  if (!s.connected) s.connect();
  if (normalized) s.emit("join", normalized);
  return s;
}

/** Optional clean disconnect (for logout, etc.) */
export function disconnectSocket() {
  const s = getSocket();
  if (!s) return;
  s.removeAllListeners();
  s.disconnect();
  global.__crm_socket__ = undefined;
  global.__crm_socket_email__ = null;
}
