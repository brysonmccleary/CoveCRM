// /pages/api/ai/generate-summary.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Call from "@/models/Call";
import { getUserByEmail } from "@/models/User";
import { OpenAI } from "openai";
import { trackUsage } from "@/lib/billing/trackUsage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");
const WORKER_SECRET = process.env.AI_WORKER_SECRET || "";

/**
 * Legacy helper: generate a bullet summary from existing lead.callTranscripts.
 * (Used only when leadId is provided and you already have stored transcripts.)
 */
async function generateLeadSummary(leadId: string): Promise<void> {
  if (!mongoose.connection.readyState) await dbConnect();

  const lead = await Lead.findById(leadId);
  if (!lead || lead.aiSummary || !lead.callTranscripts?.length) return;

  const user = await getUserByEmail(String(lead.userEmail || "").toLowerCase());
  const aiEntitled =
    !!user &&
    (user as any) &&
    ((user as any).aiEnabled === true ||
      (user as any).hasAI === true ||
      (user as any)?.plan?.ai === true ||
      (user as any)?.plan === "Pro");

  if (!aiEntitled) return;

  const agentName = (user as any)?.name || "The agent";
  const clientName = (lead as any)?.name || "The client";

  const combined = lead.callTranscripts
    .map((entry: any) => `${entry.agent || "Agent"}: ${entry.text}`)
    .join("\n\n");

  const messages = [
    {
      role: "system" as const,
      content: `You are an expert CRM assistant. Summarize the following sales call between a life insurance agent and a lead.

Use bullet points only. Follow this format:

• [AgentName] called [ClientName] regarding [mortgage protection / veteran insurance / IUL / final expense etc.]

• [ClientName]’s mortgage is [amount] / they want coverage for [burial / mortgage / both]

• [AgentName] presented options: [describe tiers, e.g., $250k, $150k, $75k]

• [ClientName] said [key quote, concern, or objection]

• [AgentName] began [application / quoting] and [ClientName] [submitted / declined to give info / wanted to wait, etc.]

Use 5–8 bullets max. Be specific. Use clean, professional language like Close.com summaries.`,
    },
    {
      role: "user" as const,
      content: `Agent name: ${agentName}\nClient name: ${clientName}\n\nTranscript:\n${combined}`,
    },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    temperature: 0.5,
    max_tokens: 500,
  });

  const summary = completion.choices[0].message.content?.trim();
  lead.aiSummary = summary || "No summary generated.";
  await lead.save();

  // Bill user (legacy path only)
  await trackUsage({
    user,
    amount: 0.01,
    source: "openai",
  });

  console.log(`✅ Lead AI summary saved for lead ${lead._id}`);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const { callId, callSid, leadId } = (req.body || {}) as {
    callId?: string;
    callSid?: string;
    leadId?: string;
  };

  try {
    await dbConnect();

    // Preferred new flow: trigger worker by Call (keeps single source of truth)
    if (callId || callSid) {
      const call =
        (callId && (await Call.findById(callId))) ||
        (callSid && (await Call.findOne({ callSid })));

      if (!call) return res.status(404).json({ message: "Call not found" });

      // Entitlement check mirrors the worker’s gate
      const user = await getUserByEmail(
        String(call.userEmail || "").toLowerCase(),
      );
      const aiEntitled =
        !!user &&
        ((user as any).aiEnabled === true ||
          (user as any).hasAI === true ||
          (user as any)?.plan?.ai === true ||
          (user as any)?.plan === "Pro");

      if (!aiEntitled) {
        return res
          .status(200)
          .json({ message: "AI not enabled for this user. Skipping." });
      }

      // Fire-and-forget trigger to the same worker used by the recording webhook
      fetch(`${BASE_URL}/api/ai/call-worker`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-worker-secret": WORKER_SECRET,
        },
        body: JSON.stringify({ callSid: call.callSid }),
        // @ts-ignore
        next: { revalidate: 0 },
      }).catch(() => {});

      return res.status(200).json({ message: "Call processing started." });
    }

    // Legacy path: generate summary from Lead.callTranscripts (if provided leadId)
    if (leadId) {
      await generateLeadSummary(leadId);
      return res.status(200).json({ message: "Lead summary generated." });
    }

    return res
      .status(400)
      .json({ message: "Provide callId/callSid (preferred) or leadId." });
  } catch (err) {
    console.error("AI generate-summary error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
