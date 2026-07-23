import { isRecruitingAdminEmail, RECRUITING_ADMIN_EMAIL } from "@/lib/recruiting/access";
import { socialAdapters } from "@/lib/recruiting/social/adapters";
import {
  buildRecipientLock,
  createSimulationDraft,
  listProviderCapabilities,
  normalizeProfileUrl,
  validateRecruitingAudienceDescription,
  validateCampaignInput,
} from "@/lib/recruiting/social/policy";
import type { SocialTargetSnapshot } from "@/lib/recruiting/social/types";
import { hasUnitedStatesLocationEvidence } from "@/lib/recruiting/social/us-location";
import {
  actionsForConfidence,
  applyEngagementAudiencePreference,
  applyAdultSafetyGate,
  confidenceTierForScore,
  explicitEngagementAudienceFromEvidence,
} from "@/lib/recruiting/qualification";
import {
  buildDiscoverySearchQueries,
  instagramSeedProfileUrl,
  normalizeDiscoverySourceTypes,
  normalizeSeedAccounts,
  planDiscoverySource,
} from "@/lib/recruiting/cloud/discovery-sources";
import { enabledActionsForPlatform, normalizePlatformActionSettings } from "@/lib/recruiting/action-settings";
import { assertPlanAllowsCampaign, normalizeRecruitingPlan } from "@/lib/recruiting/plans";

const target: SocialTargetSnapshot = {
  platform: "linkedin",
  externalRecipientId: "urn:li:person:target-123",
  profileUrl: "https://www.linkedin.com/in/jordan-example/?trk=search",
  displayName: "Jordan Example",
  headline: "Automotive sales manager",
  capturedAt: "2026-07-16T12:00:00.000Z",
};

describe("recruiting social safety boundaries", () => {
  test("only the named admin can access recruiting", () => {
    expect(isRecruitingAdminEmail(RECRUITING_ADMIN_EMAIL)).toBe(true);
    expect(isRecruitingAdminEmail(` ${RECRUITING_ADMIN_EMAIL.toUpperCase()} `)).toBe(true);
    expect(isRecruitingAdminEmail("admin@example.com")).toBe(false);
    expect(isRecruitingAdminEmail(null)).toBe(false);
  });

  test("profile URLs must be HTTPS and match the selected platform exactly", () => {
    expect(normalizeProfileUrl("linkedin", target.profileUrl)).toBe("https://linkedin.com/in/jordan-example");
    expect(() => normalizeProfileUrl("linkedin", "https://instagram.com/jordan")).toThrow("linkedin.com");
    expect(() => normalizeProfileUrl("instagram", "http://instagram.com/jordan")).toThrow("HTTPS");
    expect(() => normalizeProfileUrl("instagram", "https://instagram.com.evil.example/jordan")).toThrow("instagram.com");
    expect(() => normalizeProfileUrl("linkedin", "https://linkedin.com/feed")).toThrow("exact /in/");
    expect(() => normalizeProfileUrl("instagram", "https://instagram.com/direct/inbox")).toThrow("exact public profile");
  });

  test("recipient lock changes if any identity-bearing target field changes", () => {
    const original = buildRecipientLock(target);
    expect(buildRecipientLock({ ...target, externalRecipientId: "urn:li:person:other" })).not.toBe(original);
    expect(buildRecipientLock({ ...target, displayName: "Someone Else" })).not.toBe(original);
    expect(buildRecipientLock({ ...target, capturedAt: "2026-07-16T12:00:01.000Z" })).not.toBe(original);
  });

  test("same campaign, action, recipient, and copy produce an exact idempotency key", () => {
    const first = createSimulationDraft({ campaignId: "campaign-1", actionType: "dm", target, message: "Would you be open to hearing more?" });
    const second = createSimulationDraft({ campaignId: "campaign-1", actionType: "dm", target, message: "Would you be open to hearing more?" });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.recipientLock).toBe(first.recipientLock);
    expect(second.executionMode).toBe("simulation");
  });

  test("unsupported platform actions fail closed", () => {
    expect(() => createSimulationDraft({ campaignId: "campaign-1", actionType: "like_story", target, message: "" }))
      .toThrow("No approved LinkedIn story capability");
    expect(listProviderCapabilities().filter((capability) => capability.mode === "browser_companion"))
      .toHaveLength(0);
  });

  test("misleading employment and income claims are rejected", () => {
    expect(() => validateCampaignInput({
      name: "Sales campaign",
      idealRecruit: "Experienced sales professionals who want a new opportunity.",
      category: "Sales",
      platforms: ["linkedin"],
      actions: ["dm"],
      openingMessage: "You are hired and guaranteed income of $100,000.",
    })).toThrow("unsupported employment or income claim");
    expect(() => createSimulationDraft({
      campaignId: "campaign-1",
      actionType: "dm",
      target,
      message: "This role has guaranteed earnings.",
    })).toThrow("unsupported employment or income claim");
  });

  test("recruiting audiences allow job-related traits and reject protected traits", () => {
    expect(validateRecruitingAudienceDescription("Commission salespeople with door-to-door experience in Arizona."))
      .toContain("door-to-door");
    expect(() => validateRecruitingAudienceDescription("Young male insurance agents under 30."))
      .toThrow("protected personal traits");
  });

  test("location evidence is fail-closed to the United States", () => {
    expect(hasUnitedStatesLocationEvidence("Phoenix, Arizona, United States")).toBe(true);
    expect(hasUnitedStatesLocationEvidence("Austin, Texas Area")).toBe(true);
    expect(hasUnitedStatesLocationEvidence("Toronto, Ontario, Canada")).toBe(false);
    expect(hasUnitedStatesLocationEvidence("Location not listed")).toBe(false);
  });

  test("confidence tiers produce strategic action sequences", () => {
    expect(confidenceTierForScore(0.85)).toBe("high");
    expect(confidenceTierForScore(0.6)).toBe("medium");
    expect(confidenceTierForScore(0.59)).toBe("low");
    expect(actionsForConfidence("instagram", "high")).toEqual(["like_post", "like_story", "follow", "dm"]);
    expect(actionsForConfidence("instagram", "medium")).toEqual(["like_post", "like_story"]);
    expect(actionsForConfidence("instagram", "low")).toEqual([]);
    expect(actionsForConfidence("linkedin", "high")).toEqual(["connect", "dm"]);
    expect(actionsForConfidence("linkedin", "medium")).toEqual(["like_post"]);
  });

  test("engagement preference affects likes only and never guesses from names", () => {
    expect(explicitEngagementAudienceFromEvidence("Taylor Smith · Insurance agent · Phoenix, Arizona")).toBe("unknown");
    expect(explicitEngagementAudienceFromEvidence("Taylor Smith · she/her · Insurance agent")).toBe("women");
    expect(explicitEngagementAudienceFromEvidence("Taylor Smith · he/him · Insurance agent")).toBe("men");
    expect(applyEngagementAudiencePreference(["like_post", "like_story", "dm"], "women", "she/her · sales agent"))
      .toEqual(["like_post", "like_story", "dm"]);
    expect(applyEngagementAudiencePreference(["like_post", "like_story", "dm"], "women", "he/him · sales agent"))
      .toEqual(["dm"]);
    expect(applyEngagementAudiencePreference(["like_post", "dm"], "men", "Jordan · sales agent"))
      .toEqual(["dm"]);
  });

  test("adult safety gate blocks every action for minors and unknown ages", () => {
    const actions = ["like_post", "like_story", "dm"] as const;
    expect(applyAdultSafetyGate([...actions], "adult_verified")).toEqual(actions);
    expect(applyAdultSafetyGate([...actions], "minor_or_youth")).toEqual([]);
    expect(applyAdultSafetyGate([...actions], "unknown")).toEqual([]);
  });

  test("every platform action including DMs can be independently disabled", () => {
    const settings = normalizePlatformActionSettings({
      instagram: { like_post: true, like_story: false, follow: true, dm: false },
      linkedin: { like_post: false, connect: false, dm: true },
    });
    expect(enabledActionsForPlatform(settings, "instagram")).toEqual(["like_post", "follow"]);
    expect(enabledActionsForPlatform(settings, "linkedin")).toEqual(["dm"]);
  });

  test("pricing tiers enforce platform and DM entitlements server-side", () => {
    expect(normalizeRecruitingPlan("growth")).toBe("growth");
    expect(normalizeRecruitingPlan("not-a-plan")).toBe("growth_recruiting");
    expect(() => assertPlanAllowsCampaign("growth", ["instagram"], false)).not.toThrow();
    expect(() => assertPlanAllowsCampaign("growth", ["instagram", "linkedin"], false)).toThrow("1 platform");
    expect(() => assertPlanAllowsCampaign("growth", ["instagram"], true)).toThrow("Growth + Recruiting");
    expect(() => assertPlanAllowsCampaign("growth_recruiting", ["instagram", "linkedin"], true)).not.toThrow();
  });

  test("seed accounts and professional discovery sources are normalized and rotated into U.S. searches", () => {
    expect(normalizeSeedAccounts("@vivint\n@edmylett\n@vivint\n<script>bad</script>"))
      .toEqual(["@vivint", "@edmylett"]);
    expect(instagramSeedProfileUrl("@vivint")).toBe("https://www.instagram.com/vivint/");
    expect(instagramSeedProfileUrl("https://www.linkedin.com/company/vivint/")).toBeNull();
    const sourceTypes = normalizeDiscoverySourceTypes(["university_college_athletes", "not_allowed"]);
    expect(sourceTypes).toEqual(["university_college_athletes"]);
    expect(buildDiscoverySearchQueries({
      platform: "linkedin",
      audienceDescription: "competitive salespeople",
      location: "United States",
      examples: ["athletes"],
      sourceTypes,
      seedAccounts: ["Vivint"],
    })).toEqual(expect.arrayContaining([
      expect.stringContaining("United States"),
      expect.stringContaining("university college athlete"),
      expect.stringContaining("Vivint"),
    ]));
    const instagramPlans = Array.from({ length: 10 }, (_, cursor) =>
      planDiscoverySource("instagram", ["baseline", "college athletes"], ["@vivint", "@edmylett"], ["@strongmatch"], cursor));
    expect(instagramPlans.map((plan) => plan.seedPool))
      .toEqual(["primary", "primary", "primary", "primary", "primary", "primary", "primary", "derived", null, null]);
    expect(instagramPlans.slice(0, 7).map((plan) => plan.seedSourceCursor)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(planDiscoverySource("instagram", ["baseline"], ["@vivint"], ["@strongmatch"], 10).seedSourceCursor).toBe(7);
    expect(planDiscoverySource("linkedin", ["baseline", "college athletes"], ["Vivint"], [], 1))
      .toEqual({ activeQuery: "college athletes", seedPool: null, seedSourceCursor: 0 });
  });

  test("simulation adapters never make provider requests and reject mode mismatch", async () => {
    const draft = createSimulationDraft({ campaignId: "campaign-1", actionType: "dm", target, message: "Would you be open to hearing more?" });
    await expect(socialAdapters.linkedin.simulate(draft)).resolves.toEqual(expect.objectContaining({
      ok: true,
      simulated: true,
      providerRequestMade: false,
    }));
    await expect(socialAdapters.instagram.simulate(draft)).rejects.toThrow("mismatched");
    await expect(socialAdapters.linkedin.simulate({ ...draft, executionMode: "browser_companion" })).rejects.toThrow("non-simulation");
  });
});
