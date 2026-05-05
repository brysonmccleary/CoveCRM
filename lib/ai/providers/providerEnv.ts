export function normalizeProviderApiKey(value: unknown): string {
  let key = String(value || "").trim();
  if (key.length >= 2) {
    const first = key[0];
    const last = key[key.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      key = key.slice(1, -1).trim();
    }
  }
  return key;
}

export function getSecretFingerprint(value: unknown) {
  const key = normalizeProviderApiKey(value);
  return {
    hasKey: Boolean(key),
    keyLength: key.length,
    keyPreview: key ? `${key.slice(0, 7)}...${key.slice(-4)}` : null,
  };
}

export function providerErrorCode(err: any): string {
  const status = Number(err?.status || err?.response?.status || 0);
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (status) return `provider_http_${status}`;
  return "provider_error";
}

export function sanitizeProviderError(value: any): string {
  const raw = String(value?.message || value || "provider_error");
  return raw
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "[redacted_api_key]")
    .replace(/(api key provided:\s*)[^\s.]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .slice(0, 180);
}
