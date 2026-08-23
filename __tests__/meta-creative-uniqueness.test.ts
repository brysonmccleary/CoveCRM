import {
  buildCreativeGenerationSignature,
  buildPublishedCreativeFingerprint,
} from "@/lib/facebook/creativeIdentity";
import {
  claimCreativeSet,
  finalizeCreativeReservation,
  CREATIVE_ALREADY_USED_MESSAGE,
} from "@/lib/facebook/creativeUsage";
import {
  generateWinningVariantList,
  type WinnerLeadType,
} from "@/lib/facebook/winningAdLibrary";

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function generatedDraft(variant: any, leadType: WinnerLeadType, user: string, batch: number, index: number) {
  const seed = `${user}|${leadType}|${batch}|${index}`;
  const visualVariantIndex = hashString(seed) % 40;
  const photoPercent = leadType === "trucker" ? 75 : leadType === "veteran" ? 60 : leadType === "mortgage_protection" ? 65 : 0;
  const draft = {
    ...variant,
    leadType,
    audienceSegment: "standard",
    winningFamilyId: variant.familyId,
    creativeArchetype: variant.archetype,
    visualVariantIndex,
    visualTreatment: hashString(`${seed}|treatment`) % 100 < photoPercent ? "photo" : "graphic",
  };
  return { ...draft, creativeSignature: buildCreativeGenerationSignature(draft) };
}

function createUsageModel() {
  const records = new Map<string, any>();
  const signatures = new Map<string, string>();
  return {
    records,
    init: jest.fn().mockResolvedValue(undefined),
    findOneAndUpdate: jest.fn(async (filter: any, update: any) => {
      const fingerprint = filter.creativeFingerprint;
      const signature = update.$setOnInsert?.generationSignature;
      const existing = records.get(fingerprint);
      if (existing?.status === "published" || (signature && signatures.has(signature) && signatures.get(signature) !== fingerprint)) {
        throw Object.assign(new Error("duplicate"), { code: 11000 });
      }
      if (filter.status === "reserved" && !update.$setOnInsert) {
        if (!existing || existing.claimToken !== filter.claimToken) return null;
        const next = { ...existing, ...update.$set };
        records.set(fingerprint, next);
        return next;
      }
      const next = { ...(existing || update.$setOnInsert), ...update.$set };
      records.set(fingerprint, next);
      signatures.set(next.generationSignature, fingerprint);
      return next;
    }),
    deleteMany: jest.fn(async (filter: any) => {
      for (const [fingerprint, record] of records) {
        if (record.claimToken === filter.claimToken && record.status === filter.status) {
          records.delete(fingerprint);
          signatures.delete(record.generationSignature);
        }
      }
    }),
  };
}

describe("global Meta creative uniqueness", () => {
  const baseDraft = {
    leadType: "veteran",
    audienceSegment: "standard",
    primaryText: "Veterans can review private life insurance coverage options.",
    headline: "Life Insurance For Veterans",
    description: "Review options",
    cta: "LEARN_MORE",
    winningFamilyId: "vet_patriotic_amount_card",
    variationType: "logical",
    creativeArchetype: "amount_card",
    visualVariantIndex: 7,
    visualTreatment: "photo",
    buttonLabels: ["50-60", "61-70", "71+"],
    bulletPoints: ["Private coverage review"],
    renderedCreativeDataUrl: "data:image/png;base64,AAAA",
  };

  test("same visible design is account-independent while picture or saying changes remain valid variants", () => {
    const first = buildCreativeGenerationSignature({ ...baseDraft, generationNonce: "one", userEmail: "a@example.com" });
    const same = buildCreativeGenerationSignature({ ...baseDraft, generationNonce: "two", userEmail: "b@example.com" });
    const newSaying = buildCreativeGenerationSignature({ ...baseDraft, headline: "Coverage Options For Those Who Served" });
    const newPicture = buildCreativeGenerationSignature({ ...baseDraft, visualVariantIndex: 8 });

    expect(same).toBe(first);
    expect(newSaying).not.toBe(first);
    expect(newPicture).not.toBe(first);
    expect(buildPublishedCreativeFingerprint({ ...baseDraft, creativeSignature: first })).toMatch(/^cpf_[a-f0-9]{64}$/);
  });

  test("a published creative cannot be claimed by a different agent", async () => {
    const usageModel = createUsageModel();
    const creativeSignature = buildCreativeGenerationSignature(baseDraft);
    const draft = { ...baseDraft, creativeSignature };
    const first = await claimCreativeSet({
      userEmail: "first@example.com",
      campaignId: "campaign-1",
      leadType: "veteran",
      drafts: [draft],
      usageModel,
    });
    await finalizeCreativeReservation({
      claimToken: first.claimToken,
      creativeFingerprint: first.reservations[0].creativeFingerprint,
      metaAdId: "meta-ad-1",
      metaCreativeId: "meta-creative-1",
      usageModel,
    });

    await expect(claimCreativeSet({
      userEmail: "second@example.com",
      campaignId: "campaign-2",
      leadType: "veteran",
      drafts: [draft],
      usageModel,
    })).rejects.toThrow(CREATIVE_ALREADY_USED_MESSAGE);
  });

  test.each([
    ["veteran", 0.50, 0.70],
    ["trucker", 0.65, 0.85],
    ["mortgage_protection", 0.55, 0.75],
  ] as const)("%s keeps a deliberate mix of photo and graphic treatments", (leadType, minimum, maximum) => {
    let photos = 0;
    const total = 1000;
    for (let index = 0; index < total; index++) {
      const seed = `mix-agent-${index}|${leadType}|0|0`;
      const photoPercent = leadType === "trucker" ? 75 : leadType === "veteran" ? 60 : 65;
      if (hashString(`${seed}|treatment`) % 100 < photoPercent) photos += 1;
    }
    expect(photos / total).toBeGreaterThanOrEqual(minimum);
    expect(photos / total).toBeLessThanOrEqual(maximum);
  });

  test.each<WinnerLeadType>(["final_expense", "mortgage_protection", "veteran", "trucker", "iul"])(
    "%s can allocate three fresh ads to 500 agents from the current library",
    (leadType) => {
      const allocated = new Set<string>();
      let maxBatchUsed = 0;
      for (let agentIndex = 0; agentIndex < 500; agentIndex++) {
        const user = `scale-agent-${agentIndex}@example.com`;
        const selected: string[] = [];
        for (let batch = 0; batch < 32 && selected.length < 3; batch++) {
          const variants = generateWinningVariantList({
            leadType,
            audienceSegment: "standard",
            userId: user,
            campaignName: `${leadType}|${user}|bench:${batch}`,
            location: "AZ",
            variantCount: 4,
          });
          variants.forEach((variant, index) => {
            const signature = generatedDraft(variant, leadType, user, batch, index).creativeSignature;
            if (!allocated.has(signature) && !selected.includes(signature) && selected.length < 3) selected.push(signature);
          });
          if (selected.length === 3) maxBatchUsed = Math.max(maxBatchUsed, batch);
        }
        expect(selected).toHaveLength(3);
        selected.forEach((signature) => allocated.add(signature));
      }
      expect(allocated.size).toBe(1500);
      expect(maxBatchUsed).toBeLessThan(32);
    }
  );
});
