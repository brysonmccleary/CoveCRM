// pages/api/calls/ai-overview.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import { getUserByEmail } from "@/models/User";

function asString(v: string | string[] | undefined) {
  if (!v) return "";
  return Array.isArray(v) ? v[0] : String(v);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const requesterEmail: string | undefined = session?.user?.email
    ? String(session.user.email).toLowerCase()
    : undefined;

  if (!requesterEmail) return res.status(401).json({ message: "Unauthorized" });

  const leadId = asString(req.query.leadId);
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && (requester as any).role === "admin";

    const query: any = {
      leadId,
      aiOverviewReady: true,
      aiOverview: { $exists: true, $ne: null },
    };

    // Tenant isolation: non-admin can only see their calls
    if (!isAdmin) query.userEmail = requesterEmail;

    const call: any = await (Call as any)
      .findOne(query)
      .sort({ startedAt: -1, completedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    if (!call) {
      return res.status(200).json({ ok: true, call: null });
    }

    return res.status(200).json({
      ok: true,
      call: {
        id: String(call._id),
        callSid: String(call.callSid || ""),
        startedAt: call.startedAt || call.createdAt || null,
        completedAt: call.completedAt || null,
        duration: typeof call.duration === "number" ? call.duration : null,
        aiOverviewReady: !!call.aiOverviewReady,
        aiOverview: call.aiOverview || null,
      },
    });
  } catch (err: any) {
    console.error("GET /api/calls/ai-overview error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
