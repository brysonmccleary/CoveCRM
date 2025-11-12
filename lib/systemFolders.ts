// lib/systemFolders.ts

// Canonical system folder names visible in the UI
export const SYSTEM_FOLDERS = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
  "Vet Leads",
] as const;

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

const CANONICAL_LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

function safeNormalize(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Strict server-side check. Only exact canonical names (case-insensitive) + “booked” shorthand. */
export function isSystemFolderName(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;
  if (CANONICAL_LOWER.has(n)) return true; // ✅ fixed: _LOWER (not _LOOWER)
  if (n === "booked") return true; // shorthand for “Booked Appointment”
  return false;
}

/** Softer, UX-only heuristic. Do NOT use for server blocking. */
export function isSystemish(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;
  if (isSystemFolderName(n)) return true;
  const compact = n.replace(/\s+/g, "");
  if (compact === "sold" || compact === "solds") return true;
  if (compact === "notinterested") return true;
  if (compact === "booked" || compact === "bookedappointment") return true;
  return false;
}
