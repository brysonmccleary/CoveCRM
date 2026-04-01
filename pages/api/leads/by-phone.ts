// pages/api/leads/by-phone.ts
// Token-auth GET — find a lead by phone number (used by AI voice server)
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";

function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers["x-api-secret"] || req.headers["authorization"];
  const token = Array.isArray(authHeader) ? authHeader[0] : authHeader || "";
  const bare = token.replace(/^Bearer\s+/i, "");
  if (!COVECRM_API_SECRET || bare !== COVECRM_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { phone, userEmail } = req.query as { phone?: string; userEmail?: string };
  if (!phone) return res.status(400).json({ error: "phone is required" });
  if (!userEmail) return res.status(400).json({ error: "userEmail is required" });

  await mongooseConnect();

  const norm = normalizePhone(phone);

  // Build phone variants to match against stored formats
  const variants = [
    norm,
    `+1${norm}`,
    norm.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3"),
    norm.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3"),
  ].filter(Boolean);

  const lead = await Lead.findOne({
    $and: [
      { $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }] },
      { $or: [{ Phone: { $in: variants } }, { phone: { $in: variants } }] },
    ],
  }).lean();

  if (!lead) return res.status(404).json({ error: "Lead not found" });

  return res.status(200).json({ lead });
}
