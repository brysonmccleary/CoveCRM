export const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"] as const;

function canon(s?: string) {
  return String(s ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "")
    .replace(/0/g, "o")
    .replace(/\|/g, "l")
    .replace(/1/g, "l");
}

const SYSTEM_CANON = new Set(SYSTEM_FOLDERS.map(canon));

export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

export function isSystemFolderName(name?: string | null): boolean {
  const c = canon(name);
  return !!c && SYSTEM_CANON.has(c);
}
