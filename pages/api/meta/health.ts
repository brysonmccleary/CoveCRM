import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkMetaWriteReadiness } from "@/lib/meta/metaHealth";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const user = await User.findOne({ email }).lean() as any;
  if (!user) return res.status(404).json({ error: "User not found" });

  const leadType = String(req.query.leadType || "").trim();
  const leadTypeAssets =
    leadType && user?.metaLeadTypeAssets
      ? user.metaLeadTypeAssets instanceof Map
        ? user.metaLeadTypeAssets.get(leadType)
        : user.metaLeadTypeAssets[leadType]
      : null;

  const health = await checkMetaWriteReadiness({
    user,
    userEmail: email,
    pageId: String(req.query.pageId || leadTypeAssets?.pageId || user.metaPageId || "").trim(),
    adAccountId: String(req.query.adAccountId || leadTypeAssets?.adAccountId || user.metaAdAccountId || "").trim(),
    accessToken: String(user.metaSystemUserToken || user.metaAccessToken || "").trim(),
    force: String(req.query.force || "") === "true",
  });

  return res.status(health.ok ? 200 : 400).json({
    ok: health.ok,
    metaHealth: health,
    error: health.ok ? "" : health.reason,
  });
}
