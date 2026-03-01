import { useEffect } from "react";
import { connectAndJoin, getSocket } from "@/lib/socketClient";

type Handler = (data: any) => void;

/**
 * useSocket
 * - Uses the singleton Socket.IO client from lib/socketClient.ts
 * - Joins the user's email room
 * - Listens for server event: "newMessage"
 *
 * IMPORTANT: do NOT create a second io() client here (prevents double connections + dup listeners).
 */
export function useSocket(userEmail: string, onMessage: Handler) {
  useEffect(() => {
    const email = (userEmail || "").trim().toLowerCase();
    if (!email) return;

    // Connect + join room (idempotent)
    const s = connectAndJoin(email);
    if (!s) return;

    const handler = (data: any) => {
      onMessage?.(data);
    };

    // Align event name with API emit: emitToUser(email, "newMessage", payload)
    s.on("newMessage", handler);

    return () => {
      try {
        s.off("newMessage", handler);
        // Do NOT disconnect the singleton here; other pages may be using it.
        // Use disconnectSocket() only on sign-out.
      } catch {}
    };
  }, [userEmail, onMessage]);
}
