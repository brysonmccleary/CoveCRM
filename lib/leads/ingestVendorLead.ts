import { Types } from "mongoose";
import Folder from "@/models/Folder";
import Lead, { sanitizeLeadType } from "@/models/Lead";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";

export type VendorLeadInput = {
  userEmail: string;
  folderName?: string;
  folderId?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  state?: string;
  notes?: string;
  age?: string;
  leadType?: string;
  externalId?: string;
  custom?: Record<string, unknown>;
};

export type VendorLeadResult = {
  id: string;
  deduped: boolean;
  action: "created" | "updated" | "skipped";
};

export class VendorLeadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_CUSTOM_FIELDS = 40;
const MAX_PAYLOAD_BYTES = 32 * 1024;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Keep this identical to the live Sheets webhook's canonical normalization.
function normalizePhone(raw: unknown): string {
  return String(raw || "").trim().replace(/\D+/g, "");
}

function sanitizeCustom(custom: unknown): Record<string, unknown> {
  if (custom == null) return {};
  if (typeof custom !== "object" || Array.isArray(custom)) {
    throw new VendorLeadError(422, "custom must be an object");
  }
  const entries = Object.entries(custom as Record<string, unknown>);
  if (entries.length > MAX_CUSTOM_FIELDS) {
    throw new VendorLeadError(422, `custom may contain at most ${MAX_CUSTOM_FIELDS} fields`);
  }
  const safe: Record<string, unknown> = {};
  for (const [rawKey, value] of entries) {
    const key = rawKey.replace(/^\$+/, "").trim();
    if (!key || key.includes(".") || key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new VendorLeadError(422, `Invalid custom field name: ${rawKey}`);
    }
    safe[key] = value;
  }
  return safe;
}

async function resolveFolder(userEmail: string, folderId?: string, folderName?: string) {
  if (folderId) {
    if (!Types.ObjectId.isValid(folderId)) throw new VendorLeadError(403, "Folder not found for this account");
    const folder = await Folder.findOne({ _id: folderId, userEmail });
    if (!folder) throw new VendorLeadError(403, "Folder not found for this account");
    return folder;
  }

  const name = cleanString(folderName) || "API Leads";
  return await Folder.findOneAndUpdate(
    { userEmail, name },
    { $setOnInsert: { userEmail, name, assignedDrips: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

function duplicateQuery(userEmail: string, folderId: Types.ObjectId, normalizedPhone: string, email: string) {
  const matches: Record<string, unknown>[] = [];
  if (normalizedPhone) {
    matches.push({ normalizedPhone }, { phoneLast10: normalizedPhone.slice(-10) });
  }
  if (email) matches.push({ email }, { Email: email });
  return matches.length ? { userEmail, folderId, $or: matches } : null;
}

export async function ingestVendorLead(input: VendorLeadInput): Promise<VendorLeadResult> {
  const rawPayload = { ...input, userEmail: undefined };
  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(rawPayload), "utf8");
  } catch {
    throw new VendorLeadError(422, "Payload must be valid JSON data");
  }
  if (payloadBytes > MAX_PAYLOAD_BYTES) {
    throw new VendorLeadError(422, "Lead payload must not exceed 32KB");
  }

  const userEmail = cleanString(input.userEmail).toLowerCase();
  const phone = cleanString(input.phone);
  const normalizedPhone = normalizePhone(phone);
  const email = cleanString(input.email).toLowerCase();
  if (!normalizedPhone && !email) throw new VendorLeadError(422, "At least phone or email is required");

  const custom = sanitizeCustom(input.custom);
  const folder = await resolveFolder(userEmail, cleanString(input.folderId), input.folderName);
  const externalId = cleanString(input.externalId);

  // An explicit leadType in the payload always wins. When absent, the
  // folder's default (if the folder has one set) is applied — but only at
  // creation time, never blasted onto an existing lead via an update that
  // simply didn't include a leadType this time (see below).
  const rawLeadType = cleanString(input.leadType);
  const explicitLeadType = rawLeadType ? sanitizeLeadType(rawLeadType) : undefined;
  const folderLeadType = cleanString((folder as any)?.leadType) || undefined;

  const leadFields: Record<string, unknown> = {
    ...custom,
    "First Name": cleanString(input.firstName) || undefined,
    "Last Name": cleanString(input.lastName) || undefined,
    Phone: phone || normalizedPhone || undefined,
    normalizedPhone: normalizedPhone || undefined,
    phoneLast10: normalizedPhone ? normalizedPhone.slice(-10) : undefined,
    Email: email || undefined,
    email: email || undefined,
    State: cleanString(input.state) || undefined,
    Notes: cleanString(input.notes) || undefined,
    Age: cleanString(input.age) || undefined,
    ...(explicitLeadType ? { leadType: explicitLeadType } : {}),
    sourceType: "vendor_api",
    realTimeEligible: true,
    source: "vendor_api",
    rawRow: rawPayload,
  };

  if (externalId) {
    const updated = await Lead.findOneAndUpdate(
      { userEmail, externalId },
      { $set: leadFields },
      { new: true },
    );
    if (updated) return { id: String(updated._id), deduped: true, action: "updated" };
  }

  const dedupe = duplicateQuery(userEmail, folder._id as Types.ObjectId, normalizedPhone, email);
  if (dedupe) {
    const existing: any = await Lead.findOne(dedupe).select("_id").lean();
    if (existing) return { id: String(existing._id), deduped: true, action: "skipped" };
  }

  try {
    const created = await Lead.create({
      ...leadFields,
      ...(explicitLeadType ? {} : folderLeadType ? { leadType: folderLeadType } : {}),
      userEmail,
      folderId: folder._id,
      externalId: externalId || undefined,
      status: "New",
    });

    await enrollOnNewLeadIfWatched({
      userEmail,
      folderId: String(folder._id),
      leadId: String(created._id),
      source: "sheet-bulk",
      startMode: "now",
    });
    try {
      await triggerAIFirstCall(String(created._id), String(folder._id), userEmail);
    } catch (error: any) {
      console.warn("[vendor-leads] AI first-call trigger skipped", {
        leadId: String(created._id),
        error: error?.message || String(error),
      });
    }
    return { id: String(created._id), deduped: false, action: "created" };
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const query = externalId ? { userEmail, externalId } : dedupe;
    const raced: any = query ? await Lead.findOne(query).select("_id").lean() : null;
    if (!raced) throw error;
    if (externalId) {
      await Lead.updateOne({ _id: raced._id, userEmail }, { $set: leadFields });
    }
    return { id: String(raced._id), deduped: true, action: externalId ? "updated" : "skipped" };
  }
}
