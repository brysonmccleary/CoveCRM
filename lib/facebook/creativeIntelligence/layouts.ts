import type { CreativeFormat, CreativeVertical, LayoutId } from "./types";

export type LayoutDefinition = {
  layoutId: LayoutId;
  name: string;
  rendererFamily: string;
  compatibleVerticals: CreativeVertical[];
  compatibleFormats: CreativeFormat[];
  slots: string[];
  hierarchyClass: string;
  meaningfulComposition: string;
};

const ALL_VERTICALS: CreativeVertical[] = [
  "veteran",
  "final_expense",
  "mortgage_protection",
  "iul",
  "trucker",
];

export const CREATIVE_LAYOUTS: LayoutDefinition[] = [
  {
    layoutId: "hero_amount_age_grid",
    name: "Hero Amount + Age Grid",
    rendererFamily: "amount_hero",
    compatibleVerticals: ["veteran", "final_expense", "mortgage_protection", "trucker"],
    compatibleFormats: ["graphic", "photo"],
    slots: ["audienceCallout", "primaryHook", "heroAmount", "selector", "cta", "disclosure"],
    hierarchyClass: "number_first",
    meaningfulComposition: "Oversized amount occupies the center; qualification choices form the lower grid.",
  },
  {
    layoutId: "audience_benefit_grid",
    name: "Audience Callout + Benefit Grid",
    rendererFamily: "benefit_grid",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["graphic", "photo"],
    slots: ["audienceCallout", "primaryHook", "benefitList", "selector", "cta", "disclosure"],
    hierarchyClass: "identity_then_benefits",
    meaningfulComposition: "Identity header leads into separate benefit tiles and a qualification control.",
  },
  {
    layoutId: "problem_consequence_offer",
    name: "Problem → Consequence → Offer",
    rendererFamily: "split_panel",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["graphic", "photo", "video"],
    slots: ["primaryHook", "supportingCopy", "secondaryHook", "offer", "cta", "disclosure"],
    hierarchyClass: "narrative_three_stage",
    meaningfulComposition: "Three visibly separated stages move from problem to impact to the response.",
  },
  {
    layoutId: "portrait_hero_offer",
    name: "Portrait + Hero Offer",
    rendererFamily: "premium_card",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["photo", "agent_video"],
    slots: ["heroImage", "audienceCallout", "primaryHook", "heroAmount", "cta", "disclosure"],
    hierarchyClass: "portrait_anchor",
    meaningfulComposition: "Portrait and offer use separate zones; the person is the visual anchor.",
  },
  {
    layoutId: "full_bleed_text_overlay",
    name: "Full-Bleed Image + Text Overlay",
    rendererFamily: "dark_response",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["photo", "video"],
    slots: ["backgroundImage", "badge", "primaryHook", "heroAmount", "cta", "disclosure"],
    hierarchyClass: "image_first_overlay",
    meaningfulComposition: "Full-bleed image carries the concept while a high-contrast offer block overlays it.",
  },
  {
    layoutId: "notice_letter_paper",
    name: "Notice / Letter / Paper Card",
    rendererFamily: "aged_parchment",
    compatibleVerticals: ["veteran", "final_expense", "mortgage_protection"],
    compatibleFormats: ["graphic"],
    slots: ["badge", "audienceCallout", "primaryHook", "supportingCopy", "selector", "cta", "disclosure"],
    hierarchyClass: "document_notice",
    meaningfulComposition: "Paper/document framing with a notice header and a clearly non-government disclosure.",
  },
  {
    layoutId: "family_lifestyle_offer",
    name: "Family / Lifestyle Offer",
    rendererFamily: "poster_stack",
    compatibleVerticals: ["veteran", "final_expense", "mortgage_protection", "iul", "trucker"],
    compatibleFormats: ["photo", "video"],
    slots: ["heroImage", "primaryHook", "secondaryHook", "benefitList", "cta", "disclosure"],
    hierarchyClass: "lifestyle_emotional",
    meaningfulComposition: "Family image leads; concise protective promise and benefits follow beneath it.",
  },
  {
    layoutId: "comparison_two_column",
    name: "Comparison / Two-Column",
    rendererFamily: "comparison_table",
    compatibleVerticals: ["mortgage_protection", "iul", "final_expense"],
    compatibleFormats: ["graphic"],
    slots: ["primaryHook", "comparisonLeft", "comparisonRight", "supportingCopy", "cta", "disclosure"],
    hierarchyClass: "side_by_side_comparison",
    meaningfulComposition: "Two balanced columns compare situations or concepts without implying guaranteed outcomes.",
  },
  {
    layoutId: "educational_explainer_card",
    name: "Educational Explainer Card",
    rendererFamily: "clean_white_diagram",
    compatibleVerticals: ["iul", "mortgage_protection", "final_expense", "veteran", "trucker"],
    compatibleFormats: ["graphic", "agent_video"],
    slots: ["primaryHook", "supportingCopy", "benefitList", "badge", "cta", "disclosure"],
    hierarchyClass: "diagram_explainer",
    meaningfulComposition: "Clean instructional flow uses a diagram-like center instead of an offer poster.",
  },
  {
    layoutId: "calculator_quiz_assessment",
    name: "Calculator / Quiz / Assessment",
    rendererFamily: "quiz_card",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["graphic"],
    slots: ["primaryHook", "selector", "supportingCopy", "cta", "disclosure"],
    hierarchyClass: "interactive_assessment",
    meaningfulComposition: "A single assessment prompt and large response choices dominate the card.",
  },
  {
    layoutId: "ugc_talking_head",
    name: "UGC / Talking-Head Video Framework",
    rendererFamily: "mobile_native",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["ugc_video", "video"],
    slots: ["heroImage", "primaryHook", "caption", "badge", "cta", "disclosure"],
    hierarchyClass: "native_video_frame",
    meaningfulComposition: "Vertical talking-head frame with native caption and persistent CTA/disclosure zones.",
  },
  {
    layoutId: "agent_trust_explainer",
    name: "Agent / Trust / Explainer Framework",
    rendererFamily: "trust_medical",
    compatibleVerticals: ALL_VERTICALS,
    compatibleFormats: ["agent_video", "photo"],
    slots: ["heroImage", "agentName", "primaryHook", "benefitList", "trustBadge", "cta", "disclosure"],
    hierarchyClass: "credentialed_explainer",
    meaningfulComposition: "Agent identity and trust panel lead into an educational summary and consultation CTA.",
  },
];

const BY_ID = new Map(CREATIVE_LAYOUTS.map((layout) => [layout.layoutId, layout]));

export function getLayoutDefinition(layoutId: LayoutId): LayoutDefinition {
  const layout = BY_ID.get(layoutId);
  if (!layout) throw new Error(`Unknown creative layout: ${layoutId}`);
  return layout;
}

export function assertLayoutCompatibility(input: {
  layoutId: LayoutId;
  vertical: CreativeVertical;
  format: CreativeFormat;
}) {
  const layout = getLayoutDefinition(input.layoutId);
  if (!layout.compatibleVerticals.includes(input.vertical)) {
    throw new Error(`${input.layoutId} is not compatible with ${input.vertical}`);
  }
  if (!layout.compatibleFormats.includes(input.format)) {
    throw new Error(`${input.layoutId} does not support ${input.format}`);
  }
  return layout;
}
