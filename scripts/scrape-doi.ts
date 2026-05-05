// scripts/scrape-doi.ts
// Imports licensed life/health insurance agent data from government bulk sources.
// Replaces HTML scraping with official CSV/API downloads.
//
// Run standalone: npx tsx scripts/import-doi-leads.ts
// Run via cron:   GET /api/cron/run-doi-scraper

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import crypto from "crypto";
import axios from "axios";
import { parse } from "csv-parse";
import mongooseConnect from "../lib/mongooseConnect";
import DOIRawRecord from "../models/DOIRawRecord";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportDiagnostics {
  rowsSeen: number;
  rowsMatchedLifeHealth: number;
  rowsRejectedStatus: number;
  rowsRejectedNonLifeHealth: number;
  rowsRejectedMissingLicense: number;
  rowsRejectedMissingName: number;
  rowsUpsertAttempted: number;
  rawRowsLanded: number;
  sampleMatches: Array<{
    name: string;
    licenseType: string;
    authority: string;
    status: string;
    licenseNumber: string;
    npn: string;
  }>;
}

export interface StateImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  diagnostics?: ImportDiagnostics;
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
const MAX_DEBUG_SAMPLES = 8;
const NEGATIVE_STATUS_TERMS = ["inactive", "suspend", "revoked", "terminated", "expired", "canceled"];

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

interface RawLandRecord {
  payloadHash: string;
  source: string;
  state: string;
  rawFirstName: string;
  rawLastName: string;
  rawEmail: string;
  rawPhone: string;
  rawCity: string;
  rawLicenseType: string;
  rawLineOfAuthority: string;
  rawLicenseStatus: string;
  rawLicenseNumber: string;
  rawNpn: string;
  parseStatus: "pending";
}

function buildRawRecord(params: Omit<RawLandRecord, "payloadHash" | "parseStatus">): RawLandRecord {
  const hash = crypto
    .createHash("sha256")
    .update(
      `${params.source}|${params.state}|${params.rawLicenseNumber}|${params.rawNpn}|${params.rawFirstName}|${params.rawLastName}`
    )
    .digest("hex");
  return { ...params, payloadHash: hash, parseStatus: "pending" };
}

function createDiagnostics(): ImportDiagnostics {
  return {
    rowsSeen: 0,
    rowsMatchedLifeHealth: 0,
    rowsRejectedStatus: 0,
    rowsRejectedNonLifeHealth: 0,
    rowsRejectedMissingLicense: 0,
    rowsRejectedMissingName: 0,
    rowsUpsertAttempted: 0,
    rawRowsLanded: 0,
    sampleMatches: [],
  };
}

function recordSample(diag: ImportDiagnostics, sample: ImportDiagnostics["sampleMatches"][number]) {
  if (diag.sampleMatches.length < MAX_DEBUG_SAMPLES) {
    diag.sampleMatches.push(sample);
  }
}

function logDiagnostics(state: string, diag: ImportDiagnostics) {
  console.info(
    `[${state}] Diagnostics: rows=${diag.rowsSeen} matched=${diag.rowsMatchedLifeHealth} statusReject=${diag.rowsRejectedStatus} nonLife=${diag.rowsRejectedNonLifeHealth} missingLicense=${diag.rowsRejectedMissingLicense} missingName=${diag.rowsRejectedMissingName} upsertAttempts=${diag.rowsUpsertAttempted} rawRowsLanded=${diag.rawRowsLanded}`
  );
  if (diag.sampleMatches.length) {
    console.info(`[${state}] Sample matched rows (${diag.sampleMatches.length}):`);
    diag.sampleMatches.forEach((s, idx) => {
      console.info(
        `  #${idx + 1}: ${s.name} | license=${s.licenseType} | authority=${s.authority} | status=${s.status} | licenseNumber=${s.licenseNumber} | npn=${s.npn}`
      );
    });
  } else {
    console.info(`[${state}] No matched sample rows captured.`);
  }
}

/** Land a batch of raw records into DOIRawRecord staging table. */
async function landRawBatch(
  batch: RawLandRecord[],
  result: StateImportResult,
  diagnostics?: ImportDiagnostics
): Promise<void> {
  await Promise.all(
    batch.map(async (fields) => {
      try {
        const res = await DOIRawRecord.updateOne(
          { payloadHash: fields.payloadHash },
          { $setOnInsert: fields, $set: { updatedAt: new Date() } },
          { upsert: true }
        );
        if (res.upsertedCount > 0) result.imported++;
        else result.updated++; // duplicate — already landed
        if (diagnostics) diagnostics.rawRowsLanded++;
      } catch (err: any) {
        if (err?.code === 11000) {
          result.updated++; // concurrent duplicate
          if (diagnostics) diagnostics.rawRowsLanded++;
        } else {
          result.errors++;
          if (err?.code !== 11000) {
            console.warn(`[doi-land] upsert error (${fields.state}):`, err?.message || err);
          }
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
  const diagnostics = createDiagnostics();
  const result: StateImportResult = { imported: 0, updated: 0, skipped: 0, errors: 0, diagnostics };
  let processed = 0;
  let batch: RawLandRecord[] = [];

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
        diagnostics.rowsSeen++;
        const licenseType =
          pick(row, "LicenseType", "License Type", "LineOfAuthority", "Line Of Authority",
            "licenseType", "license_type", "LicTypeDesc", "LicType") || "";
        const licenseStatus =
          pick(row, "Status", "LicenseStatus", "License Status", "licenseStatus",
            "license_status", "LicStatus") || "";
        const lineOfAuthority =
          pick(row, "LineOfAuthority", "Line Of Authority", "Line Description", "Qualification", "Qualification Description", "lineOfAuthority") ||
          "";
        const combinedAuthority = [licenseType, lineOfAuthority].filter(Boolean).join(" | ");
        const isLife = isLifeHealth(combinedAuthority);
        const normalizedStatus = (licenseStatus || "").toLowerCase();
        const badStatus =
          normalizedStatus &&
          NEGATIVE_STATUS_TERMS.some((term) => normalizedStatus.includes(term));

        if (badStatus) {
          diagnostics.rowsRejectedStatus++;
          // land anyway — normalization stage will handle status rejection
        }

        // Count non-life-health rows but still land them for normalization to evaluate
        if (!isLife) {
          diagnostics.rowsRejectedNonLifeHealth++;
        }

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
        const city =
          pick(row, "ResidenceCity", "City", "city", "MailingCity", "BusinessCity") || "";
        const npn = pick(row, "NPN", "npn", "NationalProducerNumber") || "";

        const email = rawEmail.toLowerCase().includes("@") ? rawEmail.toLowerCase().trim() : "";

        if (!licenseNumber && !npn) {
          diagnostics.rowsRejectedMissingLicense++;
        }
        if (!firstName && !lastName) {
          diagnostics.rowsRejectedMissingName++;
        }

        if (isLife) {
          diagnostics.rowsMatchedLifeHealth++;
          recordSample(diagnostics, {
            name: `${firstName} ${lastName}`.trim(),
            licenseType,
            authority: combinedAuthority,
            status: licenseStatus || "(blank)",
            licenseNumber: licenseNumber || "(blank)",
            npn: npn || "(blank)",
          });
        }

        batch.push(buildRawRecord({
          source: "FL-DOI",
          state: "FL",
          rawFirstName: firstName,
          rawLastName: lastName,
          rawEmail: email,
          rawPhone: phone,
          rawCity: city,
          rawLicenseType: licenseType,
          rawLineOfAuthority: lineOfAuthority,
          rawLicenseStatus: licenseStatus,
          rawLicenseNumber: licenseNumber,
          rawNpn: npn,
        }));
        diagnostics.rowsUpsertAttempted++;

        if (batch.length >= BATCH_SIZE) {
          await landRawBatch(batch, result, diagnostics);
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
      await landRawBatch(batch, result, diagnostics);
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
  logDiagnostics("FL", diagnostics);
  return result;
}

// ---------------------------------------------------------------------------
// B. Texas — Socrata Open Data API (paginated JSON)
// ---------------------------------------------------------------------------

const TX_API_BASE = "https://data.texas.gov/resource/kxv3-diwf.json";
const TX_PAGE_SIZE = 50_000;

export async function importTexasLeads(): Promise<StateImportResult> {
  const diagnostics = createDiagnostics();
  const result: StateImportResult = { imported: 0, updated: 0, skipped: 0, errors: 0, diagnostics };
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

    let batch: RawLandRecord[] = [];

    for (const row of rows) {
      try {
        diagnostics.rowsSeen++;
        const licenseType =
          String(
            row.license_type || row.licenseType || row.LicenseType ||
            row.license_type_code || row.line_of_authority || ""
          ).trim();
        const lineOfAuthority =
          String(
            row.line_of_authority ||
            row.authority ||
            row.license_authority ||
            row.qualification ||
            row.license_qualification ||
            row.loa ||
            row.loa_desc ||
            row.license_classification ||
            ""
          ).trim();
        const licenseStatus =
          String(
            row.license_status || row.licenseStatus || row.status || row.Status || ""
          ).trim();

        const combinedAuthority = [licenseType, lineOfAuthority].filter(Boolean).join(" | ");
        const isLife = isLifeHealth(combinedAuthority);

        // Count non-life-health but still land for normalization to evaluate
        if (!isLife) {
          diagnostics.rowsRejectedNonLifeHealth++;
        }

        const normalizedStatus = licenseStatus.toLowerCase();
        const badStatus =
          normalizedStatus !== "" &&
          NEGATIVE_STATUS_TERMS.some((term) => normalizedStatus.includes(term));
        if (badStatus) {
          diagnostics.rowsRejectedStatus++;
          // land anyway — normalization stage handles status rejection
        }

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
        const city = String(row.city || row.City || row.business_city || "").trim();
        const npn = String(row.npn || row.NPN || "").trim();

        const email = rawEmail.toLowerCase().includes("@") ? rawEmail.toLowerCase() : "";

        if (!licenseNumber && !npn) {
          diagnostics.rowsRejectedMissingLicense++;
        }
        if (!firstName && !lastName) {
          diagnostics.rowsRejectedMissingName++;
        }

        if (isLife) {
          diagnostics.rowsMatchedLifeHealth++;
          recordSample(diagnostics, {
            name: `${firstName} ${lastName}`.trim(),
            licenseType,
            authority: combinedAuthority || "(none)",
            status: licenseStatus || "(blank)",
            licenseNumber: licenseNumber || "(blank)",
            npn: npn || "(blank)",
          });
        }

        batch.push(buildRawRecord({
          source: "TX-DOI",
          state: "TX",
          rawFirstName: firstName,
          rawLastName: lastName,
          rawEmail: email,
          rawPhone: phone,
          rawCity: city,
          rawLicenseType: licenseType,
          rawLineOfAuthority: lineOfAuthority,
          rawLicenseStatus: licenseStatus,
          rawLicenseNumber: licenseNumber,
          rawNpn: npn,
        }));
        diagnostics.rowsUpsertAttempted++;

        if (batch.length >= BATCH_SIZE) {
          await landRawBatch(batch, result, diagnostics);
          batch = [];
        }
      } catch (rowErr: any) {
        result.errors++;
      }
    }

    // Flush batch for this page
    if (batch.length > 0) {
      await landRawBatch(batch, result, diagnostics);
    }

    console.info(
      `[TX] After page ${page} — matchedLifeHealth=${diagnostics.rowsMatchedLifeHealth} imported=${result.imported} updated=${result.updated} skipped=${result.skipped}`
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
  logDiagnostics("TX", diagnostics);
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
      const batch: RawLandRecord[] = [];
      result.skipped = 0;

      for (const row of response.data) {
        try {
          const licenseType = String(row.license_type || row.licenseType || "").trim();
          const licenseStatus = String(row.license_status || row.status || "").trim();
          const city = String(row.city || row.City || "").trim();
          const npn = String(row.npn || row.NPN || "").trim();
          const licenseNumber = String(row.license_number || row.npn || "").trim();
          const firstName = String(row.first_name || row.firstName || "").trim();
          const lastName = String(row.last_name || row.lastName || "").trim();
          batch.push(buildRawRecord({
            source: "OH-DOI",
            state: "OH",
            rawFirstName: firstName,
            rawLastName: lastName,
            rawEmail: String(row.email || "").trim().toLowerCase(),
            rawPhone: String(row.phone || "").trim(),
            rawCity: city,
            rawLicenseType: licenseType,
            rawLineOfAuthority: "",
            rawLicenseStatus: licenseStatus,
            rawLicenseNumber: licenseNumber,
            rawNpn: npn,
          }));
        } catch { result.errors++; }
      }

      if (batch.length > 0) await landRawBatch(batch, result);
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

      const batch: RawLandRecord[] = [];
      for (const row of records) {
        try {
          const licenseType = pick(row, "LicenseType", "License Type", "licenseType") || "";
          const licenseStatus = pick(row, "Status", "LicenseStatus", "License Status") || "";
          const city = pick(row, "City", "ResidenceCity", "BusinessCity") || "";
          const npn = pick(row, "NPN", "npn", "LicenseNumberAlt") || "";
          const licenseNumber = pick(row, "LicenseNumber", "License Number", "NPN") || "";
          const firstName = pick(row, "FirstName", "First Name", "firstName") || "";
          const lastName = pick(row, "LastName", "Last Name", "lastName") || "";
          batch.push(buildRawRecord({
            source: "GA-DOI",
            state: "GA",
            rawFirstName: firstName,
            rawLastName: lastName,
            rawEmail: (pick(row, "Email", "EmailAddress", "Email Address") || "").toLowerCase(),
            rawPhone: pick(row, "Phone", "PhoneNumber", "Phone Number") || "",
            rawCity: city,
            rawLicenseType: licenseType,
            rawLineOfAuthority: "",
            rawLicenseStatus: licenseStatus,
            rawLicenseNumber: licenseNumber,
            rawNpn: npn,
          }));
        } catch { result.errors++; }
      }

      if (batch.length > 0) await landRawBatch(batch, result);
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

function printSummary(result: ScrapeAllResult) {
  const header = ["State", "Imported", "Updated", "Skipped", "Errors"];
  const colWidth = 11;
  console.log("\n──────────────────────────────────────────────");
  console.log(" DOI Scraper Summary");
  console.log("──────────────────────────────────────────────");
  const formattedHeader = header
    .map((label, idx) =>
      idx === 0 ? label.padEnd(8) : label.padStart(colWidth)
    )
    .join(" ");
  console.log(" " + formattedHeader);
  console.log(" " + "─".repeat(formattedHeader.length));
  for (const [state, stats] of Object.entries(result.byState)) {
    const row = [
      state.padEnd(8),
      String(stats.imported).padStart(colWidth),
      String(stats.updated).padStart(colWidth),
      String(stats.skipped).padStart(colWidth),
      String(stats.errors).padStart(colWidth),
    ].join(" ");
    console.log(" " + row);
  }
  console.log(" " + "─".repeat(formattedHeader.length));
  const totals = [
    "TOTAL".padEnd(8),
    String(result.totalImported).padStart(colWidth),
    String(result.totalUpdated).padStart(colWidth),
    String(result.totalSkipped).padStart(colWidth),
    String(result.totalErrors).padStart(colWidth),
  ].join(" ");
  console.log(" " + totals);
  console.log("──────────────────────────────────────────────\n");
}

async function runStandalone() {
  console.log("[scrape-doi] Starting standalone DOI scrape…");
  const started = Date.now();
  try {
    const result = await scrapeAllStates();
    printSummary(result);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[scrape-doi] Finished in ${elapsed}s — imported=${result.totalImported} updated=${result.totalUpdated} skipped=${result.totalSkipped} errors=${result.totalErrors}`
    );
    process.exit(0);
  } catch (err: any) {
    console.error("[scrape-doi] Fatal error:", err?.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  runStandalone();
}
