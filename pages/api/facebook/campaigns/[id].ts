// pages/api/facebook/campaigns/[id].ts
// GET, PATCH, DELETE for a specific FB lead campaign
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";

async function updateMetaObjectStatus(
  objectId: string,
  status: "ACTIVE" | "PAUSED",
  accessToken: string,
  objectType: "campaign" | "adset" | "ad"
) {
  const metaParams = new URLSearchParams();
  metaParams.set("status", status);
  metaParams.set("access_token", accessToken);
  const metaResp = await fetch(`https://graph.facebook.com/v21.0/${objectId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: metaParams.toString(),
  });
  const metaJson = await metaResp.json().catch(() => ({}));
  if (!metaResp.ok) {
    throw {
      objectType,
      objectId,
      metaError: metaJson,
    };
  }
  return metaJson;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { id } = req.query as { id: string };

  await mongooseConnect();

  const campaign = await FBLeadCampaign.findOne({
    _id: id,
    userEmail: session.user.email.toLowerCase(),
  });

  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  if (req.method === "GET") {
    return res.status(200).json({ campaign });
  }

  if (req.method === "PATCH") {
    const { campaignName, status, dailyBudget, totalSpend, totalLeads, totalClicks, cpl, notes, facebookCampaignId } =
      req.body as Partial<{
        campaignName: string;
        status: string;
        dailyBudget: number;
        totalSpend: number;
        totalLeads: number;
        totalClicks: number;
        cpl: number;
        notes: string;
        facebookCampaignId: string;
      }>;

    const updates: Record<string, any> = {};
    const requestedMetaStatus = String(status || "").toUpperCase();
    if (campaignName !== undefined) updates.campaignName = campaignName;
    if (requestedMetaStatus === "ACTIVE" || requestedMetaStatus === "PAUSED") {
      const metaCampaignId = String((campaign as any).metaCampaignId || "").trim();
      if (!metaCampaignId) return res.status(400).json({ error: "Campaign is missing metaCampaignId" });
      const metaAdsetId = String((campaign as any).metaAdsetId || "").trim();
      if (!metaAdsetId) return res.status(400).json({ error: "Campaign is missing metaAdsetId" });
      const currentAds = Array.isArray((campaign as any).ads) ? [ ...(campaign as any).ads ] : [];
      const metaAdIds = Array.from(
        new Set(
          [
            ...currentAds.map((ad: any) => String(ad?.metaAdId || "").trim()),
            ...(currentAds.length === 0 ? [String((campaign as any).metaAdId || "").trim()] : []),
          ].filter(Boolean)
        )
      );
      if (!metaAdIds.length) return res.status(400).json({ error: "Campaign is missing metaAdId" });

      const user = await User.findOne({ email: session.user.email.toLowerCase() })
        .select("metaSystemUserToken metaAccessToken")
        .lean() as any;
      const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
      if (!accessToken) return res.status(400).json({ error: "Meta access token missing" });

      try {
        if (requestedMetaStatus === "ACTIVE") {
          await updateMetaObjectStatus(metaAdsetId, "ACTIVE", accessToken, "adset");
          for (const metaAdId of metaAdIds) {
            await updateMetaObjectStatus(metaAdId, "ACTIVE", accessToken, "ad");
          }
          await updateMetaObjectStatus(metaCampaignId, "ACTIVE", accessToken, "campaign");
        } else {
          await updateMetaObjectStatus(metaCampaignId, "PAUSED", accessToken, "campaign");
          await updateMetaObjectStatus(metaAdsetId, "PAUSED", accessToken, "adset");
          for (const metaAdId of metaAdIds) {
            await updateMetaObjectStatus(metaAdId, "PAUSED", accessToken, "ad");
          }
        }
      } catch (err: any) {
        const failure = {
          objectType: err?.objectType || "unknown",
          objectId: err?.objectId || "",
          metaError: err?.metaError || err?.message || "Meta status update failed",
        };
        await FBLeadCampaign.updateOne(
          { _id: campaign._id },
          {
            $set: {
              metaObjectHealth: "sync_failed",
              metaSyncStatus: "sync_failed",
              metaSyncError: JSON.stringify(failure).slice(0, 1000),
              metaLastSyncedAt: new Date(),
            },
          }
        ).catch(() => {});
        return res.status(500).json({
          ok: false,
          error: "Meta status update failed",
          failedObject: failure,
        });
      }
      updates.status = requestedMetaStatus === "ACTIVE" ? "active" : "paused";
      updates.metaConfiguredStatus = requestedMetaStatus;
      updates.metaObjectHealth = requestedMetaStatus === "ACTIVE" ? "healthy" : "paused_on_meta";
      updates.metaSyncStatus = "synced";
      updates.metaSyncError = "";
      updates.metaLastSyncedAt = new Date();
      updates.ads = currentAds.map((ad: any) => ({
        ...(typeof ad?.toObject === "function" ? ad.toObject() : ad),
        status: requestedMetaStatus,
      }));
    } else if (status !== undefined) {
      updates.status = status;
    }
    if (dailyBudget !== undefined) updates.dailyBudget = dailyBudget;
    if (totalSpend !== undefined) updates.totalSpend = totalSpend;
    if (totalLeads !== undefined) updates.totalLeads = totalLeads;
    if (totalClicks !== undefined) updates.totalClicks = totalClicks;
    if (cpl !== undefined) updates.cpl = cpl;
    if (notes !== undefined) updates.notes = notes;
    if (facebookCampaignId !== undefined) updates.facebookCampaignId = facebookCampaignId;

    if ((updates.status === "active" || status === "active") && !campaign.setupCompletedAt) {
      updates.setupCompletedAt = new Date();
      updates.connectedAt = new Date();
    }

    Object.assign(campaign, updates);
    await campaign.save();

    return res.status(200).json({ ok: true, campaign });
  }

  if (req.method === "DELETE") {
    if ((campaign as any).metaCampaignId) {
      try {
        const user = await User.findOne({ email: session.user.email.toLowerCase() })
          .select("metaSystemUserToken metaAccessToken")
          .lean() as any;
        const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
        if (accessToken) {
          await fetch(
            `https://graph.facebook.com/v18.0/${(campaign as any).metaCampaignId}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                status: "DELETED",
                access_token: accessToken,
              }),
            }
          );
        }
      } catch (e) {
        // Non-fatal — proceed with local delete
        console.error("[campaign delete] Meta archive failed:", e);
      }
    }
    await campaign.deleteOne();
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
