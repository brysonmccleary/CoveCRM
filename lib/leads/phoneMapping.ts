export type ExtractedPhone = {
  phone: string;
  normalizedPhone: string;
};

export function normalizePhoneDigitsToE164(input: unknown): string {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;

  return "";
}

export function extractPhoneFromRow(row: any): ExtractedPhone {
  if (!row || typeof row !== "object") {
    return { phone: "", normalizedPhone: "" };
  }

  const keys = [
    "phone",
    "Phone",
    "phoneNumber",
    "PhoneNumber",
    "phone_number",
    "Phone Number",
    "phone number",
    "Phone 1",
    "phone 1",
    "Phone1",
    "mobile",
    "Mobile",
    "cell",
    "Cell",
    "Cell Phone",
    "cell phone",
    "telephone",
    "Telephone",
    "rawPhone",
    "normalizedPhone",
  ];

  for (const key of keys) {
    const value = row[key];
    if (value == null) continue;

    const phone = String(value).trim();
    const normalizedPhone = normalizePhoneDigitsToE164(phone);

    if (phone || normalizedPhone) {
      return { phone, normalizedPhone };
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (!/phone|mobile|cell|tel/i.test(key)) continue;
    if (value == null) continue;

    const phone = String(value).trim();
    const normalizedPhone = normalizePhoneDigitsToE164(phone);

    if (phone || normalizedPhone) {
      return { phone, normalizedPhone };
    }
  }

  return { phone: "", normalizedPhone: "" };
}
