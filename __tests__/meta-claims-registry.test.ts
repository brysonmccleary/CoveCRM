import MetaLaunchArchive from "@/models/MetaLaunchArchive";
import {
  buildLandingPageSnapshot,
  applyTenantClaimApprovals,
  evaluateCreativeClaims,
  RegisteredClaim,
  requiredQualifierTextsForCreative,
} from "@/lib/facebook/claimsRegistry";
import { writeImmutableMetaLaunchArchive } from "@/lib/facebook/archiveMetaLaunch";

const future = "2030-01-01T00:00:00.000Z";
const clean: RegisteredClaim = {
  claimText: "No Medical Exam",
  pattern: "no\\s+medical\\s+exam",
  classification: "CLEAN",
  eligibleProducts: ["final_expense"],
  carrierBasis: "Simplified issue",
  states: ["*"],
  version: "v1",
  expiresAt: future,
  approvedBy: "compliance",
};
const qualified: RegisteredClaim = {
  claimText: "No 2 Year Wait",
  pattern: "no\\s+2[ -]?year\\s+wait",
  classification: "QUALIFIED",
  eligibleProducts: ["final_expense"],
  carrierBasis: "Level benefit",
  requiredQualifierText: "For those who qualify based on health.",
  states: ["AZ", "TX"],
  version: "v2",
  expiresAt: future,
  approvedBy: "compliance",
};

describe("Meta claims advisory audit", () => {
  it("allows a current CLEAN claim without a landing qualifier", () => {
    expect(evaluateCreativeClaims({
      creativeText: "No medical exam",
      leadType: "final_expense",
      states: ["AZ"],
      landingPageSnapshot: "Landing page",
      claims: [clean],
      now: new Date("2026-01-01"),
    }).qualifierTexts).toEqual([]);
  });

  it("allows a QUALIFIED claim only when the rendered snapshot contains its disclosure", () => {
    const qualifierTexts = requiredQualifierTextsForCreative("No 2-year wait", [qualified]);
    const snapshot = buildLandingPageSnapshot({ headline: "Plan Ahead", qualifierTexts });
    expect(evaluateCreativeClaims({
      creativeText: "No 2-year wait",
      leadType: "final_expense",
      states: ["TX", "AZ"],
      landingPageSnapshot: snapshot,
      claims: [qualified],
      now: new Date("2026-01-01"),
    }).matchedClaims).toHaveLength(1);
  });

  it("warns without blocking when a QUALIFIED claim lacks the disclosure", () => {
    expect(evaluateCreativeClaims({
      creativeText: "No 2 year wait",
      leadType: "final_expense",
      states: ["AZ"],
      landingPageSnapshot: "Headline only",
      claims: [qualified],
      now: new Date("2026-01-01"),
    }).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/rendered landing-page disclosure/i)]));
  });

  it("warns without blocking for expired and unregistered claims", () => {
    expect(evaluateCreativeClaims({
      creativeText: "No medical exam",
      leadType: "final_expense",
      states: ["AZ"],
      landingPageSnapshot: "Landing",
      claims: [{ ...clean, expiresAt: "2025-01-01" }],
      now: new Date("2026-01-01"),
    }).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/expired/i)]));
    expect(evaluateCreativeClaims({
      creativeText: "Coverage up to $75,000",
      leadType: "final_expense",
      states: ["AZ"],
      landingPageSnapshot: "Landing",
      claims: [],
      now: new Date("2026-01-01"),
    }).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Unregistered claim/i)]));
  });

  it("records a warning for a system seed without blocking publish", () => {
    expect(evaluateCreativeClaims({
      creativeText: "No medical exam",
      leadType: "final_expense",
      states: ["AZ"],
      landingPageSnapshot: "Landing",
      claims: [{ ...clean, approvedBy: "system_seed_v1" }],
      now: new Date("2026-01-01"),
    }).warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no current CoveCRM approval/i)]));
  });

  it("applies only a current tenant-specific approval with evidence", () => {
    const approved = applyTenantClaimApprovals(
      [{ ...clean, approvedBy: "system_seed_v1" }],
      [{
        claimText: clean.claimText,
        claimVersion: clean.version,
        eligibleProducts: ["final_expense"],
        states: ["AZ"],
        carrierBasis: "Carrier form and underwriting guide",
        approvalEvidence: "https://example.com/carrier-approval.pdf",
        approvedBy: "compliance@example.com",
        approvedAt: "2026-01-01",
        expiresAt: "2026-12-31",
        revokedAt: null,
      }],
      new Date("2026-06-01")
    );
    expect(approved[0]).toEqual(expect.objectContaining({
      approvedBy: "compliance@example.com",
      approvalEvidence: "https://example.com/carrier-approval.pdf",
      states: ["AZ"],
    }));
  });

  it("writes an immutable archive atomically with the landing-page snapshot", async () => {
    const findOneAndUpdate = jest.fn().mockResolvedValue({ _id: "archive-1" });
    await writeImmutableMetaLaunchArchive({
      userEmail: "TENANT@example.com",
      launchFingerprint: "fp-1",
      campaignId: "campaign-1",
      landingPageSnapshot: "Headline\nFor those who qualify based on health.",
      adCopy: [{ headline: "No 2 Year Wait" }],
      images: [{ dataUrl: "data:image/png;base64,exact" }],
    }, { findOneAndUpdate });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { userEmail: "tenant@example.com", launchFingerprint: "fp-1" },
      { $setOnInsert: expect.objectContaining({ landingPageSnapshot: expect.stringContaining("qualify") }) },
      { upsert: true, new: true }
    );
    expect((MetaLaunchArchive.schema.path("landingPageSnapshot") as any).options.immutable).toBe(true);
  });
});
