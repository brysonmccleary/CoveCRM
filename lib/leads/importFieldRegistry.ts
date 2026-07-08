export const DONT_IMPORT = "Don't import";
export const CUSTOM_FIELD = "Custom field";

export const CANONICAL_FIELDS = [
  "First Name",
  "Last Name",
  "Phone",
  "Email",
  "State",
  "Lead Type",
  "Status",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
export type ImportTarget = CanonicalField | typeof DONT_IMPORT | string;

export const API_KEY_TO_CANONICAL: Record<string, CanonicalField> = {
  firstName: "First Name",
  lastName: "Last Name",
  phone: "Phone",
  email: "Email",
  state: "State",
  leadType: "Lead Type",
  status: "Status",
  disposition: "Status",
};

export const CANONICAL_TO_API_KEY: Record<CanonicalField, string> = {
  "First Name": "firstName",
  "Last Name": "lastName",
  Phone: "phone",
  Email: "email",
  State: "state",
  "Lead Type": "leadType",
  Status: "status",
};

export const CANONICAL_TO_LEAD_FIELD: Record<CanonicalField, string> = {
  "First Name": "First Name",
  "Last Name": "Last Name",
  Phone: "Phone",
  Email: "Email",
  State: "State",
  "Lead Type": "leadType",
  Status: "status",
};

export const FIELD_PATTERNS: Array<{ field: CanonicalField; pattern: RegExp }> = [
  { field: "First Name", pattern: /^(first|firstname|fname|givenname)$/ },
  { field: "Last Name", pattern: /^(last|lastname|lname|surname|familyname)$/ },
  { field: "Phone", pattern: /^(phone|mobile|cell|telephone|tel|phonenumber|primaryphone)$/ },
  { field: "Email", pattern: /^(email|e?mailaddress|emailid)$/ },
  { field: "State", pattern: /^(state|st|region)$/ },
  { field: "Lead Type", pattern: /^(leadtype|type|product|producttype)$/ },
  { field: "Status", pattern: /^(status|disposition|leadstatus)$/ },
];

export function normalizeHeaderForMatch(header: string): string {
  return String(header || "").toLowerCase().replace(/\s|_|-/g, "");
}

export function bestGuess(header: string): CanonicalField | "" {
  const normalized = normalizeHeaderForMatch(header);
  const match = FIELD_PATTERNS.find((entry) => entry.pattern.test(normalized));
  return match?.field || "";
}

export function sanitizeCustomFieldName(header: string): string {
  const sanitized = String(header || "")
    .trim()
    .replace(/[.$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "Custom Field";
}

export function customFieldTarget(header: string): string {
  return `${CUSTOM_FIELD}: ${sanitizeCustomFieldName(header)}`;
}

export function isCanonicalField(value: string): value is CanonicalField {
  return (CANONICAL_FIELDS as readonly string[]).includes(value);
}

export function parseCustomFieldTarget(target: string, header: string): string {
  const raw = String(target || "").trim();
  if (raw === CUSTOM_FIELD) return sanitizeCustomFieldName(header);
  if (raw.toLowerCase().startsWith(`${CUSTOM_FIELD.toLowerCase()}:`)) {
    return sanitizeCustomFieldName(raw.slice(raw.indexOf(":") + 1));
  }
  return sanitizeCustomFieldName(raw || header);
}

export function trimImportValue(value: any): any {
  return typeof value === "string" ? value.trim() : value;
}

export function parseDateAdded(value: any): Date | null {
  const trimmed = trimImportValue(value);
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isDateAddedHeader(header: string): boolean {
  return /^(dateadded|createdat|created|dateentered)$/.test(normalizeHeaderForMatch(header));
}

export function buildInsertCreatedAt(
  dateAddedValue: any,
  fallback: Date,
  warnings: string[] = [],
  label = "Date Added",
): Date {
  const trimmed = trimImportValue(dateAddedValue);
  if (!trimmed) return fallback;
  const parsed = parseDateAdded(trimmed);
  if (parsed) return parsed;
  warnings.push(`${label} "${trimmed}" was not parseable; createdAt default used.`);
  return fallback;
}

export type NormalizedImportMapping = {
  headerToTarget: Record<string, ImportTarget>;
  mapped: Record<string, string>;
  customFields: string[];
  skipped: string[];
};

export function normalizeImportMapping(
  mapping: Record<string, string>,
  headers: string[] = Object.keys(mapping || {}),
): NormalizedImportMapping {
  const headerSet = new Set(headers.map((header) => String(header)));
  const headerToTarget: Record<string, ImportTarget> = {};

  for (const header of headers) {
    const target = mapping[header];
    if (target !== undefined) {
      headerToTarget[header] = target;
    }
  }

  for (const [key, value] of Object.entries(mapping || {})) {
    if (headerSet.has(key)) continue;
    const canonical = API_KEY_TO_CANONICAL[key] || (isCanonicalField(key) ? key : "");
    if (!canonical || !value) continue;
    headerToTarget[String(value)] = canonical;
  }

  const mapped: Record<string, string> = {};
  const customFields: string[] = [];
  const skipped: string[] = [];

  for (const header of headers) {
    const rawTarget = headerToTarget[header];
    const target = String(rawTarget || "").trim();
    if (!target || target === DONT_IMPORT) {
      skipped.push(header);
      continue;
    }
    if (isCanonicalField(target)) {
      mapped[header] = target;
      continue;
    }
    const customField = parseCustomFieldTarget(target, header);
    headerToTarget[header] = customFieldTarget(customField);
    mapped[header] = customFieldTarget(customField);
    if (!customFields.includes(customField)) customFields.push(customField);
  }

  return { headerToTarget, mapped, customFields, skipped };
}

export function buildAutoMapping(headers: string[]): Record<string, ImportTarget> {
  const mapping: Record<string, ImportTarget> = {};
  for (const header of headers) {
    const guess = bestGuess(header);
    mapping[header] = guess || customFieldTarget(header);
  }
  return mapping;
}
