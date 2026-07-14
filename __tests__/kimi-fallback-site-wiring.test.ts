import fs from "fs";
import path from "path";

// Source-pattern verification (same technique already used elsewhere in this
// suite, e.g. payout-double-pay-remediation.test.ts) — confirms each of the
// 5 approved sites was actually rewired to the Kimi-fallback wrapper with the
// right site tag and openaiModel, and that none of them still call
// openai.chat.completions.create directly. Full functional coverage of the
// fallback behavior itself lives in kimi-fallback-wrapper.test.ts.

const SITES: Array<{ file: string; siteTag: string; openaiModel: string; expectsJsonMode?: boolean }> = [
  { file: "lib/ai/generateCallCoachReport.ts", siteTag: "generateCallCoachReport", openaiModel: "gpt-4o", expectsJsonMode: true },
  { file: "pages/api/facebook/analyze-ad.ts", siteTag: "facebook/analyze-ad", openaiModel: "gpt-4o" },
  { file: "lib/facebook/generateActionReport.ts", siteTag: "generateActionReport", openaiModel: "gpt-4o" },
  { file: "lib/facebook/generateWeeklyMarketReport.ts", siteTag: "generateWeeklyMarketReport", openaiModel: "gpt-4o" },
  { file: "pages/api/ai/generate-summary.ts", siteTag: "generate-summary", openaiModel: "gpt-4o" },
];

describe("the 5 approved sites are wired to completeTextWithKimiFallback", () => {
  for (const site of SITES) {
    test(`${site.file}`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), site.file), "utf8");

      expect(source).toContain('from "@/lib/ai/providers/textCompletionWithFallback"');
      expect(source).toContain(`site: "${site.siteTag}"`);
      expect(source).toContain(`openaiModel: "${site.openaiModel}"`);

      // No direct OpenAI client call remains at this site.
      expect(source).not.toContain("openai.chat.completions.create");
      expect(source).not.toMatch(/new OpenAI\(/);

      if (site.expectsJsonMode) {
        expect(source).toContain('responseFormat: "json_object"');
      }
    });
  }
});

describe("sites NOT in scope for this migration are untouched", () => {
  test("lib/ai/handleAIResponse.ts (SMS auto-reply) still calls OpenAI directly — explicitly excluded", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/ai/handleAIResponse.ts"), "utf8");
    expect(source).toContain("openai.chat.completions.create");
    expect(source).not.toContain("completeTextWithKimiFallback");
  });

  test("pages/api/chat-assistant.ts still uses gpt-4o-mini directly — not moved to Kimi", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
    expect(source).toContain('const CHAT_ASSISTANT_MODEL = "gpt-4o-mini"');
    expect(source).not.toContain("completeTextWithKimiFallback");
  });

  test("already-gpt-4o-mini helper sites are untouched", () => {
    const files = [
      "pages/api/ai/suggest-drip.ts",
      "pages/api/ai/suggest-reply.ts",
      "pages/api/ai/generate-email.ts",
      "pages/api/ai/score-subject.ts",
      "pages/api/ai/optimize-campaign.ts",
      "pages/api/ai/explain-drip.ts",
      "lib/ai/memory/memoryExtractor.ts",
      "lib/ai/memory/memorySummary.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).not.toContain("completeTextWithKimiFallback");
    }
  });
});
