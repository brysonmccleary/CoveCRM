// lib/systemFolders.ts
// Canonical system folder names (UI-visible)
export const SYSTEM_FOLDERS = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
  "No Show",          // ⬅️ NEW
] as const;

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

const CANONICAL_LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

// Safe normalize: lower + collapse whitespace + trim punctuation to spaces.
// NO character substitutions that change meaning.
function safeNormalize(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

// Strict check: only exact (case-insensitive) canonical names, plus a few shorthands.
export function isSystemFolderName(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;
  if (CANONICAL_LOWER.has(n)) return true;
  // Accept common shorthands
  if (n === "booked") return true;           // "Booked Appointment"
  if (n === "no show" || n === "noshow") return true; // "No Show"
  return false;
}

/**
 * Optional, *softer* detector for client-side UX only.
 * We keep it conservative to avoid false positives:
 * - allow simple punctuation/spacing variations
 * - recognize compact forms
 * DO NOT use this to *block* on the server—use isSystemFolderName.
 */
export function isSystemish(name?: string | null): boolean {
  const n = safeNormalize(name);
  if (!n) return false;
  if (isSystemFolderName(n)) return true;

  const compact = n.replace(/\s+/g, "");

  if (compact === "sold" || compact === "solds") return true;
  if (compact === "notinterested") return true;
  if (compact === "booked" || compact === "bookedappointment") return true;
  if (compact === "noshow" || compact === "missedappointment") return true;

  return false;
}
