// pages/api/drips/unenroll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const userEmail = String(session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const { leadId, dripId, all } = (req.body || {}) as {
    leadId?: string;
    dripId?: string;
    all?: boolean;
  };

  if (!leadId) return res.status(400).json({ error: "Missing leadId" });

  await mongooseConnect();

  try {
    const baseUpdate = {
      status: "canceled" as const,
      active: false,
      isActive: false,
      enabled: false,
      paused: true,
      isPaused: true,
      stopAll: true,
      processing: false,
      processingAt: null as any,
      nextSendAt: null as any,
      lastError: "canceled_by_user",
      updatedAt: new Date(),
    };

    if (all) {
      const r = await DripEnrollment.updateMany(
        { userEmail, leadId, status: { $in: ["active", "paused"] } },
        { $set: baseUpdate }
      ).exec();
      return res.status(200).json({ success: true, count: r.modifiedCount || 0 });
    }

    if (!dripId) {
      return res.status(400).json({ error: "Missing dripId (or pass all=true)" });
    }

    const r = await DripEnrollment.updateOne(
      { userEmail, leadId, campaignId: dripId, status: { $in: ["active", "paused"] } },
      { $set: baseUpdate }
    ).exec();

    return res.status(200).json({ success: true, count: r.modifiedCount || 0 });
  } catch (e: any) {
    console.error("unenroll error:", e?.message || e);
    return res.status(500).json({ error: "Failed to unenroll" });
  }
}
