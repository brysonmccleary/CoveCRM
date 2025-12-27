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

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function buildAppsScript(params: {
  webhookUrl: string;
  backfillUrl: string;
  sheetId: string;
  gid?: string;
  tabName?: string;
  connectionId: string;
  token: string;
}) {
  const webhookUrl = esc(params.webhookUrl);
  const backfillUrl = esc(params.backfillUrl);
  const sheetId = esc(params.sheetId);
  const gid = esc(params.gid || "");
  const tabName = esc(params.tabName || "");
  const connectionId = esc(params.connectionId);
  const token = esc(params.token);

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
const COVECRM_SHEET_ID = "${sheetId}";
const COVECRM_GID = "${gid}";
const COVECRM_TAB_NAME = "${tabName}";

// ✅ Connection isolation (prevents cross-account imports)
const COVECRM_CONNECTION_ID = "${connectionId}";
const COVECRM_TOKEN = "${token}";

// Backfill behavior
const BACKFILL_BATCH_SIZE = 50;
const BACKFILL_MAX_MS = 240000;
const BACKFILL_TRIGGER_FN = "covecrmBackfillWorker";

function _propKey(suffix) {
  return "covecrm:" + COVECRM_SHEET_ID + ":" + (COVECRM_GID || "any") + ":" + suffix;
}

// ✅ Per-row dedupe keys
function _rowHashKey(rowNumber) {
  return _propKey("rowHash:" + String(rowNumber));
}
function _rowImportedKey(rowNumber) {
  return _propKey("rowImported:" + String(rowNumber));
}

function _hmacHex(body, secret) {
  const rawSig = Utilities.computeHmacSha256Signature(body, secret);
  return rawSig
    .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");
}

/**
 * INSTALL (run one time manually)
 * - Installs onEdit trigger (forever sync)
 * - Starts a one-time backfill import of all existing rows
 */
function covecrmInstall() {
  // Remove our old triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === "covecrmOnEdit" || fn === BACKFILL_TRIGGER_FN) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // ✅ Installable onEdit trigger
  ScriptApp.newTrigger("covecrmOnEdit")
    .forSpreadsheet(COVECRM_SHEET_ID)
    .onEdit()
    .create();

  Logger.log("✅ CoveCRM trigger installed. New rows will import automatically.");

  // ✅ Start one-time backfill
  covecrmBackfillStart();
}

function covecrmBackfillStart() {
  const props = PropertiesService.getScriptProperties();

  const done = props.getProperty(_propKey("backfillDone"));
  if (done === "true") {
    Logger.log("ℹ️ Backfill already completed for this sheet. Skipping.");
    return;
  }

  const inProgress = props.getProperty(_propKey("backfillInProgress"));
  if (inProgress === "true") {
    _ensureBackfillTrigger();
    Logger.log("ℹ️ Backfill already in progress. Worker trigger ensured.");
    return;
  }

  const runId = Utilities.getUuid();
  props.setProperty(_propKey("backfillRunId"), runId);
  props.setProperty(_propKey("backfillNextRow"), "2");
  props.setProperty(_propKey("backfillInProgress"), "true");
  props.deleteProperty(_propKey("backfillLastError"));

  covecrmBackfillWorker();
  _ensureBackfillTrigger();
}

function _ensureBackfillTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === BACKFILL_TRIGGER_FN);
  if (exists) return;

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

function covecrmBackfillWorker() {
  const start = Date.now();
  const props = PropertiesService.getScriptProperties();
  const lock = LockService.getScriptLock();
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
      props.setProperty(_propKey("backfillDone"), "true");
      props.deleteProperty(_propKey("backfillInProgress"));
      _removeBackfillTrigger();
      return;
    }

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    let nextRow = parseInt(props.getProperty(_propKey("backfillNextRow")) || "2", 10);
    if (!nextRow || nextRow < 2) nextRow = 2;

    while (nextRow <= lastRow) {
      if (Date.now() - start > BACKFILL_MAX_MS) break;

      const endRow = Math.min(lastRow, nextRow + BACKFILL_BATCH_SIZE - 1);
      const numRows = endRow - nextRow + 1;

      const values = sheet.getRange(nextRow, 1, numRows, lastCol).getValues();

      const rows = [];
      for (let i = 0; i < values.length; i++) {
        const rowNumber = nextRow + i;
        const rowVals = values[i];

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

        rows.push({ rowNumber: rowNumber, row: rowObj });
      }

      if (rows.length) {
        _postBackfillBatch(runId, rows, lastRow);
      }

      nextRow = endRow + 1;
      props.setProperty(_propKey("backfillNextRow"), String(nextRow));
    }

    if (nextRow > lastRow) {
      props.setProperty(_propKey("backfillDone"), "true");
      props.deleteProperty(_propKey("backfillInProgress"));
      props.deleteProperty(_propKey("backfillNextRow"));
      _removeBackfillTrigger();
      Logger.log("✅ Backfill completed.");
    } else {
      props.setProperty(_propKey("backfillInProgress"), "true");
      _ensureBackfillTrigger();
      Logger.log("⏳ Backfill paused (will continue). Next row: " + nextRow);
    }
  } catch (err) {
    try {
      PropertiesService.getScriptProperties().setProperty(_propKey("backfillLastError"), String(err));
    } catch {}
  } finally {
    try { lock.releaseLock(); } catch {}
  }
}

function _postBackfillBatch(runId, rows, totalRows) {
  const payload = {
    connectionId: COVECRM_CONNECTION_ID,
    sheetId: COVECRM_SHEET_ID,
    gid: COVECRM_GID || "",
    tabName: COVECRM_TAB_NAME || "",
    runId: runId,
    totalRows: totalRows,
    rows: rows,
    ts: Date.now()
  };

  const body = JSON.stringify(payload);
  const sig = _hmacHex(body, COVECRM_TOKEN);

  const resp = UrlFetchApp.fetch(COVECRM_BACKFILL_URL, {
    method: "post",
    contentType: "application/json",
    payload: body,
    muteHttpExceptions: true,
    headers: {
      "x-covecrm-token": COVECRM_TOKEN,
      "x-covecrm-signature": sig
    }
  });

  const code = resp.getResponseCode ? resp.getResponseCode() : 200;
  if (code >= 500) throw new Error("Backfill batch failed with " + code);
}

function covecrmOnEdit(e) {
  try {
    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    if (COVECRM_TAB_NAME && sheet.getName() !== COVECRM_TAB_NAME) return;
    if (COVECRM_GID && String(sheet.getSheetId()) !== String(COVECRM_GID)) return;

    const startRow = e.range.getRow();
    const numRows = e.range.getNumRows ? e.range.getNumRows() : 1;
    if (startRow < 2) return;

    for (let r = startRow; r < startRow + numRows; r++) {
      _sendRowIfNew(sheet, r);
    }
  } catch {}
}

function _sendRowIfNew(sheet, rowNumber) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const lastCol = sheet.getLastColumn();
    if (!lastCol || lastCol < 1) return;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const values = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0];

    const rowObj = {};
    let hasAnyValue = false;

    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] ? String(headers[i]).trim() : "";
      if (!key) continue;
      const v = values[i];
      if (v !== null && v !== undefined && String(v).trim() !== "") hasAnyValue = true;
      rowObj[key] = v;
    }

    if (!hasAnyValue) return;

    const props = PropertiesService.getScriptProperties();

    const imported = props.getProperty(_rowImportedKey(rowNumber)) === "true";
    if (imported) return;

    const hash = _hashRow(values);
    const lastHash = props.getProperty(_rowHashKey(rowNumber)) || "";
    if (lastHash === hash) return;

    props.setProperty(_rowHashKey(rowNumber), hash);

    const payload = {
      connectionId: COVECRM_CONNECTION_ID,
      sheetId: COVECRM_SHEET_ID,
      gid: COVECRM_GID || "",
      tabName: COVECRM_TAB_NAME || "",
      row: rowObj,
      ts: Date.now()
    };

    const body = JSON.stringify(payload);
    const sig = _hmacHex(body, COVECRM_TOKEN);

    const resp = UrlFetchApp.fetch(COVECRM_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: body,
      muteHttpExceptions: true,
      headers: {
        "x-covecrm-token": COVECRM_TOKEN,
        "x-covecrm-signature": sig
      }
    });

    const code = resp.getResponseCode ? resp.getResponseCode() : 200;

    if (code < 400) {
      props.setProperty(_rowImportedKey(rowNumber), "true");
    } else {
      props.deleteProperty(_rowHashKey(rowNumber));
      props.deleteProperty(_rowImportedKey(rowNumber));
    }
  } catch (err) {
    try {
      PropertiesService.getScriptProperties().setProperty(_propKey("lastError"), String(err));
    } catch {}
  } finally {
    try { lock.releaseLock(); } catch {}
  }
}

function _hashRow(values) {
  try {
    const joined = values.map(v => String(v ?? "")).join("|");
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, joined, Utilities.Charset.UTF_8);
    return bytes
      .map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
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
  if (!cleanFolderName) return res.status(400).json({ error: "Missing folderName" });

  if (isSystemFolder(cleanFolderName) || isSystemish(cleanFolderName)) {
    return res.status(400).json({ error: "Cannot link a sheet to a system folder" });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const gs: any = (user as any).googleSheets || {};
    gs.syncedSheetsSimple = Array.isArray(gs.syncedSheetsSimple) ? gs.syncedSheetsSimple : [];

    // Ensure folder exists immediately
    const existingFolder = await Folder.findOne({ userEmail: session.user.email, name: cleanFolderName });
    if (!existingFolder) {
      await Folder.create({ userEmail: session.user.email, name: cleanFolderName, source: "google-sheets" });
    }

    const connectionId = crypto.randomBytes(12).toString("hex");
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);

    const entry = {
      sheetId: String(effectiveSheetId),
      folderName: cleanFolderName,
      tabName: tabName || "",
      gid: gid || "",
      lastSyncedAt: null,
      lastEventAt: null,

      connectionId,
      tokenHash,
      createdAt: new Date(),
    };

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
      sheetId: String(effectiveSheetId),
      gid: gid || "",
      tabName: tabName || "",
      connectionId,
      token,
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
        connectionId,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed" });
  }
}
