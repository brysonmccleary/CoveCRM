// /lib/systemFolders.ts
export const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"] as const;
export type SystemFolderName = (typeof SYSTEM_FOLDERS)[number];

const LOWER = new Set(SYSTEM_FOLDERS.map((s) => s.toLowerCase()));

export function isSystemFolderName(name?: string | null): boolean {
  const n = String(name ?? "").trim().toLowerCase();
  return n.length > 0 && LOWER.has(n);
}

// ---------- Hardened lookalike guard ----------
function stripDiacritics(s: string) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}
export function canonicalizeName(name?: string | null): string {
  const raw = stripDiacritics(String(name ?? ""));
  const leet = raw
    .toLowerCase()
    .replace(/\$/g, "s")
    .replace(/5/g, "s")
    .replace(/0/g, "o")
    .replace(/[|!]/g, "l")
    .replace(/1/g, "l")
    .replace(/@/g, "a")
    .replace(/3/g, "e")
    .replace(/7/g, "t")
    .replace(/4/g, "a");
  return leet.replace(/\s+/g, "").replace(/[_\-.,/\\]+/g, "");
}

const SYSTEM_CANON = new Set(SYSTEM_FOLDERS.map((n) => canonicalizeName(n)));

/** Blocks exact system names and common look-alikes like "$0ld", "n0tinterested", "b00kedapp0intment". */
export function isBlockedSystemName(name?: string | null): boolean {
  const c = canonicalizeName(name);
  return c.length > 0 && SYSTEM_CANON.has(c);
}
