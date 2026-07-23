import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  const userEmail = String(session?.user?.email || "").trim().toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });
  await mongooseConnect();

  if (req.method === "GET") {
    const user = await User.findOne({ email: userEmail })
      .select("metaAdAccountId metaCapiAdAccountId metaDatasetId metaCapiEnabled metaCapiDailyCap")
      .lean() as any;
    if (!user) return res.status(404).json({ error: "User account not found" });
    return res.status(200).json({
      adAccountId: String(user.metaAdAccountId || ""),
      configuredAdAccountId: String(user.metaCapiAdAccountId || ""),
      datasetId: String(user.metaDatasetId || ""),
      enabled: !!user.metaCapiEnabled,
      dailyCap: Number(user.metaCapiDailyCap || 1000),
      globalKillSwitchEnabled: String(process.env.CAPI_ENABLED || "").toLowerCase() === "true",
    });
  }

  const datasetId = String(req.body?.datasetId || "").trim();
  const adAccountId = String(req.body?.adAccountId || "").trim().replace(/^act_/, "");
  const enabled = req.body?.enabled === true;
  const dailyCap = Number(req.body?.dailyCap ?? 1000);
  if (datasetId && !/^\d{5,30}$/.test(datasetId)) return res.status(400).json({ error: "Meta dataset ID must be numeric" });
  if (enabled && !datasetId) return res.status(400).json({ error: "A Meta dataset is required before enabling CAPI" });
  if (enabled && !adAccountId) return res.status(400).json({ error: "A connected Meta ad account is required before enabling CAPI" });
  if (!Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 100000) {
    return res.status(400).json({ error: "dailyCap must be an integer between 1 and 100000" });
  }
  const updated = await User.findOneAndUpdate(
    {
      email: userEmail,
      ...(enabled ? { metaAdAccountId: adAccountId } : {}),
    },
    {
      $set: {
        metaDatasetId: datasetId,
        metaCapiAdAccountId: enabled ? adAccountId : "",
        metaCapiEnabled: enabled,
        metaCapiDailyCap: dailyCap,
      },
    },
    { new: true }
  ).select("metaAdAccountId metaCapiAdAccountId metaDatasetId metaCapiEnabled metaCapiDailyCap").lean() as any;
  if (!updated) return res.status(400).json({ error: "Connect a Meta ad account before enabling CAPI" });
  return res.status(200).json({
    ok: true,
    adAccountId: String(updated.metaAdAccountId || ""),
    configuredAdAccountId: String(updated.metaCapiAdAccountId || ""),
    datasetId: String(updated.metaDatasetId || ""),
    enabled: !!updated.metaCapiEnabled,
    dailyCap: Number(updated.metaCapiDailyCap || dailyCap),
  });
}
