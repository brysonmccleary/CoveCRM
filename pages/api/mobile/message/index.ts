// pages/api/mobile/message/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import mongooseConnect from "@/lib/mongooseConnect";
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

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET || process.env.NEXTAUTH_SECRET || "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const email = getEmailFromAuth(req);
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

  // Send SMS for outbound messages
  if (direction === "outbound") {
    const user = await User.findOne({ email }).lean().exec();
    if (!user) return res.status(404).json({ error: "User not found" });

    try {
      await sendSMS(to, text.trim(), user._id);
    } catch (err: any) {
      console.error("Twilio send error (mobile):", err);
      return res
        .status(500)
        .json({ error: err?.message || "Failed to send SMS" });
    }
  }

  // Persist message
  const message = await Message.create({
    userEmail: email,
    leadId,
    text: text.trim(),
    direction,
    read: direction === "inbound" ? false : true,
  });

  // Emit socket event (best-effort, same event name as web)
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
    console.warn("Socket emit (mobile) failed:", e);
  }

  return res.status(200).json({ success: true, message });
}
