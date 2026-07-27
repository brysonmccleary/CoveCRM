import fs from "fs";
import path from "path";
import { enabledCallAnalysis } from "@/lib/ai/callAnalysisSettings";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("automatic call analysis", () => {
  test("overview and coaching toggles remain independent", () => {
    expect(enabledCallAnalysis(null)).toEqual({ overview: true, coaching: false });
    expect(enabledCallAnalysis({ aiCallOverviewEnabled: true, aiCallCoachingEnabled: false }))
      .toEqual({ overview: true, coaching: false });
    expect(enabledCallAnalysis({ aiCallOverviewEnabled: false, aiCallCoachingEnabled: true }))
      .toEqual({ overview: false, coaching: true });
    expect(enabledCallAnalysis({ aiCallOverviewEnabled: false, aiCallCoachingEnabled: false }))
      .toEqual({ overview: false, coaching: false });
  });

  test("saved settings can enable both features without a forced coaching override", () => {
    const settingsApi = read("pages/api/settings/ai-settings.ts");
    expect(settingsApi).toContain('"aiCallOverviewEnabled"');
    expect(settingsApi).toContain('"aiCallCoachingEnabled"');
    expect(settingsApi).not.toContain("update.aiCallCoachingEnabled = false");
  });

  test("completed recording processing invokes automatic coaching and respects settings", () => {
    const processor = read("pages/api/calls/transcribe-recording.ts");
    expect(processor).toContain("enabledCallAnalysis(settings)");
    expect(processor).toContain("generateCallCoachReport(String(call._id), callUserEmail, coachingLeadName)");
    expect(processor).toContain('reason: "call_analysis_disabled"');
    expect(processor).toContain('reason: "ai_not_entitled"');
  });

  test("existing dialer coaching reports cannot be billed as regular calls on a retry", () => {
    const generator = read("lib/ai/generateCallCoachReport.ts");
    expect(generator).toContain("billingOrigin: (existing as any).billingOrigin");
    expect(generator).toContain('if (args.billingOrigin === "dialer") return');
  });

  test("recording webhook is no longer blocked by the legacy global summary flag", () => {
    const webhook = read("pages/api/voice/recording-webhook.ts");
    expect(webhook).not.toContain("CALL_AI_SUMMARY_ENABLED");
    expect(webhook).toContain("const aiAllowed = gate.ok");
  });

  test("lead screen has no manual generation buttons", () => {
    const leadPage = read("pages/lead/[id].tsx");
    const coach = read("components/CallCoachReport.tsx");
    expect(leadPage).not.toContain("Generate Overview");
    expect(coach).not.toContain("Generate Coach Report");
    expect(coach).toContain("processed automatically");
  });
});
