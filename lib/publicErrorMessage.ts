const TECHNICAL_ERROR_PATTERNS = [
  /\b(?:env(?:ironment)?\s+var(?:iable)?|process\.env|stack trace|mongodb|mongoose|stripeinvalidrequesterror)\b/i,
  /\b(?:price|prod|cus|sub|seti|pi|pm)_[A-Za-z0-9_]+\b/,
  /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/,
  /(?:TypeError|ReferenceError|SyntaxError|ECONN|ENOTFOUND|undefined is not|null is not)/i,
  /(?:\{|\}|\[object Object\]|at\s+[A-Za-z0-9_$./-]+\s*\()/,
];

/**
 * Converts server/provider failures into customer-safe copy. Technical detail
 * stays in server logs and is never rendered in the CRM.
 */
export function publicErrorMessage(value: unknown, fallback: string): string {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message || message.length > 240) return fallback;
  if (TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) return fallback;
  return message;
}
