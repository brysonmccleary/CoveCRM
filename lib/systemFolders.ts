// /lib/systemFolders.ts
// Single source of truth for reserved/system folders and helpers.

const SYSTEM_FOLDERS_RAW = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
  "No Show",
] as const;

export const SYSTEM_FOLDERS = SYSTEM_FOLDERS_RAW.map((n) => n.toLowerCase());

function norm(s: string) {
  return String(s || "").trim().toLowerCase();
}

/**
 * Case-insensitive check for reserved/system folders.
 */
export function isSystemFolderName(name: string | undefined | null): boolean {
  if (!name) return false;
  return SYSTEM_FOLDERS.includes(norm(name));
}

/**
 * Back-compat alias kept for older UI code.
 * Some components still import `{ isSystemish }`.
 */
export const isSystemish = isSystemFolderName;

/**
 * Produces a folder name that is guaranteed to be NON-system.
 * If the incoming name is one of the reserved names, suffix " (Leads)".
 * If name is empty/whitespace, falls back to "Imported Leads".
 */
export function safeFolderName(name: string | undefined | null): string {
  const base = String(name || "").trim();
  if (!base) return "Imported Leads";
  return isSystemFolderName(base) ? `${base} (Leads)` : base;
}
