import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const user = await User.findOne({ email: session.user.email.toLowerCase() })
    .select("metaAccessToken metaAdAccountId metaPageId metaPageName metaTokenExpiresAt metaLastWebhookAt metaLastInsightSyncAt")
    .lean() as any;

  return res.status(200).json({
    connected: !!(user?.metaAccessToken || user?.metaAdAccountId || user?.metaPageId),
    adAccountId: user?.metaAdAccountId || "",
    pageId: user?.metaPageId || "",
    pageName: user?.metaPageName || "",
    tokenExpiresAt: user?.metaTokenExpiresAt || null,
    lastWebhookAt: user?.metaLastWebhookAt || null,
    lastInsightSyncAt: user?.metaLastInsightSyncAt || null,
  });
}
