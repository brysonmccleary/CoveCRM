// pages/api/calls/get.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";

const ENV_AI = process.env.CALL_AI_SUMMARY_ENABLED === "1";

function serialize<T extends Record<string, any>>(doc: T | null) {
  if (!doc) return null;
  const x: any = JSON.parse(JSON.stringify(doc));
  if (x._id) x._id = String(x._id);
  if (x.leadId && typeof x.leadId === "object") x.leadId = String(x.leadId);
  return x;
}

function entitled(user: any): boolean {
  if (!ENV_AI || !user) return false;
  const active = (user.subscriptionStatus || "active") === "active";
  return Boolean(user.hasAI && active);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const requesterEmail = session?.user?.email?.toLowerCase();
  if (!requesterEmail) return res.status(401).json({ message: "Unauthorized" });

  const { id, callSid, includeLead } = req.query as { id?: string; callSid?: string; includeLead?: string; };
  if (!id && !callSid) return res.status(400).json({ message: "Provide id or callSid" });

  try {
    await dbConnect();
    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && (requester as any).role === "admin";
    const canSeeAI = entitled(requester);

    const callRaw =
      (id && ((await (Call as any).findById(id).lean()) as any)) ||
      (callSid && ((await (Call as any).findOne({ callSid }).lean()) as any)) ||
      null;

    if (!callRaw) return res.status(404).json({ message: "Call not found" });
    const call: any = callRaw;

    if (!isAdmin && (call.userEmail as string | undefined)?.toLowerCase() !== requesterEmail) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const payload: any = serialize(call);
    payload.hasRecording = !!payload.recordingUrl;

    if (canSeeAI) {
      payload.hasAI = Boolean(payload.aiSummary || (Array.isArray(payload.aiBullets) && payload.aiBullets.length > 0));
    } else {
      payload.hasAI = false;
      delete payload.aiSummary;
      delete payload.aiActionItems;
      delete payload.aiBullets;
      delete payload.aiScore;
      delete payload.aiSentiment;
      delete payload.transcript;
      delete payload.aiProcessing;
    }

    payload.durationSeconds = payload.duration ?? payload.recordingDuration ?? undefined;

    if (includeLead === "1" && call.leadId) {
      const lead: any = await (Lead as any).findOne({ _id: call.leadId }).lean();
      if (lead) {
        payload.lead = {
          id: String(lead._id),
          name:
            lead.name ||
            lead.fullName ||
            [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
            "",
          phone: lead.Phone || lead.phone || "",
          email: lead.Email || lead.email || "",
          status: lead.status || "",
        };
      }
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ call: payload });
  } catch (err: any) {
    console.error("GET /api/calls/get error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
