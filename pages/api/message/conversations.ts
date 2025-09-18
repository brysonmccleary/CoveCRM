// /pages/api/message/conversations.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";

type LeanLead = {
  _id: any;
  userEmail?: string | null;
  ownerEmail?: string | null;
  firstName?: string;
  lastName?: string;
  Phone?: string;
  phone?: string;
  ["First Name"]?: string;
  ["Last Name"]?: string;
  Name?: string;
  FullName?: string;
  displayName?: string;
  Email?: string;
  email?: string;
  State?: string;
  state?: string;
  phones?: Array<{ value?: string }>;
};

function normalizeDigits(p: string) {
  return (p || "").replace(/\D/g, "");
}

function leadMatchesLast10(lead: any, phone: string) {
  const d = normalizeDigits(phone);
  const last10 = d.slice(-10);
  if (!last10) return false;

  const cands: string[] = [];
  const push = (v: any) => v && cands.push(normalizeDigits(String(v)));
  push(lead?.Phone);
  push(lead?.phone);
  push((lead as any)?.["Phone Number"]);
  push((lead as any)?.PhoneNumber);
  push(lead?.Mobile);
  push(lead?.mobile);
  if (Array.isArray(lead?.phones)) {
    for (const ph of lead.phones) push(ph?.value);
  }
  return cands.some((x) => x && x.endsWith(last10));
}

function resolveDisplayName(lead: LeanLead | undefined | null) {
  if (!lead) return "";
  const full =
    (lead.displayName as string) ||
    (lead.FullName as string) ||
    (lead.Name as string) ||
    `${lead.firstName || lead["First Name"] || ""} ${lead.lastName || lead["Last Name"] || ""}`.trim();
  return (full || "").trim();
}

function resolvePhone(lead: LeanLead | undefined | null) {
  if (!lead) return "";
  return (
    (lead.Phone as string) ||
    (lead.phone as string) ||
    ((lead as any)["Phone Number"] as string) ||
    ((lead as any).PhoneNumber as string) ||
    (lead.Mobile as string) ||
    (lead.mobile as string) ||
    ""
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = (await getServerSession(
      req,
      res,
      authOptions as any,
    )) as Session | null;

    const userEmail =
      typeof session?.user?.email === "string"
        ? session.user.email.toLowerCase()
        : "";
    if (!userEmail) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await mongooseConnect();

    // 1) Latest message per leadId (normal case)
    const latestByLead = await Message.aggregate([
      { $match: { userEmail } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$leadId",
          last: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$direction", "inbound"] }, { $eq: ["$read", false] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).exec();

    // 2) Also consider messages that somehow lack leadId:
    //    We take the latest inbound/outbound and try to map to a lead by phone (last-10/E.164).
    const latestNoLead = await Message.aggregate([
      { $match: { userEmail, $or: [{ leadId: { $exists: false } }, { leadId: null }] } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: { to: "$to", from: "$from" },
          last: { $first: "$$ROOT" },
        },
      },
    ]).exec();

    // Fetch all leads referenced by ID
    const leadIds = latestByLead.map((r: any) => r._id).filter(Boolean);
    const leads = await Lead.find({ _id: { $in: leadIds } })
      .lean<LeanLead[]>()
      .exec();

    const leadById = new Map<string, LeanLead>();
    for (const l of leads) leadById.set(String(l._id), l);

    // For the no-lead set, attempt a per-user phone→lead resolution
    const toCheckPhones: string[] = [];
    const phoneKey = (v: string | undefined | null) => (v || "").trim();
    for (const row of latestNoLead as any[]) {
      const last = row?.last;
      if (!last) continue;
      // Prefer the counterparty number (the lead’s phone)
      const candidate = last.direction === "inbound" ? last.from : last.to;
      if (candidate) toCheckPhones.push(phoneKey(candidate));
    }

    // Unique phones
    const uniqPhones = Array.from(new Set(toCheckPhones.filter(Boolean)));

    // Pull a superset of possible leads for quick in-memory matching
    const phoneOrRegex: any[] = [];
    for (const ph of uniqPhones) {
      const d = normalizeDigits(ph);
      const last10 = d.slice(-10);
      if (!last10) continue;
      const anchored = new RegExp(`${last10}$`);
      // add exact +1 and anchored
      phoneOrRegex.push(
        { Phone: ph }, { phone: ph }, { ["Phone Number"]: ph }, { PhoneNumber: ph },
        { Mobile: ph }, { mobile: ph }, { "phones.value": ph },
        { Phone: `+1${last10}` }, { phone: `+1${last10}` }, { ["Phone Number"]: `+1${last10}` }, { PhoneNumber: `+1${last10}` },
        { Mobile: `+1${last10}` }, { mobile: `+1${last10}` }, { "phones.value": `+1${last10}` },
        { Phone: anchored }, { phone: anchored }, { ["Phone Number"]: anchored }, { PhoneNumber: anchored },
        { Mobile: anchored }, { mobile: anchored }, { "phones.value": anchored },
      );
    }

    let possibleLeads: LeanLead[] = [];
    if (phoneOrRegex.length > 0) {
      possibleLeads = await Lead.find({
        userEmail,
        $or: phoneOrRegex as any[],
      })
        .lean<LeanLead[]>()
        .exec();
    }

    // Index leads by last-10 sets for quick match
    const candidates: LeanLead[] = possibleLeads || [];

    const conversations: any[] = [];

    // Build rows for normal leadId cases
    for (const row of latestByLead as any[]) {
      const leadIdStr = String(row._id || "");
      const lastMsg = row.last || {};
      const unreadCount = Number(row.unreadCount || 0);

      const lead = leadById.get(leadIdStr);
      if (!lead) continue;

      const fullName = resolveDisplayName(lead);
      const phone = resolvePhone(lead);
      const displayName = fullName || phone || "Unknown";

      const lastMessageTime =
        lastMsg.deliveredAt ||
        lastMsg.sentAt ||
        lastMsg.scheduledAt ||
        lastMsg.createdAt ||
        lastMsg.date ||
        new Date();

      conversations.push({
        _id: lead._id,
        name: displayName,
        phone,
        lastMessage: lastMsg.text || lastMsg.body || "",
        lastMessageTime,
        lastMessageDirection: lastMsg.direction || null,
        lastMessageSid: lastMsg.sid || null,
        lastMessageStatus: lastMsg.status || null,
        lastMessageErrorCode: lastMsg.errorCode || null,
        lastMessageSuppressed:
          Boolean(lastMsg.suppressed) || lastMsg.status === "suppressed",
        lastMessageScheduledAt: lastMsg.scheduledAt || null,
        lastMessageDeliveredAt: lastMsg.deliveredAt || null,
        lastMessageFailedAt: lastMsg.failedAt || null,
        unread: unreadCount > 0,
        unreadCount,
      });
    }

    // Build rows for messages without leadId (fallback: phone→lead)
    for (const row of latestNoLead as any[]) {
      const lastMsg = row?.last || {};
      const counterparty = lastMsg.direction === "inbound" ? lastMsg.from : lastMsg.to;
      const cp = (counterparty || "").trim();
      if (!cp) continue;

      // Match a candidate lead whose phone ends with last-10
      const match = candidates.find((l) => leadMatchesLast10(l, cp));
      if (!match) {
        // If we can’t map to a lead, skip it so the UI doesn’t show an orphan row with just a number.
        continue;
      }

      const fullName = resolveDisplayName(match);
      const phone = resolvePhone(match);
      const displayName = fullName || phone || cp || "Unknown";

      const lastMessageTime =
        lastMsg.deliveredAt ||
        lastMsg.sentAt ||
        lastMsg.scheduledAt ||
        lastMsg.createdAt ||
        lastMsg.date ||
        new Date();

      conversations.push({
        _id: match._id,
        name: displayName,
        phone: phone || cp,
        lastMessage: lastMsg.text || lastMsg.body || "",
        lastMessageTime,
        lastMessageDirection: lastMsg.direction || null,
        lastMessageSid: lastMsg.sid || null,
        lastMessageStatus: lastMsg.status || null,
        lastMessageErrorCode: lastMsg.errorCode || null,
        lastMessageSuppressed:
          Boolean(lastMsg.suppressed) || lastMsg.status === "suppressed",
        lastMessageScheduledAt: lastMsg.scheduledAt || null,
        lastMessageDeliveredAt: lastMsg.deliveredAt || null,
        lastMessageFailedAt: lastMsg.failedAt || null,
        unread: lastMsg.direction === "inbound" && lastMsg.read === false,
        unreadCount: lastMsg.direction === "inbound" && lastMsg.read === false ? 1 : 0,
      });
    }

    // Sort by last activity time desc
    conversations.sort(
      (a, b) =>
        new Date(b.lastMessageTime).getTime() -
        new Date(a.lastMessageTime).getTime(),
    );

    return res.status(200).json(conversations);
  } catch (error) {
    console.error("Conversations API Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
