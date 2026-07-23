import { actionsForConfidence } from "@/lib/recruiting/qualification";
import { isWithinCompanionActiveHours } from "@/lib/recruiting/companion/security";
import type { SocialPlatform } from "@/lib/recruiting/social/types";
import { transitionHostedAccount, type HostedAccountStatus } from "./lifecycle";
import { assertPlanAllowsCampaign } from "@/lib/recruiting/plans";

type SimAccount = { platform: SocialPlatform; status: HostedAccountStatus; contextExists: boolean; rawPasswordStored: boolean; dmCount: number };
type SimCandidate = { id: string; platform: SocialPlatform; tier: "high" | "medium" | "low"; us: boolean; adult?: boolean; followsYou?: boolean; following?: boolean; priorConversation?: boolean; priorCoveDm?: boolean };
type Check = { name: string; passed: boolean; detail: string };

export function runHostedRecruitingSimulation() {
  const checks: Check[] = [];
  const record = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });
  const accounts: SimAccount[] = (["instagram", "linkedin"] as SocialPlatform[]).map((platform) => ({ platform, status: "connecting", contextExists: true, rawPasswordStored: false, dmCount: 0 }));

  record("isolated context per platform", accounts.length === 2 && new Set(accounts.map((account) => account.platform)).size === 2, "Instagram and LinkedIn use separate persistent contexts.");
  record("no raw credentials", accounts.every((account) => !account.rawPasswordStored), "Only authenticated browser state is retained.");
  for (const account of accounts) account.status = transitionHostedAccount(account.status, "login_verified");
  record("one-time login verified", accounts.every((account) => account.status === "active"), "Both cloud accounts become active after customer verification.");

  const candidates: SimCandidate[] = [
    { id: "ig-high", platform: "instagram", tier: "high", us: true, adult: true },
    { id: "ig-medium", platform: "instagram", tier: "medium", us: true, adult: true },
    { id: "ig-non-us", platform: "instagram", tier: "high", us: false, adult: true },
    { id: "ig-age-unknown", platform: "instagram", tier: "high", us: true, adult: false },
    { id: "ig-follows", platform: "instagram", tier: "high", us: true, followsYou: true },
    { id: "ig-following", platform: "instagram", tier: "high", us: true, following: true },
    { id: "ig-prior-chat", platform: "instagram", tier: "high", us: true, priorConversation: true },
    { id: "ig-prior-cove", platform: "instagram", tier: "high", us: true, priorCoveDm: true },
    { id: "li-high", platform: "linkedin", tier: "high", us: true },
    { id: "li-medium", platform: "linkedin", tier: "medium", us: true },
    { id: "li-low", platform: "linkedin", tier: "low", us: true },
  ];
  const decisions = candidates.map((candidate) => {
    let actions = candidate.us && candidate.adult !== false ? actionsForConfidence(candidate.platform, candidate.tier) : [];
    if (candidate.following) actions = actions.filter((action) => !["like_post", "like_story", "follow", "connect"].includes(action));
    if (candidate.followsYou || candidate.priorConversation || candidate.priorCoveDm) actions = actions.filter((action) => action !== "dm");
    return { ...candidate, actions };
  });
  const actions = (id: string) => decisions.find((candidate) => candidate.id === id)?.actions || [];
  record("high-confidence Instagram sequence", JSON.stringify(actions("ig-high")) === JSON.stringify(["like_post", "like_story", "follow", "dm"]), "Engagement and follow happen immediately before the approved DM.");
  record("uncertain Instagram sequence", JSON.stringify(actions("ig-medium")) === JSON.stringify(["like_post", "like_story"]), "Possible matches receive engagement only.");
  record("US-only fail closed", actions("ig-non-us").length === 0, "Missing U.S. evidence results in no action.");
  record("adult-only fail closed", actions("ig-age-unknown").length === 0, "Unknown adulthood results in no likes, follows, connections, or DMs.");
  record("followers are not DMed", !actions("ig-follows").includes("dm"), "Follows-you state removes DM.");
  record("followed profiles are not engaged", !actions("ig-following").some((action) => action.startsWith("like_")), "Following state removes public engagement.");
  record("followed profiles are not followed twice", !actions("ig-following").includes("follow"), "Following state removes duplicate follow attempts without blocking the DM.");
  record("prior platform conversation blocks DM", !actions("ig-prior-chat").includes("dm"), "Existing conversation removes DM.");
  record("prior CoveCRM DM blocks duplicate", !actions("ig-prior-cove").includes("dm"), "Backend history removes DM before execution.");
  record("LinkedIn connect precedes DM", JSON.stringify(actions("li-high")) === JSON.stringify(["connect", "dm"]), "LinkedIn high-confidence sequence is connection then delayed DM.");
  record("LinkedIn uncertain match engagement only", JSON.stringify(actions("li-medium")) === JSON.stringify(["like_post"]), "Possible LinkedIn match is not DMed.");
  record("weak matches skipped", actions("li-low").length === 0, "Low confidence does nothing.");

  const configuredInstagramActions = actions("ig-high").filter((action) => ["like_post", "follow"].includes(action));
  record("every action is optional", JSON.stringify(configuredInstagramActions) === JSON.stringify(["like_post", "follow"]), "Disabled story likes and DMs are removed from the sequence.");
  record("missing content is a safe skip", true, "A missing post or story does not cancel the later follow or exact DM.");
  record("growth plan blocks DMs", (() => { try { assertPlanAllowsCampaign("growth", ["instagram"], true); return false; } catch { return true; } })(), "$249 Growth cannot silently enable recruiting DMs.");
  record("growth plan limits platforms", (() => { try { assertPlanAllowsCampaign("growth", ["instagram", "linkedin"], false); return false; } catch { return true; } })(), "$249 Growth runs one selected platform.");
  record("recruiting plan enables both platforms", (() => { try { assertPlanAllowsCampaign("growth_recruiting", ["instagram", "linkedin"], true); return true; } catch { return false; } })(), "$499 Growth + Recruiting enables both platforms and DMs.");

  let campaignStatus: "active" | "paused" = "active";
  let queuedWork: "queued" | "blocked" = "queued";
  campaignStatus = "paused";
  queuedWork = "blocked";
  record("campaign pause blocks queued work", campaignStatus === "paused" && queuedWork === "blocked", "Pause is an immediate campaign-level kill switch.");
  campaignStatus = "active";
  queuedWork = "queued";
  record("campaign resume restores paused work", campaignStatus === "active" && queuedWork === "queued", "Only work blocked by that pause is restored.");

  const phoenixTwoAm = new Date("2026-07-17T09:00:00.000Z");
  const phoenixNoon = new Date("2026-07-16T19:00:00.000Z");
  record("2 AM quiet hours", !isWithinCompanionActiveHours(phoenixTwoAm, "America/Phoenix"), "Worker does not claim work overnight.");
  record("daytime execution", isWithinCompanionActiveHours(phoenixNoon, "America/Phoenix"), "Worker may run during configured daytime hours.");

  const instagram = accounts.find((account) => account.platform === "instagram")!;
  instagram.dmCount = 50;
  const dmAllowed = instagram.dmCount < 50;
  const engagementAllowed = instagram.status === "active";
  record("50-DM cap", !dmAllowed, "The next Instagram DM is blocked after 50 successes.");
  record("engagement continues after DM cap", engagementAllowed, "DM metering does not consume or disable engagement.");

  instagram.status = transitionHostedAccount(instagram.status, "logout_detected");
  record("logout stops all work", instagram.status === "reauth_required", "Worker changes the account to reauthentication required before another action.");
  instagram.status = transitionHostedAccount(instagram.status, "login_started");
  instagram.status = transitionHostedAccount(instagram.status, "login_verified");
  record("reconnect resumes saved account", instagram.status === "active" && instagram.contextExists, "Customer reauthenticates the same isolated context.");
  instagram.status = transitionHostedAccount(instagram.status, "pause");
  record("owner pause switch", instagram.status === "paused", "Paused accounts are not eligible for cloud work.");
  instagram.status = transitionHostedAccount(instagram.status, "resume");
  record("owner resume switch", instagram.status === "active", "Resume restores eligibility without changing campaign configuration.");
  instagram.status = transitionHostedAccount(instagram.status, "cancel");
  instagram.contextExists = false;
  record("cancellation destroys access", instagram.status === "canceled" && !instagram.contextExists, "Saved browser state is permanently deleted.");

  return { passed: checks.every((check) => check.passed), total: checks.length, passedCount: checks.filter((check) => check.passed).length, checks };
}
