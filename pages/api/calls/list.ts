// /pages/api/calls/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";

function parseBool(v?: string) {
  return v === "1" || v === "true";
}
function toDateOrUndefined(v?: string) {
  const d = v ? new Date(v) : undefined;
  return d && !isNaN(d.getTime()) ? d : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const requesterEmail = session?.user?.email?.toLowerCase();
  if (!requesterEmail) return res.status(401).json({ message: "Unauthorized" });

  const {
    page = "1",
    pageSize = "25",
    from,           // ISO date (start)
    to,             // ISO date (end)
    hasRecording,   // "1" | "0"
    hasAI,          // "1" | "0"
    includeLead,    // "1" to join lead name/phone
    direction,      // "inbound" | "outbound"
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const sizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));
  const skip = (pageNum - 1) * sizeNum;

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && ((requester as any).role === "admin");

    const q: any = {};
    if (!isAdmin) q.userEmail = requesterEmail;

    // Date filter (by startedAt or completedAt)
    const fromDate = toDateOrUndefined(from);
    const toDate = toDateOrUndefined(to);
    if (fromDate || toDate) {
      q.$or = [
        {
          startedAt: {
            ...(fromDate ? { $gte: fromDate } : {}),
            ...(toDate ? { $lte: toDate } : {}),
          },
        },
        {
          completedAt: {
            ...(fromDate ? { $gte: fromDate } : {}),
            ...(toDate ? { $lte: toDate } : {}),
          },
        },
      ];
    }

    if (direction === "inbound" || direction === "outbound") {
      q.direction = direction;
    }

    if (hasRecording !== undefined) {
      q.recordingUrl = parseBool(hasRecording) ? { $exists: true, $ne: "" } : { $in: [null, ""] };
    }

    if (hasAI !== undefined) {
      q.aiSummary = parseBool(hasAI) ? { $exists: true, $ne: "" } : { $in: [null, ""] };
    }

    const [items, total] = await Promise.all([
      Call.find(q).sort({ startedAt: -1, createdAt: -1 }).skip(skip).limit(sizeNum).lean(),
      Call.countDocuments(q),
    ]);

    // Optionally attach light lead info for each
    let leadMap: Record<string, any> = {};
    if (includeLead === "1") {
      const leadIds = Array.from(new Set(items.map(i => String(i.leadId || "")).filter(Boolean)));
      if (leadIds.length) {
        const leads = await Lead.find({ _id: { $in: leadIds } }).select("_id name firstName lastName Phone phone Email email").lean();
        leadMap = Object.fromEntries(
          leads.map((l: any) => [
            String(l._id),
            {
              id: String(l._id),
              name: l.name || [l.firstName, l.lastName].filter(Boolean).join(" ") || "",
              phone: l.Phone || l.phone || "",
              email: l.Email || l.email || "",
            },
          ])
        );
      }
    }

    const rows = items.map((c: any) => {
      const out: any = {
        id: String(c._id),
        callSid: c.callSid,
        userEmail: c.userEmail,
        leadId: c.leadId ? String(c.leadId) : undefined,
        direction: c.direction,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        duration: c.duration ?? c.recordingDuration,
        talkTime: c.talkTime,
        hasRecording: !!c.recordingUrl,
        recordingUrl: c.recordingUrl || undefined,
        hasAI: !!c.aiSummary,
        aiSummary: c.aiSummary || undefined,
        aiSentiment: c.aiSentiment || undefined,
      };
      if (includeLead === "1" && c.leadId && leadMap[String(c.leadId)]) {
        out.lead = leadMap[String(c.leadId)];
      }
      return out;
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      page: pageNum,
      pageSize: sizeNum,
      total,
      rows,
    });
  } catch (err: any) {
    console.error("GET /api/calls/list error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
