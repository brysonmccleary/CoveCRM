import type {
  CreativeAudienceSegment,
  CreativeFormat,
  CreativeLanguage,
  CreativeVertical,
  LayoutId,
} from "@/lib/facebook/creativeIntelligence/types";

export type ProductionAssetType =
  | "STATIC_IMAGE" | "BACKGROUND_IMAGE" | "GRAPHIC" | "PORTRAIT" | "LIFESTYLE"
  | "NOTICE_TEXTURE" | "PATRIOTIC" | "HOME" | "TRUCK" | "FINANCIAL_EDUCATION"
  | "FINAL_EXPENSE_FAMILY" | "SPANISH_NATIVE" | "AGENT_VIDEO" | "UGC_VIDEO"
  | "STORY_VIDEO" | "EXPLAINER_VIDEO" | "OTHER_APPROVED";

export type ProductionCreativeAsset = {
  assetId: string;
  assetType: ProductionAssetType;
  verticals: Array<CreativeVertical | "*">;
  audienceSegments: Array<CreativeAudienceSegment | "*">;
  products: Array<CreativeVertical | "*">;
  languages: Array<CreativeLanguage | "*">;
  format: CreativeFormat | "texture";
  direction: string;
  imageDirection: string;
  visualClass: string;
  compatibleFamilies: string[];
  layoutCompatibility: Array<LayoutId | "*">;
  storageUrl: string;
  contentHash: string;
  semanticFingerprint: string;
  visualFingerprint: string;
  ownershipStatus: "owned" | "licensed" | "third_party" | "unknown";
  licenseStatus: "owned" | "licensed" | "approved_stock" | "unknown";
  approvalStatus: "approved" | "pending" | "rejected" | "retired";
  approvedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  useCount: number;
  recentUsage?: number;
  lastUsedAt?: string | Date | null;
  active: boolean;
};

export type AssetSelectionContext = {
  vertical: CreativeVertical;
  audienceSegment: CreativeAudienceSegment;
  language: CreativeLanguage;
  product: CreativeVertical;
  familyId: string;
  layoutId: LayoutId;
  format: CreativeFormat;
  userKey: string;
  seed: string;
  recentUsage: Array<Record<string, unknown>>;
  excludedAssetIds?: Set<string>;
};
