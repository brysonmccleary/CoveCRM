// /lib/socketClient.ts
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
  const envBase = (process.env.NEXT_PUBLIC_SOCKET_URL || "").trim().replace(/\/$/, "");
  const envPathRaw = (process.env.NEXT_PUBLIC_SOCKET_PATH || "").trim().replace(/\/$/, "");

  if (envBase) {
    return { base: envBase, path: envPathRaw || "/api/socket" };
  }

  const base =
    (typeof window !== "undefined" && window.location.origin) ||
    (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { base, path: "/api/socket" };
}

function createClient(): Socket {
  const { base, path } = resolveEndpoint();
  const websocketOnly = process.env.NODE_ENV === "production";

  const socket = io(base, {
    path,
    withCredentials: true,
    transports: websocketOnly ? ["websocket"] : ["websocket", "polling"],
    forceNew: false,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });

  socket.on("connect", () => {
    try {
      const t = (socket as any).io?.engine?.transport?.name;
      console.log("[socket] connected via", t || "unknown");
    } catch {}
    const email = (global as any).__crm_socket_email__;
    if (email) socket.emit("join", String(email).toLowerCase());
  });

  socket.on("upgrade", () => {
    try {
      const t = (socket as any).io?.engine?.transport?.name;
      console.log("[socket] upgraded to", t);
    } catch {}
  });

  socket.on("connect_error", (err: any) => {
    console.error("[socket] connect_error:", err?.message || err);
  });
  socket.on("error", (err: any) => {
    console.error("[socket] error:", err);
  });

  return socket;
}

export function getSocket(): Socket | null {
  if (!isBrowser()) return null;
  if (!global.__crm_socket__) global.__crm_socket__ = createClient();
  return (global.__crm_socket__ as Socket) ?? null;
}

export function connectAndJoin(userEmail?: string | null): Socket | null {
  const s = getSocket();
  if (!s) return null;
  const normalized = (userEmail || "").trim().toLowerCase();
  (global as any).__crm_socket_email__ = normalized || null;
  if (!s.connected) s.connect();
  if (normalized) s.emit("join", normalized);
  return s;
}

export function disconnectSocket() {
  const s = getSocket();
  if (s) {
    s.removeAllListeners();
    s.disconnect();
  }
  (global as any).__crm_socket__ = null;
  (global as any).__crm_socket_email__ = null;
}
