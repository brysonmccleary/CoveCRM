// pages/api/sheets/webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead, { createLeadsFromGoogleSheet, sanitizeLeadType } from "@/models/Lead";
import { isSystemFolderName as isSystemFolder, isSystemish } from "@/lib/systemFolders";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";

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

function normalizeGid(value: any) {
  const raw = String(value || "").trim();
  return raw || "0";
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

function splitFullNameFallback(raw: any) {
  const parts = String(raw || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function normalizeUsPhoneToE164(raw: any): string {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function isRealisticAge(raw: any): boolean {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,3}$/.test(s)) return false;
  const n = Number(s);
  return n >= 18 && n <= 99;
}

function isBlockedPhoneFallbackKey(key: any): boolean {
  const normalized = normalizeHeaderKey(key);
  return new Set(["age", "zip", "zipcode", "postalcode", "dob", "dateofbirth", "birthdate"]).has(normalized);
}

function recoverSinglePhoneFromRow(row: Record<string, any>) {
  const candidates: Array<{ key: string; value: string; normalized: string }> = [];

  for (const [key, value] of Object.entries(row || {})) {
    if (isBlockedPhoneFallbackKey(key)) continue;
    if (value === undefined || value === null) continue;
    const raw = String(value).trim();
    if (!raw || isRealisticAge(raw)) continue;

    const normalized = normalizeUsPhoneToE164(raw);
    if (!normalized) continue;
    candidates.push({ key, value: raw, normalized });
  }

  const unique = Array.from(new Map(candidates.map((c) => [c.normalized, c])).values());
  return unique.length === 1 ? unique[0] : null;
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

function hasUsablePhone(lead: any) {
  const candidates = [
    lead?.Phone,
    lead?.phone,
    lead?.normalizedPhone,
    lead?.phoneLast10,
  ];
  return candidates.some((value) => String(value || "").replace(/\D+/g, "").length >= 10);
}

function canTriggerAfterPhoneAdded(lead: any) {
  if (lead?.sourceType !== "google_sheets_live") return false;
  if (lead?.realTimeEligible !== true) return false;
  if (lead?.aiFirstCallAttemptedAt) return false;

  const status = String(lead?.aiFirstCallStatus || "").trim().toLowerCase();
  const activeOrCompleted = new Set([
    "pending",
    "scheduled",
    "triggered",
    "queued",
    "calling",
    "in_progress",
    "completed",
  ]);
  return !activeOrCompleted.has(status);
}

function isNonEmpty(value: any) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function buildSafeLeadUpdateSet(leadDoc: Record<string, any>, row: Record<string, any>, payload: any, match: any, sheetId: string, activeConnectionId: string, rowNumber: number) {
  const updateSet: Record<string, any> = {};
  const blockedKeys = new Set(["_id", "id", "__v", "userEmail", "folderId", "rawRow", "sheetMeta"]);

  for (const [key, value] of Object.entries(leadDoc)) {
    if (blockedKeys.has(key)) continue;
    if (key.includes(".") || key.startsWith("$")) continue;
    if (key === "status" && String(value || "").trim() === "New") continue;
    if (!isNonEmpty(value)) continue;
    updateSet[key] = value;
  }

  updateSet.rawRow = Object.fromEntries(
    Object.entries(row || {}).filter(([, value]) => isNonEmpty(value))
  );
  updateSet["sheetMeta.receivedAt"] = new Date();
  updateSet["sheetMeta.ts"] = payload.ts || null;
  updateSet["sheetMeta.rowNumber"] = rowNumber || undefined;
  updateSet["sheetMeta.sheetId"] = sheetId;
  updateSet["sheetMeta.gid"] = payload.gid || "";
  updateSet["sheetMeta.tabName"] = payload.tabName || match.tabName || "";
  updateSet["sheetMeta.connectionId"] = activeConnectionId;

  return updateSet;
}

async function triggerSheetsAIOnce(args: {
  requestId: string;
  leadId: string;
  folderId: string;
  userEmail: string;
  reason: string;
}) {
  try {
    console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_ATTEMPT]", {
      requestId: args.requestId,
      leadId: args.leadId,
      folderId: args.folderId,
      userEmail: args.userEmail,
      reason: args.reason,
    });
    await triggerAIFirstCall(args.leadId, args.folderId, args.userEmail);
    const aiState = await (Lead as any)
      .findById(args.leadId)
      .select({ aiFirstCallStatus: 1, aiFirstCallDueAt: 1, aiFirstCallAttemptedAt: 1 })
      .lean();
    if (aiState?.aiFirstCallStatus || aiState?.aiFirstCallDueAt || aiState?.aiFirstCallAttemptedAt) {
      console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_RESULT]", {
        requestId: args.requestId,
        leadId: args.leadId,
        status: aiState.aiFirstCallStatus || null,
        dueAt: aiState.aiFirstCallDueAt || null,
        reason: args.reason,
      });
    } else {
      console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_SKIPPED]", {
        requestId: args.requestId,
        leadId: args.leadId,
        reason: "not_scheduled_after_helper_gates",
        triggerReason: args.reason,
      });
    }
  } catch (aiErr: any) {
    console.warn("[AI_FIRST_CALL][SHEETS_TRIGGER_SKIPPED]", {
      requestId: args.requestId,
      leadId: args.leadId,
      error: aiErr?.message || String(aiErr),
      triggerReason: args.reason,
    });
  }
}

async function persistConnectionTouch(args: {
  user: any;
  gs: any;
  synced: any[];
  match: any;
}) {
  args.match.lastSyncedAt = new Date();
  args.match.lastEventAt = new Date();
  args.match.updatedAt = new Date();
  args.gs.syncedSheetsSimple = args.synced;
  args.user.googleSheets = args.gs;
  await args.user.save();
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
      if (process.env.SHEETS_SIG_DEBUG === "1") {
        console.warn("[sheets/webhook] invalid signature", { requestId, rawLen: rawBytes.length });
      }
      // Return 200 to prevent retry storms from old/invalid Apps Script installs.
      return res.status(403).json({ ok: false, error: "Invalid signature" });
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBodyText || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const connectionId = String(payload.connectionId || "").trim();
    const sheetId = String(payload.sheetId || "").trim();
    const gid = normalizeGid(payload.gid);
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

    let user: any = await User.findOne({
      "googleSheets.syncedSheetsSimple": { $elemMatch: { connectionId: connectionId } },
    });

    let usedFallbackConnection = false;
    let gs: any = user?.googleSheets || {};
    let synced = Array.isArray(gs.syncedSheetsSimple) ? gs.syncedSheetsSimple : [];
    let match = synced.find((s: any) => String(s.connectionId || "") === connectionId);

    if (!user || !match) {
      const fallbackUsers = await User.find({
        "googleSheets.syncedSheetsSimple": { $elemMatch: { sheetId } },
      });
      const candidates: Array<{ user: any; entry: any }> = [];

      for (const fallbackUser of fallbackUsers as any[]) {
        const fallbackGs: any = fallbackUser?.googleSheets || {};
        const fallbackSynced = Array.isArray(fallbackGs.syncedSheetsSimple) ? fallbackGs.syncedSheetsSimple : [];
        for (const entry of fallbackSynced) {
          if (String(entry.sheetId || "") === sheetId && normalizeGid(entry.gid) === gid) {
            candidates.push({ user: fallbackUser, entry });
          }
        }
      }

      if (candidates.length !== 1) {
        console.warn("[sheets/webhook] connection not found", {
          requestId,
          incomingConnectionId: connectionId,
          sheetId,
          gid,
          candidateCount: candidates.length,
        });
        return res.status(404).json({ error: "Connection not found" });
      }

      user = candidates[0].user;
      gs = user?.googleSheets || {};
      synced = Array.isArray(gs.syncedSheetsSimple) ? gs.syncedSheetsSimple : [];
      match = candidates[0].entry;
      usedFallbackConnection = true;
    }

    const userEmail = String(user?.email || "").trim().toLowerCase();
    if (!userEmail) return res.status(500).json({ error: "User missing email" });

    const activeConnectionId = String(match.connectionId || "").trim();
    if (activeConnectionId && activeConnectionId !== connectionId) {
      console.log("[sheets/webhook] stale connectionId auto-healed", {
        requestId,
        incomingConnectionId: connectionId,
        activeConnectionId,
        sheetId,
        gid,
        userEmail,
      });
    }

    if (String(match.sheetId || "") !== sheetId) {
      console.warn("[sheets/webhook] auth fail sheet mismatch", {
        requestId,
        incomingConnectionId: connectionId,
        activeConnectionId,
        incomingSheetId: sheetId,
        expectedSheetId: match.sheetId,
        incomingGid: gid,
        expectedGid: match.gid,
      });
      return res.status(403).json({ error: "Sheet mismatch for connection" });
    }

    const tokenHash = String(match.tokenHash || "");
    const gotHash = sha256Hex(token);
    const historyCount = Array.isArray(match.credentialHistory) ? match.credentialHistory.length : 0;
    const historyMatch = (Array.isArray(match.credentialHistory) ? match.credentialHistory : []).find(
      (item: any) => String(item?.tokenHash || "") && String(item.tokenHash) === gotHash
    );

    if (!tokenHash && !historyMatch) {
      console.warn("[sheets/webhook] auth fail missing tokenHash", {
        requestId,
        incomingConnectionId: connectionId,
        activeConnectionId,
        sheetId,
        gid,
        userEmail,
      });
      return res.status(403).json({ error: "Connection token missing" });
    }
    if (gotHash !== tokenHash && !historyMatch) {
      console.warn("[sheets/webhook] stale auth rejected unknown token", {
        requestId,
        incomingConnectionId: connectionId,
        activeConnectionId,
        sheetId,
        gid,
        userEmail,
        gotHashPrefix: gotHash.slice(0, 12),
        expectedHashPrefix: String(tokenHash || "").slice(0, 12),
        historyCount,
        usedFallbackConnection,
      });
      return res.status(403).json({ error: "Invalid token" });
    }

    const authLog = {
      requestId,
      incomingConnectionId: connectionId,
      activeConnectionId,
      sheetId,
      gid,
      rowNumber,
      userEmail,
      usedFallbackConnection,
      usedHistoryCredential: Boolean(historyMatch),
      authMode: historyMatch ? "history" : "active",
    };
    if (historyMatch) {
      console.log("[sheets/webhook] stale auth accepted via credentialHistory", authLog);
    } else {
      console.log("[sheets/webhook] fresh auth ok", authLog);
    }

    const folderName = String(match.folderName || "").trim() || "Imported Leads";
    const folder = await getOrCreateSafeFolder(userEmail, folderName);

    // ✅ Extract common fields (variation-proof)
    let firstName = pickRowValue(row, ["First Name", "First", "FName", "Given Name", "firstname", "first_name", "first"]);
    let lastName = pickRowValue(row, ["Last Name", "Last", "LName", "Surname", "lastname", "last_name", "last"]);
    if (!firstName && !lastName) {
      const splitName = splitFullNameFallback(pickRowValue(row, ["Full Name", "Name", "Client Name", "Contact Name", "Lead Name"]));
      firstName = splitName.firstName;
      lastName = splitName.lastName;
    }
    const phoneRaw = pickRowValue(row, ["Phone", "Phone Number", "Mobile", "Cell", "Primary Phone", "phone", "phoneNumber", "phonenumber", "Phone 1", "Phone1", "phone1", "Contact Phone", "Telephone", "Cell Phone"]);
    const emailRaw = pickRowValue(row, ["Email", "Email Address", "E-mail", "E-mail Address", "email", "emailAddress", "email_address", "Contact Email"]);
    let phoneClean = phoneRaw && /\d{7,}/.test(phoneRaw)
      ? phoneRaw
      : undefined;
    const recoveredPhone = phoneClean ? null : recoverSinglePhoneFromRow(row);
    if (recoveredPhone) {
      phoneClean = recoveredPhone.normalized;
      console.log("[sheets/webhook] recovered phone from non-phone field", {
        requestId,
        sourceKey: recoveredPhone.key,
        last4: recoveredPhone.normalized.slice(-4),
      });
    }

    const emailClean = emailRaw && emailRaw.includes("@")
      ? emailRaw
      : undefined;
    const state = pickRowValue(row, ["State", "ST", "state", "Resident State"]);
    const age = pickRowValue(row, ["Age", "age"]);
    const ageFromRecoveredPhone = recoveredPhone && normalizeHeaderKey(recoveredPhone.key) === "age" && !isRealisticAge(age);
    const safeAge = ageFromRecoveredPhone ? undefined : age;
    const notes = pickRowValue(row, ["Notes", "Note", "notes", "note", "Comments"]);
    const beneficiary = pickRowValue(row, ["Beneficiary", "Beneficiary Name", "beneficiary"]);
    const coverageAmount = pickRowValue(row, ["Coverage Amount", "Coverage", "coverage", "coverageamount"]);
    const leadTypeIn = pickRowValue(row, ["leadType", "Lead Type", "LeadType", "Type", "type"]);

    const normalizedPhone = recoveredPhone ? recoveredPhone.normalized : normalizePhone(phoneClean);
    const phoneLast10 = normalizedPhone ? normalizedPhone.slice(-10) : "";
    const emailLower = normalizeEmail(emailClean);

    console.log("[sheets/webhook] extracted", {
      requestId,
      firstName: String(firstName || "").slice(0, 40),
      lastName: String(lastName || "").slice(0, 40),
      phone: maskPhone(normalizedPhone),
      email: maskEmail(emailLower),
      hasRowNumber: !!rowNumber,
    });

    // ✅ Hard-dedupe by externalId across the whole account (prevents duplicates even if lead moved folders)
    const finalConnectionId = activeConnectionId || connectionId;
    const externalId = finalConnectionId && rowNumber ? `gs:${finalConnectionId}:r${rowNumber}` : undefined;

    // ✅ Import EVERYTHING: spread full row first, then overlay canonical fields
    const leadDoc: any = {
      ...row,

      State: String(state || "").trim() || row.State || row["State"] || undefined,
      "First Name": String(firstName || "").trim() || row["First Name"] || row.FirstName || undefined,
      "Last Name": String(lastName || "").trim() || row["Last Name"] || row.LastName || undefined,
      Phone: String(phoneClean || "").trim() || row.Phone || row["Phone"] || undefined,
      Email: emailLower || row.Email || row["Email"] || undefined,

      Notes: String(notes || "").trim() || row.Notes || row["Notes"] || undefined,
      Age: String(safeAge || "").trim() || undefined,
      Beneficiary: String(beneficiary || "").trim() || row.Beneficiary || row["Beneficiary"] || undefined,
      "Coverage Amount": String(coverageAmount || "").trim() || row["Coverage Amount"] || undefined,

      normalizedPhone: normalizedPhone || undefined,
      phoneLast10: phoneLast10 || undefined,
      status: "New",
      leadType: sanitizeLeadType(String(leadTypeIn || "")),
      sourceType: "google_sheets_live",
      realTimeEligible: true,

      source: "google-sheets",
      externalId: externalId,
      sheetMeta: {
        sheetId,
        gid: payload.gid || "",
        tabName: payload.tabName || match.tabName || "",
        receivedAt: new Date(),
        ts: payload.ts || null,
        connectionId: activeConnectionId,
        rowNumber: rowNumber || undefined,
      },
      rawRow: row,
    };

    if (typeof externalId === "string" && externalId.trim()) {
      console.log("[sheets/webhook] dedupe externalId check", {
        requestId,
        externalId,
        rowNumber,
        finalConnectionId,
      });

      const existsByExternal = await (Lead as any)
        .findOne({
          userEmail,
          externalId: {
            $eq: String(externalId),
            $exists: true,
            $type: "string",
            $ne: "",
          },
        })
        .select({
          _id: 1,
          externalId: 1,
          rawRow: 1,
          Phone: 1,
          phone: 1,
          normalizedPhone: 1,
          phoneLast10: 1,
          sourceType: 1,
          realTimeEligible: 1,
          aiFirstCallAttemptedAt: 1,
          aiFirstCallStatus: 1,
        })
        .lean();
      if (existsByExternal) {
        console.log("[sheets/webhook] duplicate_externalId match", {
          requestId,
          externalId,
          matchedLeadId: String(existsByExternal._id),
          matchedLeadExternalId: existsByExternal.externalId,
        });

        const isNonEmpty = (value: any) =>
          value !== null && value !== undefined && String(value).trim() !== "";
        const updateSet: Record<string, any> = {};
        const updatedKeys: string[] = [];
        const blockedKeys = new Set(["_id", "id", "__v", "userEmail", "folderId", "rawRow", "sheetMeta"]);

        for (const [key, value] of Object.entries(leadDoc)) {
          if (blockedKeys.has(key)) continue;
          if (key.includes(".") || key.startsWith("$")) continue;
          if (key === "status" && String(value || "").trim() === "New") continue;
          if (!isNonEmpty(value)) continue;
          updateSet[key] = value;
          updatedKeys.push(key);
        }

        const mergedRawRow = { ...((existsByExternal as any).rawRow || {}) };
        for (const [key, value] of Object.entries(row || {})) {
          if (!isNonEmpty(value)) continue;
          mergedRawRow[key] = value;
        }

        updateSet.rawRow = mergedRawRow;
        updateSet["sheetMeta.receivedAt"] = new Date();
        updateSet["sheetMeta.ts"] = payload.ts || null;
        updateSet["sheetMeta.rowNumber"] = rowNumber || undefined;
        updateSet["sheetMeta.sheetId"] = sheetId;
        updateSet["sheetMeta.gid"] = payload.gid || "";
        updateSet["sheetMeta.tabName"] = payload.tabName || match.tabName || "";
        updateSet["sheetMeta.connectionId"] = activeConnectionId;
        updatedKeys.push("rawRow", "sheetMeta");

        const hadPhoneBefore = hasUsablePhone(existsByExternal);

        await (Lead as any).updateOne(
          { _id: existsByExternal._id, userEmail },
          { $set: updateSet }
        );

        const updatedLead = await (Lead as any)
          .findById(existsByExternal._id)
          .select({
            _id: 1,
            Phone: 1,
            phone: 1,
            normalizedPhone: 1,
            phoneLast10: 1,
            sourceType: 1,
            realTimeEligible: 1,
            aiFirstCallAttemptedAt: 1,
            aiFirstCallStatus: 1,
          })
          .lean();
        const phoneAdded = !hadPhoneBefore && hasUsablePhone(updatedLead);

        console.log("[sheets/webhook] duplicate_externalId updated", {
          requestId,
          existingLeadId: String(existsByExternal._id),
          updatedKeysCount: updatedKeys.length,
          updatedKeys,
          phoneAdded,
        });

        await touchFolderUpdatedAt(folder._id as any, userEmail);

        await persistConnectionTouch({ user, gs, synced, match });

        if (phoneAdded && canTriggerAfterPhoneAdded(updatedLead)) {
          console.log("[sheets/webhook] duplicate externalId phone-added trigger attempt", {
            requestId,
            leadId: String(existsByExternal._id),
            phone: maskPhone(String(updatedLead?.Phone || updatedLead?.phone || updatedLead?.normalizedPhone || "")),
          });
          await triggerSheetsAIOnce({
            requestId,
            leadId: String(existsByExternal._id),
            folderId: String(folder._id),
            userEmail,
            reason: "duplicate_externalId_phone_added",
          });
        }

        return res.status(200).json({ ok: true, updated: "duplicate_externalId" });
      }
    }

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

        await touchFolderUpdatedAt(folder._id as any, userEmail);

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

        await touchFolderUpdatedAt(folder._id as any, userEmail);

        match.lastSyncedAt = new Date();
        match.lastEventAt = new Date();
        match.updatedAt = new Date();
        gs.syncedSheetsSimple = synced;
        (user as any).googleSheets = gs;
        await user.save();

        return res.status(200).json({ ok: true, skipped: "duplicate_email" });
      }
    }
    console.log("[sheets/webhook] pre-insert leadDoc", {
      requestId,
      externalId,
      leadDocFirstName: leadDoc["First Name"],
      leadDocLastName: leadDoc["Last Name"],
      leadDocPhone: maskPhone(String(leadDoc.Phone || leadDoc.phone || "")),
      leadDocEmail: maskEmail(String(leadDoc.Email || leadDoc.email || "")),
      leadDocNormalizedPhone: maskPhone(String(leadDoc.normalizedPhone || "")),
      leadDocPhoneLast10: leadDoc.phoneLast10 ? "***" + String(leadDoc.phoneLast10).slice(-4) : "",
      rawRowPhone: maskPhone(String(row.Phone || row["Phone"] || "")),
      rawRowEmail: maskEmail(String(row.Email || row["Email"] || "")),
      rawRowAge: row.Age || row["Age"],
    });

    try {
      await createLeadsFromGoogleSheet([leadDoc], userEmail, folder._id as any);
    } catch (insertErr: any) {
      if (insertErr?.code !== 11000 || !externalId) {
        throw insertErr;
      }

      const updateSet = buildSafeLeadUpdateSet(
        leadDoc,
        row,
        payload,
        match,
        sheetId,
        activeConnectionId,
        rowNumber
      );
      const racedLead = await (Lead as any)
        .findOneAndUpdate(
          { userEmail, externalId },
          { $set: updateSet },
          { new: true }
        )
        .select({ _id: 1 })
        .lean();

      console.log("[sheets/webhook] duplicate_externalId raced insert updated", {
        requestId,
        externalId,
        existingLeadId: racedLead?._id ? String(racedLead._id) : null,
      });

      await touchFolderUpdatedAt(folder._id as any, userEmail);
      await persistConnectionTouch({ user, gs, synced, match });
      return res.status(200).json({ ok: true, updated: "duplicate_externalId_race" });
    }
    await touchFolderUpdatedAt(folder._id as any, userEmail);

    // ✅ best-effort: confirm created lead id
    let createdLead: any = null;
    if (ts) {
      createdLead = await (Lead as any)
        .findOne({
          userEmail,
          folderId: folder._id,
          "sheetMeta.ts": ts,
          "sheetMeta.connectionId": finalConnectionId,
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
          "sheetMeta.connectionId": finalConnectionId,
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

      try {
        console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_ATTEMPT]", {
          requestId,
          leadId: String(createdLead._id),
          folderId: String(folder._id),
          userEmail,
        });
        await triggerAIFirstCall(
          String(createdLead._id),
          String(folder._id),
          userEmail
        );
        const aiState = await (Lead as any)
          .findById(createdLead._id)
          .select({ aiFirstCallStatus: 1, aiFirstCallDueAt: 1, aiFirstCallAttemptedAt: 1 })
          .lean();
        if (aiState?.aiFirstCallStatus || aiState?.aiFirstCallDueAt || aiState?.aiFirstCallAttemptedAt) {
          console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_RESULT]", {
            requestId,
            leadId: String(createdLead._id),
            status: aiState.aiFirstCallStatus || null,
            dueAt: aiState.aiFirstCallDueAt || null,
          });
        } else {
          console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_SKIPPED]", {
            requestId,
            leadId: String(createdLead._id),
            reason: "not_scheduled_after_helper_gates",
          });
        }
      } catch (aiErr: any) {
        console.warn("[AI_FIRST_CALL][SHEETS_TRIGGER_SKIPPED]", {
          requestId,
          leadId: String(createdLead._id),
          error: aiErr?.message || String(aiErr),
        });
      }
    } else {
      console.log("[AI_FIRST_CALL][SHEETS_TRIGGER_SKIPPED]", {
        requestId,
        reason: "created_lead_not_found",
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
