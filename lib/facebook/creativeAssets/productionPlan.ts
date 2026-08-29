import type { CreativeLanguage, CreativeVertical } from "@/lib/facebook/creativeIntelligence/types";

export type AssetProductionLane = {
  laneId: string;
  vertical: CreativeVertical;
  audienceSegment: "standard" | "veteran" | "trucker" | "spanish";
  language: CreativeLanguage;
  targetApproved: number;
  existingCandidateCount: number;
  directions: string[];
};

export const ASSET_PRODUCTION_LANES: AssetProductionLane[] = [
  {
    laneId: "veteran", vertical: "veteran", audienceSegment: "veteran", language: "en",
    targetApproved: 160, existingCandidateCount: 40,
    directions: [
      "older male veteran", "older female veteran", "middle-aged veteran", "veteran couple",
      "veteran and spouse", "veteran at home", "veteran outdoors", "veteran portrait",
      "veteran family preparation", "subtle flag", "patriotic lifestyle", "service-inspired visual",
      "dog tags or symbolic military object", "home and flag", "family and veteran",
      "no-person patriotic background", "navy graphic", "white and red graphic", "black and gold graphic",
      "navy and gold graphic", "notice paper texture", "benefit-card texture",
      "family-consequence atmosphere", "clean modern direct-response background",
    ],
  },
  {
    laneId: "mortgage", vertical: "mortgage_protection", audienceSegment: "standard", language: "en",
    targetApproved: 130, existingCandidateCount: 40,
    directions: [
      "home exterior", "family at home", "new homeowner", "couple in home", "mortgage paperwork",
      "keys and homeownership", "protect-the-home concept", "family and home consequence", "suburban home",
      "starter home", "larger family home", "home equity or payoff visual", "living-benefit education graphic",
      "notice mail card", "agent consultation", "no-person clean mortgage card", "veteran homeowner",
      "trucker homeowner",
    ],
  },
  {
    laneId: "trucker", vertical: "trucker", audienceSegment: "trucker", language: "en",
    targetApproved: 130, existingCandidateCount: 40,
    directions: [
      "semi-trailer truck", "driver portrait", "driver in cab", "driver beside truck", "owner-operator",
      "highway", "truck stop", "sunrise or sunset highway", "family and trucker", "homecoming",
      "income and family protection", "career-risk visual", "physical or health review concept",
      "mortgage and homeownership", "IUL retirement education", "no-person truck graphic",
      "CDL occupation callout card",
    ],
  },
  {
    laneId: "final_expense", vertical: "final_expense", audienceSegment: "standard", language: "en",
    targetApproved: 160, existingCandidateCount: 0,
    directions: [
      "older adult portrait", "older couple", "adult child and parent", "family preparation",
      "kitchen-table planning", "funeral-cost concern", "subtle memorial family imagery", "calm home environment",
      "document or notice style", "cost and benefit graphic", "no-person card background", "senior trust image",
      "cremation planning education", "agent consultation", "family burden and responsibility",
      "simple clean text-card background",
    ],
  },
  {
    laneId: "iul", vertical: "iul", audienceSegment: "standard", language: "en",
    targetApproved: 130, existingCandidateCount: 0,
    directions: [
      "financial education", "family legacy", "retirement planning", "cash-value education",
      "tax-planning concept", "timeline", "comparison chart", "calculator assessment", "professional couple",
      "family", "business owner", "retirement-age couple", "younger professional family", "advisor conversation",
      "agent talking head", "educational whiteboard", "no-person infographic",
      "market upside and downside education", "legacy and family inheritance", "occupation-specific education",
    ],
  },
  {
    laneId: "spanish_final_expense", vertical: "final_expense", audienceSegment: "spanish", language: "es",
    targetApproved: 30, existingCandidateCount: 0,
    directions: ["responsabilidad familiar", "padre o madre e hijos", "pareja", "familia multigeneracional", "confianza con agente", "planificación"],
  },
  {
    laneId: "spanish_mortgage", vertical: "mortgage_protection", audienceSegment: "spanish", language: "es",
    targetApproved: 30, existingCandidateCount: 0,
    directions: ["familia en casa", "pareja propietaria", "conversación", "protección del hogar", "tarjeta informativa", "consulta con agente"],
  },
  {
    laneId: "spanish_iul", vertical: "iul", audienceSegment: "spanish", language: "es",
    targetApproved: 30, existingCandidateCount: 0,
    directions: ["educación financiera", "pareja profesional", "familia y legado", "planificación", "explicación con agente", "tarjeta de beneficios"],
  },
  {
    laneId: "spanish_veteran", vertical: "veteran", audienceSegment: "spanish", language: "es",
    targetApproved: 30, existingCandidateCount: 0,
    directions: ["familia y responsabilidad", "pareja", "hogar", "conversación", "planificación", "confianza con agente"],
  },
  {
    laneId: "spanish_trucker", vertical: "trucker", audienceSegment: "spanish", language: "es",
    targetApproved: 30, existingCandidateCount: 0,
    directions: ["familia", "pareja", "hogar", "conversación", "planificación", "educación financiera"],
  },
];

export type PlannedAssetJob = {
  jobId: string;
  laneId: string;
  vertical: CreativeVertical;
  audienceSegment: AssetProductionLane["audienceSegment"];
  language: CreativeLanguage;
  direction: string;
  assetType: "BACKGROUND_IMAGE" | "LIFESTYLE" | "PORTRAIT" | "GRAPHIC" | "NOTICE_TEXTURE";
  format: "photo" | "graphic" | "texture";
  promptPolicy: string;
  ordinal: number;
  model: "gpt-image-1.5";
  quality: "medium";
  size: "1536x1024";
  status: "planned_unfunded";
};

export function buildUnfundedStaticAssetQueue(): PlannedAssetJob[] {
  return ASSET_PRODUCTION_LANES.flatMap((lane) => {
    const required = Math.max(0, lane.targetApproved - lane.existingCandidateCount);
    return Array.from({ length: required }, (_, index) => {
      const direction = lane.directions[index % lane.directions.length];
      const texture = /texture|notice|paper|document|mail/i.test(direction);
      const graphic = /graphic|card|chart|calculator|timeline|infographic|education|educación|whiteboard|payoff|cost and benefit/i.test(direction);
      const portrait = /portrait/i.test(direction);
      const lifestyle = /family|familia|couple|pareja|parent|children|homeowner|veteran at|driver|agent|agente|consultation|conversación|adult|senior/i.test(direction);
      return {
        jobId: `cie_${lane.laneId}_${String(index + 1).padStart(4, "0")}`,
        laneId: lane.laneId,
        vertical: lane.vertical,
        audienceSegment: lane.audienceSegment,
        language: lane.language,
        direction,
        assetType: texture ? "NOTICE_TEXTURE" as const : graphic ? "GRAPHIC" as const
          : portrait ? "PORTRAIT" as const : lifestyle ? "LIFESTYLE" as const : "BACKGROUND_IMAGE" as const,
        format: texture ? "texture" as const : graphic ? "graphic" as const : "photo" as const,
        promptPolicy: "Original Cove composition; no logos, seals, brands, watermarks, uniforms with readable insignia, or readable generated text; copy-safe mobile crop; no coverage, price, tax, return, eligibility, or testimonial claims embedded in the image.",
        ordinal: index + 1,
        model: "gpt-image-1.5" as const,
        quality: "medium" as const,
        size: "1536x1024" as const,
        status: "planned_unfunded" as const,
      };
    });
  });
}

export const MASS_ASSET_COST_PLAN = {
  totalApprovedAssetsRequested: ASSET_PRODUCTION_LANES.reduce((sum, lane) => sum + lane.targetApproved, 0),
  existingAssetCandidates: ASSET_PRODUCTION_LANES.reduce((sum, lane) => sum + lane.existingCandidateCount, 0),
  newStaticAssetsRequired: buildUnfundedStaticAssetQueue().length,
  imageOutputCostPerAssetUsd: 0.05,
  maximumPromptTokensPerAsset: 100,
  textInputCostPerMillionTokensUsd: 5,
  estimatedNewAssetBytes: Math.round(buildUnfundedStaticAssetQueue().length * 195_316),
  blobStorageCostPerGbMonthUsd: 0.023,
} as const;
