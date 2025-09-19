// lib/systemFolders.ts

// Canonical system folder labels (UI may display these exactly)
export const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"] as const;
export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

const LOWER_CANON = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

// Fold common visual lookalikes to a base, letters-only form
// - 0 -> o
// - i / ı (dotless i) -> l  (historical guard we’ve used to catch SoId / S0Id variants)
// - strip spaces, punctuation, digits
function normalizeVisual(name?: string | null): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/[ıi]/g, "l")
    .replace(/[^a-z]/g, ""); // keep only letters
}

// Basenames we will always block after normalization
const BLOCKED_BASENAMES = new Set<string>([
  "sold",
  "notinterested",
  "booked",
  "bookedappointment",
]);

/**
 * Strict system-folder check.
 * Returns true if the name is a known system folder or a lookalike/obfuscated variant.
 */
export function isBlockedSystemName(name?: string | null): boolean {
  const raw = String(name ?? "").trim();
  if (!raw) return false;
  const lc = raw.toLowerCase();

  // Exact canonical label block
  if (LOWER_CANON.has(lc)) return true;

  // Visual-lookalike / obfuscated block
  const base = normalizeVisual(raw);
  if (BLOCKED_BASENAMES.has(base)) return true;

  // Also guard "startsWith" forms like "booked appointment – 2025-01"
  for (const b of BLOCKED_BASENAMES) {
    if (base.startsWith(b)) return true;
  }
  return false;
}

/**
 * Backwards-compatible alias.
 * Historically the client imported `isSystemFolderName`. Keep it, but make it strict.
 */
export function isSystemFolderName(name?: string | null): boolean {
  return isBlockedSystemName(name);
}
