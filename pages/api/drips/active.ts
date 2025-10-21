// pages/api/drips/active.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const leadId = String(req.query.leadId || "");
  if (!leadId) return res.status(400).json({ error: "Missing leadId" });

  await mongooseConnect();

  // Return active/paused enrollments for this lead (tenant-scoped)
  const enrollments = await DripEnrollment.find({
    userEmail: email,
    leadId,
    status: { $in: ["active", "paused"] },
  })
    .select({ _id: 1, campaignId: 1, status: 1, nextSendAt: 1, cursorStep: 1, createdAt: 1, updatedAt: 1 })
    .lean()
    .exec();

  return res.status(200).json({ enrollments });
}
