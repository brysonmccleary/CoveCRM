// lib/meta/retrieveLead.ts
// Retrieve a lead from the Meta Graph API using a leadgen_id

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

export interface MetaLeadData {
  leadgenId: string;
  formId: string;
  adId: string;
  adsetId: string;
  campaignId: string;
  pageId: string;
  createdTime: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zip: string;
  city: string;
  state: string;
  rawFieldData: any[];
  rawPayload: any;
}

function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "_");
}

function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName || "").trim().split(/\s+/);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ") || "",
  };
}

export async function retrieveMetaLead(leadgenId: string): Promise<MetaLeadData> {
  const token =
    process.env.META_SYSTEM_USER_TOKEN ||
    process.env.META_PAGE_ACCESS_TOKEN ||
    "";

  if (!token) {
    throw new Error("[retrieveMetaLead] No Meta access token configured");
  }

  const url = new URL(`${META_GRAPH_BASE}/${leadgenId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set(
    "fields",
    "id,created_time,field_data,form_id,ad_id,adset_id,campaign_id,page_id"
  );

  const resp = await fetch(url.toString(), { method: "GET" });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(
      `[retrieveMetaLead] Graph API error ${resp.status}: ${errBody.slice(0, 400)}`
    );
  }

  const payload = await resp.json() as any;
  const fieldData: { name: string; values: string[] }[] = payload.field_data || [];

  // Build field map
  const fields: Record<string, string> = {};
  for (const f of fieldData) {
    const key = normalizeFieldName(f.name);
    fields[key] = String(f.values?.[0] ?? "");
  }

  // Normalize name fields
  let firstName = fields["first_name"] || fields["fname"] || "";
  let lastName = fields["last_name"] || fields["lname"] || "";

  if (!firstName && !lastName && fields["full_name"]) {
    const parsed = parseFullName(fields["full_name"]);
    firstName = parsed.firstName;
    lastName = parsed.lastName;
  }

  return {
    leadgenId,
    formId: String(payload.form_id || ""),
    adId: String(payload.ad_id || ""),
    adsetId: String(payload.adset_id || ""),
    campaignId: String(payload.campaign_id || ""),
    pageId: String(payload.page_id || ""),
    createdTime: String(payload.created_time || ""),
    firstName,
    lastName,
    email: (fields["email"] || "").toLowerCase().trim(),
    phone: fields["phone_number"] || fields["phone"] || "",
    zip: fields["zip_code"] || fields["zip"] || fields["postal_code"] || "",
    city: fields["city"] || "",
    state: fields["state"] || "",
    rawFieldData: fieldData,
    rawPayload: payload,
  };
}
