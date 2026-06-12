// utils/renderTemplate.ts
//
// Safe template renderer for SMS drips.
//
// Canonical tokens:
//   {{ contact.first_name }}, {{ contact.last_name }}, {{ contact.full_name }}
//   {{ agent.name }}, {{ agent.first_name }}, {{ agent.last_name }}, {{ agent.phone }}
//
// Legacy/alternate token names are mapped to canonical paths via FIELD_ALIASES.
// Supports default filters:  {{ contact.first_name | default:"friend" }}
// Unknown contact-name tokens fall back to "there"; agent tokens fall back to "your agent".
// A post-render safety scan replaces any remaining {{ }} or [[ ]] patterns before the
// message can be sent — raw template braces are never delivered to Twilio.

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
    phone?: string | null;
  };
  /** Optional: passed to warn logs only, never rendered */
  _meta?: { leadId?: string | null; campaignId?: string | null };
};

// ── Alias table ──────────────────────────────────────────────────────────────
// Maps every normalized legacy/alternate field name → canonical dot-path.
// normalizeFieldPath() lowercases + underscores before this lookup.

const FIELD_ALIASES: Record<string, string> = {
  // contact.first_name
  "first_name":                "contact.first_name",
  "firstname":                 "contact.first_name",
  "contact.firstname":         "contact.first_name",
  "client_first_name":         "contact.first_name",
  "clientfirstname":           "contact.first_name",
  "client.first_name":         "contact.first_name",
  "lead_first_name":           "contact.first_name",
  "leadfirstname":             "contact.first_name",
  "contact_first_name":        "contact.first_name",

  // contact.last_name
  "last_name":                 "contact.last_name",
  "lastname":                  "contact.last_name",
  "contact.lastname":          "contact.last_name",
  "client_last_name":          "contact.last_name",
  "clientlastname":            "contact.last_name",
  "client.last_name":          "contact.last_name",
  "lead_last_name":            "contact.last_name",
  "leadlastname":              "contact.last_name",
  "contact_last_name":         "contact.last_name",

  // contact.full_name
  "full_name":                 "contact.full_name",
  "fullname":                  "contact.full_name",
  "contact.fullname":          "contact.full_name",
  "client_full_name":          "contact.full_name",
  "clientfullname":            "contact.full_name",
  "client.full_name":          "contact.full_name",

  // agent.name
  "agent_name":                "agent.name",
  "agentname":                 "agent.name",

  // agent.first_name
  "agent_first_name":          "agent.first_name",
  "agentfirstname":            "agent.first_name",
  "agent.firstname":           "agent.first_name",

  // agent.last_name
  "agent_last_name":           "agent.last_name",
  "agentlastname":             "agent.last_name",
  "agent.lastname":            "agent.last_name",

  // agent.phone
  "agent_phone":               "agent.phone",
  "agentphone":                "agent.phone",
  "agent.phonenumber":         "agent.phone",
};

function resolveAlias(path: string): string {
  return FIELD_ALIASES[path] ?? path;
}

function normalizeFieldPath(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

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
  const path = resolveAlias(normalizeFieldPath(expr));

  switch (path) {
    case "contact.first_name":  return ctx.contact.first_name  || undefined;
    case "contact.last_name":   return ctx.contact.last_name   || undefined;
    case "contact.full_name":   return ctx.contact.full_name   || undefined;
    case "agent.name":          return ctx.agent.name          || undefined;
    case "agent.first_name":    return ctx.agent.first_name    || undefined;
    case "agent.last_name":     return ctx.agent.last_name     || undefined;
    case "agent.phone":         return ctx.agent.phone         || undefined;
    default:                    return undefined;
  }
}

function parseDefaultFilter(part: string): string | undefined {
  const m =
    part.match(/default\s*:\s*"([^"]*)"/i) ||
    part.match(/default\s*:\s*'([^']*)'/i) ||
    part.match(/default\s*:\s*([^\s'"}|]+)/i);
  return m ? m[1] : undefined;
}

// Implicit fallback when value is null/empty and no explicit |default: filter was set.
// Contact name tokens default to "there" so messages read naturally.
// Agent tokens default to the agent name or "your agent".
function implicitDefault(canonicalPath: string, ctx: TemplateContext): string {
  switch (canonicalPath) {
    case "contact.first_name":
    case "contact.last_name":
      return "there";
    case "contact.full_name": {
      const derived = [ctx.contact?.first_name, ctx.contact?.last_name]
        .filter(Boolean)
        .join(" ");
      return derived || "there";
    }
    case "agent.name":
      return ctx.agent?.name || "your agent";
    case "agent.first_name":
      return ctx.agent?.first_name || ctx.agent?.name || "your agent";
    case "agent.last_name":
      return ctx.agent?.last_name || "";
    case "agent.phone":
      return ctx.agent?.phone || "";
    default:
      return "";
  }
}

// ── Post-render safety scan ──────────────────────────────────────────────────
// Replaces any {{ }} or [[ ]] patterns that survived the main render pass.
// Logs a warning so the template can be fixed. Raw template braces are
// never forwarded to Twilio.
function sanitizeUnresolvedTokens(body: string, ctx: TemplateContext): string {
  const meta = ctx._meta ?? {};

  // Remaining {{ }}
  let cleaned = body.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_full, inner: string) => {
    const path = resolveAlias(normalizeFieldPath(String(inner).split("|")[0].trim()));
    console.warn("[renderTemplate] Unresolved {{ }} token after render", {
      token: inner.trim(),
      resolvedPath: path,
      ...meta,
    });
    if (path.startsWith("contact.")) return "there";
    if (path === "agent.name") return ctx.agent?.name || "your agent";
    if (path.startsWith("agent.")) return "";
    return "";
  });

  // [[ ]] patterns (non-standard but guard against copy-paste errors)
  cleaned = cleaned.replace(/\[\[\s*([^\]]+)\s*\]\]/g, (_full, inner: string) => {
    const path = resolveAlias(normalizeFieldPath(String(inner).split("|")[0].trim()));
    console.warn("[renderTemplate] Unresolved [[ ]] token after render", {
      token: inner.trim(),
      resolvedPath: path,
      ...meta,
    });
    if (path.startsWith("contact.")) return "there";
    if (path.startsWith("agent.")) return ctx.agent?.name || "your agent";
    return "";
  });

  return cleaned;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function renderTemplate(template: string, ctx: TemplateContext): string {
  if (!template || typeof template !== "string") return "";

  const rendered = template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_full, inner: string) => {
    try {
      const parts = String(inner)
        .split("|")
        .map((p: string) => p.trim())
        .filter(Boolean);

      if (parts.length === 0) return "";

      const fieldExpr = parts[0];
      let value = getValue(fieldExpr, ctx);

      // Apply explicit |default: filters first
      for (let i = 1; i < parts.length; i++) {
        const filter = parts[i];
        if (/^default\s*:/.test(filter)) {
          if (value == null || value === "") {
            const fallback = parseDefaultFilter(filter);
            if (fallback !== undefined) value = fallback;
          }
        }
      }

      // No explicit default was set — apply smart implicit default
      if (value == null || value === "") {
        const canonicalPath = resolveAlias(normalizeFieldPath(fieldExpr));
        const def = implicitDefault(canonicalPath, ctx);
        if (def) value = def;
      }

      return value == null ? "" : String(value);
    } catch {
      return "";
    }
  });

  // Belt-and-suspenders: eliminate any patterns that escaped the main replace
  return sanitizeUnresolvedTokens(rendered, ctx);
}

/** Ensures a compliant opt-out phrase is present exactly once when enabled. */
export function ensureOptOut(
  message: string,
  opts?: { appendOptOut?: boolean },
): string {
  const optOut = " Reply STOP to opt out.";
  const body = String(message || "").trim();
  if (opts?.appendOptOut === false) return body;
  if (!body) return optOut.trim();
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
