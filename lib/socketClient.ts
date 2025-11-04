// Browser Socket.IO client (pairs with server at /api/socket/)
import { io, Socket } from "socket.io-client";

declare global {
  // Preserve a single instance across hot reloads
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
  // IMPORTANT:
  // - path must include trailing slash to avoid Next 308 redirect issues
  // - force transports=["polling"] to avoid WS upgrade flakiness on Vercel
  return io({
    path: "/api/socket/",
    transports: ["polling"],
    withCredentials: true,
    reconnection: true,
  });
}

/** Singleton getter (browser only). */
export function getSocket(): Socket | null {
  if (!isBrowser()) return null;

  if (!global.__crm_socket__) {
    const s = createClient();

    const rejoin = () => {
      const email = (global.__crm_socket_email__ || "").toLowerCase();
      if (email) s.emit("join", email);
    };

    // Re-join on connect/reconnect using the last known email
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
