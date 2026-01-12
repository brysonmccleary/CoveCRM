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

/**
 * ✅ Normalize header keys so ANY vendor header variation matches:
 * - lowercases
 * - removes spaces/underscores/dashes/punctuation
 */
function normalizeHeaderKey(k: any): string {
  return String(k ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

function pickRowValue(row: Record<string, any>, keys: string[]) {
  if (!row || typeof row !== "object") return "";

  // exact key
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }

  // normalized match
  const want = new Set(keys.map((k) => normalizeHeaderKey(k)));
  for (const actualKey of Object.keys(row)) {
    const nk = normalizeHeaderKey(actualKey);
    if (!nk) continue;
    if (!want.has(nk)) continue;

    const v = (row as any)[actualKey];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }

  return "";
}

function isHexSig(sig: string) {
  return /^[0-9a-f]{64}$/i.test(sig);
}

function isB64Sig(sig: string) {
  return /^[A-Za-z0-9+/=]+$/.test(sig) && sig.length >= 40;
}

function stableStringify(value: any): string {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + stableStringify((value as any)[k]));
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

function maskPhone(p: string) {
  const d = String(p || "").replace(/\D+/g, "");
  if (!d) return "";
  if (d.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}

function maskEmail(e: string) {
  const s = String(e || "").trim().toLowerCase();
  if (!s) return "";
  const at = s.indexOf("@");
  if (at <= 1) return "***";
  return `${s.slice(0, 1)}***${s.slice(at)}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const startedAt = Date.now();
  const requestId = `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

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
      console.warn("[sheets/webhook] invalid signature", { requestId, rawLen: rawBytes.length });
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
    const gid = String(payload.gid || "").trim();
    const tabName = String(payload.tabName || "").trim();
    const ts = payload.ts || null;
    const rowNumber = Number(payload.rowNumber || 0) || 0;

    const row = (payload.row || {}) as Record<string, any>;

    const rowKeys = row && typeof row === "object" ? Object.keys(row) : [];
    console.log("[sheets/webhook] recv", {
      requestId,
      connectionId,
      sheetId,
      gid,
      tabName,
      ts,
      rowNumber: rowNumber || undefined,
      rowKeysCount: rowKeys.length,
      rowKeysSample: rowKeys.slice(0, 20),
    });

    if (!connectionId || !sheetId) {
      console.warn("[sheets/webhook] missing ids", { requestId });
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

    // ✅ Extract common fields (variation-proof)
    const firstName = pickRowValue(row, ["First Name", "First", "FName", "Given Name", "firstname", "first_name", "first"]);
    const lastName = pickRowValue(row, ["Last Name", "Last", "LName", "Surname", "lastname", "last_name", "last"]);
    const phoneRaw = pickRowValue(row, ["Phone", "Phone Number", "Mobile", "Cell", "Primary Phone", "phone", "phoneNumber", "phonenumber"]);
    const emailRaw = pickRowValue(row, ["Email", "Email Address", "E-mail", "E-mail Address", "email", "emailAddress", "email_address"]);
    const state = pickRowValue(row, ["State", "ST", "state"]);
    const age = pickRowValue(row, ["Age", "age"]);
    const notes = pickRowValue(row, ["Notes", "Note", "notes", "note"]);
    const beneficiary = pickRowValue(row, ["Beneficiary", "Beneficiary Name", "beneficiary"]);
    const coverageAmount = pickRowValue(row, ["Coverage Amount", "Coverage", "coverage", "coverageamount"]);
    const leadTypeIn = pickRowValue(row, ["leadType", "Lead Type", "LeadType", "Type", "type"]);

    const normalizedPhone = normalizePhone(phoneRaw);
    const phoneLast10 = normalizedPhone ? normalizedPhone.slice(-10) : "";
    const emailLower = normalizeEmail(emailRaw);

    console.log("[sheets/webhook] extracted", {
      requestId,
      firstName: String(firstName || "").slice(0, 40),
      lastName: String(lastName || "").slice(0, 40),
      phone: maskPhone(normalizedPhone),
      email: maskEmail(emailLower),
      hasRowNumber: !!rowNumber,
    });

    // ✅ Dedupe (log WHY)
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
        console.log("[sheets/webhook] skip dedupe", {
          requestId,
          reason: "duplicate_phone",
          existingLeadId: String(exists._id),
        });

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
        console.log("[sheets/webhook] skip dedupe", {
          requestId,
          reason: "duplicate_email",
          existingLeadId: String(exists._id),
        });

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

    // ✅ Import EVERYTHING: spread full row first, then overlay canonical fields
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
        rowNumber: rowNumber || undefined,
      },
      rawRow: row,
    };

    await createLeadsFromGoogleSheet([leadDoc], userEmail, folder._id);
    await touchFolderUpdatedAt(folder._id, userEmail);

    // ✅ best-effort: confirm created lead id
    let createdLead: any = null;
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

    if (!createdLead && rowNumber) {
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          "sheetMeta.connectionId": connectionId,
          "sheetMeta.rowNumber": rowNumber,
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

    console.log("[sheets/webhook] created", {
      requestId,
      createdLeadId: createdLead?._id ? String(createdLead._id) : null,
      durationMs: Date.now() - startedAt,
    });

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
    console.error("[sheets/webhook] error", { requestId, error: e?.message || String(e) });
    return res.status(500).json({ error: e?.message || "Webhook failed" });
  }
}
