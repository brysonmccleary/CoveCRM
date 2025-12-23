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
  userEmail: string;
  sheetId: string;
  gid?: string;
  tabName?: string;
  secret: string;
}) {
  const webhookUrl = esc(params.webhookUrl);
  const userEmail = esc(params.userEmail);
  const sheetId = esc(params.sheetId);
  const gid = esc(params.gid || "");
  const tabName = esc(params.tabName || "");
  const secret = esc(params.secret);

  return `/**
 * CoveCRM Google Sheets → Real-time Lead Sync (NO OAUTH / NO CASA)
 *
 * ✅ What this does:
 * - All NEW rows you add to this sheet will automatically import into CoveCRM.
 * - CoveCRM imports the row into the folder you selected in the CoveCRM UI.
 *
 * ONE-TIME SETUP (do this once):
 * 1) In your Google Sheet: Extensions → Apps Script
 * 2) Select everything in Code.gs and paste this code so it REPLACES everything
 * 3) Save:
 *    - Mac: ⌘ Command + S
 *    - Windows: Ctrl + S
 *    - OR click the floppy disk “Save” icon in the top toolbar (tooltip: “Save project to Drive”)
 * 4) Near the top toolbar, use the function dropdown and select: covecrmInstall
 *    (you don’t need to do anything else with the dropdown)
 * 5) Click Run (▶) in the top toolbar (near Debug) and approve permissions
 *
 * ⚠️ DO NOT CLICK DEPLOY
 * This is NOT a web app deploy. You only Save + Run once.
 *
 * After that, imports happen automatically forever for this sheet.
 */

const COVECRM_WEBHOOK_URL = "${webhookUrl}";
const COVECRM_USER_EMAIL = "${userEmail}";
const COVECRM_SHEET_ID = "${sheetId}";
const COVECRM_GID = "${gid}";
const COVECRM_TAB_NAME = "${tabName}";
const COVECRM_SECRET = "${secret}";

// Where we store last-processed info (prevents re-sending the same row repeatedly)
function _propKey(suffix) {
  return "covecrm:" + COVECRM_SHEET_ID + ":" + (COVECRM_GID || "any") + ":" + suffix;
}

function covecrmInstall() {
  // Remove our old triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === "covecrmOnEdit" || fn === "covecrmOnChange") {
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
    // This does NOT change any lead/drip behavior — it just ensures the folder exists before first webhook.
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

    const appsScript = buildAppsScript({
      webhookUrl,
      userEmail: session.user.email,
      sheetId: String(effectiveSheetId),
      gid: gid || "",
      tabName: tabName || "",
      secret: String(gs.webhookSecret),
    });

    return res.status(200).json({
      ok: true,
      webhookUrl,
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
