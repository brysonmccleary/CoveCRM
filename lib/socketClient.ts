// /lib/socketClient.ts
// Browser Socket.IO client (pairs with server at /api/socket)

import { io, Socket } from "socket.io-client";

declare global {
  // Preserve a single instance across hot-reloads
  // eslint-disable-next-line no-var
  var __crm_socket__: Socket | undefined;
  // Keep last joined email so reconnects can rejoin room
  // eslint-disable-next-line no-var
  var __crm_socket_email__: string | null | undefined;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function createClient(): Socket {
  return io(undefined, {
    path: "/api/socket",
    transports: ["websocket"],
    autoConnect: false,
    withCredentials: true,
    reconnection: true,
    // (optional) tweak backoff if desired:
    // reconnectionAttempts: Infinity,
    // reconnectionDelay: 500,
    // reconnectionDelayMax: 5000,
  });
}

/** Singleton getter (browser only). */
export function getSocket(): Socket | null {
  if (!isBrowser()) return null;

  if (!global.__crm_socket__) {
    const s = createClient();

    // Re-join on connect/reconnect using the last known email
    const rejoin = () => {
      const email = (global.__crm_socket_email__ || "").toLowerCase();
      if (email) s.emit("join", email);
    };
    s.on("connect", rejoin);
    s.on("reconnect", rejoin);

    // Light diagnostics (safe to remove)
    s.on("connect_error", (err) => {
      // eslint-disable-next-line no-console
      console.warn("[socket] connect_error:", err?.message || err);
    });
    s.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.warn("[socket] error:", err);
    });

    global.__crm_socket__ = s;
  }

  return global.__crm_socket__!;
}

/** Connect (if needed) and join the per-user room by email. */
export function connectAndJoin(email: string): Socket | null {
  const s = getSocket();
  if (!s) return null;

  const normalized = (email || "").toLowerCase();
  global.__crm_socket_email__ = normalized;

  if (!s.connected) s.connect();
  if (normalized) s.emit("join", normalized);

  return s;
}

/** Optional: cleanly disconnect (e.g., on sign-out). */
export function disconnectSocket() {
  const s = getSocket();
  if (!s) return;
  s.removeAllListeners();
  s.disconnect();
  global.__crm_socket__ = undefined;
  global.__crm_socket_email__ = null;
}
