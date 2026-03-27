// scripts/scrape-doi.ts
// Imports licensed life/health insurance agent data from government bulk sources.
// Replaces HTML scraping with official CSV/API downloads.
//
// Run standalone: npx tsx scripts/import-doi-leads.ts
// Run via cron:   GET /api/cron/run-doi-scraper

import axios from "axios";
import { parse } from "csv-parse";
import mongooseConnect from "../lib/mongooseConnect";
import DOILead from "../models/DOILead";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StateImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
}

export interface ScrapeAllResult {
  totalImported: number;
  totalUpdated: number;
  totalSkipped: number;
  totalErrors: number;
  // Backward-compat aliases consumed by the cron endpoint
  totalInserted: number;
  totalScraped: number;
  byState: Record<string, StateImportResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;
const LOG_EVERY = 1000;

/** Generate a synthetic email for records that have no email address.
 *  Format is clearly non-real so it won't match suppressions or bounce lists. */
function syntheticEmail(state: string, licenseNumber: string): string {
  const safe = (licenseNumber || "unknown").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `_doi_${state.toLowerCase()}_${safe}@noemail.doilead.local`;
}

/** True if the license type string is a life or health line. */
function isLifeHealth(licenseType: string): boolean {
  const lt = (licenseType || "").toUpperCase();
  return (
    lt.includes("LIFE") ||
    lt.includes("HEALTH") ||
    lt.includes("2-14") ||
    lt.includes("2-15") ||
    lt.includes("2-16") ||
    lt.includes("2-40") ||
    lt.includes("L&H") ||
    lt.includes("ANNUITY") ||
    lt.includes("VARIABLE")
  );
}

/** Upsert a single record into DOILead by email (primary) or licenseNumber (fallback).
 *  Returns "imported" | "updated" | "skipped". */
async function upsertDOILead(fields: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  state: string;
  licenseType: string;
  licenseNumber: string;
  licenseStatus: string;
  source: string;
}): Promise<"imported" | "updated" | "skipped"> {
  const emailKey = fields.email || syntheticEmail(fields.state, fields.licenseNumber);

  try {
    const result = await DOILead.findOneAndUpdate(
      { email: emailKey },
      {
        $set: {
          firstName: fields.firstName,
          lastName: fields.lastName,
          phone: fields.phone,
          state: fields.state,
          licenseType: fields.licenseType,
          licenseNumber: fields.licenseNumber,
          licenseStatus: fields.licenseStatus,
          source: fields.source,
          scrapedAt: new Date(),
        },
        $setOnInsert: {
          email: emailKey,
          assignedCount: 0,
          globallyUnsubscribed: false,
        },
      },
      { upsert: true, new: false, lean: true }
    );

    return result === null ? "imported" : "updated";
  } catch (err: any) {
    // Duplicate key on concurrent writes — treat as skipped
    if (err?.code === 11000) return "skipped";
    throw err;
  }
}

/** Process a batch of records, updating the result counters in place. */
async function processBatch(
  batch: Parameters<typeof upsertDOILead>[0][],
  result: StateImportResult
): Promise<void> {
  await Promise.all(
    batch.map(async (fields) => {
      try {
        const outcome = await upsertDOILead(fields);
        if (outcome === "imported") result.imported++;
        else if (outcome === "updated") result.updated++;
        else result.skipped++;
      } catch (err: any) {
        result.errors++;
        // Only log non-trivial errors
        if (err?.code !== 11000) {
          console.warn(`[doi-import] upsert error (${fields.state}):`, err?.message || err);
        }
      }
    })
  );
}

// ---------------------------------------------------------------------------
// A. Florida — CSV bulk download from FLDFS
// ---------------------------------------------------------------------------

const FL_CSV_URL =
  "https://licenseesearch.fldfs.com/BulkDownload/DownloadFile?type=individuals";

/** Flexible column extractor — tries multiple common header variations. */
function pick(row: Record<string, string>, ...candidates: string[]): string {
  for (const c of candidates) {
    const val = row[c] ?? row[c.toLowerCase()] ?? row[c.toUpperCase()];
    if (val !== undefined && val !== null) return String(val).trim();
  }
  return "";
}

export async function importFloridaLeads(): Promise<StateImportResult> {
  const result: StateImportResult = { imported: 0, updated: 0, skipped: 0, errors: 0 };
  let processed = 0;
  let batch: Parameters<typeof upsertDOILead>[0][] = [];

  console.info("[FL] Starting Florida CSV import…");

  try {
    const response = await axios({
      method: "GET",
      url: FL_CSV_URL,
      responseType: "stream",
      timeout: 300_000,
      headers: {
        "User-Agent": "CoveCRM-DOI-Import/2.0 (licensed data import)",
        Accept: "text/csv,application/octet-stream,*/*",
      },
    });

    const parser = response.data.pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        relax_quotes: true,
      })
    );

    for await (const row of parser) {
      try {
        const licenseType =
          pick(row, "LicenseType", "License Type", "LineOfAuthority", "Line Of Authority",
            "licenseType", "license_type", "LicTypeDesc", "LicType") || "";
        const licenseStatus =
          pick(row, "Status", "LicenseStatus", "License Status", "licenseStatus",
            "license_status", "LicStatus") || "";

        // Filter: only life/health lines and Active status
        if (!isLifeHealth(licenseType)) continue;
        if (licenseStatus.toLowerCase() !== "active") continue;

        const licenseNumber =
          pick(row, "LicenseNumber", "License Number", "LicNbr", "LicenseNbr",
            "licenseNumber", "license_number", "NPN", "npn") || "";
        const firstName =
          pick(row, "FirstName", "First Name", "firstName", "first_name", "GivenName") || "";
        const lastName =
          pick(row, "LastName", "Last Name", "lastName", "last_name", "Surname") || "";
        const rawEmail =
          pick(row, "EmailAddress", "Email Address", "Email", "email", "emailAddress",
            "email_address") || "";
        const phone =
          pick(row, "PhoneNumber", "Phone Number", "Phone", "phone", "BusinessPhone",
            "Business Phone") || "";

        const email = rawEmail.toLowerCase().includes("@") ? rawEmail.toLowerCase().trim() : "";

        // Skip if no licenseNumber AND no email — nothing to key on
        if (!licenseNumber && !email) continue;

        batch.push({
          firstName,
          lastName,
          email,
          phone,
          state: "FL",
          licenseType,
          licenseNumber,
          licenseStatus: "Active",
          source: "FL-DOI",
        });

        if (batch.length >= BATCH_SIZE) {
          await processBatch(batch, result);
          batch = [];
        }

        processed++;
        if (processed % LOG_EVERY === 0) {
          console.info(
            `[FL] Processed ${processed.toLocaleString()} records — imported=${result.imported} updated=${result.updated} skipped=${result.skipped}`
          );
        }
      } catch (rowErr: any) {
        result.errors++;
      }
    }

    // Flush remaining batch
    if (batch.length > 0) {
      await processBatch(batch, result);
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("ECONNRESET")) {
      console.warn(`[FL] Source unreachable: ${msg} — skipping`);
      result.skipped++;
    } else {
      console.error("[FL] Import error:", msg);
      result.errors++;
    }
  }

  console.info(
    `[FL] Done — imported=${result.imported} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`
  );
  return result;
}

// ---------------------------------------------------------------------------
// B. Texas — Socrata Open Data API (paginated JSON)
// ---------------------------------------------------------------------------

const TX_API_BASE = "https://data.texas.gov/resource/kxv3-diwf.json";
const TX_PAGE_SIZE = 50_000;

export async function importTexasLeads(): Promise<StateImportResult> {
  const result: StateImportResult = { imported: 0, updated: 0, skipped: 0, errors: 0 };
  let offset = 0;
  let page = 0;
  let totalFetched = 0;

  console.info("[TX] Starting Texas API import…");

  const appToken = process.env.TEXAS_DATA_APP_TOKEN || "";

  while (true) {
    let rows: any[];
    try {
      const response = await axios.get(TX_API_BASE, {
        params: {
          $limit: TX_PAGE_SIZE,
          $offset: offset,
          $order: ":id",
        },
        headers: {
          Accept: "application/json",
          "User-Agent": "CoveCRM-DOI-Import/2.0",
          ...(appToken ? { "X-App-Token": appToken } : {}),
        },
        timeout: 120_000,
      });

      rows = Array.isArray(response.data) ? response.data : [];
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
        console.warn(`[TX] Source unreachable: ${msg} — skipping`);
        result.skipped++;
        break;
      }
      console.error(`[TX] Fetch error at offset ${offset}:`, msg);
      result.errors++;
      break;
    }

    if (rows.length === 0) break;

    page++;
    totalFetched += rows.length;
    console.info(`[TX] Page ${page}: fetched ${rows.length} rows (total so far: ${totalFetched.toLocaleString()})`);

    let batch: Parameters<typeof upsertDOILead>[0][] = [];

    for (const row of rows) {
      try {
        const licenseType =
          String(
            row.license_type || row.licenseType || row.LicenseType ||
            row.license_type_code || row.line_of_authority || ""
          ).trim();
        const licenseStatus =
          String(
            row.license_status || row.licenseStatus || row.status || row.Status || ""
          ).trim();

        if (!isLifeHealth(licenseType)) continue;
        if (licenseStatus.toLowerCase() !== "active") continue;

        const licenseNumber =
          String(
            row.license_number || row.licenseNumber || row.npn || row.NPN || ""
          ).trim();
        const firstName =
          String(
            row.first_name || row.firstName || row.FirstName || ""
          ).trim();
        const lastName =
          String(
            row.last_name || row.lastName || row.LastName || ""
          ).trim();
        const rawEmail =
          String(
            row.email || row.Email || row.email_address || row.emailAddress || ""
          ).trim();
        const phone =
          String(
            row.phone || row.Phone || row.phone_number || row.phoneNumber || ""
          ).trim();

        const email = rawEmail.toLowerCase().includes("@") ? rawEmail.toLowerCase() : "";

        if (!licenseNumber && !email) continue;

        batch.push({
          firstName,
          lastName,
          email,
          phone,
          state: "TX",
          licenseType,
          licenseNumber,
          licenseStatus: "Active",
          source: "TX-DOI",
        });

        if (batch.length >= BATCH_SIZE) {
          await processBatch(batch, result);
          batch = [];
        }
      } catch (rowErr: any) {
        result.errors++;
      }
    }

    // Flush batch for this page
    if (batch.length > 0) {
      await processBatch(batch, result);
    }

    console.info(
      `[TX] After page ${page} — imported=${result.imported} updated=${result.updated} skipped=${result.skipped}`
    );

    // If fewer rows returned than requested, we've hit the end
    if (rows.length < TX_PAGE_SIZE) break;

    offset += TX_PAGE_SIZE;

    // Brief pause between pages to be polite to the API
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  console.info(
    `[TX] Done — imported=${result.imported} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`
  );
  return result;
}

// ---------------------------------------------------------------------------
// C. Ohio — graceful skip (no accessible bulk source)
// ---------------------------------------------------------------------------

export async function importOhioLeads(): Promise<StateImportResult> {
  const result: StateImportResult = { imported: 0, updated: 0, skipped: 1, errors: 0 };

  try {
    // Attempt Ohio data.ohio.gov dataset
    const response = await axios.get(
      "https://data.ohio.gov/wps/portal/gov/data/view/ins-licensed-producers",
      {
        timeout: 15_000,
        headers: { "User-Agent": "CoveCRM-DOI-Import/2.0", Accept: "application/json,*/*" },
        validateStatus: () => true,
      }
    );

    if (response.status === 200 && Array.isArray(response.data) && response.data.length > 0) {
      // Unexpected success — process what we got
      console.info(`[OH] Got ${response.data.length} records from Ohio data portal`);
      const batch: Parameters<typeof upsertDOILead>[0][] = [];
      result.skipped = 0;

      for (const row of response.data) {
        try {
          const licenseType = String(row.license_type || row.licenseType || "").trim();
          const licenseStatus = String(row.license_status || row.status || "").trim();
          if (!isLifeHealth(licenseType) || licenseStatus.toLowerCase() !== "active") continue;

          batch.push({
            firstName: String(row.first_name || row.firstName || "").trim(),
            lastName: String(row.last_name || row.lastName || "").trim(),
            email: String(row.email || "").trim().toLowerCase(),
            phone: String(row.phone || "").trim(),
            state: "OH",
            licenseType,
            licenseNumber: String(row.license_number || row.npn || "").trim(),
            licenseStatus: "Active",
            source: "OH-DOI",
          });
        } catch { result.errors++; }
      }

      if (batch.length > 0) await processBatch(batch, result);
    } else {
      console.info("[OH] No bulk source available — skipping");
    }
  } catch {
    console.info("[OH] No bulk source available — skipping");
  }

  return result;
}

// ---------------------------------------------------------------------------
// D. Georgia — graceful skip (requires form submission)
// ---------------------------------------------------------------------------

export async function importGeorgiaLeads(): Promise<StateImportResult> {
  const result: StateImportResult = { imported: 0, updated: 0, skipped: 1, errors: 0 };

  try {
    const response = await axios.get(
      "https://www.oci.ga.gov/producersearch/producerlist.aspx",
      {
        timeout: 15_000,
        headers: { "User-Agent": "CoveCRM-DOI-Import/2.0" },
        validateStatus: () => true,
        responseType: "arraybuffer",
      }
    );

    const contentType = String(response.headers["content-type"] || "");
    const isDownloadable =
      contentType.includes("csv") ||
      contentType.includes("octet-stream") ||
      contentType.includes("excel") ||
      contentType.includes("spreadsheet");

    if (response.status === 200 && isDownloadable) {
      console.info("[GA] Downloadable file detected — attempting CSV parse");
      result.skipped = 0;

      const csvText = Buffer.from(response.data).toString("utf-8");
      const records: any[] = await new Promise((resolve, reject) => {
        parse(csvText, { columns: true, skip_empty_lines: true, trim: true }, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });

      const batch: Parameters<typeof upsertDOILead>[0][] = [];
      for (const row of records) {
        try {
          const licenseType = pick(row, "LicenseType", "License Type", "licenseType") || "";
          const licenseStatus = pick(row, "Status", "LicenseStatus", "License Status") || "";
          if (!isLifeHealth(licenseType) || licenseStatus.toLowerCase() !== "active") continue;

          batch.push({
            firstName: pick(row, "FirstName", "First Name", "firstName") || "",
            lastName: pick(row, "LastName", "Last Name", "lastName") || "",
            email: (pick(row, "Email", "EmailAddress", "Email Address") || "").toLowerCase(),
            phone: pick(row, "Phone", "PhoneNumber", "Phone Number") || "",
            state: "GA",
            licenseType,
            licenseNumber: pick(row, "LicenseNumber", "License Number", "NPN") || "",
            licenseStatus: "Active",
            source: "GA-DOI",
          });
        } catch { result.errors++; }
      }

      if (batch.length > 0) await processBatch(batch, result);
    } else {
      console.info("[GA] Requires form submission — skipping");
    }
  } catch {
    console.info("[GA] Requires form submission — skipping");
  }

  return result;
}

// ---------------------------------------------------------------------------
// E. Main export — scrapeAllStates()
// ---------------------------------------------------------------------------

export async function scrapeAllStates(): Promise<ScrapeAllResult> {
  await mongooseConnect();

  const byState: Record<string, StateImportResult> = {};

  // ── Priority states (confirmed bulk sources) ──────────────────────────────
  console.info("[doi-import] Starting Florida import…");
  byState["FL"] = await importFloridaLeads();

  console.info("[doi-import] Starting Texas import…");
  byState["TX"] = await importTexasLeads();

  // ── Best-effort states ────────────────────────────────────────────────────
  console.info("[doi-import] Trying Ohio…");
  try {
    byState["OH"] = await importOhioLeads();
  } catch (err: any) {
    console.error("[OH] Fatal error (skipping):", err?.message || err);
    byState["OH"] = { imported: 0, updated: 0, skipped: 1, errors: 1 };
  }

  console.info("[doi-import] Trying Georgia…");
  try {
    byState["GA"] = await importGeorgiaLeads();
  } catch (err: any) {
    console.error("[GA] Fatal error (skipping):", err?.message || err);
    byState["GA"] = { imported: 0, updated: 0, skipped: 1, errors: 1 };
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  let totalImported = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const r of Object.values(byState)) {
    totalImported += r.imported;
    totalUpdated += r.updated;
    totalSkipped += r.skipped;
    totalErrors += r.errors;
  }

  console.info(
    `[doi-import] Complete — imported=${totalImported} updated=${totalUpdated} skipped=${totalSkipped} errors=${totalErrors}`
  );

  return {
    totalImported,
    totalUpdated,
    totalSkipped,
    totalErrors,
    // Backward-compat aliases
    totalInserted: totalImported,
    totalScraped: totalImported + totalUpdated,
    byState,
  };
}
