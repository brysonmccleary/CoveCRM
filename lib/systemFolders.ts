// /lib/systemFolders.ts
// Canonical system folder names (UI-visible)
export const SYSTEM_FOLDERS = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
] as const;

const LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

// Normalize in a SAFE way (no character substitutions that change meaning)
function safeNormalize(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")     // collapse whitespace
    .replace(/[._-]+/g, " "); // common punctuation to space
}

// Exact, case-insensitive match against canonical names
export function isSystemFolderName(name?: string | null): boolean {
  const n = safeNormalize(name);
  // compare against canonical set after normalizing spaces (e.g., "not    interested")
  if (!n) return false;
  if (LOWER.has(n)) return true;
  // handle "booked" as a shorthand of "booked appointment"
  if (n === "booked") return true;
  return false;
}

// Broader but STILL SAFE guard: allow minor spacing/punctuation variants only
export function isSystemish(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;

  // Exact system names
  if (isSystemFolderName(n)) return true;

  // “Sold” with punctuation/plurals (e.g., "sold!", "sold.", "solds")
  if (n.replace(/\s+/g, "") === "sold" || /^solds?$/.test(n.replace(/\s+/g, ""))) return true;

  // “Not Interested” with flexible spacing/punctuation
  if (n.replace(/\s+/g, "") === "notinterested") return true;

  // “Booked” or “Booked Appointment” with flexible spacing/punctuation
  const compact = n.replace(/\s+/g, "");
  if (compact === "booked" || compact === "bookedappointment") return true;

  // No deeper “lookalike” tricks — avoid false positives
  return false;
}
