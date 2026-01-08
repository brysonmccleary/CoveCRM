// utils/renderTemplate.ts

/**
 * Minimal, safe template renderer for SMS drips.
 * Supports:
 *   {{ contact.first_name }}, {{ contact.last_name }}, {{ contact.full_name }}
 *   {{ agent.name }}, {{ agent.first_name }}, {{ agent.last_name }}
 *   Case/whitespace tolerant, e.g. {{ Contact.First_Name }}
 *   Default filter: {{ contact.first_name | default:"there" }}
 */

export type TemplateContext = {
  contact: {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
  };
  agent: {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
};

function normalizeFieldPath(raw: string): string {
  // Example inputs:
  // " contact.first_name ", "Contact.First_Name", "AGENT . LAST NAME"
  // -> "contact.first_name", "contact.first_name", "agent.last_name"
  const cleaned = String(raw || "")
    .replace(/\s+/g, " ") // collapse runs of whitespace
    .trim();

  // Split on dot, normalize segments
  const parts = cleaned.split(".").map((seg) =>
    seg
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/__+/g, "_")
  );

  return parts.join(".");
}

function getValue(expr: string, ctx: TemplateContext): string | undefined {
  const path = normalizeFieldPath(expr);

  switch (path) {
    case "contact.first_name":
      return (ctx.contact.first_name || undefined) ?? undefined;
    case "contact.last_name":
      return (ctx.contact.last_name || undefined) ?? undefined;
    case "contact.full_name":
      return (ctx.contact.full_name || undefined) ?? undefined;

    case "agent.name":
      return (ctx.agent.name || undefined) ?? undefined;
    case "agent.first_name":
      return (ctx.agent.first_name || undefined) ?? undefined;
    case "agent.last_name":
      return (ctx.agent.last_name || undefined) ?? undefined;

    default:
      return undefined;
  }
}

function parseDefaultFilter(part: string): string | undefined {
  // Accept: default:"there"  |  default:'there'  |  default:there
  const m =
    part.match(/default\s*:\s*"([^"]*)"/i) ||
    part.match(/default\s*:\s*'([^']*)'/i) ||
    part.match(/default\s*:\s*([^\s'"}|]+)/i);
  return m ? m[1] : undefined;
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  if (!template || typeof template !== "string") return "";

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_full, inner: string) => {
    try {
      // Split filters: left-most is the field, rest can be filters (we only support default)
      const parts = String(inner)
        .split("|")
        .map((p: string) => p.trim())
        .filter(Boolean);

      if (parts.length === 0) return "";

      const fieldExpr = parts[0];
      let value = getValue(fieldExpr, ctx);

      // Apply filters from left to right after field resolution
      for (let i = 1; i < parts.length; i++) {
        const filter = parts[i];
        if (/^default\s*:/.test(filter)) {
          if (value == null || value === "") {
            const fallback = parseDefaultFilter(filter);
            if (fallback !== undefined) value = fallback;
          }
        }
      }

      // If still empty, return empty string (don’t leave raw handlebars in output)
      return value == null ? "" : String(value);
    } catch {
      return "";
    }
  });
}

/** Ensures a compliant opt-out phrase is present exactly once. */
export function ensureOptOut(message: string): string {
  const optOut = " Reply STOP to opt out.";
  const body = String(message || "").trim();
  if (!body) return optOut.trim();

  // If the exact opt-out is already present (case-sensitive check), don't duplicate
  if (body.endsWith(optOut.trim())) return body;

  return `${body}${optOut}`;
}

/** Helper to derive agent pieces from a single name string. */
export function splitName(full?: string | null): { first: string | null; last: string | null } {
  const name = (full || "").trim();
  if (!name) return { first: null, last: null };
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
