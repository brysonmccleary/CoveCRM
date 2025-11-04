// lib/socket.ts
import type { Server as HTTPServer } from "http";
import { Server as IOServer } from "socket.io";

let ioSingleton: IOServer | undefined;

/** Return the Socket.IO server if already initialized by /api/socket. */
export function getIO(): IOServer | undefined {
  return ioSingleton;
}

/** Allow /api/socket to register its instance here (optional convenience). */
export function setIO(io: IOServer) {
  ioSingleton = io;
}

/** Emit to a specific user’s room. Safe no-op if IO not ready. */
export function emitToUser(email: string, event: string, payload?: any) {
  const io = ioSingleton;
  if (!io || !email || !event) return;
  io.to(email.toLowerCase()).emit(event, payload);
}
