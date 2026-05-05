import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { chromium, type Browser, type Page } from "playwright-core";
import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";

const DEFAULT_BATCH_SIZE = Number(process.env.DOI_SBS_BATCH_SIZE || 25);
const MAX_ATTEMPTS = Number(process.env.DOI_SBS_MAX_ATTEMPTS || 3);
const MAX_CONCURRENCY = Math.max(
  1,
  Math.min(3, Number(process.env.DOI_SBS_CONCURRENCY || 1))
);
const CHROME_PATH =
  process.env.CHROME_EXECUTABLE_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SBS_USE_CDP = process.env.SBS_USE_CDP === "true";
const SBS_CDP_URL = process.env.SBS_CDP_URL || "http://127.0.0.1:9222";
const TEST_SBS_NPN = clean(process.env.TEST_SBS_NPN || "");
const TEST_SBS_AGENT_ID = clean(process.env.TEST_SBS_AGENT_ID || "");
const SBS_BASE_URL =
  process.env.SBS_LOOKUP_BASE_URL || "https://sbs.naic.org/solar-external-lookup/";
const DEFAULT_SBS_STATES = ["Arizona", "New Mexico", "Nevada", "Utah", "Colorado"];
const SBS_STATES = (process.env.DOI_SBS_STATES || DEFAULT_SBS_STATES.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+?1[-.\s]*)?(?:\(?\d{3}\)?[-.\s]*)\d{3}[-.\s]*\d{4}/g;

type SbsProfile = {
  fullName: string;
  firstName: string;
  lastName: string;
  npn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
  businessAddress: string;
  domicileState: string;
  residentFlag: string;
  licenseNumber: string;
  licenseType: string;
  licenseStatus: string;
  licenseIssueDate: string;
  licenseEffectiveDate: string;
  licenseExpirationDate: string;
  licenseStatusDate: string;
  designatedHomeState: string;
  linesOfAuthority: string[];
  matchedState: string;
};

type EnrichResult = {
  matched: boolean;
  hydrated: boolean;
  skipped: boolean;
  errored: boolean;
  isFreshLicenseLead?: boolean;
  isLicenseActive?: boolean;
  isLicenseCurrent?: boolean;
};

type EnrichSummary = {
  searched: number;
  matched: number;
  hydrated: number;
  skipped: number;
  errors: number;
  fresh: number;
  activeCurrent: number;
};

type BrowserSession = {
  browser: Browser;
  mode: "launch" | "cdp";
  closeBrowser: () => Promise<void>;
};

function clean(value?: string | null) {
  return (value || "").replace(/\u00a0/g, " ").trim();
}

function normalizeText(text?: string | null) {
  return clean((text || "").replace(/\s+/g, " "));
}

function isBlank(value: unknown) {
  return clean(String(value || "")) === "";
}

function splitFullName(fullName?: string | null) {
  const normalized = clean(fullName);
  if (!normalized) return { firstName: "", lastName: "" };
  if (normalized.includes(",")) {
    const [last, rest] = normalized.split(",", 2).map((part) => clean(part));
    const parts = rest.split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || "",
      lastName: last || parts.slice(1).join(" "),
    };
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function uniqueStrings(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractEmails(text: string) {
  return uniqueStrings((text.match(EMAIL_REGEX) || []).map((email) => email.toLowerCase()));
}

function extractPhones(text: string) {
  return uniqueStrings(text.match(PHONE_REGEX) || []);
}

function extractWebsite(text: string) {
  const match = text.match(/https?:\/\/[^\s)]+|www\.[^\s)]+/i);
  return clean(match?.[0] || "");
}

function extractLabelValue(text: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`${escaped}\\s*:?\\s*([^\\n]+)`, "i"),
      new RegExp(`${escaped}\\s*\\n\\s*([^\\n]+)`, "i"),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        const value = normalizeText(match[1]).replace(/^[:\-]\s*/, "");
        if (value && value.toLowerCase() !== label.toLowerCase()) return value;
      }
    }
  }
  return "";
}

function collectLinesOfAuthority(text: string) {
  const lines: string[] = [];
  const regex = /Line(?:\s+Of)?\s+Authority\s*:?([^\n]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const value = normalizeText(match[1]);
    if (value) lines.push(value);
  }
  return uniqueStrings(lines);
}

function parseUsDate(value?: string | null) {
  const raw = clean(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

function yearsAgo(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

function isOnOrAfterToday(date: Date | null) {
  if (!date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);
  return compare >= today;
}

function isWithinMonths(date: Date | null, months: number) {
  if (!date) return false;
  return date >= monthsAgo(months);
}

function isWithinYears(date: Date | null, years: number) {
  if (!date) return false;
  return date >= yearsAgo(years);
}

function computeFreshness(profile: SbsProfile) {
  const status = clean(profile.licenseStatus).toLowerCase();
  const effectiveDate =
    parseUsDate(profile.licenseEffectiveDate) || parseUsDate(profile.licenseIssueDate);
  const expirationDate = parseUsDate(profile.licenseExpirationDate);
  const statusDate = parseUsDate(profile.licenseStatusDate);
  const isLicenseActive = /\bactive\b/.test(status);
  const isLicenseCurrent = Boolean(expirationDate && isOnOrAfterToday(expirationDate));
  const isRecentlyLicensed = isWithinYears(effectiveDate, 10);
  const isRecentlyRenewed =
    isWithinMonths(statusDate, 24) || isWithinMonths(effectiveDate, 24);
  const isFreshLicenseLead =
    isLicenseActive && isLicenseCurrent && (isRecentlyLicensed || isRecentlyRenewed);

  let freshnessBucket = "unknown";
  if (isLicenseActive && isLicenseCurrent && isRecentlyLicensed && isRecentlyRenewed) {
    freshnessBucket = "fresh_recent";
  } else if (isLicenseActive && isLicenseCurrent && (isRecentlyLicensed || isRecentlyRenewed)) {
    freshnessBucket = "active_recent";
  } else if (isLicenseActive && isLicenseCurrent) {
    freshnessBucket = "active_old";
  } else if (!isLicenseCurrent && (isRecentlyLicensed || isRecentlyRenewed)) {
    freshnessBucket = "expired_recent";
  } else if (!isLicenseCurrent && (effectiveDate || expirationDate || statusDate)) {
    freshnessBucket = "expired_old";
  }

  return {
    isLicenseActive,
    isLicenseCurrent,
    isRecentlyLicensed,
    isRecentlyRenewed,
    isFreshLicenseLead,
    freshnessBucket,
    effectiveDate: clean(profile.licenseEffectiveDate),
    expirationDate: clean(profile.licenseExpirationDate),
    statusDate: clean(profile.licenseStatusDate),
  };
}

function shouldSkipAgent(agent: any, force = false) {
  if (force) return false;
  return Boolean(
    clean(agent.email) &&
      clean(agent.phone) &&
      clean(agent.fullName) &&
      clean(agent.licenseStatus)
  );
}

function buildAgentFilter(force = false) {
  const base = {
    npn: { $exists: true, $nin: ["", null] },
    $or: [
      { fullName: "" },
      { fullName: null },
      { fullName: { $exists: false } },
      { email: "" },
      { email: null },
      { email: { $exists: false } },
      { phone: "" },
      { phone: null },
      { phone: { $exists: false } },
      { licenseStatus: "" },
      { licenseStatus: null },
      { licenseStatus: { $exists: false } },
    ],
  } as Record<string, any>;

  if (!force) {
    base.$and = [
      {
        $or: [
          { sbsLookupAttempts: { $lt: MAX_ATTEMPTS } },
          { sbsLookupAttempts: { $exists: false } },
        ],
      },
    ];
  }

  return base;
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
  if (SBS_USE_CDP) {
    console.log(`[sbs-browser] mode=cdp url=${SBS_CDP_URL}`);
    const browser = await chromium.connectOverCDP(SBS_CDP_URL);
    return browser;
  }

  console.log(`[sbs-browser] mode=launch executable=${CHROME_PATH}`);
  return chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS !== "false",
    executablePath: CHROME_PATH,
  });
}

async function createBrowserSession(): Promise<BrowserSession> {
  const browser = await createBrowser();
  return {
    browser,
    mode: SBS_USE_CDP ? "cdp" : "launch",
    closeBrowser: async () => {
      if (SBS_USE_CDP) return;
      await browser.close().catch(() => null);
    },
  };
}

async function acquirePage(browser: Browser, mode: "launch" | "cdp") {
  if (mode === "cdp") {
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    return {
      page,
      release: async () => {
        await page.close().catch(() => null);
      },
    };
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  return {
    page,
    release: async () => {
      await page.close().catch(() => null);
      await context.close().catch(() => null);
    },
  };
}

async function gotoSbs(page: Page) {
  await page.goto(SBS_BASE_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
}

async function detectBlocked(page: Page, agentId: string, state: string) {
  const title = normalizeText(await page.title().catch(() => ""));
  const bodyText = normalizeText(await page.textContent("body").catch(() => ""));
  if (title.toLowerCase().includes("403") || bodyText.toLowerCase().includes("403 forbidden")) {
    console.log(
      `[sbs-blocked] agentId=${agentId} state=${state} url=${page.url()} title=${JSON.stringify(title)}`
    );
    throw new Error("sbs_blocked_403");
  }
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click({ timeout: 5000 }).catch(() => null);
    return true;
  }
  return false;
}

async function checkTermsCheckbox(page: Page) {
  const selectors = [
    'input[name="termsAndConditions"]',
    'input[id*="terms" i]',
    'input[type="checkbox"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;

    const alreadyChecked = await locator.isChecked().catch(() => false);
    if (!alreadyChecked) {
      await locator.check({ timeout: 5000 }).catch(async () => {
        await locator.click({ timeout: 5000 }).catch(() => null);
      });
    }

    const checked = await locator.isChecked().catch(() => false);
    if (checked) return true;
  }

  await logFormDiagnostics(page);
  throw new Error("missing_terms_checkbox");
}

async function clickInitialSearch(page: Page) {
  const clicked = await clickFirstVisible(page, [
    'button:has-text("Search")',
    'input[type="submit"][value*="Search"]',
    'input[type="button"][value*="Search"]',
  ]);

  if (!clicked) {
    await logFormDiagnostics(page);
    throw new Error("missing_initial_search_button");
  }

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
}

async function waitForExpandedSearch(page: Page, agentId: string, state: string) {
  const expandedSelectors = [
    'select[name*="entityType" i]',
    'select[id*="entityType" i]',
    'select[aria-label*="Entity Type" i]',
    'input[name*="npn" i]',
    'input[id*="npn" i]',
    'input[aria-label*="NPN" i]',
    'input[placeholder*="NPN" i]',
    'input[name*="lastName" i]',
    'input[id*="lastName" i]',
    'input[name*="firstName" i]',
    'input[id*="firstName" i]',
    'input[name*="license" i]',
    'input[id*="license" i]',
  ];

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    for (const selector of expandedSelectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count().catch(() => 0)) === 0) continue;
      if (await locator.isVisible().catch(() => false)) return true;
    }
    await page.waitForTimeout(500);
  }

  await logFormDiagnostics(page);
  console.log(
    `[sbs-transition-failed] agentId=${agentId} state=${state} url=${page.url()} title=${JSON.stringify(
      normalizeText(await page.title().catch(() => ""))
    )}`
  );
  throw new Error("sbs_transition_failed");
}

async function fillFirstVisible(page: Page, selectors: string[], value: string) {
  if (!value) return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.fill(value, { timeout: 5000 }).catch(() => null);
    const current = await locator.inputValue().catch(() => "");
    if (clean(current) === clean(value)) return true;
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

async function selectFirstVisible(page: Page, selectors: string[], value: string) {
  if (!value) return false;
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    const options = await locator.locator("option").allTextContents().catch(() => []);
    const match = options.find((option) =>
      option.toLowerCase().includes(value.toLowerCase())
    );
    if (match) {
      await locator.selectOption({ label: match }).catch(async () => {
        await locator.selectOption({ value: match }).catch(() => null);
      });
      return true;
    }
  }
  return false;
}

async function prepareSearchForm(page: Page, state: string) {
  await gotoSbs(page);

  await selectFirstVisible(
    page,
    [
      'select[name*="jurisdiction"]',
      'select[id*="jurisdiction"]',
      'select[aria-label*="Jurisdiction"]',
    ],
    state
  );

  await selectFirstVisible(
    page,
    [
      'select[name*="searchType"]',
      'select[id*="searchType"]',
      'select[aria-label*="Search Type"]',
    ],
    "Licensee"
  );

  await checkTermsCheckbox(page);
  await clickInitialSearch(page);
}

async function prepareExpandedSearch(page: Page, agentId: string, state: string) {
  await waitForExpandedSearch(page, agentId, state);

  await selectFirstVisible(
    page,
    [
      'select[name*="entityType"]',
      'select[id*="entityType"]',
      'select[aria-label*="Entity Type"]',
    ],
    "Individual"
  );

  await page.waitForTimeout(800);
}

async function logFormDiagnostics(page: Page) {
  const labels = (await page.locator("label:visible").allTextContents().catch(() => []))
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .slice(0, 40);
  const fieldMeta = await page
    .locator("input:visible, select:visible, textarea:visible")
    .evaluateAll((nodes) =>
      nodes.slice(0, 50).map((node) => {
        const el = node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        return {
          tag: el.tagName.toLowerCase(),
          name: el.getAttribute("name") || "",
          id: el.getAttribute("id") || "",
          placeholder: el.getAttribute("placeholder") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          type: (el as HTMLInputElement).type || "",
        };
      })
    )
    .catch(() => []);

  console.log(`[sbs-form-debug] url="${page.url()}"`);
  console.log(`[sbs-form-debug] title="${normalizeText(await page.title().catch(() => ""))}"`);
  console.log(`[sbs-form-debug] labels="${labels.join(", ")}"`);
  console.log(
    `[sbs-form-debug] fields="${fieldMeta
      .map((field: any) =>
        [field.tag, field.type, field.name, field.id, field.placeholder, field.ariaLabel]
          .filter(Boolean)
          .join(":")
      )
      .join(", ")}"`
  );
}

async function fillVisibleLikelyNpn(page: Page, npn: string) {
  const locator = page.locator("input:visible").filter({
    hasNot: page.locator('[type="hidden"]'),
  });
  const count = await locator.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const input = locator.nth(i);
    const meta = await input
      .evaluate((node) => {
        const el = node as HTMLInputElement;
        const label =
          el.labels && el.labels.length
            ? Array.from(el.labels)
                .map((item) => item.textContent || "")
                .join(" ")
            : "";
        return {
          name: el.getAttribute("name") || "",
          id: el.getAttribute("id") || "",
          placeholder: el.getAttribute("placeholder") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          label,
        };
      })
      .catch(() => null);
    const haystack = normalizeText(
      [meta?.name, meta?.id, meta?.placeholder, meta?.ariaLabel, meta?.label].join(" ")
    ).toLowerCase();
    if (!/npn|national producer|producer number/.test(haystack)) continue;
    await input.fill(npn, { timeout: 5000 }).catch(() => null);
    const current = await input.inputValue().catch(() => "");
    if (clean(current) === clean(npn)) return true;
  }
  return false;
}

async function submitNpnSearch(page: Page, npn: string) {
  await page.waitForTimeout(800);
  await page
    .waitForSelector(
      'input[name*="npn" i], input[id*="npn" i], input[aria-label*="NPN" i], input[placeholder*="NPN" i]',
      { timeout: 5000 }
    )
    .catch(() => null);

  let filled = await fillFirstVisible(
    page,
    [
      'input[name*="npn" i]',
      'input[id*="npn" i]',
      'input[aria-label*="NPN" i]',
      'input[placeholder*="NPN" i]',
      'input[name*="nationalProducerNumber" i]',
      'input[id*="nationalProducerNumber" i]',
    ],
    npn
  );

  if (!filled) {
    filled = await fillByLabelText(page, /npn|national producer number/i, npn);
  }
  if (!filled) {
    filled = await fillVisibleLikelyNpn(page, npn);
  }
  if (!filled) {
    await logFormDiagnostics(page);
    throw new Error("missing_npn_field");
  }

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
  ];
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    if (count > 0) return locator;
  }
  return page.locator("table tbody tr").filter({ has: page.locator("a") });
}

async function parseResultRow(row: any) {
  const text = normalizeText(await row.textContent().catch(() => ""));
  const cells = (await row.locator("td").allTextContents().catch(() => []))
    .map((value: string) => normalizeText(value))
    .filter(Boolean);

  const emails = extractEmails(text);
  const phones = extractPhones(text);
  const licenseNumber =
    cells.find((value: string) => /[a-z0-9-]{5,}/i.test(value) && /lic|agent|brok/i.test(text) === false) ||
    extractLabelValue(text, ["License Number", "License #"]);
  const npn =
    cells.find((value: string) => /^\d{5,}$/.test(value)) ||
    extractLabelValue(text, ["NPN", "National Producer Number"]);
  const licenseStatus = extractLabelValue(text, ["Status", "License Status"]);
  const licenseType = extractLabelValue(text, ["License Type", "Type", "Class"]);
  const effectiveDate = extractLabelValue(text, ["Effective Date", "Issue Date", "First Active"]);
  const expirationDate = extractLabelValue(text, ["Expiration Date", "Expire Date"]);
  const residentFlag = extractLabelValue(text, ["Resident", "Resident Flag"]);
  const designatedHomeState = extractLabelValue(text, ["Designated Home State", "Home State"]);
  const businessAddress = extractLabelValue(text, ["Business Address", "Address"]);
  const linesOfAuthority = collectLinesOfAuthority(text);

  return {
    text,
    name: cells[0] || "",
    licenseNumber: clean(licenseNumber),
    npn: clean(npn),
    licenseStatus: clean(licenseStatus),
    licenseType: clean(licenseType),
    effectiveDate: clean(effectiveDate),
    expirationDate: clean(expirationDate),
    residentFlag: clean(residentFlag),
    designatedHomeState: clean(designatedHomeState),
    businessAddress: clean(businessAddress),
    linesOfAuthority,
    phone: phones[0] || "",
    email: emails[0] || "",
  };
}

async function findMatchingRow(page: Page, npn: string) {
  const rows = await collectResultRows(page);
  const count = await rows.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const parsed = await parseResultRow(row);
    if (parsed.npn && clean(parsed.npn) === clean(npn)) {
      return { row, count, parsed };
    }
    if (parsed.text.includes(npn)) {
      return { row, count, parsed };
    }
  }
  if (count === 1) {
    const row = rows.nth(0);
    return { row, count, parsed: await parseResultRow(row) };
  }
  return { row: null as any, count, parsed: null as any };
}

async function parseDetailPage(
  page: Page,
  matchedState: string,
  summaryRow: Awaited<ReturnType<typeof parseResultRow>>
): Promise<SbsProfile> {
  const bodyText = normalizeText(await page.textContent("body").catch(() => ""));
  const title = normalizeText(await page.title().catch(() => ""));
  const pageHtml = await page.content().catch(() => "");
  const emails = extractEmails(`${bodyText} ${pageHtml}`);
  const phones = extractPhones(bodyText);

  const fullName =
    extractLabelValue(bodyText, ["Name", "Licensee Name", "Individual Name"]) ||
    summaryRow.name ||
    title;
  const split = splitFullName(fullName);
  const website =
    extractLabelValue(bodyText, ["Website", "Web Site"]) ||
    extractWebsite(bodyText) ||
    extractWebsite(pageHtml);
  const businessAddress =
    extractLabelValue(bodyText, ["Business Address", "Address", "Mailing Address"]) ||
    summaryRow.businessAddress;
  const city = extractLabelValue(bodyText, ["City"]);
  const state = extractLabelValue(bodyText, ["State"]);
  const zip = extractLabelValue(bodyText, ["Zip", "ZIP", "Postal Code"]);
  const domicileState = extractLabelValue(bodyText, ["Domicile State", "Domicile"]);
  const residentFlag =
    extractLabelValue(bodyText, ["Resident", "Resident Flag"]) || summaryRow.residentFlag;
  const licenseNumber =
    extractLabelValue(bodyText, ["License Number", "License #"]) || summaryRow.licenseNumber;
  const licenseType =
    extractLabelValue(bodyText, ["License Class", "License Type", "Type", "Class"]) ||
    summaryRow.licenseType;
  const licenseStatus =
    extractLabelValue(bodyText, ["License Status", "Status"]) || summaryRow.licenseStatus;
  const statusDate = extractLabelValue(bodyText, ["Status Date"]);
  const effectiveDate =
    extractLabelValue(bodyText, ["Effective Date", "First Active Date", "First Active"]) ||
    summaryRow.effectiveDate;
  const expirationDate =
    extractLabelValue(bodyText, ["Expiration Date", "Expire Date"]) || summaryRow.expirationDate;
  const issueDate = extractLabelValue(bodyText, ["Issue Date", "Original Issue Date"]);
  const designatedHomeState =
    extractLabelValue(bodyText, ["Designated Home State", "Home State"]) ||
    summaryRow.designatedHomeState;
  const npnValue =
    extractLabelValue(bodyText, ["NPN", "National Producer Number"]) || summaryRow.npn;
  const linesOfAuthority = uniqueStrings([
    ...summaryRow.linesOfAuthority,
    ...collectLinesOfAuthority(bodyText),
  ]);

  return {
    fullName,
    firstName: split.firstName,
    lastName: split.lastName,
    npn: clean(npnValue),
    address: businessAddress,
    city: clean(city),
    state: clean(state),
    zip: clean(zip),
    phone: phones[0] || summaryRow.phone,
    email: emails[0] || summaryRow.email,
    website: clean(website),
    businessAddress,
    domicileState: clean(domicileState),
    residentFlag: clean(residentFlag),
    licenseNumber: clean(licenseNumber),
    licenseType: clean(licenseType),
    licenseStatus: clean(licenseStatus),
    licenseIssueDate: clean(issueDate || effectiveDate),
    licenseEffectiveDate: clean(effectiveDate),
    licenseExpirationDate: clean(expirationDate),
    licenseStatusDate: clean(statusDate),
    designatedHomeState: clean(designatedHomeState),
    linesOfAuthority,
    matchedState,
  };
}

function pickBetterString(current: string, next: string) {
  const currentClean = clean(current);
  const nextClean = clean(next);
  if (!nextClean) return "";
  if (!currentClean) return nextClean;
  if (nextClean.length > currentClean.length) return nextClean;
  return "";
}

function pickBetterArray(current: string[] | undefined, next: string[]) {
  const currentCount = (current || []).filter(Boolean).length;
  if (next.length > currentCount) return next;
  return [];
}

async function persistProfile(agent: any, profile: SbsProfile) {
  const freshness = computeFreshness(profile);
  const set: Record<string, any> = {
    identitySource: "sbs_lookup",
    identityUpdatedAt: new Date(),
    sbsLastEnrichedAt: new Date(),
    sbsLastLookupAt: new Date(),
    sbsLastLookupError: "",
    isLicenseActive: freshness.isLicenseActive,
    isLicenseCurrent: freshness.isLicenseCurrent,
    isRecentlyLicensed: freshness.isRecentlyLicensed,
    isRecentlyRenewed: freshness.isRecentlyRenewed,
    isFreshLicenseLead: freshness.isFreshLicenseLead,
    freshnessBucket: freshness.freshnessBucket,
    freshnessEvaluatedAt: new Date(),
  };

  const maybeSet = (field: string, value: string) => {
    const better = pickBetterString(agent[field], value);
    if (better) set[field] = better;
  };

  maybeSet("fullName", profile.fullName);
  maybeSet("firstName", profile.firstName);
  maybeSet("lastName", profile.lastName);
  maybeSet("npn", profile.npn);
  maybeSet("address", profile.address);
  maybeSet("city", profile.city);
  maybeSet("state", profile.state);
  maybeSet("zip", profile.zip);
  maybeSet("phone", profile.phone);
  maybeSet("email", profile.email);
  maybeSet("website", profile.website);
  maybeSet("businessAddress", profile.businessAddress);
  maybeSet("domicileState", profile.domicileState);
  maybeSet("residentFlag", profile.residentFlag);
  maybeSet("licenseNumber", profile.licenseNumber);
  maybeSet("licenseType", profile.licenseType);
  maybeSet("licenseStatus", profile.licenseStatus);
  maybeSet("licenseIssueDate", profile.licenseIssueDate);
  maybeSet("licenseEffectiveDate", profile.licenseEffectiveDate);
  maybeSet("licenseExpirationDate", profile.licenseExpirationDate);
  maybeSet("licenseStatusDate", profile.licenseStatusDate);
  maybeSet("designatedHomeState", profile.designatedHomeState);
  maybeSet("agencyName", "");

  const betterLoa = pickBetterArray(agent.linesOfAuthority, profile.linesOfAuthority);
  if (betterLoa.length) set.linesOfAuthority = betterLoa;

  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: set,
      $inc: { sbsLookupAttempts: 1 },
    }
  );

  console.log(
    `[sbs-freshness] agentId=${agent._id} status=${JSON.stringify(
      profile.licenseStatus
    )} effective=${JSON.stringify(freshness.effectiveDate)} expiration=${JSON.stringify(
      freshness.expirationDate
    )} statusDate=${JSON.stringify(freshness.statusDate)} active=${freshness.isLicenseActive} current=${freshness.isLicenseCurrent} recentLicensed=${freshness.isRecentlyLicensed} recentRenewed=${freshness.isRecentlyRenewed} freshLead=${freshness.isFreshLicenseLead} bucket=${freshness.freshnessBucket}`
  );

  return freshness;
}

function buildTestAgent() {
  return {
    _id: TEST_SBS_AGENT_ID || "test_sbs_npn",
    npn: TEST_SBS_NPN,
    fullName: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    website: "",
    address: "",
    businessAddress: "",
    city: "",
    state: "",
    zip: "",
    domicileState: "",
    residentFlag: "",
    designatedHomeState: "",
    licenseNumber: "",
    licenseType: "",
    licenseStatus: "",
    licenseIssueDate: "",
    licenseEffectiveDate: "",
    licenseExpirationDate: "",
    licenseStatusDate: "",
    linesOfAuthority: [],
    sbsLookupAttempts: 0,
  };
}

async function lookupAgentInState(page: Page, agent: any, state: string) {
  console.log(`[sbs-search] agentId=${agent._id} npn=${clean(agent.npn)} state=${state}`);

  await prepareSearchForm(page, state);
  await detectBlocked(page, String(agent._id), state);
  await prepareExpandedSearch(page, String(agent._id), state);
  await submitNpnSearch(page, clean(agent.npn));

  const { row, count, parsed } = await findMatchingRow(page, clean(agent.npn));
  console.log(`[sbs-results] agentId=${agent._id} state=${state} count=${count}`);
  if (!row || !parsed) return null;

  const name = parsed.name || parsed.text || "";
  console.log(`[sbs-match] agentId=${agent._id} state=${state} name="${name}"`);

  const link = row.locator("a").first();
  if ((await link.count().catch(() => 0)) > 0) {
    await link.click({ timeout: 10000 });
  } else {
    await row.click({ timeout: 10000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  console.log(`[sbs-detail] agentId=${agent._id} state=${state}`);

  return parseDetailPage(page, state, parsed);
}

async function enrichOneAgent(
  browser: Browser,
  browserMode: "launch" | "cdp",
  agent: any,
  force = false
): Promise<EnrichResult> {
  if (!clean(agent.npn)) {
    console.log(`[sbs-skip] agentId=${agent._id} reason=no_npn`);
    return { matched: false, hydrated: false, skipped: true, errored: false };
  }
  if (shouldSkipAgent(agent, force)) {
    console.log(`[sbs-skip] agentId=${agent._id} reason=already_hydrated`);
    return { matched: false, hydrated: false, skipped: true, errored: false };
  }

  const { page, release } = await acquirePage(browser, browserMode);

  try {
    let profile: SbsProfile | null = null;
    for (const state of SBS_STATES) {
      try {
        profile = await withRetry(() => lookupAgentInState(page, agent, state), 1);
        if (profile) break;
      } catch (err: any) {
        if ((err?.message || "") === "sbs_blocked_403") {
          break;
        }
        console.log(
          `[sbs-error] agentId=${agent._id} state=${state} error=${JSON.stringify(
            err?.message || String(err)
          )}`
        );
      }
    }

    if (!profile) {
      console.log(`[sbs-skip] agentId=${agent._id} reason=no_match`);
      await DOIAgent.updateOne(
        { _id: agent._id },
        {
          $inc: { sbsLookupAttempts: 1 },
          $set: {
            sbsLastLookupAt: new Date(),
            sbsLastLookupError: "no_match",
          },
        }
      );
      return { matched: false, hydrated: false, skipped: true, errored: false };
    }

    const freshness = computeFreshness(profile);
    if (TEST_SBS_NPN) {
      console.log(`[sbs-test-profile] ${JSON.stringify(profile)}`);
      console.log(`[sbs-test-freshness] ${JSON.stringify(freshness)}`);
      if (TEST_SBS_AGENT_ID) {
        await persistProfile({ ...agent, _id: TEST_SBS_AGENT_ID }, profile);
      }
    } else {
      await persistProfile(agent, profile);
    }
    console.log(`[sbs-hydrate] agentId=${agent._id}`);
    return {
      matched: true,
      hydrated: true,
      skipped: false,
      errored: false,
      isFreshLicenseLead: freshness.isFreshLicenseLead,
      isLicenseActive: freshness.isLicenseActive,
      isLicenseCurrent: freshness.isLicenseCurrent,
    };
  } catch (err: any) {
    const message = err?.message || String(err);
    console.log(`[sbs-error] agentId=${agent._id} state=unknown error=${JSON.stringify(message)}`);
    await DOIAgent.updateOne(
      { _id: agent._id },
      {
        $inc: { sbsLookupAttempts: 1 },
        $set: {
          sbsLastLookupAt: new Date(),
          sbsLastLookupError: message,
        },
      }
    );
    return { matched: false, hydrated: false, skipped: false, errored: true };
  } finally {
    await release();
  }
}

export async function enrichFromSbsAgents(agents: any[], force = false): Promise<EnrichSummary> {
  if (!agents.length) {
    return {
      searched: 0,
      matched: 0,
      hydrated: 0,
      skipped: 0,
      errors: 0,
      fresh: 0,
      activeCurrent: 0,
    };
  }

  const session = await createBrowserSession();
  try {
    const summary: EnrichSummary = {
      searched: 0,
      matched: 0,
      hydrated: 0,
      skipped: 0,
      errors: 0,
      fresh: 0,
      activeCurrent: 0,
    };

    for (let i = 0; i < agents.length; i += MAX_CONCURRENCY) {
      const chunk = agents.slice(i, i + MAX_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((agent) => enrichOneAgent(session.browser, session.mode, agent, force))
      );
      summary.searched += chunk.length;
      for (const result of results) {
        if (result.matched) summary.matched += 1;
        if (result.hydrated) summary.hydrated += 1;
        if (result.skipped) summary.skipped += 1;
        if (result.errored) summary.errors += 1;
        if (result.isFreshLicenseLead) summary.fresh += 1;
        if (result.isLicenseActive && result.isLicenseCurrent) {
          summary.activeCurrent += 1;
        }
      }
    }

    return summary;
  } finally {
    await session.closeBrowser();
  }
}

export async function enrichFromSbsBatch(batchSize = DEFAULT_BATCH_SIZE, force = false) {
  if (TEST_SBS_NPN) {
    console.log(`[sbs-test-mode] npn=${TEST_SBS_NPN}`);
    return enrichFromSbsAgents([buildTestAgent()], force);
  }

  const agents = await DOIAgent.find(buildAgentFilter(force))
    .sort({ sbsLastLookupAt: 1, updatedAt: 1, createdAt: 1 })
    .limit(batchSize)
    .lean();

  return enrichFromSbsAgents(agents, force);
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const rawArgs = process.argv.slice(2);
    const force = rawArgs.includes("--force");
    const freshOnly = rawArgs.includes("--fresh-only");
    const numericArg = rawArgs.find((arg) => /^\d+$/.test(arg));
    const batchSize = numericArg ? Number(numericArg) : DEFAULT_BATCH_SIZE;
    const summary = await enrichFromSbsBatch(batchSize, force);
    console.log(
      `[enrich-from-sbs] searched=${summary.searched} matched=${summary.matched} hydrated=${summary.hydrated} skipped=${summary.skipped} errors=${summary.errors} fresh=${summary.fresh} activeCurrent=${summary.activeCurrent}${freshOnly ? " freshOnly=true" : ""}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[enrich-from-sbs] Fatal error:", err?.message || err);
    process.exit(1);
  });
}
