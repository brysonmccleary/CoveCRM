import { URL } from "url";

const SBS_BASE_URL =
  process.env.SBS_LOOKUP_BASE_URL || "https://sbs.naic.org/solar-external-lookup";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CoveCRM/1.0";
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type SbsLookupInput = {
  state: string;
  npn?: string;
  licenseNumber?: string;
};

export type SbsLookupResult = {
  matchedBy: "npn" | "licenseNumber";
  firstName: string;
  lastName: string;
  fullName: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  businessAddress: string;
  licenseStatus: string;
  licenseType: string;
  agencyName: string;
  rawUrl: string;
};

type CandidateRow = {
  name: string;
  npn: string;
  licenseNumber: string;
  detailUrl: string;
};

function stripHtml(html: string) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeText(value?: string | null) {
  return decodeEntities((value || "").trim());
}

function extractField(label: string, html: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}\\s*</[^>]+>\\s*<[^>]+>\\s*([^<]+)`, "i"),
    new RegExp(`${escaped}\\s*:?\\s*</[^>]+>\\s*([^<]+)`, "i"),
    new RegExp(`${escaped}\\s*:?\\s*([^<\\n]+)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return "";
}

function absoluteUrl(input: string) {
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  return new URL(input.replace(/^\/+/, "/"), `${SBS_BASE_URL}/`).toString();
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`SBS request failed (${response.status})`);
  }
  return response.text();
}

function buildSearchUrls(input: SbsLookupInput) {
  const state = (input.state || "").trim();
  const urls: Array<{ url: string; matchedBy: "npn" | "licenseNumber" }> = [];
  const push = (matchedBy: "npn" | "licenseNumber", value?: string) => {
    const cleaned = (value || "").trim();
    if (!cleaned) return;
    const url = new URL(`${SBS_BASE_URL.replace(/\/$/, "")}/lookup/licensee/search`);
    url.searchParams.set("jurisdiction", state);
    url.searchParams.set("searchType", "Licensee");
    url.searchParams.set("entityType", "Individual");
    if (matchedBy === "npn") {
      url.searchParams.set("npn", cleaned);
    } else {
      url.searchParams.set("licenseNumber", cleaned);
    }
    urls.push({ url: url.toString(), matchedBy });
  };

  push("npn", input.npn);
  push("licenseNumber", input.licenseNumber);
  return urls;
}

function extractRows(html: string): CandidateRow[] {
  const rows: CandidateRow[] = [];
  const anchorRegex =
    /<a[^>]+href="([^"]*licensee[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,400}?(NPN|License Number|License #)?[\s\S]{0,1200}?/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html))) {
    const detailUrl = absoluteUrl(match[1]);
    const block = match[0];
    const name = normalizeText(stripHtml(match[2]));
    const npnMatch = block.match(/NPN[^0-9]*([0-9]+)/i);
    const licenseMatch = block.match(/License(?: Number| #)?[^A-Z0-9]*([A-Z0-9-]+)/i);
    rows.push({
      name,
      npn: npnMatch?.[1] || "",
      licenseNumber: licenseMatch?.[1] || "",
      detailUrl,
    });
  }
  return rows;
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function parseDetail(detailHtml: string, matchedBy: "npn" | "licenseNumber", rawUrl: string): SbsLookupResult {
  const text = stripHtml(detailHtml);
  const fullName =
    extractField("Name", detailHtml) ||
    extractField("Licensee Name", detailHtml) ||
    extractField("Individual Name", detailHtml);
  const split = splitFullName(fullName);
  const email = ((detailHtml.match(EMAIL_REGEX) || [])[0] || "").toLowerCase();
  const phone =
    extractField("Phone", detailHtml) ||
    extractField("Business Phone", detailHtml) ||
    extractField("Phone Number", detailHtml);
  const city = extractField("City", detailHtml);
  const state = extractField("State", detailHtml);
  const businessAddress =
    extractField("Business Address", detailHtml) ||
    extractField("Address", detailHtml) ||
    extractField("Mailing Address", detailHtml);
  const licenseStatus = extractField("Status", detailHtml) || extractField("License Status", detailHtml);
  const licenseType = extractField("License Type", detailHtml) || extractField("Type", detailHtml);
  const agencyName =
    extractField("Business Name", detailHtml) ||
    extractField("Agency", detailHtml) ||
    extractField("Company", detailHtml);

  return {
    matchedBy,
    firstName: split.firstName,
    lastName: split.lastName,
    fullName,
    city,
    state,
    phone,
    email,
    businessAddress,
    licenseStatus,
    licenseType,
    agencyName,
    rawUrl,
  };
}

export async function lookupSbsIdentity(input: SbsLookupInput): Promise<SbsLookupResult | null> {
  const searchUrls = buildSearchUrls(input);
  for (const search of searchUrls) {
    const html = await fetchHtml(search.url);
    const rows = extractRows(html);
    const exact = rows.find((row) => {
      if (search.matchedBy === "npn") {
        return row.npn && row.npn === (input.npn || "").trim();
      }
      return row.licenseNumber && row.licenseNumber === (input.licenseNumber || "").trim();
    });
    if (!exact?.detailUrl) continue;
    const detailHtml = await fetchHtml(exact.detailUrl);
    return parseDetail(detailHtml, search.matchedBy, exact.detailUrl);
  }
  return null;
}
