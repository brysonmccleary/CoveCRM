import { getCanonicalHeaders, normalizeHeaderName } from "./sheetHeaders";

const SYNONYMS: Record<string, string[]> = {
  "Phone": ["phone number", "mobile", "mobile phone", "cell", "cell phone"],
  "Mobile": ["phone", "phone number", "cell", "cell phone"],
  "DOB": ["date of birth", "birthday", "birthdate"],
  "Date Of Birth": ["dob", "birthday", "birthdate"],
  "ZIP Code": ["zip", "zip code", "postal code"],
  "Zip": ["zip code", "postal code"],
  "First Name": ["first", "firstname", "first_name"],
  "Last Name": ["last", "lastname", "last_name"],
  "Best Time To Contact You": ["best time", "best time to contact", "best contact time"],
  "Best Time Of Day To Contact You?": ["best time", "best time to contact", "best contact time"],
  "How Much Coverage Do You Need?": ["coverage", "coverage amount", "desired coverage"],
};

export function getSheetMappingProfile(leadType: string, actualHeaders: string[] = []) {
  const expectedHeaders = getCanonicalHeaders(leadType);
  const actualNormalized = new Map(
    actualHeaders.map((header, index) => [normalizeHeaderName(header), { header, index }])
  );

  const mapping: Record<string, { header: string; index: number } | null> = {};
  const missing: string[] = [];

  for (const expected of expectedHeaders) {
    const candidates = [expected, ...(SYNONYMS[expected] || [])].map(normalizeHeaderName);
    const match = candidates.map((candidate) => actualNormalized.get(candidate)).find(Boolean);
    mapping[expected] = match || null;
    if (!match) missing.push(expected);
  }

  const unexpected = actualHeaders.filter((header) => {
    const normalized = normalizeHeaderName(header);
    return !expectedHeaders.some((expected) =>
      [expected, ...(SYNONYMS[expected] || [])].map(normalizeHeaderName).includes(normalized)
    );
  });

  return {
    expectedHeaders,
    actualHeaders,
    mapping,
    missing,
    unexpected,
    valid: missing.length === 0,
  };
}
