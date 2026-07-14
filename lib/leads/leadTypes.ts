// lib/leads/leadTypes.ts
// Canonical lead-type list. Kept dependency-free (no mongoose) so it can be
// imported from both server code and client components without pulling
// server-only libraries into the browser bundle.
export const LEAD_TYPES = ["Final Expense", "Veteran", "Mortgage Protection", "IUL", "Trucker"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

/**
 * Converts common spoken, typed, and imported shorthand into the canonical
 * value stored by Cove. Unknown values return null so callers can decide
 * whether to preserve them or use their own fallback.
 */
export function normalizeLeadType(input: unknown): LeadType | null {
  const normalized = String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return null;
  if (normalized === "fe" || normalized === "fex" || normalized.includes("final expense")) return "Final Expense";
  if (normalized === "vet" || normalized.includes("veteran")) return "Veteran";
  if (normalized === "mtg" || normalized.includes("mortgage")) return "Mortgage Protection";
  if (normalized === "iul" || normalized.includes("indexed universal life")) return "IUL";
  if (
    normalized === "truck" ||
    normalized === "cdl" ||
    normalized.includes("trucker") ||
    normalized.includes("truck driver") ||
    normalized.includes("cdl driver")
  ) {
    return "Trucker";
  }

  return null;
}
