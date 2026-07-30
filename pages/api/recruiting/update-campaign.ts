import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { MAX_DM_LENGTH, validateRecruitingAudienceDescription } from "@/lib/recruiting/social/policy";
import { RecruitingPublicError, recruitingErrorPayload } from "@/lib/recruiting/public-errors";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";
import { buildDiscoverySearchQueries, normalizeDiscoverySourceTypes, normalizeSeedAccounts } from "@/lib/recruiting/cloud/discovery-sources";
import { enabledActionsForPlatform, normalizePlatformActionSettings } from "@/lib/recruiting/action-settings";
import { assertPlanAllowsCampaign } from "@/lib/recruiting/plans";
import { parseDailyDmLimit } from "@/lib/recruiting/dm-settings";

const ALLOWED_EXAMPLES = new Set(["athletes", "insurance agents", "d2d sales", "car sales", "realtors", "fitness coaches", "entrepreneurs"]);
const UNSUPPORTED_MESSAGE_CLAIM = /guaranteed\s+(income|earnings|salary)|risk[- ]free|you(?:'re| are) hired/i;
const provided = (body: unknown, key: string) => Boolean(body) && Object.prototype.hasOwnProperty.call(body, key);

// Edits a running (or paused) hosted campaign in place. Every change applies
// only going forward — the pipeline's own per-person DM guard means nobody who
// was already messaged is ever messaged again, regardless of what changes here.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;

  const campaignId = String(req.body?.campaignId || "");
  if (!Types.ObjectId.isValid(campaignId)) return res.status(400).json({ code: "CAMPAIGN_INPUT_INVALID", error: "Choose a valid campaign first." });

  try {
    await mongooseConnect();
    const campaign = await RecruitingCampaign.findOne({
      _id: campaignId,
      ownerEmail: admin.email,
      executionMode: "hosted_cloud",
      status: { $in: ["active", "paused"] },
    });
    if (!campaign) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "That campaign is no longer available to edit.");

    const now = new Date();
    const changed: string[] = [];
    const platforms = campaign.platforms as ("instagram" | "linkedin")[];

    // --- action toggles ---
    if (provided(req.body, "platformActionSettings")) {
      const settings = normalizePlatformActionSettings(req.body.platformActionSettings);
      const actions = [...new Set(platforms.flatMap((platform) => enabledActionsForPlatform(settings, platform)))];
      if (!actions.length) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Keep at least one action turned on.");
      const dmEnabled = platforms.some((platform) => settings[platform].dm);
      try { assertPlanAllowsCampaign(campaign.planKey as any, platforms, dmEnabled); }
      catch (error) { throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", error instanceof Error ? error.message : undefined); }
      campaign.platformActionSettings = settings as any;
      campaign.actions = actions as any;
      // Any action a customer just turned off should stop, including work already queued.
      await RecruitingCompanionJob.updateMany(
        { campaignId: campaign._id, status: "queued", actionType: { $nin: actions } },
        { $set: { status: "canceled", completedAt: now, failureCode: "settings_updated", resultSummary: "This action was turned off by its owner." }, $unset: { leaseExpiresAt: 1 } },
      );
      changed.push("actions");
    }

    // --- exact DM message ---
    if (provided(req.body, "message")) {
      const message = String(req.body.message || "").trim();
      const dmEnabled = platforms.some((platform) => (campaign.platformActionSettings as any)?.[platform]?.dm);
      if (dmEnabled && (!message || message.length > MAX_DM_LENGTH)) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", `Choose a DM between 1 and ${MAX_DM_LENGTH} characters.`);
      if (UNSUPPORTED_MESSAGE_CLAIM.test(message)) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Remove unsupported employment or income claims from the DM.");
      if (message !== (campaign.openingMessage || "")) {
        campaign.openingMessage = message;
        // Cancel queued (not-yet-sent) DMs so the previous wording never goes out.
        // People already messaged are untouched and never re-messaged; those not
        // yet reached are re-queued with the new message by the next scan.
        await RecruitingCompanionJob.updateMany(
          { campaignId: campaign._id, actionType: "dm", status: "queued" },
          { $set: { status: "canceled", completedAt: now, failureCode: "message_updated", resultSummary: "The message was updated before this DM was sent." }, $unset: { leaseExpiresAt: 1 } },
        );
        changed.push("message");
      }
    }

    // --- daily DM limit ---
    if (provided(req.body, "dailyLimit")) {
      let dailyLimit: number;
      try { dailyLimit = parseDailyDmLimit(req.body.dailyLimit); }
      catch (error) { throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", error instanceof Error ? error.message : undefined); }
      await RecruitingCloudAccount.updateMany(
        { ownerEmail: admin.email, platform: { $in: platforms }, status: { $ne: "canceled" } },
        { $set: { dailyDmLimit: dailyLimit } },
      );
      changed.push("dailyLimit");
    }

    // --- public engagement preference ---
    if (provided(req.body, "engagementAudience")) {
      campaign.engagementAudience = (["everyone", "women", "men"].includes(String(req.body.engagementAudience)) ? String(req.body.engagementAudience) : "everyone") as any;
      changed.push("engagementAudience");
    }

    // --- audience (re-points discovery) ---
    if (["audienceDescription", "location", "examples", "discoverySourceTypes", "seedAccounts"].some((key) => provided(req.body, key))) {
      const audienceDescription = provided(req.body, "audienceDescription")
        ? validateRecruitingAudienceDescription(String(req.body.audienceDescription || ""))
        : String(campaign.audienceDescription || "");
      if (!audienceDescription) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Describe who you want CoveCRM to find.");
      const location = provided(req.body, "location") ? String(req.body.location || "").trim() : String(campaign.location || "");
      if (location.length > 100) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Keep the location under 100 characters.");
      const targetLocation = location || "United States";
      const examples: string[] = provided(req.body, "examples")
        ? [...new Set<string>((Array.isArray(req.body.examples) ? req.body.examples : []).map((value: unknown) => String(value).toLowerCase()).filter((value: string) => ALLOWED_EXAMPLES.has(value)))]
        : ((campaign.examples as string[]) || []);
      const seedAccounts = provided(req.body, "seedAccounts") ? normalizeSeedAccounts(req.body.seedAccounts) : ((campaign.seedAccounts as string[]) || []);
      const discoverySourceTypes = provided(req.body, "discoverySourceTypes") ? normalizeDiscoverySourceTypes(req.body.discoverySourceTypes) : ((campaign.discoverySourceTypes as any) || []);

      campaign.audienceDescription = audienceDescription;
      campaign.location = targetLocation;
      campaign.examples = examples as any;
      campaign.category = examples.join(", ") || "Custom audience";
      campaign.idealRecruit = [audienceDescription, `Location: ${targetLocation}`].filter(Boolean).join("\n");
      campaign.seedAccounts = seedAccounts as any;
      campaign.discoverySourceTypes = discoverySourceTypes as any;

      const discoveryAudience = [...examples, audienceDescription].filter(Boolean).join(" ");
      for (const platform of platforms) {
        const searchQueries = buildDiscoverySearchQueries({ platform, audienceDescription, location: targetLocation, examples, sourceTypes: discoverySourceTypes as any, seedAccounts });
        const set: Record<string, unknown> = {
          searchQuery: searchQueries[0],
          searchQueries,
          seedAccounts,
          derivedSeedAccounts: [],
          discoverySourceTypes,
          sourceCursor: 0,
          audienceDescription: discoveryAudience,
          location: targetLocation,
        };
        // Re-scan soon with the new audience only if the campaign is running.
        if (campaign.status === "active") { set.status = "queued"; set.availableAt = now; }
        await RecruitingDiscoveryJob.updateOne({ campaignId: campaign._id, platform, ownerEmail: admin.email }, { $set: set });
      }
      changed.push("audience");
    }

    if (!changed.length) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "No changes were provided.");

    campaign.version = (Number(campaign.version) || 1) + 1;
    await campaign.save();

    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: "campaign_updated",
      entityType: "campaign",
      entityId: `${campaign._id}:${Date.now()}`,
      details: { changed, hostedCloud: true },
    });
    return res.status(200).json({ ok: true, changed, campaign });
  } catch (error) {
    const status = error instanceof RecruitingPublicError ? 400 : 503;
    return res.status(status).json(recruitingErrorPayload(error, "CAMPAIGN_START_FAILED"));
  }
}
