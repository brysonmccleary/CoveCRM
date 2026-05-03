export type ExtractedPhone = {
  phone?: string;
  normalizedPhone?: string;
  phoneLast10?: string;
  sourceKey?: string;
};

const KNOWN_PHONE_KEYS = new Set([
  "phone",
  "normalizedphone",
  "phonenumber",
  "mobile",
  "cell",
  "cellphone",
  "primaryphone",
  "phone1",
  "phone2",
]);

const PREFERRED_NESTED_KEYS = new Set([
  "rawrow",
  "data",
  "lead",
  "contact",
  "additionalfields",
]);

const PHONEISH_PATH_RE = /phone|mobile|cell/i;
const FORMATTED_PHONE_RE = /(?:^\s*p\s*:|\+|\(|\)|-|\.|\s)/i;

function normalizeKey(key: unknown) {
  return String(key ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coerceDigits(raw: unknown) {
  if (raw === undefined || raw === null) return "";
  return String(raw).replace(/\D/g, "");
}

export function normalizePhoneDigitsToE164(raw: unknown) {
  const digits = coerceDigits(raw);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function buildPhone(raw: unknown, sourceKey?: string): ExtractedPhone | null {
  const digits = coerceDigits(raw);
  const normalizedPhone = normalizePhoneDigitsToE164(digits);
  if (!normalizedPhone) return null;

  return {
    phone: digits,
    normalizedPhone,
    phoneLast10: digits.slice(-10),
    ...(sourceKey ? { sourceKey } : {}),
  };
}

function valueLooksPhoneLike(raw: unknown, sourceKey?: string) {
  if (raw === undefined || raw === null) return false;
  const value = String(raw).trim();
  if (!value) return false;

  const digits = coerceDigits(value);
  const canNormalize = digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
  if (!canNormalize) return false;

  return PHONEISH_PATH_RE.test(normalizeKey(sourceKey)) || FORMATTED_PHONE_RE.test(value);
}

function scanKnownFields(input: unknown, path: string, seen: WeakSet<object>, depth: number): ExtractedPhone | null {
  if (depth > 8 || input === undefined || input === null) return null;

  const primitivePhone = buildPhone(input, path);
  if (primitivePhone && path && KNOWN_PHONE_KEYS.has(normalizeKey(path.split(".").pop()))) {
    return primitivePhone;
  }

  if (typeof input !== "object") return null;
  if (seen.has(input)) return null;
  seen.add(input);

  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      const found = scanKnownFields(input[i], `${path}[${i}]`, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const obj = input as Record<string, unknown>;

  for (const [key, value] of Object.entries(obj)) {
    if (!KNOWN_PHONE_KEYS.has(normalizeKey(key))) continue;
    const found = buildPhone(value, path ? `${path}.${key}` : key);
    if (found) return found;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (!PREFERRED_NESTED_KEYS.has(normalizeKey(key))) continue;
    const found = scanKnownFields(value, path ? `${path}.${key}` : key, seen, depth + 1);
    if (found) return found;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (PREFERRED_NESTED_KEYS.has(normalizeKey(key))) continue;
    if (!isPlainObject(value) && !Array.isArray(value)) continue;
    const found = scanKnownFields(value, path ? `${path}.${key}` : key, seen, depth + 1);
    if (found) return found;
  }

  return null;
}

function scanPhoneLikeValues(input: unknown, path: string, seen: WeakSet<object>, depth: number): ExtractedPhone | null {
  if (depth > 8 || input === undefined || input === null) return null;

  if (typeof input !== "object") {
    if (!valueLooksPhoneLike(input, path)) return null;
    return buildPhone(input, path);
  }

  if (seen.has(input)) return null;
  seen.add(input);

  if (Array.isArray(input)) {
    for (let i = 0; i < input.length; i++) {
      const found = scanPhoneLikeValues(input[i], `${path}[${i}]`, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof value !== "object" && valueLooksPhoneLike(value, childPath)) {
      const found = buildPhone(value, childPath);
      if (found) return found;
    }
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isPlainObject(value) && !Array.isArray(value)) continue;
    const found = scanPhoneLikeValues(value, path ? `${path}.${key}` : key, seen, depth + 1);
    if (found) return found;
  }

  return null;
}

export function extractPhoneFromRow(input: unknown): ExtractedPhone {
  if (input === undefined || input === null) return {};

  const knownFieldPhone = scanKnownFields(input, "", new WeakSet<object>(), 0);
  if (knownFieldPhone) return knownFieldPhone;

  const phoneLikeValue = scanPhoneLikeValues(input, "", new WeakSet<object>(), 0);
  return phoneLikeValue || {};
}
