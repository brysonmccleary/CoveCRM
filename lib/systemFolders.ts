// /lib/systemFolders.ts
// Canonical system folder names (UI-visible)
export const SYSTEM_FOLDERS = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
] as const;

const LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

// Exact, case-insensitive match
export function isSystemFolderName(name?: string | null): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return n.length > 0 && LOWER.has(n);
}

// Hardened "looks like" detector (blocks lookalikes such as s0ld, SOLD!, etc)
function normFolder(name?: string | null) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/0/g, "o")      // 0 → o
    .replace(/[ıi]/g, "l")   // dotted i / i → l (visual confusion)
    .replace(/[^a-z]/g, ""); // strip non-letters
}

const BLOCKED_BASENAMES = ["sold", "notinterested", "booked", "bookedappointment"];

// Public guard used by both client and server
export function isSystemish(name?: string | null): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  if (isSystemFolderName(raw)) return true;
  const n = normFolder(raw);
  return BLOCKED_BASENAMES.some((b) => n === b || n.startsWith(b));
}
