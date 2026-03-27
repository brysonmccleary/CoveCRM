// pages/api/pipeline/move.ts
// POST — move a lead to a different pipeline stage
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  const { leadId, stageId, stageName } = req.body as {
    leadId?: string;
    stageId?: string;
    stageName?: string;
  };

  if (!leadId || !stageId) return res.status(400).json({ error: "leadId and stageId required" });

  await Lead.updateOne(
    { _id: leadId, userEmail },
    {
      $set: {
        pipelineStageId: stageId,
        pipelineStageName: stageName || "",
        stageChangedAt: new Date(),
      },
      $push: {
        stageHistory: {
          stageId,
          stageName: stageName || "",
          movedAt: new Date(),
        },
      },
    }
  );

  return res.status(200).json({ ok: true });
}
