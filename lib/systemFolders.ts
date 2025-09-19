// Unified, strict system-folder detection with visual lookalike normalization.

export const SYSTEM_FOLDERS = [
  "Sold",
  "Not Interested",
  "Booked",
  "Booked Appointment",
] as const;

const LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

function normalizeForCompare(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/0/g, "o")        // zero → o
    .replace(/[ıi]/g, "l")     // i-like → l (visual confusables)
    .replace(/[^a-z]/g, "");   // letters only
}

const BLOCKED_BASES = new Set(
  Array.from(LOWER).map((n) =>
    n
      .replace(/\s+/g, "")         // collapse spaces
      .replace(/[^a-z]/g, "")      // strip punctuation
  )
);

/** Exact (case-insensitive) check, no lookalikes. */
export function isSystemFolderName(name?: string | null): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return n.length > 0 && LOWER.has(n);
}

/** Strict check that also blocks visual lookalikes (S0LD, s_o-l.d, etc.). */
export function isBlockedSystemName(name?: string | null): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  if (isSystemFolderName(raw)) return true;

  const norm = normalizeForCompare(raw);
  if (!norm) return false;

  // Block exact or "startsWith" of canonical bases (e.g., "bookedappointment", "booked")
  for (const base of BLOCKED_BASES) {
    if (norm === base || norm.startsWith(base)) return true;
  }
  return false;
}

/** Utility exported for any caller needing the same normalization. */
export function normalizeFolderNameForCompare(name?: string | null): string {
  return normalizeForCompare(name);
}
