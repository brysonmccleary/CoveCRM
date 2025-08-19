// /pages/api/message/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import User from "@/models/User";
import { sendSMS } from "@/lib/twilio/sendSMS";

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

  // ✅ Auth
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
  if (!leadId || !text?.trim())
    return res.status(400).json({ error: "Missing leadId or text" });

  await dbConnect();

  // ✅ Load lead & authorize ownership
  const lead = await Lead.findById(leadId).lean<LeanLead>().exec();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const ownerEmail = String(
    lead.ownerEmail || lead.userEmail || "",
  ).toLowerCase();
  if (ownerEmail !== email)
    return res.status(401).json({ error: "Not your lead" });

  // ✅ Get destination phone (handle casing: Phone vs phone)
  const toRaw = lead.Phone || lead.phone;
  if (!toRaw)
    return res.status(400).json({ error: "Lead has no phone number" });

  const to = String(toRaw).trim(); // assume already E.164; if not, add your normalizer here

  // ✅ Send SMS for outbound messages
  if (direction === "outbound") {
    const user = await User.findOne({ email }).lean().exec();
    if (!user) return res.status(404).json({ error: "User not found" });

    try {
      // Keep your existing util signature (only send when you know it's configured)
      await sendSMS(to, text.trim(), user._id);
    } catch (err: any) {
      console.error("Twilio send error:", err);
      return res
        .status(500)
        .json({ error: err?.message || "Failed to send SMS" });
    }
  }

  // ✅ Persist message
  const message = await Message.create({
    userEmail: email,
    leadId,
    text: text.trim(),
    direction,
    read: direction === "inbound" ? false : true,
  });

  // ✅ Emit socket event (best-effort)
  try {
    // @ts-ignore
    res.socket?.server?.io?.emit("newMessage", {
      _id: message._id,
      leadId,
      text: message.text,
      direction: message.direction,
      date: message.createdAt,
    });
  } catch (e) {
    console.warn("Socket emit failed:", e);
  }

  return res.status(200).json({ success: true, message });
}
