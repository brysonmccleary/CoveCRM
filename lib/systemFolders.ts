// /lib/systemFolders.ts
export const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"] as const;

const LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

export function isSystemFolderName(name?: string | null): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return n.length > 0 && LOWER.has(n);
}
