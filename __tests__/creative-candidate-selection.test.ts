import {
  hasRequiredCreativeTreatmentMix,
  selectCreativeTreatmentMix,
} from "@/lib/facebook/creativeCandidateSelection";

describe("creative treatment selection", () => {
  const candidates = [
    { id: "graphic-1", visualTreatment: "graphic" },
    { id: "graphic-2", visualTreatment: "graphic" },
    { id: "photo-1", visualTreatment: "photo" },
    { id: "photo-2", visualTreatment: "photo" },
  ];

  test("a one-ad set uses a paid photo whenever the audience has a photo pool", () => {
    expect(selectCreativeTreatmentMix(candidates, 1, true).map((item) => item.id)).toEqual(["photo-1"]);
  });

  test("a multi-ad set leads with a photo and retains a graphic control", () => {
    expect(selectCreativeTreatmentMix(candidates, 3, true).map((item) => item.id)).toEqual([
      "photo-1",
      "graphic-1",
      "photo-2",
    ]);
  });

  test("lead types without a paid photo pool preserve ranked graphic order", () => {
    expect(selectCreativeTreatmentMix(candidates, 2, false).map((item) => item.id)).toEqual([
      "graphic-1",
      "graphic-2",
    ]);
  });

  test("publish validation rejects one-ad CSS-only sets when paid photos exist", () => {
    expect(hasRequiredCreativeTreatmentMix([{ visualTreatment: "graphic" }], true)).toBe(false);
    expect(hasRequiredCreativeTreatmentMix([{ visualTreatment: "photo" }], true)).toBe(true);
  });

  test("publish validation requires a photo and graphic control in multi-ad sets", () => {
    expect(hasRequiredCreativeTreatmentMix([
      { visualTreatment: "photo" },
      { visualTreatment: "photo" },
    ], true)).toBe(false);
    expect(hasRequiredCreativeTreatmentMix([
      { visualTreatment: "photo" },
      { visualTreatment: "graphic" },
    ], true)).toBe(true);
  });
});
