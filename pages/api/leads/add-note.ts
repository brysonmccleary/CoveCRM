// /pages/api/leads/add-note.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

/**
 * POST /api/leads/add-note
 * Body: { leadId: string, text: string }
 *
 * - Auth required
 * - Scopes to the owner's lead (userEmail)
 * - Appends a note to:
 *    1) lead.interactionHistory (type: "outbound")
 *    2) lead.callTranscripts (so it appears in /api/leads/history as a "note")
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions as any);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { leadId, text } = (req.body || {}) as { leadId?: string; text?: string };
  if (!leadId || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ message: "Missing leadId or text" });
    return;
  }

  // Light validation/sanitization
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 2000); // cap at 2k chars
  const now = new Date();

  try {
    await dbConnect();

    // Ensure the lead belongs to this user
    const lead = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) {
      res.status(404).json({ message: "Lead not found" });
      return;
    }

    // Push to interactionHistory (for completeness / auditing)
    lead.interactionHistory = lead.interactionHistory || [];
    lead.interactionHistory.push({
      type: "outbound",
      text: `📝 Note: ${clean}`,
      date: now,
    } as any);

    // Also push to callTranscripts so it shows up as a "note" in /api/leads/history
    lead.callTranscripts = lead.callTranscripts || [];
    lead.callTranscripts.push({
      text: clean,
      createdAt: now,
    });

    await lead.save();

    res.status(200).json({
      success: true,
      leadId,
      added: {
        text: clean,
        dateISO: now.toISOString(),
      },
    });
    return;
  } catch (err) {
    console.error("add-note error:", err);
    res.status(500).json({ message: "Internal server error" });
    return;
  }
}
