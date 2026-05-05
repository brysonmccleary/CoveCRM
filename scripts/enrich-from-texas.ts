import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium, type Browser, type Page } from "playwright-core";
import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";

const DEFAULT_BATCH_SIZE = Number(process.env.DOI_TX_BATCH_SIZE || 25);
const MAX_CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.DOI_TX_CONCURRENCY || 1))
);
const CHROME_PATH =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TEXAS_LOOKUP_URL =
  process.env.TEXAS_LICENSE_LOOKUP_URL ||
  "https://txapps.texas.gov/NASApp/tdi/TdiARManager/";
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?1[-.\s]*)?(?:\(?\d{3}\)?[-.\s]*)\d{3}[-.\s]*\d{4}/;

type TexasProfile = {
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  agencyName: string;
  licenseNumber: string;
  licenseType: string;
  licenseStatus: string;
  licenseIssueDate: string;
  licenseExpirationDate: string;
  matchedBy: "license" | "npn";
};

type TexasSummary = {
  searched: number;
  matched: number;
  hydrated: number;
  skipped: number;
  errors: number;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function normalizeText(text?: string | null) {
  return clean(
    (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
  );
}

function splitFullName(fullName?: string | null) {
  const parts = clean(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function missingIdentityFilter() {
  return {
    state: "TX",
    $and: [
      {
        $or: [
          { firstName: "" },
          { firstName: null },
          { firstName: { $exists: false } },
          { lastName: "" },
          { lastName: null },
          { lastName: { $exists: false } },
        ],
      },
      {
        $or: [{ licenseNumber: { $ne: "" } }, { npn: { $ne: "" } }],
      },
    ],
  };
}

async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
    }
  }
  throw lastErr;
}

async function createBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    executablePath: CHROME_PATH,
  });
}

async function gotoTexas(page: Page) {
  await page.goto(TEXAS_LOOKUP_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0) {
      if (await locator.isVisible().catch(() => false)) {
        await locator.click({ timeout: 5000 }).catch(() => null);
        return true;
      }
    }
  }
  return false;
}

async function fillFirstVisible(page: Page, selectors: string[], value: string) {
  if (!value) return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) > 0) {
      if (await locator.isVisible().catch(() => false)) {
        await locator.fill(value, { timeout: 5000 }).catch(() => null);
        return true;
      }
    }
  }
  return false;
}

async function fillByLabelText(page: Page, labelPattern: RegExp, value: string) {
  if (!value) return false;
  const labels = page.locator("label");
  const count = await labels.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const label = labels.nth(i);
    const text = normalizeText(await label.textContent().catch(() => ""));
    if (!labelPattern.test(text)) continue;
    const forAttr = await label.getAttribute("for").catch(() => null);
    if (forAttr) {
      const input = page.locator(`#${forAttr}`).first();
      if ((await input.count().catch(() => 0)) > 0) {
        await input.fill(value, { timeout: 5000 }).catch(() => null);
        return true;
      }
    }
    const nestedInput = label.locator("input, textarea").first();
    if ((await nestedInput.count().catch(() => 0)) > 0) {
      await nestedInput.fill(value, { timeout: 5000 }).catch(() => null);
      return true;
    }
  }
  return false;
}

async function prepareSearchForm(page: Page) {
  await clickFirstVisible(page, [
    'button:has-text("License")',
    'a:has-text("License")',
    'text="License Search"',
    'text="Agent Search"',
  ]);

  await clickFirstVisible(page, [
    'button:has-text("Accept")',
    'button:has-text("I Agree")',
    'input[type="submit"][value*="Accept"]',
    'input[type="button"][value*="Accept"]',
  ]);

  await clickFirstVisible(page, [
    'label:has-text("Individual")',
    'text="Individual"',
  ]);

  await page.waitForTimeout(500);
}

async function submitTexasSearch(
  page: Page,
  mode: "license" | "npn",
  value: string
) {
  const selectors =
    mode === "license"
      ? [
          'input[name*="license" i]',
          'input[id*="license" i]',
          'input[aria-label*="license" i]',
          'input[placeholder*="license" i]',
          'input[name*="number" i]',
        ]
      : [
          'input[name*="npn" i]',
          'input[id*="npn" i]',
          'input[aria-label*="npn" i]',
          'input[placeholder*="npn" i]',
          'input[name*="producer" i]',
        ];

  await clickFirstVisible(page, [
    mode === "license" ? 'label:has-text("License")' : 'label:has-text("NPN")',
    mode === "license" ? 'text="License Number"' : 'text="NPN"',
  ]);

  let filled = await fillFirstVisible(page, selectors, value);
  if (!filled) {
    filled = await fillByLabelText(
      page,
      mode === "license" ? /license|licence/i : /npn|producer/i,
      value
    );
  }
  if (!filled) return false;

  await clickFirstVisible(page, [
    'button:has-text("Search")',
    'input[type="submit"][value*="Search"]',
    'input[type="button"][value*="Search"]',
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  return true;
}

async function collectResultRows(page: Page) {
  const locators = [
    page.locator("table tbody tr"),
    page.locator('[role="row"]').filter({ has: page.locator("a") }),
    page.locator("tr").filter({ has: page.locator("a") }),
    page.locator("li").filter({ has: page.locator("a") }),
  ];
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    if (count > 0) return locator;
  }
  return page.locator("table tbody tr").filter({ has: page.locator("a") });
}

async function findMatchingRow(page: Page, licenseNumber: string, npn: string) {
  const rows = await collectResultRows(page);
  const count = await rows.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const text = normalizeText(await row.textContent().catch(() => ""));
    if (!text) continue;
    if (licenseNumber && text.includes(licenseNumber)) return { row, count };
    if (npn && text.includes(npn)) return { row, count };
  }
  if (count === 1) return { row: rows.nth(0), count };
  return { row: null as any, count };
}

function extractLabelValue(label: string, html: string, text: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`${escaped}\\s*:?\\s*</[^>]+>\\s*<[^>]+>\\s*([^<]+)`, "i"),
    new RegExp(`${escaped}\\s*:?\\s*([^<\\n]+)`, "i"),
  ];
  for (const pattern of patterns) {
    const htmlMatch = html.match(pattern);
    if (htmlMatch?.[1]) return normalizeText(htmlMatch[1]);
    const textMatch = text.match(pattern);
    if (textMatch?.[1]) return normalizeText(textMatch[1]);
  }
  return "";
}

async function parseDetailPage(
  page: Page,
  matchedBy: "license" | "npn"
): Promise<TexasProfile> {
  const html = await page.content();
  const text = normalizeText(await page.textContent("body").catch(() => ""));
  const title = normalizeText(await page.title().catch(() => ""));
  const fullName =
    extractLabelValue("Name", html, text) ||
    extractLabelValue("Licensee Name", html, text) ||
    extractLabelValue("Agent Name", html, text) ||
    title;
  const split = splitFullName(fullName);
  const email = ((html.match(EMAIL_REGEX) || text.match(EMAIL_REGEX) || [])[0] || "").toLowerCase();
  const phone =
    extractLabelValue("Phone", html, text) ||
    extractLabelValue("Business Phone", html, text) ||
    (text.match(PHONE_REGEX)?.[0] || "");
  const address =
    extractLabelValue("Address", html, text) ||
    extractLabelValue("Business Address", html, text) ||
    extractLabelValue("Mailing Address", html, text);
  const city = extractLabelValue("City", html, text);
  const state = extractLabelValue("State", html, text);
  const agencyName =
    extractLabelValue("Agency", html, text) ||
    extractLabelValue("Business Name", html, text) ||
    extractLabelValue("Company", html, text);
  const licenseNumber =
    extractLabelValue("License Number", html, text) ||
    extractLabelValue("License No.", html, text);
  const licenseType =
    extractLabelValue("License Type", html, text) ||
    extractLabelValue("Type", html, text);
  const licenseStatus =
    extractLabelValue("Status", html, text) ||
    extractLabelValue("License Status", html, text);
  const licenseIssueDate =
    extractLabelValue("Issue Date", html, text) ||
    extractLabelValue("Effective Date", html, text);
  const licenseExpirationDate =
    extractLabelValue("Expiration Date", html, text) ||
    extractLabelValue("Expire Date", html, text);

  return {
    matchedBy,
    firstName: split.firstName,
    lastName: split.lastName,
    fullName,
    phone: clean(phone),
    email: clean(email),
    address: clean(address),
    city: clean(city),
    state: clean(state),
    agencyName: clean(agencyName),
    licenseNumber: clean(licenseNumber),
    licenseType: clean(licenseType),
    licenseStatus: clean(licenseStatus),
    licenseIssueDate: clean(licenseIssueDate),
    licenseExpirationDate: clean(licenseExpirationDate),
  };
}

async function lookupTexasAgent(page: Page, agent: any): Promise<TexasProfile | null> {
  const license = clean(agent.licenseNumber);
  const npn = clean(agent.npn);

  for (const mode of ["license", "npn"] as const) {
    const value = mode === "license" ? license : npn;
    if (!value) continue;

    await gotoTexas(page);
    await prepareSearchForm(page);
    const submitted = await submitTexasSearch(page, mode, value);
    if (!submitted) continue;

    const { row, count } = await findMatchingRow(page, license, npn);
    console.log(`[tx-results] agentId=${agent._id} count=${count}`);
    if (!row) continue;

    const rowText = normalizeText(await row.textContent().catch(() => ""));
    const name = rowText.split(/\s{2,}/)[0] || rowText;
    console.log(`[tx-match] agentId=${agent._id} name="${name}"`);

    const link = row.locator("a").first();
    if ((await link.count().catch(() => 0)) > 0) {
      await link.click({ timeout: 10000 });
    } else {
      await row.click({ timeout: 10000 });
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    return parseDetailPage(page, mode);
  }

  return null;
}

async function persistTexasProfile(agent: any, profile: TexasProfile) {
  const set: Record<string, any> = {
    identitySource: "tx_lookup",
    identityUpdatedAt: new Date(),
  };

  if (!clean(agent.firstName) && profile.firstName) set.firstName = profile.firstName;
  if (!clean(agent.lastName) && profile.lastName) set.lastName = profile.lastName;
  if (!clean(agent.fullName) && profile.fullName) set.fullName = profile.fullName;
  if (!clean(agent.phone) && profile.phone) set.phone = profile.phone;
  if (!clean(agent.email) && profile.email) set.email = profile.email;
  if (!clean(agent.address) && profile.address) set.address = profile.address;
  if (!clean(agent.city) && profile.city) set.city = profile.city;
  if (!clean(agent.state) && profile.state) set.state = profile.state;
  if (!clean(agent.agencyName) && profile.agencyName) set.agencyName = profile.agencyName;
  if ((!clean(agent.licenseNumber) || clean(agent.licenseNumber) === clean(agent.npn)) && profile.licenseNumber) {
    set.licenseNumber = profile.licenseNumber;
  }
  if ((!clean(agent.licenseType) || clean(agent.licenseType).length < clean(profile.licenseType).length) && profile.licenseType) {
    set.licenseType = profile.licenseType;
  }
  if ((!clean(agent.licenseStatus) || clean(agent.licenseStatus).length < clean(profile.licenseStatus).length) && profile.licenseStatus) {
    set.licenseStatus = profile.licenseStatus;
  }
  if ((!clean(agent.licenseIssueDate) || clean(agent.licenseIssueDate).length < clean(profile.licenseIssueDate).length) && profile.licenseIssueDate) {
    set.licenseIssueDate = profile.licenseIssueDate;
  }
  if ((!clean(agent.licenseExpirationDate) || clean(agent.licenseExpirationDate).length < clean(profile.licenseExpirationDate).length) && profile.licenseExpirationDate) {
    set.licenseExpirationDate = profile.licenseExpirationDate;
  }

  await DOIAgent.updateOne({ _id: agent._id }, { $set: set });
}

async function enrichOneTexasAgent(browser: Browser, agent: any) {
  const existingFirst = clean(agent.firstName);
  const existingLast = clean(agent.lastName);
  if (existingFirst && existingLast) {
    console.log(`[tx-skip] agentId=${agent._id} reason=already_hydrated`);
    return { matched: false, hydrated: false, skipped: true, errored: false };
  }

  const license = clean(agent.licenseNumber);
  const npn = clean(agent.npn);
  console.log(`[tx-search] agentId=${agent._id} license=${license} npn=${npn}`);

  if (!license && !npn) {
    console.log(`[tx-skip] agentId=${agent._id} reason=missing_lookup_keys`);
    return { matched: false, hydrated: false, skipped: true, errored: false };
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const profile = await withRetry(() => lookupTexasAgent(page, agent), 1);
    if (!profile) {
      console.log(`[tx-skip] agentId=${agent._id} reason=no_match`);
      return { matched: false, hydrated: false, skipped: true, errored: false };
    }

    await persistTexasProfile(agent, profile);
    console.log(`[tx-hydrate] agentId=${agent._id}`);
    return { matched: true, hydrated: true, skipped: false, errored: false };
  } catch (err: any) {
    console.log(`[tx-error] agentId=${agent._id} error=${JSON.stringify(err?.message || String(err))}`);
    return { matched: false, hydrated: false, skipped: false, errored: true };
  } finally {
    await page.close().catch(() => null);
    await context.close().catch(() => null);
  }
}

export async function enrichFromTexasAgents(agents: any[]): Promise<TexasSummary> {
  if (!agents.length) {
    return { searched: 0, matched: 0, hydrated: 0, skipped: 0, errors: 0 };
  }

  const browser = await createBrowser();
  try {
    const summary: TexasSummary = {
      searched: 0,
      matched: 0,
      hydrated: 0,
      skipped: 0,
      errors: 0,
    };

    for (let i = 0; i < agents.length; i += MAX_CONCURRENCY) {
      const chunk = agents.slice(i, i + MAX_CONCURRENCY);
      const results = await Promise.all(chunk.map((agent) => enrichOneTexasAgent(browser, agent)));
      summary.searched += chunk.length;
      for (const result of results) {
        if (result.matched) summary.matched += 1;
        if (result.hydrated) summary.hydrated += 1;
        if (result.skipped) summary.skipped += 1;
        if (result.errored) summary.errors += 1;
      }
    }

    return summary;
  } finally {
    await browser.close().catch(() => null);
  }
}

export async function enrichFromTexasBatch(batchSize = DEFAULT_BATCH_SIZE) {
  const agents = await DOIAgent.find(missingIdentityFilter())
    .sort({ updatedAt: 1, createdAt: 1 })
    .limit(batchSize)
    .lean();

  return enrichFromTexasAgents(agents);
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const arg = Number(process.argv[2] || DEFAULT_BATCH_SIZE);
    const summary = await enrichFromTexasBatch(
      Number.isFinite(arg) && arg > 0 ? arg : DEFAULT_BATCH_SIZE
    );
    console.log(
      `[enrich-from-texas] searched=${summary.searched} matched=${summary.matched} hydrated=${summary.hydrated} skipped=${summary.skipped} errors=${summary.errors}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[enrich-from-texas] Fatal error:", err?.message || err);
    process.exit(1);
  });
}
