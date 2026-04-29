// lib/facebook/sheets/sheetHeaders.ts
// SINGLE SOURCE OF TRUTH for per-lead-type Google Sheet headers.
//
// Column order = exactly what is collected by the hosted funnel for that lead type.
// Never add columns from a different lead type's funnel.
// Never add "just in case" columns.
//
// All consumers (setup-sheet-instructions, mapLeadToSheetRow, validate-sheet-setup)
// must derive headers exclusively from this file.

export type LeadSheetType = "mortgage" | "final_expense" | "veteran" | "trucker" | "iul";

export const LEAD_TYPE_TO_SHEET_TYPE: Record<string, LeadSheetType> = {
  mortgage_protection: "mortgage",
  final_expense: "final_expense",
  veteran: "veteran",
  trucker: "trucker",
  iul: "iul",
};

export const CANONICAL_SHEET_HEADERS: Record<LeadSheetType, string[]> = {
  // ── Final Expense ──────────────────────────────────────────────────────────
  // Funnel asks: age, beneficiary, healthIssues, coverage, state, bestTime
  final_expense: [
    "Received Date",
    "Campaign Id",
    "Lead Type",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "State",
    "Age",
    "Beneficiary",
    "Desired Coverage",
    "Health Issues",
    "Best Time To Contact",
    "Notes",
    "Status",
  ],

  // ── Mortgage Protection ────────────────────────────────────────────────────
  // Funnel asks: state, mortgageAmount, beneficiary, healthIssues, age, whyInterested
  mortgage: [
    "Received Date",
    "Campaign Id",
    "Lead Type",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "State",
    "Age",
    "Mortgage Balance",
    "Beneficiary",
    "Health Issues",
    "Why Interested",
    "Notes",
    "Status",
  ],

  // ── IUL ───────────────────────────────────────────────────────────────────
  // Funnel asks: age, state, householdIncome, currentCoverage, reasonInterested, bestTime
  iul: [
    "Received Date",
    "Campaign Id",
    "Lead Type",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "State",
    "Age",
    "Household Income",
    "Current Coverage",
    "Reason Interested",
    "Best Time To Contact",
    "Notes",
    "Status",
  ],

  // ── Veteran ───────────────────────────────────────────────────────────────
  // Funnel asks: militaryStatus, militaryBranch, maritalStatus, coverage, dob, state, bestTime
  veteran: [
    "Received Date",
    "Campaign Id",
    "Lead Type",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "State",
    "Date Of Birth",
    "Military Status",
    "Military Branch",
    "Marital Status",
    "Desired Coverage",
    "Best Time To Contact",
    "Notes",
    "Status",
  ],

  // ── Trucker ───────────────────────────────────────────────────────────────
  // Funnel asks: cdlStatus, age, state, maritalStatus, coverage, bestTime
  trucker: [
    "Received Date",
    "Campaign Id",
    "Lead Type",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "State",
    "Age",
    "CDL Status",
    "Marital Status",
    "Desired Coverage",
    "Best Time To Contact",
    "Notes",
    "Status",
  ],
};

export function getLeadSheetType(leadType: string): LeadSheetType {
  return LEAD_TYPE_TO_SHEET_TYPE[leadType] || "mortgage";
}

export function getCanonicalHeaders(leadTypeOrSheetType: string): string[] {
  const sheetType =
    (CANONICAL_SHEET_HEADERS as any)[leadTypeOrSheetType]
      ? (leadTypeOrSheetType as LeadSheetType)
      : getLeadSheetType(leadTypeOrSheetType);
  return CANONICAL_SHEET_HEADERS[sheetType];
}

export function normalizeHeaderName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
