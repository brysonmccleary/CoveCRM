import { createHash } from "crypto";

export type SimilarityClass = "EXACT_DUPLICATE" | "NEAR_DUPLICATE" | "SIMILAR_BUT_ACCEPTABLE" | "DISTINCT";

function tokens(value: unknown): Set<string> {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9áéíóúñü$]+/gi, " ").trim().split(/\s+/).filter(Boolean));
}

function jaccard(left: unknown, right: unknown): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function exact(left: unknown, right: unknown): number {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return a && a === b ? 1 : 0;
}

export function creativeSimilarity(left: Record<string, any>, right: Record<string, any>) {
  const exactShape = (draft: Record<string, any>) => JSON.stringify({
    family: draft.winningFamilyId || draft.creativeFamily || "", layout: draft.layoutId || "",
    headline: draft.headline || "", primaryText: draft.primaryText || "", description: draft.description || "",
    bullets: draft.bulletPoints || [], image: draft.imageIdentity || draft.imageUrl || draft.backgroundImage || draft.imageDirection || "",
    background: draft.backgroundDirection || "", palette: draft.paletteId || draft.colorScheme || "",
    offer: draft.offerClass || draft.heroAmount || "", selector: draft.selectorContract || draft.buttonLabels || [], cta: draft.cta || "",
    hierarchy: draft.heroHierarchy || "", backgroundClass: draft.backgroundClass || "",
    ctaPlacement: draft.ctaPlacement || "", benefitStructure: draft.benefitStructure || "",
    execution: draft.cssExecutionId || "", macro: draft.cssMacroFamily || "",
    cssTreatment: [draft.cssRendererFamily, draft.cssBackgroundTreatment, draft.cssTypographyTreatment,
      draft.cssPanelStructure, draft.cssSelectorPresentation, draft.cssCtaTreatment, draft.cssFrameTreatment],
  });
  if (exactShape(left) === exactShape(right)) {
    return { score: 1, classification: "EXACT_DUPLICATE" as const, factors: { exact: 1 } };
  }
  const bodyLeft = [left.primaryText, left.description, ...(left.bulletPoints || [])].join(" ");
  const bodyRight = [right.primaryText, right.description, ...(right.bulletPoints || [])].join(" ");
  const factors = {
    family: exact(left.winningFamilyId || left.creativeFamily, right.winningFamilyId || right.creativeFamily),
    layout: exact(left.layoutId, right.layoutId),
    headline: jaccard(left.headline, right.headline),
    hook: jaccard(left.primaryText, right.primaryText),
    body: jaccard(bodyLeft, bodyRight),
    image: exact(
      left.imageIdentity || left.imageUrl || left.backgroundImage || left.imageDirection,
      right.imageIdentity || right.imageUrl || right.backgroundImage || right.imageDirection
    ),
    palette: exact(left.paletteId || left.colorScheme, right.paletteId || right.colorScheme),
    offer: exact(left.offerClass || left.heroAmount, right.offerClass || right.heroAmount),
    selector: exact(JSON.stringify(left.selectorContract || left.buttonLabels), JSON.stringify(right.selectorContract || right.buttonLabels)),
    cta: exact(left.cta, right.cta),
    hierarchy: exact(left.heroHierarchy || left.layoutId, right.heroHierarchy || right.layoutId),
    backgroundClass: exact(left.backgroundClass || left.visualTreatment, right.backgroundClass || right.visualTreatment),
    ctaPlacement: exact(left.ctaPlacement || "bottom_bar", right.ctaPlacement || "bottom_bar"),
    benefitStructure: exact(left.benefitStructure || (left.bulletPoints || []).length, right.benefitStructure || (right.bulletPoints || []).length),
    execution: exact(left.cssExecutionId, right.cssExecutionId),
    macro: exact(left.cssMacroFamily, right.cssMacroFamily),
    cssTreatment: exact(
      [left.cssRendererFamily, left.cssBackgroundTreatment, left.cssTypographyTreatment, left.cssPanelStructure, left.cssSelectorPresentation, left.cssCtaTreatment, left.cssFrameTreatment].join("|"),
      [right.cssRendererFamily, right.cssBackgroundTreatment, right.cssTypographyTreatment, right.cssPanelStructure, right.cssSelectorPresentation, right.cssCtaTreatment, right.cssFrameTreatment].join("|")
    ),
  };
  const score = factors.family * 0.03 + factors.layout * 0.1 + factors.headline * 0.11
    + factors.hook * 0.06 + factors.body * 0.07 + factors.image * 0.05
    + factors.palette * 0.03 + factors.offer * 0.08 + factors.selector * 0.07 + factors.cta * 0.03
    + factors.hierarchy * 0.06 + factors.backgroundClass * 0.04
    + factors.ctaPlacement * 0.03 + factors.benefitStructure * 0.04
    + factors.execution * 0.08 + factors.macro * 0.06 + factors.cssTreatment * 0.06;
  const classification: SimilarityClass = score >= 0.98 ? "EXACT_DUPLICATE"
    : score >= 0.7 ? "NEAR_DUPLICATE"
      : score >= 0.46 ? "SIMILAR_BUT_ACCEPTABLE" : "DISTINCT";
  return { score: Number(score.toFixed(4)), classification, factors };
}

export function semanticFingerprint(draft: Record<string, any>): string {
  const normalized = [
    draft.winningFamilyId, draft.layoutId, draft.hookClass, draft.headline, draft.primaryText,
    draft.description, JSON.stringify(draft.bulletPoints || []), draft.offerClass,
    draft.imageIdentity, draft.imageDirection, draft.backgroundDirection, JSON.stringify(draft.selectorContract), draft.cta,
    draft.heroHierarchy, draft.backgroundClass, draft.ctaPlacement, draft.benefitStructure,
    draft.cssExecutionId, draft.cssMacroFamily, draft.cssRendererFamily, draft.cssBackgroundTreatment,
    draft.cssTypographyTreatment, draft.cssPanelStructure, draft.cssSelectorPresentation,
    draft.cssCtaTreatment, draft.cssFrameTreatment,
  ]
    .map((value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim()).join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
