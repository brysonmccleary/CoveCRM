import fs from "fs";
import path from "path";

const startSource = fs.readFileSync(
  path.join(process.cwd(), "pages/api/a2p/start.ts"),
  "utf8",
);
const resumeSource = fs.readFileSync(
  path.join(process.cwd(), "lib/a2p/resumeAutomation.ts"),
  "utf8",
);

function statusSet(source: string, name: string) {
  const body = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`))?.[1] || "";
  return new Set(Array.from(body.matchAll(/"([A-Z_]+)"/g), (match) => match[1]));
}

describe("surgical A2P sequencing", () => {
  const submitted = statusSet(resumeSource, "TRUSTHUB_SUBMITTED");
  const failed = statusSet(resumeSource, "TRUSTHUB_FAILED");

  it("allows a successfully submitted Trust Product that is still in review", () => {
    expect(submitted.has("IN_REVIEW")).toBe(true);
    expect(failed.has("IN_REVIEW")).toBe(false);
    expect(resumeSource).toContain("TRUSTHUB_SUBMITTED.has(trustProductStatus)");
  });

  it.each(["FAILED", "REJECTED", "TWILIO_REJECTED"])(
    "blocks a Trust Product with status %s",
    (status) => expect(failed.has(status)).toBe(true),
  );

  it("keeps Campaign creation behind Brand approval", () => {
    expect(startSource).toContain(
      "const canCreateCampaign = BRAND_OK_FOR_CAMPAIGN.has(normalizedBrandStatus)",
    );
    expect(resumeSource).toContain(
      "if (!campaignSid && brandSid && BRAND_OK_FOR_CAMPAIGN.has(brandStatus))",
    );
  });

  it("returns canceled customers before Twilio client resolution", () => {
    const continuation = resumeSource.slice(
      resumeSource.indexOf("function resumeA2PAutomationForUserEmail"),
    );
    expect(continuation.indexOf('=== "canceled"')).toBeGreaterThanOrEqual(0);
    expect(continuation.indexOf('=== "canceled"')).toBeLessThan(
      continuation.indexOf("getClientForUser"),
    );
  });
});
