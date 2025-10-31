// /lib/systemFolders.ts
// Central definition so both API and UI use the same guard logic.

const SYSTEM_FOLDERS_RAW = [
  "Sold",
  "Not Interested",
  "Booked Appointment",
  "No Show",
  // add any other locked system folders here, and ONLY here
] as const;

export const SYSTEM_FOLDERS = SYSTEM_FOLDERS_RAW.map((n) => n.toLowerCase());

function norm(s: string) {
  return s.trim().toLowerCase();
}

/**
 * Returns true if a folder name is one of the reserved/system folders.
 * Matching is case-insensitive.
 */
export function isSystemFolderName(name: string | undefined | null): boolean {
  if (!name) return false;
  return SYSTEM_FOLDERS.includes(norm(String(name)));
}

/**
 * Back-compat alias used by older UI code.
 * Keep this export so imports like `{ isSystemish }` continue to work.
 */
export const isSystemish = isSystemFolderName;
