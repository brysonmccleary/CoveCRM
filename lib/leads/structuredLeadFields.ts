export type LeadFieldValue = string | number | boolean;

type StructuredLeadFieldsInput = {
  answers?: Record<string, unknown>;
  selectedOption?: unknown;
  leadType?: string;
};

type FieldDefinition = {
  label: string;
  aliases: string[];
};

export const STRUCTURED_LEAD_FIELD_ORDER = [
  "DOB",
  "Requested Coverage",
  "Mortgage Balance",
  "Mortgage Payment",
  "Marital Status",
  "Military Status",
  "Military Branch",
  "Who Needs Coverage",
  "CDL Status",
  "Beneficiary",
  "Health Issues",
  "Household Income",
  "Current Coverage",
  "Reason Interested",
  "Why Interested",
  "IUL Goal",
  "Best Time To Call",
  "City",
  "Zip",
  "Product Interest",
] as const;

const FIELD_DEFINITIONS: FieldDefinition[] = [
  { label: "DOB", aliases: ["dob", "dateOfBirth", "birthdate", "birthday", "birthDate"] },
  {
    label: "Requested Coverage",
    aliases: [
      "requestedCoverage",
      "desiredCoverage",
      "coverageAmount",
      "coverage",
      "whatCoverageAmountAreYouInterestedIn",
      "howMuchCoverageDoYouNeed",
    ],
  },
  {
    label: "Mortgage Balance",
    aliases: [
      "mortgageBalance",
      "mortgageAmount",
      "mortgageAmountOwed",
      "whatIsYourMortgageBalance",
    ],
  },
  { label: "Mortgage Payment", aliases: ["mortgagePayment", "monthlyMortgagePayment"] },
  { label: "Marital Status", aliases: ["maritalStatus", "marriageStatus", "familyStatus"] },
  { label: "Military Status", aliases: ["militaryStatus"] },
  {
    label: "Military Branch",
    aliases: ["militaryBranch", "branch", "whatMilitaryBranchDidYouServeIn"],
  },
  {
    label: "Who Needs Coverage",
    aliases: ["whoNeedsCoverage", "coverageSubject", "whoNeedsLifeInsurance"],
  },
  {
    label: "CDL Status",
    aliases: ["cdlStatus", "cdlDriverStatus", "areYouCurrentlyAnActiveCdlDriver"],
  },
  { label: "Beneficiary", aliases: ["beneficiary", "whoWouldBeYourBeneficiary"] },
  { label: "Health Issues", aliases: ["healthIssues", "majorHealthIssue", "majorHealthIssues"] },
  { label: "Household Income", aliases: ["householdIncome", "incomeBand"] },
  { label: "Current Coverage", aliases: ["currentCoverage", "currentCoverageAmount"] },
  { label: "Reason Interested", aliases: ["reasonInterested"] },
  { label: "Why Interested", aliases: ["whyInterested"] },
  {
    label: "IUL Goal",
    aliases: ["iulGoal", "areYouLookingForProtectionCashValueGrowthOrBoth"],
  },
  {
    label: "Best Time To Call",
    aliases: ["bestTime", "bestTimeToCall", "bestTimeToContact", "bestCallTime", "bestTimeForALicensedAgentToCall"],
  },
  { label: "City", aliases: ["city"] },
  { label: "Zip", aliases: ["zip", "zipCode", "postalCode"] },
  { label: "Product Interest", aliases: ["productInterest", "insuranceType", "interestedIn"] },
];

const RESERVED_ANSWER_KEYS = new Set([
  "firstname",
  "lastname",
  "fullname",
  "name",
  "email",
  "emailaddress",
  "phone",
  "phonenumber",
  "mobilenumber",
  "cellphone",
  "state",
  "stateprovince",
  "age",
  "consent",
  "smsconsentgiven",
  "smsconsenttext",
  "selectedoption",
  "verifiedtoken",
]);

export function normalizeLeadFieldKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function cleanLeadFieldValue(value: unknown): LeadFieldValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const cleaned = value
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    return cleaned.length ? cleaned.join(", ") : undefined;
  }
  if (typeof value === "object") return undefined;
  const cleaned = String(value).trim();
  return cleaned || undefined;
}

export function humanizeLeadFieldKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Converts every customer answer into a clean, agent-facing CRM field.
 * Consent and attribution remain in their dedicated audit records and are
 * intentionally excluded from the visible lead profile.
 */
export function buildStructuredLeadFields({
  answers = {},
  selectedOption,
  leadType = "",
}: StructuredLeadFieldsInput): Record<string, LeadFieldValue> {
  const entries = Object.entries(answers || {});
  const byNormalizedKey = new Map<string, { key: string; value: unknown }>();
  for (const [key, value] of entries) {
    const normalized = normalizeLeadFieldKey(key);
    if (normalized && !byNormalizedKey.has(normalized)) {
      byNormalizedKey.set(normalized, { key, value });
    }
  }

  const result: Record<string, LeadFieldValue> = {};
  const consumed = new Set<string>();

  for (const definition of FIELD_DEFINITIONS) {
    for (const alias of definition.aliases) {
      const normalizedAlias = normalizeLeadFieldKey(alias);
      const match = byNormalizedKey.get(normalizedAlias);
      if (!match) continue;
      const cleaned = cleanLeadFieldValue(match.value);
      consumed.add(normalizedAlias);
      if (cleaned !== undefined) result[definition.label] = cleaned;
      break;
    }
  }

  const selected = cleanLeadFieldValue(selectedOption);
  const normalizedLeadType = normalizeLeadFieldKey(leadType);
  const isMortgage = normalizedLeadType.includes("mortgage");
  if (selected !== undefined) {
    if (isMortgage && result["Mortgage Balance"] === undefined) {
      result["Mortgage Balance"] = selected;
    } else if (!isMortgage && result["Requested Coverage"] === undefined) {
      result["Requested Coverage"] = selected;
    }
  }

  for (const [key, value] of entries) {
    const normalized = normalizeLeadFieldKey(key);
    if (!normalized || consumed.has(normalized) || RESERVED_ANSWER_KEYS.has(normalized)) continue;
    if (normalized.startsWith("meta") || normalized.startsWith("utm")) continue;

    const cleaned = cleanLeadFieldValue(value);
    if (cleaned === undefined) continue;

    const label = humanizeLeadFieldKey(key);
    if (label && result[label] === undefined) result[label] = cleaned;
  }

  return result;
}

export function orderedStructuredLeadEntries(fields: Record<string, unknown>): Array<[string, string]> {
  const used = new Set<string>();
  const entries: Array<[string, string]> = [];
  const add = (label: string) => {
    const normalized = normalizeLeadFieldKey(label);
    if (normalized.startsWith("meta") || normalized.startsWith("utm") || normalized === "campaignid") return;
    const value = cleanLeadFieldValue(fields[label]);
    if (value === undefined) return;
    used.add(label);
    entries.push([label, String(value)]);
  };

  for (const label of STRUCTURED_LEAD_FIELD_ORDER) add(label);
  Object.keys(fields)
    .filter((label) => !used.has(label))
    .sort((a, b) => a.localeCompare(b))
    .forEach(add);
  return entries;
}
