// /lib/socketClient.ts
// Browser Socket.IO client (pairs with server at /api/socket/)
import { io, type Socket } from "socket.io-client";

declare global {
  // eslint-disable-next-line no-var
  var __crm_socket__: Socket | undefined;
  // eslint-disable-next-line no-var
  var __crm_socket_email__: string | null | undefined;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function createClient(): Socket {
  const base =
    (typeof window !== "undefined" && window.location.origin) ||
    (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");

  const socket = io(base, {
    path: "/api/socket", // must match server
    withCredentials: true,
    transports: ["websocket", "polling"],
    forceNew: false,
    autoConnect: false,
  });

  // Optional: console diagnostics
  socket.on("connect_error", (err: any) => {
    console.error("[socket] connect_error:", err?.message || err);
  });
  socket.on("error", (err: any) => {
    console.error("[socket] error:", err);
  });
  socket.on("connect", () => {
    // Re-join room if identity was known
    const email = (global as any).__crm_socket_email__;
    if (email) {
      socket.emit("join", email.toLowerCase());
    }
  });

  return socket;
}

/** Get or build the singleton client instance (browser only). */
export function getSocket(): Socket | undefined {
  if (!isBrowser()) return undefined;
  if (!global.__crm_socket__) {
    global.__crm_socket__ = createClient();
  }
  return global.__crm_socket__;
}

/** Connect and join the user's email room. Safe to call repeatedly. */
export function connectAndJoin(userEmail?: string | null): Socket | undefined {
  const s = getSocket();
  if (!s) return undefined;
  const normalized = (userEmail || "").trim().toLowerCase();
  (global as any).__crm_socket_email__ = normalized || null;
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
  (global as any).__crm_socket__ = undefined;
  (global as any).__crm_socket_email__ = null;
}
