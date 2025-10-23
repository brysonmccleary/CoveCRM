import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import { ensureSafeFolder } from "@/lib/ensureSafeFolder";

const FP = "sheets-audit-v1";

const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};
const clean = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
const sanitizeKey = (k: any) => {
  let s = clean(k);
  if (!s) return "";
  s = s.replace(/\./g, "_");
  s = s.replace(/^\$+/, "");
  return s.trim();
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // auth for admin/audit: same rule as cron
    const headerToken = Array.isArray(req.headers["x-cron-secret"])
      ? req.headers["x-cron-secret"][0]
      : (req.headers["x-cron-secret"] as string | undefined);
    const queryToken = typeof req.query.token === "string" ? (req.query.token as string) : undefined;
    const provided = headerToken || queryToken;
    if ((process.env.CRON_SECRET || "") && provided !== process.env.CRON_SECRET) {
      return res.status(403).json({ ok: false, error: "Forbidden", fingerprint: FP });
    }

    const userEmailParam = String(req.query.userEmail || "").toLowerCase();
    const spreadsheetId = String(req.query.spreadsheetId || "");
    const titleFilter = req.query.title ? String(req.query.title) : undefined;
    const sample = Math.max(1, Math.min(50, parseInt(String(req.query.sample || "20"), 10) || 20));

    if (!userEmailParam || !spreadsheetId) {
      return res.status(400).json({ ok: false, error: "Missing userEmail or spreadsheetId", fingerprint: FP });
    }

    await dbConnect();

    const user = await User.findOne({ email: userEmailParam }).lean();
    if (!user) return res.status(404).json({ ok: false, error: "User not found", fingerprint: FP });

    const gs: any = (user as any).googleSheets || {};
    const rootRefresh = gs.refreshToken || "";

    // find config (new or legacy)
    const synced = (gs.syncedSheets || []) as any[];
    const legacy = (gs.sheets || []) as any[];

    const cfgNew = synced.find((s: any) => s?.spreadsheetId === spreadsheetId);
    const cfgLegacy = legacy.find((s: any) => s?.sheetId === spreadsheetId);

    const headerRow = Number((cfgNew?.headerRow ?? cfgLegacy?.headerRow ?? 1) || 1);
    const pointerStored = Number((cfgNew?.lastRowImported ?? cfgLegacy?.lastRowImported ?? headerRow + 1) || headerRow + 1);
    const title = String(cfgNew?.title ?? cfgLegacy?.tabName ?? titleFilter ?? "Sheet1");

    const refreshToken = (cfgNew?.refreshToken || cfgLegacy?.refreshToken || rootRefresh);
    if (!refreshToken) {
      return res.status(400).json({ ok: false, error: "No Google refresh token available", fingerprint: FP });
    }

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2.setCredentials({ refresh_token: refreshToken });

    const sheets = google.sheets({ version: "v4", auth: oauth2 });
    const drive  = google.drive({  version: "v3", auth: oauth2 });

    // headers
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!A${headerRow}:Z${headerRow}`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    const headers = (headerResp.data.values?.[0] || []).map(sanitizeKey).filter(Boolean);

    // sample window: read from (headerRow+1) up to pointer+sample, plus pointer window
    const start = Math.max(headerRow + 1, pointerStored);
    const end   = start + sample - 1;

    const dataResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!A${start}:Z${end}`,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER",
    });
    const rows = (dataResp.data.values || []) as any[][];

    // destination folder via ensureSafeFolder (sheetId->folder mapping)
    const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
    const computedDefault = `${driveMeta.data.name || "Imported Leads"} — ${title}`.trim();
    const folderDoc = await ensureSafeFolder({
      userEmail: userEmailParam,
      folderId: cfgNew?.folderId || cfgLegacy?.folderId,
      folderName: cfgNew?.folderName || cfgLegacy?.folderName,
      defaultName: computedDefault,
      source: "google-sheets",
      sheetId: spreadsheetId,
    });

    // analyze rows
    const analysis: any[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || [];
      const sheetRow = start + i; // absolute sheet row #
      const doc: Record<string, any> = {};
      headers.forEach((h, c) => (doc[h] = row[c]));

      const p = normPhone(doc["Phone"] ?? doc["phone"] ?? "");
      const e = normEmail(doc["Email"] ?? doc["email"] ?? "");

      let action = "SKIP";
      let reason = "";
      let existingId: string | undefined;

      if (!p && !e) {
        action = "SKIP";
        reason = "no phone/email";
      } else {
        const or: any[] = [];
        if (p) or.push({ normalizedPhone: p });
        if (e) or.push({ email: e });
        const filter = { userEmail: userEmailParam, ...(or.length ? { $or: or } : {}) };
        const existing = await Lead.findOne(filter).select({ _id: 1 }).lean<{ _id: mongoose.Types.ObjectId } | null>();
        if (existing) {
          action = "UPDATE";
          existingId = String(existing._id);
        } else {
          action = "INSERT";
        }
      }

      analysis.push({
        sheetRow,
        values: doc,
        normalized: { phone: p || null, email: e || null },
        decision: { action, reason, existingId: existingId || null },
      });
    }

    return res.status(200).json({
      ok: true,
      fingerprint: FP,
      userEmail: userEmailParam,
      spreadsheetId,
      title,
      headers,
      headerRow,
      pointerStored,
      readWindow: { from: start, to: end },
      targetFolder: { _id: String(folderDoc._id), name: folderDoc.name },
      sampleCount: rows.length,
      analysis,
    });
  } catch (err: any) {
    console.error(`[${FP}] error`, err);
    return res.status(500).json({ ok: false, error: err?.message || "audit failed", fingerprint: FP });
  }
}
