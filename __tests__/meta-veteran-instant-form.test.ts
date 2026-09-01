import fs from "fs";
import path from "path";
import { buildNativeLeadFormQuestions } from "@/lib/facebook/nativeLeadFormQuestions";

describe("veteran Meta Instant Form schema", () => {
  it("collects only the approved initial-acquisition fields", () => {
    const questions = buildNativeLeadFormQuestions({ leadType: "veteran", audienceSegment: "veteran" });

    expect(questions.map((question) => question.type)).toEqual([
      "FULL_NAME", "PHONE", "EMAIL", "STATE", "CUSTOM", "CUSTOM", "CUSTOM",
    ]);
    expect(questions.filter((question) => question.type === "CUSTOM").map((question) => question.key)).toEqual([
      "age", "who_needs_coverage", "coverage_amount",
    ]);
    expect(questions).toHaveLength(7);

    const publishSource = fs.readFileSync(path.resolve("pages/api/facebook/publish-ad.ts"), "utf8");
    const consentBlock = publishSource.slice(
      publishSource.indexOf("const customDisclaimer"),
      publishSource.indexOf("const formName")
    );
    expect(consentBlock).toContain("is_required: true");
    expect(questions.length + 1).toBe(8);
  });

  it("uses age ranges and never asks for removed qualification fields", () => {
    const questions = buildNativeLeadFormQuestions({ leadType: "veteran", audienceSegment: "veteran" });
    const serialized = JSON.stringify(questions).toLowerCase();

    expect(questions.find((question) => question.key === "age")?.options).toEqual([
      { key: "18_39", value: "18-39" },
      { key: "40_49", value: "40-49" },
      { key: "50_59", value: "50-59" },
      { key: "60_69", value: "60-69" },
      { key: "70_79", value: "70-79" },
      { key: "80_plus", value: "80+" },
    ]);
    expect(serialized).not.toMatch(/date.of.birth|\bdob\b|military_branch|marital|health|best_call_time/);
  });

  it("uses the requested coverage-subject and coverage-range choices", () => {
    const questions = buildNativeLeadFormQuestions({ leadType: "veteran", audienceSegment: "veteran" });

    expect(questions.find((question) => question.key === "who_needs_coverage")?.options?.map((option) => option.value)).toEqual([
      "Veteran", "Spouse", "Military family / dependent",
    ]);
    expect(questions.find((question) => question.key === "coverage_amount")?.options?.map((option) => option.value)).toEqual([
      "$10,000-$24,999", "$25,000-$49,999", "$50,000-$99,999", "$100,000+",
    ]);
  });
});
