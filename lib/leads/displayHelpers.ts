// lib/leads/displayHelpers.ts

export function isEffectivelyEmpty(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "" || v.trim() === "-" || v.trim().toLowerCase() === "null";
  if (typeof v === "number") return v === 0 || Number.isNaN(v);
  return false;
}

export function getLeadValue(lead: any, key: "firstName" | "lastName" | "phone" | "email" | "state" | "age") {
  if (!lead) return undefined;
  if (key === "firstName") return lead.firstName ?? lead["First Name"];
  if (key === "lastName") return lead.lastName ?? lead["Last Name"];
  if (key === "phone") return lead.phone ?? lead["Phone"];
  if (key === "email") return lead.email ?? lead["Email"];
  if (key === "state") return lead.state ?? lead["State"];
  if (key === "age") return lead.age ?? lead["Age"];
  return undefined;
}

export function flattenLeadFieldsForDisplay(lead: any): Record<string, any> {
  const merged: Record<string, any> = {};
  const merge = (source: any) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    for (const [key, value] of Object.entries(source)) {
      if (merged[key] === undefined) merged[key] = value;
    }
  };
  merge(lead);
  merge(lead?.customFields);
  merge(lead?.fields);
  merge(lead?.data);
  merge(lead?.sheet);
  merge(lead?.payload);
  merge(lead?.rawRow);
  return merged;
}

export function getLeadDisplayName(lead: any): string {
  const fields = flattenLeadFieldsForDisplay(lead);
  const clean = (value: any) => (typeof value === "string" ? value.trim() : value ? String(value).trim() : "");
  const fromCamel = [clean(fields.firstName), clean(fields.lastName)].filter(Boolean).join(" ").trim();
  if (fromCamel) return fromCamel;
  const fromTitle = [clean(fields["First Name"]), clean(fields["Last Name"])].filter(Boolean).join(" ").trim();
  if (fromTitle) return fromTitle;
  return (
    clean(fields.name) ||
    clean(fields.Name) ||
    clean(fields.fullName) ||
    clean(fields["Full Name"]) ||
    clean(fields.email) ||
    clean(fields.Email) ||
    clean(fields.phone) ||
    clean(fields.Phone) ||
    "Unknown Lead"
  );
}

export function matchesLeadSearch(lead: any, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const name = getLeadDisplayName(lead).toLowerCase();
  const email = String(getLeadValue(lead, "email") || "").toLowerCase();
  if (name.includes(t) || email.includes(t)) return true;
  const phone = String(getLeadValue(lead, "phone") || "");
  if (phone.toLowerCase().includes(t)) return true;
  const phoneDigits = phone.replace(/\D+/g, "");
  const termDigits = t.replace(/\D+/g, "");
  if (termDigits.length >= 1 && phoneDigits.includes(termDigits)) return true;
  return false;
}
