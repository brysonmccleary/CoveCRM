import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import { resolveLeadDisplayName } from "@/lib/email";

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  // Simple bearer auth so this can be safely deployed
  const auth = req.headers.authorization;
  if (!INTERNAL_API_TOKEN || auth !== `Bearer ${INTERNAL_API_TOKEN}`) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    const limit = Math.min(parseInt(String(req.query.limit || "25"), 10) || 25, 200);
    const userEmail = (req.query.userEmail as string) || undefined;

    const q: any = { direction: "inbound" };
    if (userEmail) q.userEmail = userEmail;

    const msgs = await Message.find(q)
      .sort({ receivedAt: -1, createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();

    const leadIds = Array.from(
      new Set(msgs.map((m: any) => String(m.leadId || "")).filter(Boolean))
    );
    const leads = leadIds.length
      ? await Lead.find({ _id: { $in: leadIds } })
          .select("Phone phone Email email First Name Last Name name State status")
          .lean()
      : [];

    const leadMap = new Map(leads.map((l: any) => [String(l._id), l]));

    const rows = msgs.map((m: any) => {
      const lead = leadMap.get(String(m.leadId || "")) || null;
      const leadPhone = (lead && (lead.Phone || (lead as any).phone)) || "";
      const leadName = resolveLeadDisplayName(lead || {}, leadPhone || m.from) || null;

      return {
        when: m.receivedAt || m.createdAt,
        userEmail: m.userEmail,
        from: m.from,
        to: m.to,
        text: m.text?.length > 160 ? `${m.text.slice(0, 160)}…` : m.text || "",
        sid: m.sid || null,
        leadId: m.leadId || null,
        leadName,
        leadPhone: leadPhone || null,
      };
    });

    res.status(200).json({ count: rows.length, rows });
  } catch (e: any) {
    console.error("recent-inbound failed:", e);
    res.status(500).json({ message: "Internal error" });
  }
}
