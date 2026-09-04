import fs from "fs";
import path from "path";
import { buildNativeLeadFormQuestions } from "@/lib/facebook/nativeLeadFormQuestions";

describe("veteran Meta Instant Form schema", () => {
  it("collects only the approved initial-acquisition fields", () => {
    const questions = buildNativeLeadFormQuestions({ leadType: "veteran", audienceSegment: "veteran" });

    expect(questions.map((question) => question.type)).toEqual([
      "FULL_NAME", "PHONE", "EMAIL", "STATE", "CUSTOM", "CUSTOM",
    ]);
    expect(questions.filter((question) => question.type === "CUSTOM").map((question) => question.key)).toEqual([
      "age", "coverage_amount",
    ]);
    expect(questions).toHaveLength(6);

    const publishSource = fs.readFileSync(path.resolve("pages/api/facebook/publish-ad.ts"), "utf8");
    const consentBlock = publishSource.slice(
      publishSource.indexOf("const customDisclaimer"),
      publishSource.indexOf("const formName")
    );
    expect(consentBlock).toContain("is_required: true");
    expect(questions.length + 1).toBe(7);
  });

  it("uses the previously accepted age-range format without DOB or military-status questions", () => {
    const questions = buildNativeLeadFormQuestions({ leadType: "veteran", audienceSegment: "veteran" });
    const serialized = JSON.stringify(questions).toLowerCase();

    expect(questions.find((question) => question.type === "DOB")).toBeUndefined();
    expect(questions.find((question) => question.key === "age")?.options?.map((option) => option.value)).toEqual([
      "18-39", "40-49", "50-59", "60-69", "70-79", "80+",
    ]);
    expect(questions.find((question) => question.key === "who_needs_coverage")).toBeUndefined();
    expect(serialized).not.toMatch(/date.of.birth|military.status|military_branch|marital|health|best_call_time/);
  });

  it("keeps the requested coverage-range choices", () => {
    const questions = buildNativeLeadFormQuestions({ leadType: "veteran", audienceSegment: "veteran" });

    expect(questions.find((question) => question.key === "coverage_amount")?.options?.map((option) => option.value)).toEqual([
      "$10,000-$24,999", "$25,000-$49,999", "$50,000-$99,999", "$100,000+",
    ]);
  });
});
