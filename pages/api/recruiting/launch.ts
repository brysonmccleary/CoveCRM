import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { MAX_DM_LENGTH, validateRecruitingAudienceDescription } from "@/lib/recruiting/social/policy";
import { RecruitingPublicError, recruitingErrorPayload } from "@/lib/recruiting/public-errors";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";
import {
  buildDiscoverySearchQueries,
  normalizeDiscoverySourceTypes,
  normalizeSeedAccounts,
} from "@/lib/recruiting/cloud/discovery-sources";
import { enabledActionsForPlatform, normalizePlatformActionSettings } from "@/lib/recruiting/action-settings";
import { assertPlanAllowsCampaign, normalizeRecruitingPlan } from "@/lib/recruiting/plans";
import { DEFAULT_DAILY_DM_LIMIT, parseDailyDmLimit } from "@/lib/recruiting/dm-settings";

const ALLOWED_EXAMPLES = new Set(["athletes", "insurance agents", "d2d sales", "car sales", "realtors", "fitness coaches", "entrepreneurs"]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;

  try {
    const audienceDescription = validateRecruitingAudienceDescription(String(req.body?.audienceDescription || ""));
    const location = String(req.body?.location || "").trim();
    const targetLocation = location || "United States";
    const message = String(req.body?.message || "").trim();
    const platforms = [...new Set(Array.isArray(req.body?.platforms) ? req.body.platforms : [])]
      .filter((value) => value === "linkedin" || value === "instagram") as ("linkedin" | "instagram")[];
    const examples = [...new Set(Array.isArray(req.body?.examples) ? req.body.examples : [])]
      .map(String).map((value) => value.toLowerCase()).filter((value) => ALLOWED_EXAMPLES.has(value));
    const seedAccounts = normalizeSeedAccounts(req.body?.seedAccounts);
    const discoverySourceTypes = normalizeDiscoverySourceTypes(req.body?.discoverySourceTypes);
    const engagementAudience = ["everyone", "women", "men"].includes(String(req.body?.engagementAudience))
      ? String(req.body.engagementAudience)
      : "everyone";
    let dailyLimit: number;
    try { dailyLimit = parseDailyDmLimit(req.body?.dailyLimit ?? DEFAULT_DAILY_DM_LIMIT); }
    catch (error) { throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", error instanceof Error ? error.message : undefined); }
    const platformActionSettings = normalizePlatformActionSettings(req.body?.platformActionSettings);
    const planKey = normalizeRecruitingPlan(req.body?.planKey);
    const actions = [...new Set(platforms.flatMap((platform) => enabledActionsForPlatform(platformActionSettings, platform)))];
    const dmEnabled = platforms.some((platform) => platformActionSettings[platform].dm);

    if (location.length > 100) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Keep the location under 100 characters.");
    if (!platforms.length) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Choose Instagram, LinkedIn, or both.");
    if (!actions.length) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Turn on at least one action for a selected platform.");
    if (dmEnabled && (!message || message.length > MAX_DM_LENGTH)) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", `Choose a DM between 1 and ${MAX_DM_LENGTH} characters.`);
    if (dmEnabled && /guaranteed\s+(income|earnings|salary)|risk[- ]free|you(?:'re| are) hired/i.test(message)) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Remove unsupported employment or income claims from the DM.");
    try { assertPlanAllowsCampaign(planKey, platforms, dmEnabled); }
    catch (error) { throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", error instanceof Error ? error.message : undefined); }

    await mongooseConnect();
    const cloudAccounts = await RecruitingCloudAccount.find({
      ownerEmail: admin.email,
      platform: { $in: platforms },
      status: "active",
    });
    if (cloudAccounts.length !== platforms.length) throw new RecruitingPublicError("CAMPAIGN_INPUT_INVALID", "Connect every selected social account first.");
    await RecruitingCloudAccount.updateMany(
      { _id: { $in: cloudAccounts.map((account) => account._id) } },
      { $set: { dailyDmLimit: dailyLimit } },
    );
    const campaign = await RecruitingCampaign.create({
      ownerEmail: admin.email,
      name: `Recruiting campaign · ${new Date().toLocaleDateString("en-US")}`,
      category: examples.join(", ") || "Custom audience",
      planKey,
      idealRecruit: [audienceDescription, `Location: ${targetLocation}`].filter(Boolean).join("\n"),
      audienceDescription,
      location: targetLocation,
      examples,
      platforms,
      actions,
      platformActionSettings,
      engagementAudience,
      seedAccounts,
      discoverySourceTypes,
      openingMessage: message,
      status: "active",
      executionMode: "hosted_cloud",
      liveExecutionEnabled: true,
    });
    const discoveryAudience = [...examples, audienceDescription].filter(Boolean).join(" ");
    const discoveryJobs = await RecruitingDiscoveryJob.insertMany(platforms.map((platform) => {
      const searchQueries = buildDiscoverySearchQueries({
        platform,
        audienceDescription,
        location: targetLocation,
        examples,
        sourceTypes: discoverySourceTypes,
        seedAccounts,
      });
      return {
        cloudAccountId: cloudAccounts.find((account) => account.platform === platform)!._id,
        ownerEmail: admin.email,
        campaignId: campaign._id,
        platform,
        searchQuery: searchQueries[0],
        searchQueries,
        seedAccounts,
        derivedSeedAccounts: [],
        discoverySourceTypes,
        sourceCursor: 0,
        audienceDescription: discoveryAudience,
        location: targetLocation,
        maxCandidatesPerScan: 25,
        status: "queued",
        availableAt: new Date(),
      };
    }));
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: "campaign_created",
      entityType: "campaign",
      entityId: String(campaign._id),
      details: { planKey, platforms, actions, platformActionSettings, engagementAudience, seedAccountCount: seedAccounts.length, discoverySourceTypes, executionMode: "hosted_cloud", discoveryJobIds: discoveryJobs.map((job) => String(job._id)) },
    });
    return res.status(201).json({ campaign, discoveryJobs });
  } catch (error) {
    const status = error instanceof RecruitingPublicError ? 400 : 503;
    return res.status(status).json(recruitingErrorPayload(error, "CAMPAIGN_START_FAILED"));
  }
}
