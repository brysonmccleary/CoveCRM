// /pages/api/sheets/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead, { createLeadsFromGoogleSheet, sanitizeLeadType } from "@/models/Lead";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";

// ✅ Auto-enroll helper (folder drip watchers)
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function timingSafeEqualHex(a: string, b: string) {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function hmacHex(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function normalizePhone(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

function pickRowValue(row: Record<string, any>, keys: string[]) {
  for (const k of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return "";
}

async function getOrCreateSafeFolder(userEmail: string, folderName: string) {
  let name = String(folderName || "").trim() || "Imported Leads";
  if (isSystemFolder(name) || isSystemish(name)) name = `${name} (Leads)`;

  let folder = await Folder.findOne({ userEmail, name });
  if (!folder) folder = await Folder.create({ userEmail, name, source: "google-sheets" });

  // Absolute post-condition: never return a system-ish folder
  if (!folder?.name || isSystemFolder(folder.name) || isSystemish(folder.name)) {
    const safe = `${name} — ${Date.now()}`;
    folder = await Folder.create({ userEmail, name: safe, source: "google-sheets" });
  }

  return folder;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1) Verify signature + parse
    const sig = String(req.headers["x-covecrm-signature"] || "").trim();
    if (!sig) return res.status(401).json({ error: "Missing signature" });

    const rawBody = await readRawBody(req);
    if (!rawBody) return res.status(400).json({ error: "Missing body" });

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const userEmail = String(payload.userEmail || "").trim().toLowerCase();
    const sheetId = String(payload.sheetId || "").trim();
    if (!userEmail || !sheetId) {
      return res.status(400).json({ error: "Missing userEmail or sheetId" });
    }

    // 2) Load user + verify per-user webhook secret
    await dbConnect();

    const user = await User.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ error: "User not found" });

    const gs: any = (user as any).googleSheets || {};
    const secret = String(gs.webhookSecret || "");
    if (!secret) return res.status(403).json({ error: "Webhook not enabled for user" });

    const expected = hmacHex(rawBody, secret);
    if (!timingSafeEqualHex(sig, expected)) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    // 3) Find sheet mapping -> folder (✅ use syncedSheetsSimple)
    const synced = Array.isArray(gs.syncedSheetsSimple) ? gs.syncedSheetsSimple : [];
    const match = synced.find((s: any) => String(s.sheetId || "") === sheetId);
    if (!match) return res.status(404).json({ error: "No sheet mapping found for this user" });

    const folderName = String(match.folderName || "").trim() || "Imported Leads";
    const folder = await getOrCreateSafeFolder(userEmail, folderName);

    // 4) Map row -> your Lead schema (canonical fields are Title Case keys)
    const row = (payload.row || {}) as Record<string, any>;

    const firstName = pickRowValue(row, ["First Name", "firstName", "firstname", "First", "first"]);
    const lastName = pickRowValue(row, ["Last Name", "lastName", "lastname", "Last", "last"]);
    const phoneRaw = pickRowValue(row, ["Phone", "phone", "phoneNumber", "Phone Number", "PhoneNumber"]);
    const emailRaw = pickRowValue(row, ["Email", "email", "Email Address", "EmailAddress"]);
    const state = pickRowValue(row, ["State", "state"]);
    const age = pickRowValue(row, ["Age", "age"]);
    const notes = pickRowValue(row, ["Notes", "notes", "Note", "note"]);
    const beneficiary = pickRowValue(row, ["Beneficiary", "beneficiary"]);
    const coverageAmount = pickRowValue(row, ["Coverage Amount", "coverageAmount", "Coverage", "coverage"]);
    const leadTypeIn = pickRowValue(row, ["leadType", "Lead Type", "LeadType", "Type", "type"]);

    const normalizedPhone = normalizePhone(phoneRaw);
    const phoneLast10 = normalizedPhone ? normalizedPhone.slice(-10) : "";

    // 5) Optional de-dupe (prevents same phone being inserted repeatedly per folder)
    //    If no phone, attempt de-dupe by email per folder.
    if (normalizedPhone) {
      const exists = await (Lead as any).findOne({
        userEmail,
        folderId: folder._id,
        normalizedPhone,
      });
      if (exists) {
        match.lastSyncedAt = new Date();
        match.lastEventAt = new Date();
        gs.syncedSheetsSimple = synced;
        (user as any).googleSheets = gs;
        await user.save();
        return res.status(200).json({ ok: true, skipped: "duplicate_phone" });
      }
    } else if (String(emailRaw || "").trim()) {
      const emailLower = String(emailRaw || "").trim().toLowerCase();
      const exists = await (Lead as any).findOne({
        userEmail,
        folderId: folder._id,
        $or: [{ Email: emailLower }, { email: emailLower }],
      });
      if (exists) {
        match.lastSyncedAt = new Date();
        match.lastEventAt = new Date();
        gs.syncedSheetsSimple = synced;
        (user as any).googleSheets = gs;
        await user.save();
        return res.status(200).json({ ok: true, skipped: "duplicate_email" });
      }
    }

    // Build the doc using YOUR schema’s keys.
    // Also include raw row + sheet metadata (strict:false allows extra fields safely).
    const leadDoc: any = {
      State: String(state || "").trim() || undefined,
      "First Name": String(firstName || "").trim() || undefined,
      "Last Name": String(lastName || "").trim() || undefined,
      Phone: String(phoneRaw || "").trim() || undefined,
      Email: String(emailRaw || "").trim() || undefined,
      Notes: String(notes || "").trim() || undefined,
      Age: String(age || "").trim() || undefined,
      Beneficiary: String(beneficiary || "").trim() || undefined,
      "Coverage Amount": String(coverageAmount || "").trim() || undefined,

      normalizedPhone: normalizedPhone || undefined,
      phoneLast10: phoneLast10 || undefined,
      status: "New",
      leadType: sanitizeLeadType(String(leadTypeIn || "")),

      source: "google-sheets",
      sheetMeta: {
        sheetId,
        gid: payload.gid || "",
        tabName: payload.tabName || match.tabName || "",
        receivedAt: new Date(),
        ts: payload.ts || null,
      },
      rawRow: row,
    };

    // 6) Insert via your helper
    await createLeadsFromGoogleSheet([leadDoc], userEmail, folder._id);

    // ✅ 6b) Auto-enroll in folder drips if this folder is watched
    // We need a leadId to enroll. We'll fetch the most recent matching lead.
    let createdLead: any = null;
    const ts = payload.ts || null;

    if (ts) {
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          "sheetMeta.ts": ts,
        })
        .sort({ createdAt: -1 })
        .select({ _id: 1 })
        .lean();
    }

    if (!createdLead && normalizedPhone) {
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          normalizedPhone,
        })
        .sort({ createdAt: -1 })
        .select({ _id: 1 })
        .lean();
    }

    if (!createdLead && String(emailRaw || "").trim()) {
      const emailLower = String(emailRaw || "").trim().toLowerCase();
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          $or: [{ Email: emailLower }, { email: emailLower }],
        })
        .sort({ createdAt: -1 })
        .select({ _id: 1 })
        .lean();
    }

    if (createdLead?._id) {
      await enrollOnNewLeadIfWatched({
        userEmail,
        folderId: String(folder._id),
        leadId: String(createdLead._id),
        source: "sheet-bulk",
        startMode: "now",
      });
    }

    // 7) Update mapping bookkeeping
    match.lastSyncedAt = new Date();
    match.lastEventAt = new Date();
    gs.syncedSheetsSimple = synced;
    (user as any).googleSheets = gs;
    await user.save();

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Webhook failed" });
  }
}
