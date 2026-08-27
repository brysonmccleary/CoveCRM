export function normalizeContactPhone(value?: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeContactEmail(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildAccountWideContactFilter(userEmail: string, phone?: string, email?: string) {
  const normalizedPhone = normalizeContactPhone(phone);
  const normalizedEmail = normalizeContactEmail(email);
  const matchers: Record<string, any>[] = [];
  if (normalizedPhone) {
    matchers.push({ Phone: { $regex: new RegExp(normalizedPhone.split("").join("\\D*")) } });
  }
  if (normalizedEmail) {
    matchers.push(
      { email: normalizedEmail },
      { Email: { $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i") } }
    );
  }
  return matchers.length ? { userEmail: String(userEmail).toLowerCase(), $or: matchers } : null;
}

export function contactMatches(candidate: any, phone?: string, email?: string) {
  const normalizedPhone = normalizeContactPhone(phone);
  const normalizedEmail = normalizeContactEmail(email);
  const candidatePhone = normalizeContactPhone(candidate?.Phone);
  const candidateEmail = normalizeContactEmail(candidate?.email || candidate?.Email);
  return Boolean(
    (normalizedPhone && candidatePhone === normalizedPhone) ||
    (normalizedEmail && candidateEmail === normalizedEmail)
  );
}
