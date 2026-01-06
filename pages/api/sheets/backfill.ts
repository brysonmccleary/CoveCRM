// pages/api/sheets/backfill.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead, { createLeadsFromGoogleSheet, sanitizeLeadType } from "@/models/Lead";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";
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

function timingSafeEqualB64(a: string, b: string) {
  try {
    const ab = Buffer.from(a, "base64");
    const bb = Buffer.from(b, "base64");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

function hmacHex(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function hmacB64(body: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizePhone(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.replace(/\D+/g, "");
}

function normalizeEmail(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.toLowerCase();
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

function isHexSig(sig: string) {
  // sha256 hex digest = 64 chars
  return /^[0-9a-f]{64}$/i.test(sig);
}

function isB64Sig(sig: string) {
  // Not perfect, but good enough as a fallback
  return /^[A-Za-z0-9+/=]+$/.test(sig) && sig.length >= 40;
}

function verifySignature(rawBody: string, token: string, sig: string) {
  const trimmed = String(sig || "").trim();
  if (!trimmed) return false;

  // ✅ Hex path (Apps Script template currently uses hex)
  if (isHexSig(trimmed)) {
    const expected = hmacHex(rawBody, token);
    return timingSafeEqualHex(trimmed.toLowerCase(), expected.toLowerCase());
  }

  // ✅ Base64 fallback (durability)
  if (isB64Sig(trimmed)) {
    const expected = hmacB64(rawBody, token);
    return timingSafeEqualB64(trimmed, expected);
  }

  // Unknown format
  return false;
}

async function getOrCreateSafeFolder(userEmail: string, folderName: string) {
  let name = String(folderName || "").trim() || "Imported Leads";
  if (isSystemFolder(name) || isSystemish(name)) name = `${name} (Leads)`;

  let folder = await Folder.findOne({ userEmail, name });
  if (!folder) folder = await Folder.create({ userEmail, name, source: "google-sheets" });

  if (!folder?.name || isSystemFolder(folder.name) || isSystemish(folder.name)) {
    const safe = `${name} — ${Date.now()}`;
    folder = await Folder.create({ userEmail, name: safe, source: "google-sheets" });
  }

  return folder;
}

async function touchFolderUpdatedAt(folderId: any, userEmail: string) {
  try {
    await Folder.updateOne({ _id: folderId, userEmail }, { $set: { updatedAt: new Date() } }).exec();
  } catch {}
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = String(req.headers["x-covecrm-token"] || "").trim();
    const sig = String(req.headers["x-covecrm-signature"] || "").trim();
    if (!token) return res.status(401).json({ error: "Missing token" });
    if (!sig) return res.status(401).json({ error: "Missing signature" });

    const rawBody = await readRawBody(req);
    if (!rawBody) return res.status(400).json({ error: "Missing body" });

    // ✅ Verify BEFORE parsing JSON (signature must match raw bytes-as-string)
    if (!verifySignature(rawBody, token, sig)) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const connectionId = String(payload.connectionId || "").trim();
    const sheetId = String(payload.sheetId || "").trim();
    const runId = String(payload.runId || "").trim() || null;
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    if (!connectionId || !sheetId) return res.status(400).json({ error: "Missing connectionId or sheetId" });
    if (!rows.length) return res.status(200).json({ ok: true, inserted: 0 });

    await dbConnect();

    const user = await User.findOne({
      "googleSheets.syncedSheetsSimple": { $elemMatch: { connectionId: connectionId } },
    });
    if (!user) return res.status(404).json({ error: "Connection not found" });

    const userEmail = String((user as any)?.email || "").trim().toLowerCase();
    if (!userEmail) return res.status(500).json({ error: "User missing email" });

    const gs: any = (user as any).googleSheets || {};
    const synced = Array.isArray(gs.syncedSheetsSimple) ? gs.syncedSheetsSimple : [];
    const match = synced.find((s: any) => String(s.connectionId || "") === connectionId);
    if (!match) return res.status(404).json({ error: "Connection mapping missing" });

    if (String(match.sheetId || "") !== sheetId) {
      return res.status(403).json({ error: "Sheet mismatch for connection" });
    }

    const tokenHash = String(match.tokenHash || "");
    if (!tokenHash) return res.status(403).json({ error: "Connection token missing" });

    const gotHash = sha256Hex(token);
    if (gotHash !== tokenHash) return res.status(403).json({ error: "Invalid token" });

    const folderName = String(match.folderName || "").trim() || "Imported Leads";
    const folder = await getOrCreateSafeFolder(userEmail, folderName);

    const candidateDocs: Array<{
      rowNumber: number;
      leadDoc: any;
      normalizedPhone: string;
      emailLower: string;
    }> = [];

    const phones: string[] = [];
    const last10s: string[] = [];
    const emails: string[] = [];

    for (const item of rows) {
      const rowNumber = Number(item?.rowNumber || 0) || 0;
      const row = (item?.row || {}) as Record<string, any>;
      if (!rowNumber || !row || typeof row !== "object") continue;

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
      const emailLower = normalizeEmail(emailRaw);

      if (normalizedPhone) {
        phones.push(normalizedPhone);
        if (phoneLast10) last10s.push(phoneLast10);
      } else if (emailLower) {
        emails.push(emailLower);
      }

      const leadDoc: any = {
        State: String(state || "").trim() || undefined,
        "First Name": String(firstName || "").trim() || undefined,
        "Last Name": String(lastName || "").trim() || undefined,
        Phone: String(phoneRaw || "").trim() || undefined,
        Email: emailLower || undefined,
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
          connectionId,
          backfillRunId: runId,
          backfillRowNumber: rowNumber,
        },
        rawRow: row,
      };

      candidateDocs.push({ rowNumber, leadDoc, normalizedPhone, emailLower });
    }

    if (!candidateDocs.length) return res.status(200).json({ ok: true, inserted: 0 });

    // ✅ preload existing phone/email keys so we can dedupe within this folder BEFORE insertMany
    const existingPhoneKeys = new Set<string>();
    const existingEmailKeys = new Set<string>();

    if (phones.length || last10s.length) {
      const uniqPhones = Array.from(new Set(phones));
      const uniqLast10 = Array.from(new Set(last10s));

      const found = await (Lead as any)
        .find({
          userEmail,
          folderId: folder._id,
          $or: [
            ...(uniqPhones.length ? [{ normalizedPhone: { $in: uniqPhones } }] : []),
            ...(uniqLast10.length ? [{ phoneLast10: { $in: uniqLast10 } }] : []),
            ...(uniqPhones.length ? [{ Phone: { $in: uniqPhones } }] : []),
            ...(uniqPhones.length ? [{ phone: { $in: uniqPhones } }] : []),
          ],
        })
        .select({ normalizedPhone: 1, phoneLast10: 1, Phone: 1, phone: 1 })
        .lean();

      for (const f of found || []) {
        const np = String(f?.normalizedPhone || "").trim();
        const p10 = String(f?.phoneLast10 || "").trim();
        const raw = String(f?.Phone || f?.phone || "").replace(/\D+/g, "");
        if (np) existingPhoneKeys.add(np);
        if (p10) existingPhoneKeys.add(p10);
        if (raw) {
          existingPhoneKeys.add(raw);
          const raw10 = raw.slice(-10);
          if (raw10) existingPhoneKeys.add(raw10);
        }
      }
    }

    if (emails.length) {
      const uniqEmails = Array.from(new Set(emails));
      const found = await (Lead as any)
        .find({
          userEmail,
          folderId: folder._id,
          $or: [{ Email: { $in: uniqEmails } }, { email: { $in: uniqEmails } }, { "Email": { $in: uniqEmails } }],
        })
        .select({ Email: 1, email: 1 })
        .lean();

      for (const f of found || []) {
        const e = String(f?.Email || f?.email || "").trim().toLowerCase();
        if (e) existingEmailKeys.add(e);
      }
    }

    const newLeadDocs: any[] = [];
    const intendedRowNumbers: number[] = [];

    for (const c of candidateDocs) {
      if (c.normalizedPhone) {
        const p10 = c.normalizedPhone.slice(-10);
        if (existingPhoneKeys.has(c.normalizedPhone) || (p10 && existingPhoneKeys.has(p10))) continue;

        existingPhoneKeys.add(c.normalizedPhone);
        if (p10) existingPhoneKeys.add(p10);

        newLeadDocs.push(c.leadDoc);
        intendedRowNumbers.push(c.rowNumber);
      } else if (c.emailLower) {
        if (existingEmailKeys.has(c.emailLower)) continue;

        existingEmailKeys.add(c.emailLower);
        newLeadDocs.push(c.leadDoc);
        intendedRowNumbers.push(c.rowNumber);
      } else {
        newLeadDocs.push(c.leadDoc);
        intendedRowNumbers.push(c.rowNumber);
      }
    }

    if (!newLeadDocs.length) {
      await touchFolderUpdatedAt(folder._id, userEmail);
      return res.status(200).json({ ok: true, inserted: 0, skipped: candidateDocs.length });
    }

    await createLeadsFromGoogleSheet(newLeadDocs, userEmail, folder._id);
    await touchFolderUpdatedAt(folder._id, userEmail);

    // ✅ enroll drips for leads we definitely created in this run
    const created = await (Lead as any)
      .find({
        userEmail,
        folderId: folder._id,
        "sheetMeta.connectionId": connectionId,
        "sheetMeta.backfillRunId": runId,
        "sheetMeta.backfillRowNumber": { $in: intendedRowNumbers },
      })
      .select({ _id: 1 })
      .lean();

    if (created?.length) {
      await Promise.all(
        created.map((l: any) =>
          enrollOnNewLeadIfWatched({
            userEmail,
            folderId: String(folder._id),
            leadId: String(l._id),
            source: "sheet-bulk",
            startMode: "now",
          })
        )
      );
    }

    match.lastSyncedAt = new Date();
    match.lastEventAt = new Date();
    match.updatedAt = new Date();
    gs.syncedSheetsSimple = synced;
    (user as any).googleSheets = gs;
    await user.save();

    return res.status(200).json({
      ok: true,
      inserted: newLeadDocs.length,
      skipped: candidateDocs.length - newLeadDocs.length,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Backfill failed" });
  }
}
