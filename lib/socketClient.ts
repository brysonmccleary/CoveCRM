// /lib/socketClient.ts
// Browser Socket.IO client. Uses Render in production by default, with env overrides.
// No changes to call sites; connectAndJoin() stays the same.

import { io, type Socket } from "socket.io-client";

declare global {
  // eslint-disable-next-line no-var
  var __crm_socket__: Socket | null | undefined;
  // eslint-disable-next-line no-var
  var __crm_socket_email__: string | null | undefined;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function resolveEndpoint() {
  // ---- 1) Env overrides (preferred) ----
  const envBase = (process.env.NEXT_PUBLIC_SOCKET_URL || "").trim().replace(/\/$/, "");
  // IMPORTANT: server path is '/socket/' (with trailing slash)
  const envPathRaw = (process.env.NEXT_PUBLIC_SOCKET_PATH || "").trim();
  const envPath = envPathRaw ? (envPathRaw.endsWith("/") ? envPathRaw : envPathRaw + "/") : "";

  if (envBase) {
    return { base: envBase, path: envPath || "/socket/" };
  }

  // ---- 2) Safe default in PRODUCTION: same-origin (Vercel Next.js) ----
  // This ensures all realtime events emitted by /api/* routes (messages, inbound banners, etc.) reach the UI.
  // If you intentionally want a different socket host, set NEXT_PUBLIC_SOCKET_URL / NEXT_PUBLIC_SOCKET_PATH.
  if (process.env.NODE_ENV === "production") {
    const base =
      (typeof window !== "undefined" && window.location.origin) ||
      (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
    return { base, path: "/api/socket/" };
  }

  // ---- 3) Dev fallback: same-origin (works locally) ----
  const base =
    (typeof window !== "undefined" && window.location.origin) ||
    (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { base, path: "/api/socket/" };
}

function createClient(): Socket {
  const { base, path } = resolveEndpoint();

  const socket = io(base, {
    path,
    withCredentials: true,
    transports: ["websocket", "polling"], // websocket first, polling as fallback
    forceNew: false,
    autoConnect: false,
  });

  // Diagnostics (quiet unless there is an issue)
  socket.on("connect_error", (err: any) => {
    console.error("[socket] connect_error:", err?.message || err);
  });
  socket.on("error", (err: any) => {
    console.error("[socket] error:", err);
  });
  socket.on("connect", () => {
    const email = (global as any).__crm_socket_email__;
    if (email) socket.emit("join", String(email).toLowerCase());
  });

  return socket;
}

/** Get or build the singleton client instance (browser only). */
export function getSocket(): Socket | null {
  if (!isBrowser()) return null;
  if (!global.__crm_socket__) {
    global.__crm_socket__ = createClient();
  }
  return (global.__crm_socket__ as Socket) ?? null;
}

/** Connect and join the user's email room. Safe to call repeatedly. */
export function connectAndJoin(userEmail?: string | null): Socket | null {
  const s = getSocket();
  if (!s) return null;
  const normalized = (userEmail || "").trim().toLowerCase();
  (global as any).__crm_socket_email__ = normalized || null;
  if (!s.connected) s.connect();
  if (normalized) s.emit("join", normalized);
  return s;
}

/** Optional: cleanly disconnect (e.g., on sign-out). */
export function disconnectSocket() {
  const s = getSocket();
  if (s) {
    s.removeAllListeners();
    s.disconnect();
  }
  (global as any).__crm_socket__ = null;
  (global as any).__crm_socket_email__ = null;
}
