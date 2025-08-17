// lib/assistantName.ts
/**
 * Single source of truth for the assistant display name on the client.
 * Uses NEXT_PUBLIC_ASSISTANT_NAME with a safe fallback.
 */
export const ASSISTANT_NAME =
  (process.env.NEXT_PUBLIC_ASSISTANT_NAME || "Cove Assistant").trim();
