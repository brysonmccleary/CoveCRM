// pages/api/mobile/message/[leadId].ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";

type LeanLead = {
  _id: any;
  ownerEmail?: string | null;
  userEmail?: string | null;
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
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const email = getEmailFromAuth(req);
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const { leadId } = req.query as { leadId: string };
  if (!leadId) return res.status(400).json({ error: "Missing leadId" });

  await mongooseConnect();

  // Ensure the lead belongs to this user
  const lead = await Lead.findById(leadId).lean<LeanLead>().exec();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const ownerEmail = String(lead.ownerEmail || lead.userEmail || "").toLowerCase();
  if (ownerEmail !== email)
    return res.status(401).json({ error: "Not your lead" });

  // Fetch thread
  const messages = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  return res.status(200).json(messages || []);
}
