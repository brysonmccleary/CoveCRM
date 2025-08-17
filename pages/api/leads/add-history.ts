// /pages/api/leads/add-history.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

/**
 * POST /api/leads/add-history
 * body: { leadId: string, type: "note" | "disposition" | string, message: string, meta?: object }
 * Writes a history entry into Lead.history with user + timestamp.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const requesterEmail = session?.user?.email?.toLowerCase();
  if (!requesterEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, type, message, meta } = (req.body || {}) as {
    leadId?: string;
    type?: string;
    message?: string;
    meta?: Record<string, any>;
  };

  if (!leadId || !type || !message) {
    return res.status(400).json({ message: "Missing leadId, type, or message" });
  }

  try {
    await dbConnect();

    // Only allow owners (or admins via your existing guard—add if you pass role in session)
    const lead = await Lead.findById(leadId);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (String(lead.userEmail || "").toLowerCase() !== requesterEmail) {
      // If you have admins, you can relax this with a role check
      return res.status(403).json({ message: "Forbidden" });
    }

    // Push into history (Close-style)
    lead.history = lead.history || [];
    lead.history.push({
      type,
      message,
      userEmail: requesterEmail,
      timestamp: new Date(),
      meta: meta || {},
    });

    await lead.save();

    return res.status(200).json({ ok: true, history: lead.history });
  } catch (err: any) {
    console.error("POST /api/leads/add-history error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
