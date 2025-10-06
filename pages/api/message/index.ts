// pages/api/message/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import User from "@/models/User";
import { sendSms } from "@/lib/twilio/sendSMS";

type LeanLead = {
  _id: any;
  ownerEmail?: string | null;
  userEmail?: string | null;
  Phone?: string;
  phone?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const {
    leadId,
    text,
    direction = "outbound",
  } = (req.body || {}) as {
    leadId?: string;
    text?: string;
    direction?: "outbound" | "inbound" | "ai";
  };

  if (!leadId || !mongoose.isValidObjectId(leadId))
    return res.status(400).json({ error: "Missing or invalid leadId" });
  if (!text?.trim())
    return res.status(400).json({ error: "Missing text" });

  await mongooseConnect();

  // Load lead & authorize ownership
  const lead = await Lead.findById(leadId).lean<LeanLead>().exec();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const ownerEmail = String(
    lead.ownerEmail || lead.userEmail || "",
  ).toLowerCase();
  if (ownerEmail !== email)
    return res.status(401).json({ error: "Not your lead" });

  // Get destination phone
  const toRaw = lead.Phone || lead.phone;
  if (!toRaw)
    return res.status(400).json({ error: "Lead has no phone number" });

  const to = String(toRaw).trim();
  let createdMessage: any = null;

  try {
    if (direction === "outbound") {
      // Use the object-form helper which:
      //  - creates a queued Message row (with leadId)
      //  - dispatches via Twilio (or schedules/suppresses)
      const result = await sendSms({
        to,
        body: text.trim(),
        userEmail: email,
        leadId: String(leadId),
      });

      // Load the DB source-of-truth row by ID returned from sendSms
      createdMessage = await Message.findById(result.messageId).lean();
      if (!createdMessage) {
        // Extremely unlikely; provide a minimal echo so the UI doesn't break
        createdMessage = {
          leadId,
          userEmail: email,
          direction: "outbound",
          text: text.trim(),
          status: result.sid ? "accepted" : "queued",
          createdAt: new Date(),
        };
      }
    } else {
      // Non-outbound (e.g., AI notes) — persist directly
      createdMessage = await Message.create({
        userEmail: email,
        leadId,
        text: text.trim(),
        direction,
        read: direction === "inbound" ? false : true,
      });
    }
  } catch (err: any) {
    console.error("❌ /api/message send error:", err?.message || err);
    const msg =
      typeof err?.message === "string" && err.message
        ? err.message
        : "Failed to send SMS";
    return res.status(500).json({ error: msg });
  }

  // Emit socket events (best-effort) — keep your existing event name,
  // and also emit "message:new" which your ChatThread listens for to re-fetch.
  try {
    const payload = {
      _id: createdMessage._id,
      leadId: String(leadId),
      text: createdMessage.text,
      direction: createdMessage.direction || direction,
      date: createdMessage.createdAt || new Date(),
    };
    // @ts-ignore
    res.socket?.server?.io?.emit("newMessage", payload);
    // @ts-ignore
    res.socket?.server?.io?.emit("message:new", payload);
  } catch (e) {
    console.warn("Socket emit failed:", e);
  }

  return res.status(200).json({ success: true, message: createdMessage });
}
