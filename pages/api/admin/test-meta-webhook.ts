// pages/api/admin/test-meta-webhook.ts
// POST — Admin: manually trigger processMetaLead for testing

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { processMetaLead } from "@/lib/meta/processMetaLead";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Admin only" });
  }

  const { leadgenId, pageId } = req.body || {};
  if (!leadgenId) return res.status(400).json({ error: "leadgenId is required" });

  await mongooseConnect();

  try {
    await processMetaLead(
      String(leadgenId),
      String(pageId || ""),
      "",
      "",
      "",
      "",
      new Date().toISOString()
    );
    return res.status(200).json({ ok: true, message: `processMetaLead completed for ${leadgenId}` });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Processing failed" });
  }
}
