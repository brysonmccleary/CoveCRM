import fs from "fs";
import path from "path";
import User from "@/models/User";
import { validateLaunchInput } from "@/pages/api/facebook/validate-launch";
import {
  DEFAULT_META_CLAIMS,
  evaluateCreativeClaims,
  ownerApprovedMetaClaimWarnings,
} from "@/lib/facebook/claimsRegistry";
import { ownerApprovedCreativeMixWarnings } from "@/lib/facebook/creativeCandidateSelection";
import { preserveOwnerApprovedMetaCopy, buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";
import { isCreativeExclusivityPolicyError, CREATIVE_ALREADY_USED_MESSAGE } from "@/lib/facebook/creativeUsage";
import { preflightMetaLaunch } from "@/lib/facebook/metaLaunchPreflight";
import { classifyMetaHealthError } from "@/lib/meta/metaHealth";

jest.mock("@/lib/mongooseConnect", () => ({ __esModule: true, default: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock("@/lib/meta/capi", () => ({
  hasRecentMetaQualitySignal: jest.fn().mockResolvedValue(true),
  isCapiEnabled: jest.fn().mockReturnValue(true),
}));

function response(body: any, ok = true) {
  return { ok, json: jest.fn().mockResolvedValue(body) } as any;
}

describe("owner-approved Meta launch authority", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (User.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "user-1",
          metaSystemUserToken: "token",
          metaAdAccountId: "act_123",
          metaPageId: "page-1",
          metaDatasetId: "725252660577483",
        }),
      }),
    });
  });

  test("unknown claim becomes a warning instead of a Cove launch veto", () => {
    const evaluation = evaluateCreativeClaims({
      creativeText: "No medical exam",
      leadType: "veteran",
      states: ["AZ"],
      landingPageSnapshot: "Owner-approved landing page",
      claims: [],
      now: new Date("2026-08-30T00:00:00Z"),
    });
    expect(evaluation.warnings).toEqual([
      expect.stringMatching(/Unregistered claim detected/i),
    ]);
    expect(ownerApprovedMetaClaimWarnings(evaluation)).toEqual([
      expect.stringMatching(/Unregistered claim detected/i),
    ]);
  });

  test("missing capability record becomes a warning instead of a Cove launch veto", () => {
    const publishSource = fs.readFileSync(path.resolve("pages/api/facebook/publish-ad.ts"), "utf8");
    expect(publishSource).not.toContain("productCapability");
    const evaluation = evaluateCreativeClaims({
      creativeText: "No Medical Exam",
      leadType: "veteran",
      states: ["AZ"],
      landingPageSnapshot: "Owner-approved landing page",
      claims: DEFAULT_META_CLAIMS,
      now: new Date("2026-08-30T00:00:00Z"),
    });
    expect(evaluation.warnings.length).toBeGreaterThan(0);
    expect(ownerApprovedMetaClaimWarnings(evaluation).join(" ")).toMatch(/approval record|stored evidence/i);
  });

  test("creative regex and library metadata mismatches return warnings while technical structure still validates", async () => {
    await expect(validateLaunchInput({
      userEmail: "owner@example.com",
      body: {
        campaignName: "Owner Approved Veteran Ad",
        leadType: "veteran",
        audienceSegment: "veteran",
        campaignType: "hosted_funnel",
        performanceGoal: "LEAD_GENERATION",
        licensedStates: ["AZ"],
        dailyBudgetCents: 1000,
        funnelType: "lead_form",
        winningFamilyId: "owner_custom_family",
        variationType: "owner_custom",
        uniquenessFingerprint: "owner_custom_fingerprint",
        vendorStyleTag: "owner_custom",
        drafts: [{
          primaryText: "Owner-approved protection options for your family.",
          headline: "Protect What Matters",
          description: "Review your options.",
        }],
      },
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      policyWarnings: expect.arrayContaining([
        expect.stringMatching(/creative-library warning/i),
        expect.stringMatching(/audience\/copy warning/i),
      ]),
      structure: expect.objectContaining({
        campaign: expect.objectContaining({ objective: "OUTCOME_LEADS" }),
      }),
    }));
  });

  test("photo/graphic mix is a warning and exact owner-approved copy is not rewritten", () => {
    expect(ownerApprovedCreativeMixWarnings([{ visualTreatment: "graphic" }], true)).toEqual([
      expect.stringMatching(/owner-approved Meta launch continued/i),
    ]);
    const copy = {
      primaryText: "Tap to qualify — No 2-Year Wait.",
      headline: "LOCK IN YOUR RATE",
      description: "  Keep this spacing and wording.  ",
    };
    expect(preserveOwnerApprovedMetaCopy(copy)).toEqual(copy);
  });

  test("global creative exclusivity is identifiable as Cove policy, not a technical Meta failure", () => {
    expect(isCreativeExclusivityPolicyError(new Error(CREATIVE_ALREADY_USED_MESSAGE))).toBe(true);
    expect(isCreativeExclusivityPolicyError(new Error("Meta creative create failed"))).toBe(false);
  });

  test("missing Meta-required creative content remains blocking", () => {
    expect(() => buildCampaignStructure({
      campaignName: "Invalid",
      leadType: "veteran",
      audienceSegment: "veteran",
      licensedStates: ["AZ"],
      dailyBudgetCents: 1000,
      creatives: [],
    })).toThrow("Template creative required");
  });

  test("Meta API rejection remains blocking", async () => {
    const structure = buildCampaignStructure({
      campaignName: "Technical Validation",
      leadType: "veteran",
      audienceSegment: "veteran",
      licensedStates: ["AZ"],
      dailyBudgetCents: 1000,
      creatives: [{ primaryText: "Veteran coverage options.", headline: "Veteran Coverage" }],
    });
    const fetchImpl = jest.fn().mockResolvedValue(response({
      error: { message: "Invalid payload", error_user_msg: "Meta rejected this payload" },
    }, false));
    await expect(preflightMetaLaunch({
      adAccountId: "123",
      accessToken: "token",
      campaign: structure.campaign,
      adSet: structure.adSet,
      pageId: "page-1",
      datasetId: "725252660577483",
      campaignType: "hosted_funnel",
      fetchImpl: fetchImpl as any,
    })).rejects.toThrow("Meta rejected this payload");
  });

  test("authentication and security failures remain classified as blocking Meta setup failures", () => {
    expect(classifyMetaHealthError('OAuthException: invalid access token, code: 190')).toEqual(expect.objectContaining({
      status: "reconnectNeeded",
      reconnectNeeded: true,
    }));
    expect(classifyMetaHealthError("authenticate your account because of recent activity")).toEqual(expect.objectContaining({
      status: "securityVerificationRequired",
      cooldown: true,
    }));
  });

  test("publish route wires policy findings as warnings and retains technical failures", () => {
    const source = fs.readFileSync(path.resolve("pages/api/facebook/publish-ad.ts"), "utf8");
    expect(source).toContain("ownerApprovedMetaClaimWarnings");
    expect(source).toContain("ownerApprovedCreativeMixWarnings");
    expect(source).toContain("isCreativeExclusivityPolicyError");
    expect(source).not.toContain("Launch blocked by product/claim validation");
    expect(source).toContain("Meta campaign create failed");
    expect(source).toContain("Meta ad set create failed");
    expect(source).toContain("Meta creative create failed");
    expect(source).toContain("Meta ad create failed");
  });
});
