// Canonical system folder list (human-facing names)
export const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"] as const;

const LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

/**
 * Exact match (case-insensitive) against canonical names.
 * Kept for backward compatibility.
 */
export function isSystemFolderName(name?: string | null): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return n.length > 0 && LOWER.has(n);
}

/**
 * Visual-lookalike guard used by both client and server.
 * Blocks "sold", "not interested", "booked appointment" and common lookalikes.
 */
function normVisual(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    // digit/letter lookalikes
    .replace(/0/g, "o")       // zero -> o
    .replace(/[ıìíîïi]/g, "l")// various i forms -> l (visually similar in some fonts)
    // strip everything but letters
    .replace(/[^a-z]/g, "");
}

const BLOCKED_BASENAMES = [
  "sold",
  "notinterested",
  "booked",
  "bookedappointment",
];

export function isBlockedSystemName(name?: string | null): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  if (isSystemFolderName(raw)) return true;
  const n = normVisual(raw);
  return BLOCKED_BASENAMES.some((b) => n === b || n.startsWith(b));
}
