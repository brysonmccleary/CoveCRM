// pages/api/facebook/publish-ad.ts
// Creates internal FBLeadCampaign + CRM folder when agent clicks "Post Ad".
// Meta API publishing is a future phase; this pass wires up the routing layer.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import Folder from "@/models/Folder";
import User from "@/models/User";

const VALID_LEAD_TYPES = [
  "final_expense",
  "iul",
  "mortgage_protection",
  "veteran",
  "trucker",
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    leadType,
    campaignName,
    dailyBudgetCents,
    primaryText,
    headline,
    description,
    cta,
    imagePrompt,
    imageUrl,
    facebookPageId,
    adAccountId,
    creativeArchetype,
  } = req.body as {
    leadType?: string;
    campaignName?: string;
    dailyBudgetCents?: number;
    primaryText?: string;
    headline?: string;
    description?: string;
    cta?: string;
    imagePrompt?: string;
    imageUrl?: string;
    facebookPageId?: string;
    adAccountId?: string;
    creativeArchetype?: string;
  };

  // Validate required fields
  if (!campaignName || String(campaignName).trim().length < 3) {
    return res.status(400).json({ error: "campaignName is required (min 3 chars)" });
  }
  if (!leadType || !VALID_LEAD_TYPES.includes(leadType)) {
    return res.status(400).json({ error: `Valid leadType is required. Got: ${leadType}` });
  }
  if (!primaryText || String(primaryText).trim().length < 10) {
    return res.status(400).json({ error: "primaryText is required (min 10 chars)" });
  }
  if (!headline || String(headline).trim().length < 3) {
    return res.status(400).json({ error: "headline is required (min 3 chars)" });
  }
  const budgetCents = Number(dailyBudgetCents) || 0;
  if (budgetCents < 500) {
    return res.status(400).json({ error: "dailyBudgetCents must be >= 500 ($5.00/day minimum)" });
  }

  try {
    await mongooseConnect();

    const userEmail = String(session.user.email).toLowerCase();
    const user = await User.findOne({ email: userEmail })
      .select("_id metaAccessToken metaAdAccountId metaPageId metaInstagramId")
      .lean();
    if (!user) {
      return res.status(404).json({ error: "User account not found" });
    }

    const safeName = String(campaignName).trim();

    // 1. Ensure CRM folder exists — convention: "FB: {campaignName}"
    //    This matches what the webhook uses for lead routing.
    const folderName = `FB: ${safeName}`;
    let folder: any = null;
    let folderError: string | null = null;
    try {
      folder = await Folder.findOne({ userEmail, name: folderName }).lean();
      if (!folder) {
        folder = await Folder.create({
          name: folderName,
          userEmail,
          createdAt: new Date(),
        });
      }
    } catch (err: any) {
      folderError = err?.message || "Folder creation failed";
      console.error("[publish-ad] folder error:", folderError);
    }

    if (!folder) {
      return res.status(500).json({
        ok: false,
        error: "Failed to create CRM folder",
        partialResults: { folderError },
      });
    }

    const folderId = folder._id;

    // 2. Create or update FBLeadCampaign (upsert by userEmail + campaignName to avoid duplicates)
    const campaign = await FBLeadCampaign.findOneAndUpdate(
      { userEmail, campaignName: safeName },
      {
        $setOnInsert: {
          userId: (user as any)._id,
          status: "setup",
          plan: "manager",
        },
        $set: {
          leadType,
          dailyBudget: Math.round(budgetCents / 100),
          folderId,
          ...(facebookPageId ? { facebookPageId } : {}),
          // Store ad copy metadata in notes for future troubleshooting
          notes: JSON.stringify({
            headline: headline || "",
            primaryText: primaryText || "",
            imagePrompt: imagePrompt || "",
            imageUrl: imageUrl || "",
            cta: cta || "",
            creativeArchetype: creativeArchetype || "",
            adAccountId: adAccountId || "",
            savedAt: new Date().toISOString(),
          }),
        },
      },
      { upsert: true, new: true }
    );

    let metaCampaignId = "";
    let metaAdsetId = "";
    let metaAdId = "";
    let metaFormId = "";
    let metaPublishStatus: "not_attempted" | "skipped_missing_meta_connection" | "success" | "failed" = "not_attempted";
    let metaError: string | null = null;

    try {
      const fullUser = await User.findOne({ email: userEmail })
        .select("metaAccessToken metaAdAccountId metaPageId metaInstagramId")
        .lean() as any;

      const accessToken = String(fullUser?.metaAccessToken || "").trim();
      const adAccountIdFinal = String(adAccountId || fullUser?.metaAdAccountId || "").trim().replace(/^act_/, "");
      const pageIdFinal = String(facebookPageId || fullUser?.metaPageId || "").trim();
      const instagramId = String(fullUser?.metaInstagramId || "").trim();

      if (!accessToken || !adAccountIdFinal || !pageIdFinal) {
        metaPublishStatus = "skipped_missing_meta_connection";
      } else {
        const campaignParams = new URLSearchParams();
        campaignParams.set("name", safeName);
        campaignParams.set("objective", "OUTCOME_LEADS");
        campaignParams.set("status", "PAUSED");
        campaignParams.set("special_ad_categories", '["CREDIT"]');
        campaignParams.set("access_token", accessToken);

        const metaCampaignResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: campaignParams.toString(),
        });
        const metaCampaignJson = await metaCampaignResp.json();

        if (!metaCampaignResp.ok || !metaCampaignJson?.id) {
          throw new Error(`Meta campaign create failed: ${JSON.stringify(metaCampaignJson)}`);
        }
        metaCampaignId = String(metaCampaignJson.id);

        const adsetParams = new URLSearchParams();
        adsetParams.set("name", `${safeName} Ad Set`);
        adsetParams.set("campaign_id", metaCampaignId);
        adsetParams.set("daily_budget", String(budgetCents));
        adsetParams.set("billing_event", "IMPRESSIONS");
        adsetParams.set("optimization_goal", "LEAD_GENERATION");
        adsetParams.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
        adsetParams.set("status", "PAUSED");
        adsetParams.set("promoted_object", JSON.stringify({ page_id: pageIdFinal }));
        adsetParams.set("targeting", JSON.stringify({
          geo_locations: { countries: ["US"] },
          age_min: 30,
          age_max: 80,
        }));
        adsetParams.set("access_token", accessToken);

        const metaAdsetResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/adsets`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: adsetParams.toString(),
        });
        const metaAdsetJson = await metaAdsetResp.json();

        if (!metaAdsetResp.ok || !metaAdsetJson?.id) {
          throw new Error(`Meta ad set create failed: ${JSON.stringify(metaAdsetJson)}`);
        }
        metaAdsetId = String(metaAdsetJson.id);

        const questions: Array<Record<string, any>> = [
          { type: "FULL_NAME" },
          { type: "PHONE" },
        ];
        if (leadType === "iul" || leadType === "final_expense") {
          questions.push({ type: "EMAIL" });
        }

        const metaFormParams = new URLSearchParams();
        metaFormParams.set("name", `${safeName} Lead Form`);
        metaFormParams.set("locale", "en_US");
        metaFormParams.set("privacy_policy_url", "https://www.covecrm.com/privacy");
        metaFormParams.set("follow_up_action_url", "https://www.covecrm.com/thank-you");
        metaFormParams.set("questions", JSON.stringify(questions));
        metaFormParams.set("access_token", accessToken);

        const metaFormResp = await fetch(`https://graph.facebook.com/v19.0/${pageIdFinal}/leadgen_forms`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: metaFormParams.toString(),
        });
        const metaFormJson = await metaFormResp.json();

        if (!metaFormResp.ok || !metaFormJson?.id) {
          throw new Error(`Meta lead form create failed: ${JSON.stringify(metaFormJson)}`);
        }
        metaFormId = String(metaFormJson.id);

        const objectStorySpec: Record<string, any> = {
          page_id: pageIdFinal,
          link_data: {
            link: "https://www.covecrm.com",
            message: String(primaryText || ""),
            name: String(headline || ""),
            description: String(description || ""),
            call_to_action: {
              type: String(cta || "LEARN_MORE"),
              value: {
                lead_gen_form_id: metaFormId,
                link: "https://www.covecrm.com",
              },
            },
          },
        };

        if (imageUrl && String(imageUrl).trim()) {
          objectStorySpec.link_data.image_url = String(imageUrl).trim();
        }
        if (instagramId) {
          objectStorySpec.instagram_actor_id = instagramId;
        }

        const creativeParams = new URLSearchParams();
        creativeParams.set("name", `${safeName} Creative`);
        creativeParams.set("object_story_spec", JSON.stringify(objectStorySpec));
        creativeParams.set("access_token", accessToken);

        const metaCreativeResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/adcreatives`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: creativeParams.toString(),
        });
        const metaCreativeJson = await metaCreativeResp.json();

        if (!metaCreativeResp.ok || !metaCreativeJson?.id) {
          throw new Error(`Meta creative create failed: ${JSON.stringify(metaCreativeJson)}`);
        }
        const creativeId = String(metaCreativeJson.id);

        const adParams = new URLSearchParams();
        adParams.set("name", `${safeName} Ad`);
        adParams.set("adset_id", metaAdsetId);
        adParams.set("creative", JSON.stringify({ creative_id: creativeId }));
        adParams.set("status", "PAUSED");
        adParams.set("access_token", accessToken);

        const metaAdResp = await fetch(`https://graph.facebook.com/v19.0/act_${adAccountIdFinal}/ads`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: adParams.toString(),
        });
        const metaAdJson = await metaAdResp.json();

        if (!metaAdResp.ok || !metaAdJson?.id) {
          throw new Error(`Meta ad create failed: ${JSON.stringify(metaAdJson)}`);
        }
        metaAdId = String(metaAdJson.id);

        await FBLeadCampaign.updateOne(
          { _id: campaign._id },
          {
            $set: {
              metaCampaignId,
              metaAdsetId,
              metaFormId,
              metaAdId,
              facebookCampaignId: metaCampaignId,
            },
          }
        );

        metaPublishStatus = "success";
      }
    } catch (err: any) {
      metaPublishStatus = "failed";
      metaError = err?.message || "Meta publish failed";
      console.error("[publish-ad] meta publish error:", metaError);
    }

    return res.status(200).json({
      ok: true,
      status: "internal_campaign_created_meta_publish_attempted",
      message:
        metaPublishStatus === "success"
          ? `Meta campaign, ad set, lead form, and ad were created in PAUSED status, and CRM routing folder ${folderName} is ready.`
          : `CRM campaign and folder are ready, but Meta live publish did not complete.`,
      campaignId: String(campaign._id),
      folderId: String(folderId),
      folderName,
      campaignName: safeName,
      leadType,
      metaPublishStatus,
      metaError,
      metaCampaignId,
      metaAdsetId,
      metaFormId,
      metaAdId,
    });
  } catch (err: any) {
    console.error("[publish-ad] error:", err?.message);
    return res.status(500).json({ ok: false, error: "Failed to create campaign", details: err?.message });
  }
}
