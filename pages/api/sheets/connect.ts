// /pages/api/sheets/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";

function getBaseUrl(req: NextApiRequest) {
  const env = process.env.NEXT_PUBLIC_BASE_URL || process.env.COVECRM_BASE_URL;
  if (env) return env.replace(/\/+$/, "");

  const xfProto = req.headers["x-forwarded-proto"] as string | undefined;
  const proto = xfProto || ((req.socket as any)?.encrypted ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

// Prevent breaking the Apps Script template if values contain quotes/newlines.
function esc(s: string) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '\\"');
}

function buildAppsScript(params: {
  webhookUrl: string;
  backfillUrl: string;
  userEmail: string;
  sheetId: string;
  gid?: string;
  tabName?: string;
  secret: string;
}) {
  const webhookUrl = esc(params.webhookUrl);
  const backfillUrl = esc(params.backfillUrl);
  const userEmail = esc(params.userEmail);
  const sheetId = esc(params.sheetId);
  const gid = esc(params.gid || "");
  const tabName = esc(params.tabName || "");
  const secret = esc(params.secret);

  return `/**
 * CoveCRM Google Sheets → Real-time Lead Sync (NO OAUTH / NO CASA)
 *
 * ✅ What this does:
 * - ONE-TIME: Imports ALL existing rows in this sheet into CoveCRM (right after install).
 * - FOREVER: All NEW rows you add to this sheet will automatically import into CoveCRM.
 *
 * ONE-TIME SETUP (do this once):
 * 1) In your Google Sheet: Extensions → Apps Script
 * 2) Select everything in Code.gs and paste this code so it REPLACES everything
 * 3) Save:
 *    - Mac: ⌘ Command + S
 *    - Windows: Ctrl + S
 *    - OR click the floppy disk “Save” icon in the top toolbar (tooltip: “Save project to Drive”)
 * 4) Near the top toolbar, use the function dropdown and select: covecrmInstall
 * 5) Click Run (▶) in the top toolbar (near Debug) and approve permissions
 *
 * ⚠️ DO NOT CLICK DEPLOY
 * This is NOT a web app deploy. You only Save + Run once.
 */

const COVECRM_WEBHOOK_URL = "${webhookUrl}";
const COVECRM_BACKFILL_URL = "${backfillUrl}";
const COVECRM_USER_EMAIL = "${userEmail}";
const COVECRM_SHEET_ID = "${sheetId}";
const COVECRM_GID = "${gid}";
const COVECRM_TAB_NAME = "${tabName}";
const COVECRM_SECRET = "${secret}";

// Backfill behavior
const BACKFILL_BATCH_SIZE = 50;      // rows per request (kept conservative)
const BACKFILL_MAX_MS = 240000;      // stop before 6-min Apps Script limit (4 min)
const BACKFILL_TRIGGER_FN = "covecrmBackfillWorker";

// Where we store last-processed info (prevents re-sending the same row repeatedly)
function _propKey(suffix) {
  return "covecrm:" + COVECRM_SHEET_ID + ":" + (COVECRM_GID || "any") + ":" + suffix;
}

/**
 * INSTALL (run one time manually)
 * - Installs triggers (forever sync)
 * - Starts a one-time backfill import of all existing rows
 */
function covecrmInstall() {
  // Remove our old triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === "covecrmOnEdit" || fn === "covecrmOnChange" || fn === BACKFILL_TRIGGER_FN) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // ✅ Installable onEdit trigger (most reliable for user-added rows + paste)
  ScriptApp.newTrigger("covecrmOnEdit")
    .forSpreadsheet(COVECRM_SHEET_ID)
    .onEdit()
    .create();

  // Optional: keep a lightweight onChange trigger as a safety net for structural changes.
  // It will NOT spam because we also de-dupe via PropertiesService.
  ScriptApp.newTrigger("covecrmOnChange")
    .forSpreadsheet(COVECRM_SHEET_ID)
    .onChange()
    .create();

  Logger.log("✅ CoveCRM triggers installed. New rows will import automatically.");

  // ✅ Start one-time backfill immediately after install
  covecrmBackfillStart();
}

/**
 * Start a one-time backfill.
 * - Imports ALL CURRENT rows (row 2..lastRow) into CoveCRM safely in chunks
 * - Uses PropertiesService checkpointing to resume if needed
 * - Uses a time-based trigger only if needed (no Deploy, no OAuth verification)
 */
function covecrmBackfillStart() {
  const props = PropertiesService.getScriptProperties();

  // Idempotent: if already completed for this sheet mapping, don't re-run automatically.
  const done = props.getProperty(_propKey("backfillDone"));
  if (done === "true") {
    Logger.log("ℹ️ Backfill already completed for this sheet. Skipping.");
    return;
  }

  // If a backfill is already in progress, just ensure the worker trigger exists.
  const inProgress = props.getProperty(_propKey("backfillInProgress"));
  if (inProgress === "true") {
    _ensureBackfillTrigger();
    Logger.log("ℹ️ Backfill already in progress. Worker trigger ensured.");
    return;
  }

  const runId = Utilities.getUuid();
  props.setProperty(_propKey("backfillRunId"), runId);
  props.setProperty(_propKey("backfillNextRow"), "2"); // row 1 is headers
  props.setProperty(_propKey("backfillInProgress"), "true");
  props.deleteProperty(_propKey("backfillLastError"));

  // Try to run immediately (often finishes for small/medium sheets)
  covecrmBackfillWorker();

  // If not finished, the worker will keep going via trigger
  _ensureBackfillTrigger();
}

function _ensureBackfillTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === BACKFILL_TRIGGER_FN);
  if (exists) return;

  // Time-driven trigger to continue if we hit execution limits
  // (no Deploy required — runs inside user's Apps Script project)
  ScriptApp.newTrigger(BACKFILL_TRIGGER_FN)
    .timeBased()
    .everyMinutes(1)
    .create();
}

function _removeBackfillTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === BACKFILL_TRIGGER_FN) {
      ScriptApp.deleteTrigger(t);
    }
  });
}

/**
 * Worker: imports the next chunk(s) of rows until time is nearly up, then exits.
 * Will be called:
 * - immediately by covecrmBackfillStart()
 * - later by time-driven trigger if needed
 */
function covecrmBackfillWorker() {
  const start = Date.now();
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();

  // Prevent overlapping runs (trigger + manual run)
  if (!lock.tryLock(5000)) return;

  try {
    const done = props.getProperty(_propKey("backfillDone"));
    if (done === "true") {
      _removeBackfillTrigger();
      props.deleteProperty(_propKey("backfillInProgress"));
      return;
    }

    const runId = props.getProperty(_propKey("backfillRunId")) || Utilities.getUuid();
    props.setProperty(_propKey("backfillRunId"), runId);

    const ss = SpreadsheetApp.openById(COVECRM_SHEET_ID);

    // Resolve the sheet we should read
    let sheet = null;
    if (COVECRM_GID) {
      const sheets = ss.getSheets();
      for (let i = 0; i < sheets.length; i++) {
        if (String(sheets[i].getSheetId()) === String(COVECRM_GID)) {
          sheet = sheets[i];
          break;
        }
      }
    }
    if (!sheet) sheet = ss.getActiveSheet();
    if (!sheet) return;

    if (COVECRM_TAB_NAME && sheet.getName() !== COVECRM_TAB_NAME) return;
    if (COVECRM_GID && String(sheet.getSheetId()) !== String(COVECRM_GID)) return;

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) {
      // Nothing to import
      props.setProperty(_propKey("backfillDone"), "true");
      props.deleteProperty(_propKey("backfillInProgress"));
      _removeBackfillTrigger();
      return;
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    let nextRow = parseInt(props.getProperty(_propKey("backfillNextRow")) || "2", 10);
    if (!nextRow || nextRow < 2) nextRow = 2;

    while (nextRow <= lastRow) {
      // Stop before we hit execution limits
      if (Date.now() - start > BACKFILL_MAX_MS) break;

      const endRow = Math.min(lastRow, nextRow + BACKFILL_BATCH_SIZE - 1);
      const numRows = endRow - nextRow + 1;

      const values = sheet.getRange(nextRow, 1, numRows, lastCol).getValues();

      const rows = [];
      for (let i = 0; i < values.length; i++) {
        const rowNumber = nextRow + i;
        const rowVals = values[i];

        // Build object from headers
        const rowObj = {};
        let hasAnyValue = false;

        for (let c = 0; c < headers.length; c++) {
          const key = headers[c] ? String(headers[c]).trim() : "";
          if (!key) continue;
          const v = rowVals[c];
          if (v !== null && v !== undefined && String(v).trim() !== "") hasAnyValue = true;
          rowObj[key] = v;
        }

        if (!hasAnyValue) continue;

        rows.push({
          rowNumber: rowNumber,
          row: rowObj
        });
      }

      if (rows.length) {
        _postBackfillBatch(runId, rows, lastRow);
      }

      nextRow = endRow + 1;
      props.setProperty(_propKey("backfillNextRow"), String(nextRow));
    }

    // Completed?
    if (nextRow > lastRow) {
      props.setProperty(_propKey("backfillDone"), "true");
      props.deleteProperty(_propKey("backfillInProgress"));
      props.deleteProperty(_propKey("backfillNextRow"));
      _removeBackfillTrigger();
      Logger.log("✅ Backfill completed.");
    } else {
      // Not finished yet; ensure trigger exists and exit
      props.setProperty(_propKey("backfillInProgress"), "true");
      _ensureBackfillTrigger();
      Logger.log("⏳ Backfill paused (will continue). Next row: " + nextRow);
    }
  } catch (err) {
    try {
      PropertiesService.getScriptProperties().setProperty(_propKey("backfillLastError"), String(err));
    } catch {}
  } finally {
    try {
      lock.releaseLock();
    } catch {}
  }
}

function _postBackfillBatch(runId, rows, totalRows) {
  const payload = {
    userEmail: COVECRM_USER_EMAIL,
    sheetId: COVECRM_SHEET_ID,
    gid: COVECRM_GID || "",
    tabName: COVECRM_TAB_NAME || "",
    runId: runId,
    totalRows: totalRows,
    rows: rows,
    ts: Date.now()
  };

  const body = JSON.stringify(payload);

  // HMAC SHA256 signature (hex)
  const rawSig = Utilities.computeHmacSha256Signature(body, COVECRM_SECRET);
  const sig = rawSig
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");

  const resp = UrlFetchApp.fetch(COVECRM_BACKFILL_URL, {
    method: "post",
    contentType: "application/json",
    payload: body,
    muteHttpExceptions: true,
    headers: { "x-covecrm-signature": sig }
  });

  const code = resp.getResponseCode ? resp.getResponseCode() : 200;

  // If server errors, stop the backfill so we don’t spam.
  if (code >= 500) {
    throw new Error("Backfill batch failed with " + code);
  }
}

// Trigger: runs when a user edits a cell (including pasting rows).
function covecrmOnEdit(e) {
  try {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();

    // Optional tab-name filter if you ever pass tabName
    if (COVECRM_TAB_NAME && sheet.getName() !== COVECRM_TAB_NAME) return;

    // Optional gid filter if provided
    if (COVECRM_GID && String(sheet.getSheetId()) !== String(COVECRM_GID)) return;

    const startRow = e.range.getRow();
    const numRows = e.range.getNumRows ? e.range.getNumRows() : 1;

    // We assume row 1 is headers
    if (startRow < 2) return;

    // Process each affected row once
    for (let r = startRow; r < startRow + numRows; r++) {
      _sendRowIfNew(sheet, r);
    }
  } catch (err) {
    // Logger.log(String(err));
  }
}

// Trigger: runs on structural changes (row insert/delete, etc.)
// We try to send the last row, but we still de-dupe using PropertiesService.
function covecrmOnChange(e) {
  try {
    const ss = SpreadsheetApp.openById(COVECRM_SHEET_ID);

    // If gid is provided, grab that sheet specifically; else use active sheet.
    let sheet = null;
    if (COVECRM_GID) {
      const sheets = ss.getSheets();
      for (let i = 0; i < sheets.length; i++) {
        if (String(sheets[i].getSheetId()) === String(COVECRM_GID)) {
          sheet = sheets[i];
          break;
        }
      }
    }
    if (!sheet) sheet = ss.getActiveSheet();

    if (!sheet) return;
    if (COVECRM_TAB_NAME && sheet.getName() !== COVECRM_TAB_NAME) return;
    if (COVECRM_GID && String(sheet.getSheetId()) !== String(COVECRM_GID)) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    _sendRowIfNew(sheet, lastRow);
  } catch (err) {
    // Logger.log(String(err));
  }
}

function _sendRowIfNew(sheet, rowNumber) {
  // Basic sanity: avoid empty rows
  const lastCol = sheet.getLastColumn();
  if (!lastCol || lastCol < 1) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];

  // Build row object from headers
  const rowObj = {};
  let hasAnyValue = false;

  for (let i = 0; i < headers.length; i++) {
    const key = headers[i] ? String(headers[i]).trim() : "";
    if (!key) continue;
    const v = values[i];
    if (v !== null && v !== undefined && String(v).trim() !== "") hasAnyValue = true;
    rowObj[key] = v;
  }

  // Don’t send completely blank rows
  if (!hasAnyValue) return;

  // De-dupe key: rowNumber + a compact hash of the values
  const hash = _hashRow(values);
  const dedupeKey = String(rowNumber) + ":" + hash;

  const props = PropertiesService.getScriptProperties();
  const lastKey = props.getProperty(_propKey("lastKey")) || "";
  if (lastKey === dedupeKey) return;

  // Write it BEFORE sending to prevent accidental double sends from near-simultaneous triggers
  props.setProperty(_propKey("lastKey"), dedupeKey);

  const payload = {
    userEmail: COVECRM_USER_EMAIL,
    sheetId: COVECRM_SHEET_ID,
    gid: COVECRM_GID || "",
    tabName: COVECRM_TAB_NAME || "",
    row: rowObj,
    ts: Date.now()
  };

  const body = JSON.stringify(payload);

  // HMAC SHA256 signature (hex)
  const rawSig = Utilities.computeHmacSha256Signature(body, COVECRM_SECRET);
  const sig = rawSig
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");

  const resp = UrlFetchApp.fetch(COVECRM_WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: body,
    muteHttpExceptions: true,
    headers: { "x-covecrm-signature": sig }
  });

  // Optional: if webhook failed, allow retry by clearing lastKey
  const code = resp.getResponseCode ? resp.getResponseCode() : 200;
  if (code >= 400) {
    props.deleteProperty(_propKey("lastKey"));
  }
}

function _hashRow(values) {
  try {
    const joined = values.map(v => String(v ?? "")).join("|");
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, joined, Utilities.Charset.UTF_8);
    return bytes
      .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16); // short hash is fine for dedupe
  } catch {
    return String(new Date().getTime());
  }
}
`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  // ✅ Backwards compatibility: some UI versions send "spreadsheetId" instead of "sheetId".
  const { sheetId, spreadsheetId, folderName, tabName, gid } = (req.body || {}) as {
    sheetId?: string;
    spreadsheetId?: string;
    folderName?: string;
    tabName?: string;
    gid?: string;
  };

  const effectiveSheetId = sheetId || spreadsheetId;

  if (!effectiveSheetId || !folderName) {
    return res.status(400).json({ error: "Missing sheetId or folderName" });
  }

  const cleanFolderName = String(folderName || "").trim();
  if (!cleanFolderName) {
    return res.status(400).json({ error: "Missing folderName" });
  }

  // Hard block canonical system folder names + system-ish names (safety)
  if (isSystemFolder(cleanFolderName) || isSystemish(cleanFolderName)) {
    return res.status(400).json({ error: "Cannot link a sheet to a system folder" });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const gs: any = (user as any).googleSheets || {};

    // ✅ Ensure arrays exist
    gs.syncedSheetsSimple = Array.isArray(gs.syncedSheetsSimple) ? gs.syncedSheetsSimple : [];

    // ✅ Fully automated forever: secret auto-created per user (schema supported)
    if (!gs.webhookSecret) {
      gs.webhookSecret = crypto.randomBytes(32).toString("hex");
    }

    // ✅ UX FIX: Create the folder immediately so it appears in CoveCRM right away.
    const existingFolder = await Folder.findOne({ userEmail: session.user.email, name: cleanFolderName });
    if (!existingFolder) {
      await Folder.create({ userEmail: session.user.email, name: cleanFolderName, source: "google-sheets" });
    }

    const entry = {
      sheetId: String(effectiveSheetId),
      folderName: cleanFolderName,
      tabName: tabName || "",
      gid: gid || "",
      lastSyncedAt: null,
      lastEventAt: null,
    };

    // ✅ Upsert mapping by sheetId (string)
    const idx = gs.syncedSheetsSimple.findIndex(
      (s: any) => String(s.sheetId || "") === String(effectiveSheetId)
    );
    if (idx >= 0) gs.syncedSheetsSimple[idx] = entry;
    else gs.syncedSheetsSimple.push(entry);

    (user as any).googleSheets = gs;
    await user.save();

    const baseUrl = getBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/sheets/webhook`;
    const backfillUrl = `${baseUrl}/api/sheets/backfill`;

    const appsScript = buildAppsScript({
      webhookUrl,
      backfillUrl,
      userEmail: session.user.email,
      sheetId: String(effectiveSheetId),
      gid: gid || "",
      tabName: tabName || "",
      secret: String(gs.webhookSecret),
    });

    return res.status(200).json({
      ok: true,
      webhookUrl,
      backfillUrl,
      appsScript,
      sheet: {
        sheetId: String(effectiveSheetId),
        folderName: cleanFolderName,
        tabName: tabName || "",
        gid: gid || "",
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed" });
  }
}
