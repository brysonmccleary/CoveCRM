// pages/api/sheets/webhook.ts
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

// ✅ Read RAW BYTES (Buffer) so HMAC can be verified byte-perfect.
async function readRawBodyBuffer(req: NextApiRequest): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
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

function hmacHexBytes(bodyBytes: Buffer, secret: string) {
  return crypto.createHmac("sha256", secret).update(bodyBytes).digest("hex");
}

function hmacB64Bytes(bodyBytes: Buffer, secret: string) {
  return crypto.createHmac("sha256", secret).update(bodyBytes).digest("base64");
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
  return /^[0-9a-f]{64}$/i.test(sig);
}

function isB64Sig(sig: string) {
  return /^[A-Za-z0-9+/=]+$/.test(sig) && sig.length >= 40;
}

/**
 * Deterministic JSON string with keys sorted recursively.
 */
function stableStringify(value: any): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]));
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(value);
}

function verifySignatureAgainstBytes(bodyBytes: Buffer, token: string, sig: string) {
  const trimmed = String(sig || "").trim();
  if (!trimmed) return false;

  if (isHexSig(trimmed)) {
    const expected = hmacHexBytes(bodyBytes, token);
    return timingSafeEqualHex(trimmed.toLowerCase(), expected.toLowerCase());
  }

  if (isB64Sig(trimmed)) {
    const expected = hmacB64Bytes(bodyBytes, token);
    return timingSafeEqualB64(trimmed, expected);
  }

  return false;
}

function verifySignatureFlexibleBytes(rawBytes: Buffer, rawBodyText: string, token: string, sig: string) {
  if (verifySignatureAgainstBytes(rawBytes, token, sig)) return true;

  try {
    const obj = JSON.parse(rawBodyText || "{}");
    const minified = JSON.stringify(obj);
    if (verifySignatureAgainstBytes(Buffer.from(minified, "utf8"), token, sig)) return true;

    const stable = stableStringify(obj);
    if (verifySignatureAgainstBytes(Buffer.from(stable, "utf8"), token, sig)) return true;
  } catch {}

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

function buildPhoneQueryCandidates(normalizedPhone: string) {
  const last10 = normalizedPhone ? normalizedPhone.slice(-10) : "";
  const candidates: any[] = [];

  if (normalizedPhone) {
    candidates.push({ normalizedPhone });
    candidates.push({ phoneLast10: last10 });
    candidates.push({ Phone: normalizedPhone });
    candidates.push({ phone: normalizedPhone });
    candidates.push({ "Phone": normalizedPhone });
  }

  if (last10) {
    candidates.push({ Phone: { $regex: `${last10}$` } });
    candidates.push({ phone: { $regex: `${last10}$` } });
    candidates.push({ "Phone": { $regex: `${last10}$` } });
  }

  return candidates;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const token = String(req.headers["x-covecrm-token"] || "").trim();
    const sig = String(req.headers["x-covecrm-signature"] || "").trim();

    if (!token) return res.status(401).json({ error: "Missing token" });
    if (!sig) return res.status(401).json({ error: "Missing signature" });

    const rawBytes = await readRawBodyBuffer(req);
    if (!rawBytes || !rawBytes.length) return res.status(400).json({ error: "Missing body" });

    const rawBodyText = rawBytes.toString("utf8");

    if (!verifySignatureFlexibleBytes(rawBytes, rawBodyText, token, sig)) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBodyText || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const connectionId = String(payload.connectionId || "").trim();
    const sheetId = String(payload.sheetId || "").trim();
    if (!connectionId || !sheetId) {
      return res.status(400).json({ error: "Missing connectionId or sheetId" });
    }

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

    const row = (payload.row || {}) as Record<string, any>;

    // ✅ pull common fields, but DO NOT drop other columns
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

    // ✅ Stronger dedupe per folder (multi-field)
    if (normalizedPhone) {
      const exists = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          $or: buildPhoneQueryCandidates(normalizedPhone),
        })
        .select({ _id: 1 })
        .lean();

      if (exists) {
        await touchFolderUpdatedAt(folder._id, userEmail);

        match.lastSyncedAt = new Date();
        match.lastEventAt = new Date();
        match.updatedAt = new Date();
        gs.syncedSheetsSimple = synced;
        (user as any).googleSheets = gs;
        await user.save();

        return res.status(200).json({ ok: true, skipped: "duplicate_phone" });
      }
    } else if (emailLower) {
      const exists = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          $or: [{ Email: emailLower }, { email: emailLower }, { "Email": emailLower }],
        })
        .select({ _id: 1 })
        .lean();

      if (exists) {
        await touchFolderUpdatedAt(folder._id, userEmail);

        match.lastSyncedAt = new Date();
        match.lastEventAt = new Date();
        match.updatedAt = new Date();
        gs.syncedSheetsSimple = synced;
        (user as any).googleSheets = gs;
        await user.save();

        return res.status(200).json({ ok: true, skipped: "duplicate_email" });
      }
    }

    // ✅ Import EVERYTHING: spread full row first, then overlay normalized canonical fields
    const leadDoc: any = {
      ...row,

      State: String(state || "").trim() || row.State || row["State"] || undefined,
      "First Name": String(firstName || "").trim() || row["First Name"] || row.FirstName || undefined,
      "Last Name": String(lastName || "").trim() || row["Last Name"] || row.LastName || undefined,
      Phone: String(phoneRaw || "").trim() || row.Phone || row["Phone"] || undefined,
      Email: emailLower || row.Email || row["Email"] || undefined,

      Notes: String(notes || "").trim() || row.Notes || row["Notes"] || undefined,
      Age: String(age || "").trim() || row.Age || row["Age"] || undefined,
      Beneficiary: String(beneficiary || "").trim() || row.Beneficiary || row["Beneficiary"] || undefined,
      "Coverage Amount": String(coverageAmount || "").trim() || row["Coverage Amount"] || undefined,

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
      },
      rawRow: row,
    };

    await createLeadsFromGoogleSheet([leadDoc], userEmail, folder._id);
    await touchFolderUpdatedAt(folder._id, userEmail);

    // ✅ Find the created lead reliably for drip enrollment
    let createdLead: any = null;
    const ts = payload.ts || null;

    if (ts) {
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          "sheetMeta.ts": ts,
          "sheetMeta.connectionId": connectionId,
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
          $or: buildPhoneQueryCandidates(normalizedPhone),
        })
        .sort({ createdAt: -1 })
        .select({ _id: 1 })
        .lean();
    }

    if (!createdLead && emailLower) {
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          $or: [{ Email: emailLower }, { email: emailLower }, { "Email": emailLower }],
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

    match.lastSyncedAt = new Date();
    match.lastEventAt = new Date();
    match.updatedAt = new Date();
    gs.syncedSheetsSimple = synced;
    (user as any).googleSheets = gs;
    await user.save();

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Webhook failed" });
  }
}
