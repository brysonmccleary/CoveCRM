// lib/facebook/sheets/mapLeadToSheetRow.ts
// Builds a per-lead-type sheet row payload aligned to CANONICAL_SHEET_HEADERS.
//
// Strategy: build a superset map keyed by exact canonical header names,
// then filter to only the columns defined for this lead type.
// This means any column name change in sheetHeaders.ts must be mirrored here.
//
// Adding a new lead type: add the new pick() entries below and add the headers
// to sheetHeaders.ts. Nothing else needs to change.

import { getCanonicalHeaders, getLeadSheetType } from "./sheetHeaders";

type LeadPayload = Record<string, any>;

function pick(payload: LeadPayload, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return "";
}

export function buildLeadSheetPayload(input: {
  leadType: string;
  campaignId: string;
  answers: LeadPayload;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  status?: string;
}): LeadPayload {
  const sheetType = getLeadSheetType(input.leadType);
  const answers = input.answers || {};

  // Keys must exactly match canonical header names in sheetHeaders.ts.
  const base: LeadPayload = {
    // ── Common ──────────────────────────────────────────────────────────────
    "Received Date": new Date().toISOString(),
    "Campaign Id": input.campaignId,
    "Lead Type": input.leadType,
    "First Name": input.firstName,
    "Last Name": input.lastName,
    Email: input.email,
    Phone: input.phone,
    State: pick(answers, "state"),
    Age: pick(answers, "age"),

    // ── Final Expense + Mortgage ─────────────────────────────────────────────
    Beneficiary: pick(answers, "beneficiary"),
    "Health Issues": pick(answers, "healthIssues", "majorHealthIssue"),

    // ── Final Expense + Veteran + Trucker ────────────────────────────────────
    "Desired Coverage": pick(answers, "coverage", "coverageAmount", "desiredCoverage"),

    // ── Final Expense + IUL + Veteran + Trucker ──────────────────────────────
    "Best Time To Contact": pick(answers, "bestTime", "bestTimeToContact"),

    // ── Mortgage Protection ──────────────────────────────────────────────────
    "Mortgage Balance": pick(answers, "mortgageAmount", "mortgageAmountOwed"),
    "Why Interested": pick(answers, "whyInterested"),

    // ── IUL ──────────────────────────────────────────────────────────────────
    "Household Income": pick(answers, "householdIncome", "incomeBand"),
    "Current Coverage": pick(answers, "currentCoverage", "currentCoverageAmount"),
    "Reason Interested": pick(answers, "reasonInterested"),

    // ── Veteran ──────────────────────────────────────────────────────────────
    "Date Of Birth": pick(answers, "dob", "dateOfBirth", "birthdate"),
    "Military Status": pick(answers, "militaryStatus"),
    "Military Branch": pick(answers, "militaryBranch"),
    "Marital Status": pick(answers, "maritalStatus"),

    // ── Trucker ──────────────────────────────────────────────────────────────
    "CDL Status": pick(answers, "cdlStatus"),

    // ── Always last ──────────────────────────────────────────────────────────
    Notes: input.notes,
    Status: input.status || "New",
  };

  // Filter to only the canonical columns for this lead type, in order.
  const headers = getCanonicalHeaders(sheetType);
  const row: LeadPayload = {};
  for (const header of headers) {
    row[header] = base[header] ?? "";
  }
  return row;
}
