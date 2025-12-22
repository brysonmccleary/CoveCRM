// /pages/api/sheets/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

function getBaseUrl(req: NextApiRequest) {
  const env = process.env.NEXT_PUBLIC_BASE_URL || process.env.COVECRM_BASE_URL;
  if (env) return env.replace(/\/+$/, "");

  const xfProto = String(req.headers["x-forwarded-proto"] || "");
  const proto = xfProto
    ? xfProto.split(",")[0].trim()
    : (req.socket as any)?.encrypted
    ? "https"
    : "http";

  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function buildAppsScript(params: {
  webhookUrl: string;
  userEmail: string;
  sheetId: string;
  gid?: string;
  tabName?: string;
  secret: string; // used to sign payload
}) {
  const { webhookUrl, userEmail, sheetId, gid, tabName, secret } = params;

  // NOTE: Apps Script cannot use Node crypto; we use Utilities.computeHmacSha256Signature.
  // We keep payload stable JSON with keys in a fixed order.
  return `/**
 * CoveCRM Google Sheets → Real-time Lead Sync
 *
 * ✅ What this does:
 * - When a new row is added, it sends that row to CoveCRM instantly.
 * - CoveCRM imports it into the mapped folder you chose in the app.
 *
 * Setup:
 * 1) In your Sheet: Extensions → Apps Script
 * 2) Paste this code (replace everything)
 * 3) Click Save
 * 4) Run "covecrmInstall()" once → Approve permissions
 * 5) Add a new row to test
 */

const COVECRM_WEBHOOK_URL = "${webhookUrl}";
const COVECRM_USER_EMAIL = "${userEmail}";
const COVECRM_SHEET_ID = "${sheetId}";
const COVECRM_GID = "${gid || ""}";
const COVECRM_TAB_NAME = "${tabName || ""}";
const COVECRM_SECRET = "${secret}";

function covecrmInstall() {
  // Removes old triggers to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "covecrmOnChange") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create a change trigger (works for new rows, edits, form submits)
  ScriptApp.newTrigger("covecrmOnChange")
    .forSpreadsheet(COVECRM_SHEET_ID)
    .onChange()
    .create();

  Logger.log("✅ CoveCRM trigger installed.");
}

function covecrmOnChange(e) {
  try {
    // Optional: If tabName provided, only sync that sheet
    // We'll detect active sheet name
    const ss = SpreadsheetApp.openById(COVECRM_SHEET_ID);
    const sheet = ss.getActiveSheet();
    const activeName = sheet.getName();

    if (COVECRM_TAB_NAME && activeName !== COVECRM_TAB_NAME) {
      return;
    }

    // If gid provided, ensure we are on that tab
    if (COVECRM_GID) {
      const maybeId = String(sheet.getSheetId());
      if (maybeId !== String(COVECRM_GID)) return;
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) return; // assume row 1 is headers

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const values = sheet.getRange(lastRow, 1, 1, lastCol).getValues()[0];

    // Build row object using headers
    const rowObj = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] ? String(headers[i]).trim() : "";
      if (!key) continue;
      rowObj[key] = values[i];
    }

    // Stable payload keys (order matters for signature stability)
    const payload = {
      userEmail: COVECRM_USER_EMAIL,
      sheetId: COVECRM_SHEET_ID,
      gid: COVECRM_GID || "",
      tabName: COVECRM_TAB_NAME || "",
      row: rowObj,
      ts: Date.now()
    };

    const body = JSON.stringify(payload);

    // HMAC signature
    const rawSig = Utilities.computeHmacSha256Signature(body, COVECRM_SECRET);
    const sig = rawSig.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");

    const resp = UrlFetchApp.fetch(COVECRM_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: body,
      muteHttpExceptions: true,
      headers: {
        "x-covecrm-signature": sig
      }
    });

    // For debugging
    // Logger.log(resp.getResponseCode());
    // Logger.log(resp.getContentText());
  } catch (err) {
    // Logger.log(String(err));
  }
}
`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { sheetId, folderName, tabName, gid } = (req.body || {}) as {
    sheetId?: string;
    folderName?: string;
    tabName?: string;
    gid?: string;
  };

  if (!sheetId || !folderName) {
    return res.status(400).json({ error: "Missing sheetId or folderName" });
  }
  if (isSystemFolder(folderName)) {
    return res.status(400).json({ error: "Cannot link a sheet to a system folder" });
  }

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const gs: any = (user as any).googleSheets || {};
    gs.syncedSheets = Array.isArray(gs.syncedSheets) ? gs.syncedSheets : [];

    // Create a webhook secret once per user (used to verify Apps Script pushes)
    if (!gs.webhookSecret) {
      gs.webhookSecret = crypto.randomBytes(32).toString("hex");
    }

    const idx = gs.syncedSheets.findIndex((s: any) => s.sheetId === sheetId);
    const entry = {
      sheetId,
      folderName,
      tabName: tabName || "",
      gid: gid || "",
      lastSyncedAt: null,
      lastEventAt: null,
    };

    if (idx >= 0) gs.syncedSheets[idx] = entry;
    else gs.syncedSheets.push(entry);

    (user as any).googleSheets = gs;
    await user.save();

    const baseUrl = getBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/sheets/webhook`;

    const appsScript = buildAppsScript({
      webhookUrl,
      userEmail: session.user.email,
      sheetId,
      gid: gid || "",
      tabName: tabName || "",
      secret: gs.webhookSecret,
    });

    return res.status(200).json({
      ok: true,
      webhookUrl,
      appsScript,
      sheet: { sheetId, folderName, tabName: tabName || "", gid: gid || "" },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed" });
  }
}
