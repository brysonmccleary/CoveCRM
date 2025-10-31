// /lib/mongo/leads.ts
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

const DIGITS = (s: any) => String(s ?? "").replace(/\D+/g, "");
const last10 = (v?: string | null) => {
  if (!v) return undefined;
  const k = DIGITS(v).slice(-10);
  return k || undefined;
};
const lcEmail = (v?: string | null) => {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  return s || undefined;
};

const LEAD_TYPES = [
  "Mortgage Protection",
  "Final Expense",
  "IUL",
  "Term Life",
  "Whole Life",
  "Medicare",
  "Generic",
] as const;

// Local alias to avoid collisions with other ambient LeadType declarations
type LeadTypeLocal = (typeof LEAD_TYPES)[number];

export function sanitizeLeadType(input: any): LeadTypeLocal {
  const s = String(input ?? "").trim().toLowerCase();
  const match =
    LEAD_TYPES.find((t) => t.toLowerCase() === s) ||
    (s.includes("mortgage")
      ? "Mortgage Protection"
      : s.includes("final")
      ? "Final Expense"
      : s.includes("iul")
      ? "IUL"
      : s.includes("medicare")
      ? "Medicare"
      : s.includes("term")
      ? "Term Life"
      : s.includes("whole")
      ? "Whole Life"
      : "Generic");
  return match as LeadTypeLocal;
}

/**
 * Bulk create/update leads from CSV rows (already mapped & decorated by caller).
 * - rows must already include userEmail, folderId, status (for new), and normalized keys if available.
 * - We dedupe on phoneLast10/normalizedPhone OR Email/email.
 * - For NEW docs: setOnInsert { userEmail, status: 'New', createdAt }
 * - For EXISTING: only $set non-identity fields; status is *not* overwritten unless caller intends to.
 */
export async function createLeadsFromCSV(
  rows: Array<Record<string, any>>,
  userEmail: string,
  folderId: string
): Promise<{ inserted: number; updated: number; affectedIds: string[] }> {
  if (!Array.isArray(rows) || !rows.length) return { inserted: 0, updated: 0, affectedIds: [] };

  // Normalize identity fields on each row
  const prepared: Array<Record<string, any>> = rows.map((r) => {
    const phoneRaw = r["Phone"] ?? r["phone"] ?? r.phone;
    const emailRaw = r["Email"] ?? r["email"] ?? r.email;

    const phoneKey = r["phoneLast10"] ?? last10(phoneRaw);
    const emailKey = r["Email"] ? lcEmail(r["Email"]) : lcEmail(emailRaw);

    return {
      ...r,
      userEmail,
      folderId: new mongoose.Types.ObjectId(folderId),
      // identity mirrors
      Phone: phoneRaw, // ensure Phone exists on prepared rows
      phoneLast10: phoneKey,
      normalizedPhone: phoneKey,
      Email: emailKey,
      email: emailKey,
    } as Record<string, any>;
  });

  const phoneKeys = Array.from(new Set(prepared.map((m) => m.phoneLast10).filter(Boolean) as string[]));
  const emailKeys = Array.from(new Set(prepared.map((m) => m.Email).filter(Boolean) as string[]));

  const ors: any[] = [];
  if (phoneKeys.length) {
    ors.push({ phoneLast10: { $in: phoneKeys } }, { normalizedPhone: { $in: phoneKeys } });
  }
  if (emailKeys.length) {
    ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });
  }

  const existing = ors.length
    ? await Lead.find({ userEmail, $or: ors }).select("_id phoneLast10 normalizedPhone Email email").lean()
    : [];

  const byPhone = new Map<string, any>();
  const byEmail = new Map<string, any>();
  for (const l of existing) {
    const p1 = l.phoneLast10 && String(l.phoneLast10);
    const p2 = l.normalizedPhone && String(l.normalizedPhone);
    const e1 = l.Email && String(l.Email).toLowerCase();
    const e2 = l.email && String(l.email).toLowerCase();
    if (p1) byPhone.set(p1, l);
    if (p2) byPhone.set(p2, l);
    if (e1) byEmail.set(e1, l);
    if (e2) byEmail.set(e2, l);
  }

  const ops: any[] = [];
  const processedFilters: any[] = [];

  for (const m of prepared) {
    const phoneKey = m.phoneLast10 as string | undefined;
    const emailKey = m.Email as string | undefined;

    if (!phoneKey && !emailKey) continue;

    const exists = (phoneKey && byPhone.get(phoneKey)) || (emailKey && byEmail.get(String(emailKey)));

    // identity filter
    const filter = phoneKey
      ? { userEmail, $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] }
      : { userEmail, $or: [{ Email: emailKey }, { email: emailKey }] };

    const base: Record<string, any> = {
      ownerEmail: userEmail,
      folderId: new mongoose.Types.ObjectId(folderId),
      updatedAt: new Date(),
    };

    // keep identity mirrors updated
    if (m.Phone !== undefined) base["Phone"] = m.Phone;
    if (phoneKey !== undefined) {
      base["phoneLast10"] = phoneKey;
      base["normalizedPhone"] = phoneKey;
    }
    if (emailKey !== undefined) {
      base["Email"] = emailKey;
      base["email"] = emailKey;
    }

    // soft fields
    if (m["First Name"] !== undefined) base["First Name"] = m["First Name"];
    if (m["Last Name"] !== undefined) base["Last Name"] = m["Last Name"];
    if (m.State !== undefined) base["State"] = m.State;
    if (m.Notes !== undefined) base["Notes"] = m["Notes"];
    if (m.leadType) base["leadType"] = sanitizeLeadType(m.leadType);

    if (exists) {
      // do NOT override status for existing unless caller put it in base intentionally
      ops.push({ updateOne: { filter, update: { $set: base }, upsert: false } });
    } else {
      const setOnInsert: any = {
        userEmail,
        status: m.status || "New",
        createdAt: new Date(),
      };
      // ensure we don't set status in $set for new path
      if ("status" in base) delete base.status;

      ops.push({
        updateOne: {
          filter,
          update: { $set: base, $setOnInsert: setOnInsert },
          upsert: true,
        },
      });
    }

    processedFilters.push(filter);
  }

  let inserted = 0;
  let updated = 0;
  let affectedIds: string[] = [];

  if (ops.length) {
    const result = await (Lead as any).bulkWrite(ops, { ordered: false });
    inserted = (result as any).upsertedCount || 0;
    const existedOps = processedFilters.length - inserted;
    updated = existedOps < 0 ? 0 : existedOps;

    // Collect affected IDs to sync onto Folder.leadIds (best-effort)
    const orFilters = processedFilters.flatMap((f) =>
      (f.$or || []).map((clause: any) => ({ ...clause, userEmail }))
    );
    const docs: Array<{ _id: any }> = await Lead.find({ $or: orFilters }).select("_id").lean();
    affectedIds = docs.map((d: { _id: any }) => String(d._id));
  }

  if (affectedIds.length) {
    await Folder.updateOne(
      { _id: new mongoose.Types.ObjectId(folderId), userEmail },
      { $addToSet: { leadIds: { $each: affectedIds } } }
    );
  }

  return { inserted, updated, affectedIds };
}
