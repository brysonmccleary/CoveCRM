import { getRendererCopy, getVisibleIdentityLabel, localizeSelectorContract, type RendererCopy } from "@/lib/facebook/creativeIntelligence/localization";

const PAGE_NAMES: Record<string, string> = {
  veteran: "Veteran Benefits Center",
  trucker: "Trucker Life Coverage",
  final_expense: "Final Expense Planning",
  mortgage_protection: "Mortgage Protection Center",
  iul: "IUL Education Center",
};

const LEAD_TYPE_LABELS: Record<string, string> = {
  veteran: "Veteran Coverage",
  trucker: "Trucker Coverage",
  final_expense: "Final Expense",
  mortgage_protection: "Mortgage Protection",
  iul: "IUL Education",
};

const PAGE_ACCENTS: Record<string, string> = {
  veteran: "#1a2744",
  trucker: "#00bcd4",
  final_expense: "#d4a017",
  mortgage_protection: "#b91c1c",
  iul: "#d4a017",
};

const MORTGAGE_BACKGROUND =
  "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80";

const MORTGAGE_PHOTOS = [
  "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80",
  "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&q=80",
  "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80",
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
];

function cleanText(value: unknown): string {
  return String(value || "")
    .replace(/plans options designe\w*/gi, "coverage options designed")
    .replace(/\bplans options\b/gi, "coverage options")
    .replace(/\bcoverage coverage\b/gi, "coverage")
    .replace(/\boptions options\b/gi, "options")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean).slice(0, 4)
    : [];
}

function getOverlay(draft: any) {
  const overlay = draft?.overlayData || draft?.landingPageConfig || {};
  return {
    headline: cleanText(overlay.headline || draft?.headline),
    subheadline: cleanText(overlay.subheadline),
    buttonLabels: cleanList(overlay.buttonLabels || draft?.buttonLabels),
    benefitBullets: cleanList(overlay.benefitBullets || draft?.bulletPoints),
    ctaStrip: cleanText(overlay.ctaStrip),
  };
}

function isAgeTapCta(value: string): boolean {
  const text = value.toLowerCase();
  return text.includes("tap") && text.includes("age");
}

function BottomBar({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 44,
        background: color,
        color: "#ffffff",
        fontSize: 14,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {label}
    </div>
  );
}

function CheckList({
  bullets,
  color = "#ffffff",
  checkColor = "#22c55e",
  padding = "0 20px",
}: {
  bullets: string[];
  color?: string;
  checkColor?: string;
  padding?: string;
}) {
  if (!bullets.length) return null;

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding,
        color,
        fontSize: 12,
        lineHeight: 1.35,
      }}
    >
      {bullets.slice(0, 3).map((bullet, index) => (
        <li
          key={`${bullet}-${index}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginBottom: 5,
            textAlign: "left",
          }}
        >
          <span style={{ color: checkColor, fontWeight: 900 }}>✓</span>
          <span>{bullet}</span>
        </li>
      ))}
    </ul>
  );
}

// One-time-generated static photo pool per lead type (public/ad-backgrounds).
// These are reused across every ad forever -- no per-ad generation cost.
const STATIC_BACKGROUND_COUNTS: Record<string, number> = {
  trucker: 40,
  veteran: 40,
  mortgage_protection: 40,
};

// A handful of layouts paint a near-opaque panel over the ENTIRE card
// (clean_white_diagram, patriotic_notice, homeowner_table, and benefit_grid
// specifically for veteran) -- any photo assigned to one of these would be
// invisible under it. Photo eligibility must agree with the resolved layout,
// not just leadType, or the photo pool silently goes to waste on those ads.
function isLayoutPhotoFriendly(layoutFamily: string, leadType: string): boolean {
  if (layoutFamily === "clean_white_diagram") return false;
  if (layoutFamily === "patriotic_notice") return false;
  if (layoutFamily === "homeowner_table") return false;
  if (layoutFamily === "benefit_grid" && leadType === "veteran") return false;
  // These three are deliberately fully-opaque decorative treatments
  // (ornate frame, aged paper texture, halftone burst) -- a photo behind
  // them would never be visible, so never waste one of the pool images here.
  if (layoutFamily === "ornate_gold_frame") return false;
  if (layoutFamily === "aged_parchment") return false;
  if (layoutFamily === "pop_art_burst") return false;
  return true;
}

// New drafts explicitly choose either a photo-backed or graphic treatment.
// This keeps the paid photo pools visible without flattening the library into
// one look: proven number-led/poster ads intentionally remain photo-free.
function isPhotoEligible(leadType: string, variantIndex: number, layoutFamily: string): boolean {
  if (!STATIC_BACKGROUND_COUNTS[leadType]) return false;
  if (!isLayoutPhotoFriendly(layoutFamily, leadType)) return false;
  void variantIndex;
  return true;
}

function getVisualLeadType(draft: any, leadType: string): string {
  const audienceSegment = cleanText(draft?.audienceSegment).toLowerCase();
  if (audienceSegment === "veteran" || audienceSegment === "trucker") return audienceSegment;
  return leadType;
}

function getStaticBackgroundUrl(leadType: string, variantIndex: number): string {
  const count = STATIC_BACKGROUND_COUNTS[leadType];
  if (!count) return "";
  const index = (variantIndex % count) + 1;
  return `/ad-backgrounds/${leadType}/${index}.jpg`;
}

function getCreativeBackground(draft: any, leadType: string, variantIndex: number, layoutFamily: string): string {
  const imageUrl = cleanText(draft?.imageUrl);
  if (imageUrl) return imageUrl;
  const visualLeadType = getVisualLeadType(draft, leadType);
  const visualTreatment = cleanText(draft?.visualTreatment).toLowerCase();
  if (visualTreatment === "graphic") return "";
  if (isPhotoEligible(visualLeadType, variantIndex, layoutFamily)) {
    // Legacy drafts predate visualTreatment. Preserve a healthy mix for those
    // instead of forcing every old creative onto a photograph.
    if (!visualTreatment) {
      const photoModulo = visualLeadType === "trucker" ? 4 : 5;
      const photoSlots = visualLeadType === "trucker" ? 3 : 3;
      if (variantIndex % photoModulo >= photoSlots) return "";
    }
    return getStaticBackgroundUrl(visualLeadType, variantIndex);
  }
  return "";
}

function hashString(value: string): number {
  let hash = 0;
  const str = value || "covecrm";
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getVariationSeed(draft: any, leadType: string): string {
  const creativeSignature = cleanText(draft?.creativeSignature);
  if (creativeSignature) return creativeSignature;
  const compositeSeed = [
    draft?.uniquenessFingerprint,
    draft?.creativeArchetype,
    draft?.variationType,
    draft?.winningFamilyId,
    draft?.vendorStyleTag,
    draft?.generationNonce,
    draft?.regenerationAttempt,
    draft?.headline,
  ].map(cleanText).filter(Boolean).join("|");

  return compositeSeed || `${leadType}|default`;
}

function pickVisualVariant(draft: any, leadType: string, count: number): number {
  const safeCount = Math.max(1, count);
  const providedIndex = Number(draft?.visualVariantIndex);
  if (Number.isFinite(providedIndex) && providedIndex >= 0) {
    return Math.floor(providedIndex) % safeCount;
  }

  const attemptOffset = Math.max(0, Number(draft?.regenerationAttempt) || 0) * 2;
  return (hashString(getVariationSeed(draft, leadType)) + attemptOffset) % safeCount;
}

const VISUAL_VARIANT_COUNT = 40;

function ButtonGrid({
  labels,
  styleType,
  customStyle,
}: {
  labels: string[];
  styleType: "navy" | "gold" | "red" | "cyan" | "cream";
  customStyle?: { background: string; color: string; border: string; radius?: number };
}) {
  if (!labels.length) return null;
  const compactLabels = labels.some((label) => label.length > 10);
  // Two-column choices remain readable up to 30 characters at the production
  // width. Reserve the taller single-column treatment for genuinely long
  // phrases so the selector does not push the CTA below the crop.
  const stackedLabels = labels.some((label) => label.length > 30);
  const columns = stackedLabels ? "1fr" : compactLabels ? "1fr 1fr" : undefined;

  const styles: Record<string, { background: string; color: string; border: string; radius: number }> = {
    navy: { background: "#1a2744", color: "#ffffff", border: "1px solid rgba(255,255,255,0.22)", radius: 999 },
    gold: { background: "rgba(212,160,23,0.14)", color: "#ffd76a", border: "1.5px solid #d4a017", radius: 6 },
    red: { background: "#ffffff", color: "#b91c1c", border: "2px solid #b91c1c", radius: 6 },
    cyan: { background: "rgba(0,229,255,0.12)", color: "#ffffff", border: "1.5px solid #00e5ff", radius: 6 },
    cream: { background: "#f8f5f0", color: "#2d2016", border: "1px solid rgba(45,32,22,0.18)", radius: 6 },
  };
  const selected = customStyle ? { ...customStyle, radius: customStyle.radius ?? styles[styleType].radius } : styles[styleType];

  return (
    <div data-creative-selector-grid="true" style={{ display: compactLabels ? "grid" : "flex", gridTemplateColumns: columns, gap: 7, justifyContent: "center", flexWrap: compactLabels ? undefined : "wrap", width: "100%" }}>
      {labels.slice(0, 4).map((label) => (
        <div
          key={label}
          data-creative-selector-option="true"
          style={{
            background: selected.background,
            color: selected.color,
            border: selected.border,
            borderRadius: selected.radius,
            padding: compactLabels ? "7px 8px" : "9px 13px",
            minHeight: 36,
            minWidth: compactLabels ? 0 : styleType === "red" ? 92 : undefined,
            textAlign: "center",
            fontSize: compactLabels ? 11 : 12,
            fontWeight: 900,
            lineHeight: 1.15,
            whiteSpace: compactLabels ? "normal" : "nowrap",
            overflowWrap: "normal",
            wordBreak: "keep-all",
            hyphens: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function BenefitBoxes({
  bullets,
  palette,
}: {
  bullets: string[];
  palette: "dark" | "gold" | "light" | "cyan";
}) {
  if (!bullets.length) return null;

  const styles: Record<string, { background: string; color: string; check: string; border: string }> = {
    dark: { background: "rgba(10,15,26,0.82)", color: "#ffffff", check: "#22c55e", border: "1px solid rgba(255,255,255,0.14)" },
    gold: { background: "rgba(212,160,23,0.14)", color: "#fff8df", check: "#fbbf24", border: "1px solid rgba(212,160,23,0.45)" },
    light: { background: "rgba(255,255,255,0.92)", color: "#1f2937", check: "#16a34a", border: "1px solid rgba(17,24,39,0.12)" },
    cyan: { background: "rgba(0,188,212,0.14)", color: "#e0faff", check: "#00e5ff", border: "1px solid rgba(0,229,255,0.36)" },
  };
  const selected = styles[palette];

  return (
    <div style={{ display: "grid", gap: 7 }}>
      {bullets.slice(0, 3).map((bullet, index) => (
        <div
          key={`${bullet}-${index}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 10px",
            borderRadius: 7,
            background: selected.background,
            color: selected.color,
            border: selected.border,
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1.2,
            boxShadow: "0 8px 18px rgba(0,0,0,0.16)",
          }}
        >
          <span style={{ color: selected.check, fontWeight: 900 }}>✓</span>
          <span>{bullet}</span>
        </div>
      ))}
    </div>
  );
}

type LayoutFamily =
  | "poster_stack"
  | "split_panel"
  | "selector_grid"
  | "checklist_first"
  | "amount_hero"
  | "comparison_table"
  | "quiz_card"
  | "report_card"
  | "advisory_notice"
  | "messenger_prompt"
  | "premium_card"
  | "mobile_native"
  | "trust_medical"
  | "dark_response"
  | "patriotic_badge"
  | "benefit_grid"
  | "price_table"
  | "age_selector"
  | "premium_dark_gold"
  | "clean_white_diagram"
  | "patriotic_notice"
  | "homeowner_table"
  | "trucker_highway"
  | "ornate_gold_frame"
  | "aged_parchment"
  | "pop_art_burst";
type IaFamily =
  | "amount_first"
  | "qualification_first"
  | "benefit_first"
  | "branch_selector"
  | "family_security"
  | "urgency_response"
  | "payment_protection"
  | "home_value"
  | "rate_lock"
  | "calculator_flow"
  | "coverage_comparison"
  | "cdl_qualification"
  | "on_the_road"
  | "instant_check"
  | "family_planning"
  | "lock_rate"
  | "age_based"
  | "coverage_selector";
type FrameStyle = "full_bleed" | "inset_card" | "bottom_sheet" | "top_banner" | "split_overlay" | "corner_badge" | "diagonal_band" | "soft_glass";
type DensityStyle = "compact" | "balanced" | "roomy";
type TypographyStyle = "condensed_poster" | "premium_clean" | "utility_ui" | "aggressive_response" | "trust_editorial" | "modern_minimal";
type CtaFlow = "bottom_bar" | "floating_cta" | "panel_cta" | "selector_cta" | "stacked_cta" | "inline_cta" | "comparison_cta" | "quiz_cta";
type OverlayStyle = "deep_gradient" | "soft_gradient" | "hard_vignette" | "paper_wash" | "neon_glow";
type PaletteKey = "navy" | "gold" | "red" | "cyan" | "cream";
type BenefitKey = "dark" | "gold" | "light" | "cyan";

type Palette = {
  name: string;
  fallback: string;
  overlay: string;
  glow: string;
  eyebrow: string;
  headline: string;
  headlineBg: string;
  headlineBorder: string;
  subheadline: string;
  accent: string;
  cta: string;
  panel: string;
  panelBorder: string;
  button: PaletteKey;
  benefit: BenefitKey;
  buttonBg?: string;
  buttonText?: string;
  buttonBorder?: string;
};

type CreativeState = {
  draft: any;
  leadType: string;
  headline: string;
  subheadline: string;
  buttons: string[];
  bullets: string[];
  cta: string;
  eyebrow: string;
  amount: string;
  backgroundUrl: string;
  layoutFamily: LayoutFamily;
  iaFamily: IaFamily;
  frameStyle: FrameStyle;
  densityStyle: DensityStyle;
  typographyStyle: TypographyStyle;
  ctaFlow: CtaFlow;
  overlayStyle: OverlayStyle;
  palette: Palette;
  seed: number;
  variantIndex: number;
  headlineSize: number;
  subSize: number;
  gap: number;
  pad: number;
  radius: number;
  lineHeight: number;
  spanish: boolean;
  copy: RendererCopy;
};

// Curated from the supplied top-vendor references. These are the existing
// Cove layouts that already match the proven direct-response structures:
// amount hero, age selector, rate table, benefit grid, audience photo, and
// one clear CTA. Weak generic/mobile/chat/pop-art treatments remain in the
// renderer for backwards compatibility but are no longer selected for new ads.
const LAYOUTS_BY_LEAD_TYPE: Record<string, LayoutFamily[]> = {
  veteran: ["amount_hero", "age_selector", "premium_dark_gold"],
  trucker: ["trucker_highway", "age_selector", "price_table", "premium_dark_gold", "amount_hero"],
  mortgage_protection: ["price_table", "selector_grid", "comparison_table"],
  final_expense: ["amount_hero", "age_selector", "premium_dark_gold", "price_table", "ornate_gold_frame", "benefit_grid"],
  iul: ["clean_white_diagram", "benefit_grid", "premium_dark_gold", "price_table"],
};

const IA_BY_LEAD_TYPE: Record<string, IaFamily[]> = {
  veteran: ["amount_first", "qualification_first", "benefit_first", "branch_selector", "family_security", "urgency_response"],
  trucker: ["cdl_qualification", "family_security", "on_the_road", "instant_check", "benefit_first"],
  mortgage_protection: ["payment_protection", "home_value", "rate_lock", "calculator_flow", "coverage_comparison"],
  final_expense: ["family_planning", "lock_rate", "age_based", "coverage_selector", "benefit_first"],
  iul: ["benefit_first", "family_security", "coverage_comparison", "qualification_first", "calculator_flow"],
};

function pickSeeded<T>(values: T[], seed: number, salt: string): T {
  return values[hashString(`${seed}:${salt}`) % values.length];
}

const EXPLICIT_LAYOUT_BY_FAMILY_ID: Record<string, LayoutFamily> = {
  fe_senior_benefit_card: "amount_hero",
  fe_no_exam_age_card: "age_selector",
  fe_coverage_price_table: "price_table",
  fe_private_burial_fund: "ornate_gold_frame",
  mp_amount_button_card: "selector_grid",
  mp_rate_table_card: "price_table",
  mp_clean_navy_price_table: "price_table",
  mp_simple_benefit_card: "selector_grid",
  mp_living_benefits_alert: "price_table",
  mp_with_without_coverage: "comparison_table",
  mp_family_home_warmth: "selector_grid",
  mp_veteran_family_home: "selector_grid",
  mp_veteran_living_benefits: "price_table",
  mp_trucker_home_on_road: "trucker_highway",
  mp_trucker_income_gap: "trucker_highway",
  vet_patriotic_amount_card: "amount_hero",
  vet_age_qualifier_card: "age_selector",
  vet_benefit_unlock_long_copy: "premium_dark_gold",
  vet_branch_selector: "age_selector",
  vet_spouse_security: "amount_hero",
  vet_benefit_grid_notice: "premium_dark_gold",
  vet_whole_life_bold_white: "age_selector",
  vet_coverage_up_to_100k: "amount_hero",
  vet_legacy_protection_cards: "premium_dark_gold",
  vet_spouse_family_private: "amount_hero",
  vet_notice_paper_border: "age_selector",
  trk_neon_card: "trucker_highway",
  trk_patriotic_card: "trucker_highway",
  trk_blue_highway_clean: "trucker_highway",
  trk_sunset_highway_gold: "trucker_highway",
  trk_dark_purple_sky: "trucker_highway",
  trk_patriotic_rate_table: "price_table",
  trk_truck_stop_lifestyle: "trucker_highway",
  trk_view_options_age_card: "age_selector",
  trk_family_home_base: "trucker_highway",
  trk_black_gold_premium: "premium_dark_gold",
  iul_clean_triangle_diagram: "clean_white_diagram",
  iul_family_legacy: "benefit_grid",
  iul_market_loss_protection: "benefit_grid",
  iul_flexible_cash_access: "benefit_grid",
  iul_black_gold_retirement: "premium_dark_gold",
  iul_veteran_triangle_legacy: "premium_dark_gold",
  iul_veteran_black_gold: "premium_dark_gold",
  iul_trucker_blue_highway: "trucker_highway",
  iul_trucker_sunset_gold: "trucker_highway",
  iul_trucker_premium_black_gold: "premium_dark_gold",
  iul_trucker_dark_purple_sky: "trucker_highway",
  fe_veteran_final_cost_review: "age_selector",
  fe_trucker_final_cost_review: "trucker_highway",
};

export function resolveCreativeLayoutFamily(draft: any, leadType: string, seed: number, variantIndex: number): LayoutFamily {
  const intelligenceLayouts: Record<string, LayoutFamily> = {
    hero_amount_age_grid: "amount_hero",
    audience_benefit_grid: "benefit_grid",
    problem_consequence_offer: "split_panel",
    portrait_hero_offer: "premium_card",
    full_bleed_text_overlay: "dark_response",
    notice_letter_paper: "aged_parchment",
    family_lifestyle_offer: "poster_stack",
    comparison_two_column: "comparison_table",
    educational_explainer_card: "clean_white_diagram",
    calculator_quiz_assessment: "quiz_card",
    ugc_talking_head: "mobile_native",
    agent_trust_explainer: "trust_medical",
  };
  const intelligenceLayout = intelligenceLayouts[cleanText(draft?.layoutId)];
  if (intelligenceLayout) return intelligenceLayout;
  const explicitLayout = EXPLICIT_LAYOUT_BY_FAMILY_ID[cleanText(draft?.winningFamilyId)];
  if (explicitLayout) return explicitLayout;
  const audienceSegment = cleanText(draft?.audienceSegment).toLowerCase();
  if (audienceSegment === "trucker" && (leadType === "iul" || leadType === "mortgage_protection")) {
    return pickSeeded(["trucker_highway", "price_table", "premium_dark_gold"], seed + variantIndex * 11, "layout");
  }
  if (audienceSegment === "veteran" && leadType === "iul") {
    return "premium_dark_gold";
  }
  if (audienceSegment === "veteran" && leadType === "mortgage_protection") {
    return pickSeeded(["selector_grid", "price_table", "comparison_table"], seed + variantIndex * 11, "layout");
  }
  return pickSeeded(
    LAYOUTS_BY_LEAD_TYPE[leadType] || LAYOUTS_BY_LEAD_TYPE.final_expense,
    seed + variantIndex * 11,
    "layout"
  );
}

function getProductLabel(leadType: string, audienceSegment: string, spanish = false): string {
  if (spanish) {
    if (leadType === "mortgage_protection") return audienceSegment === "veteran"
      ? "VETERANOS + PROTECCIÓN HIPOTECARIA"
      : audienceSegment === "trucker" ? "CONDUCTORES CDL + PROTECCIÓN HIPOTECARIA" : "SEGURO DE PROTECCIÓN HIPOTECARIA";
    if (leadType === "iul") return audienceSegment === "veteran"
      ? "VETERANOS + EDUCACIÓN IUL"
      : audienceSegment === "trucker" ? "CONDUCTORES CDL + EDUCACIÓN IUL" : "SEGURO DE VIDA UNIVERSAL INDEXADO (IUL)";
    if (leadType === "veteran") return "VETERANOS + SEGURO DE VIDA";
    if (leadType === "trucker") return "CONDUCTORES CDL + SEGURO DE VIDA";
    if (audienceSegment === "veteran") return "VETERANOS + GASTOS FINALES";
    if (audienceSegment === "trucker") return "CONDUCTORES CDL + GASTOS FINALES";
    return "SEGURO DE GASTOS FINALES";
  }
  if (leadType === "veteran") return "LIFE INSURANCE FOR VETERANS";
  if (leadType === "trucker") return "LIFE INSURANCE FOR CDL DRIVERS";
  if (leadType === "mortgage_protection") {
    if (audienceSegment === "veteran") return "MORTGAGE PROTECTION FOR VETERANS";
    if (audienceSegment === "trucker") return "MORTGAGE PROTECTION FOR CDL DRIVERS";
    return "MORTGAGE PROTECTION INSURANCE";
  }
  if (leadType === "iul") {
    if (audienceSegment === "veteran") return "IUL LIFE INSURANCE FOR VETERANS";
    if (audienceSegment === "trucker") return "TRUCKERS IUL LIFE INSURANCE";
    return "INDEXED UNIVERSAL LIFE INSURANCE";
  }
  if (leadType === "final_expense" && audienceSegment === "veteran") return "FINAL EXPENSE INSURANCE FOR VETERANS";
  if (leadType === "final_expense" && audienceSegment === "trucker") return "FINAL EXPENSE INSURANCE FOR CDL DRIVERS";
  return "FINAL EXPENSE INSURANCE";
}

function isProductClear(value: string, leadType: string, spanish = false): boolean {
  const text = cleanText(value).toLowerCase();
  if (spanish) {
    if (leadType === "mortgage_protection") return /hipotecar|hipoteca/.test(text);
    if (leadType === "iul") return /iul|universal indexad|valor en efectivo/.test(text);
    return /gastos finales|funeral|entierro|vida entera/.test(text);
  }
  if (leadType === "mortgage_protection") return /mortgage protection/.test(text);
  if (leadType === "iul") return /\biul\b|indexed universal life|cash value life insurance/.test(text);
  if (leadType === "veteran") return /life insurance|whole life|burial|final expense/.test(text);
  if (leadType === "trucker") return /life insurance|\biul\b|burial|final expense/.test(text);
  return /final expense|burial insurance|whole life|funeral expense/.test(text);
}

function clampCopy(value: string, maxLength: number): string {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  return candidate.slice(0, lastSpace >= Math.floor(maxLength * 0.65) ? lastSpace : maxLength).trim();
}

const VISUAL_SUBHEADLINES: Record<string, string[]> = {
  veteran: [
    "Private life insurance options for veterans and their families.",
    "Review life insurance options available for those who served.",
    "Compare private coverage options by age and state.",
  ],
  trucker: [
    "Life insurance options designed for professional drivers.",
    "Compare private coverage options built around life on the road.",
    "Review life insurance options for CDL drivers and their families.",
  ],
  mortgage_protection: [
    "Mortgage protection options for your family and home.",
    "Compare coverage options based on your mortgage balance.",
    "Coverage may help your family protect the place they call home.",
  ],
  final_expense: [
    "Life insurance options designed to help with final expenses.",
    "Compare private coverage options for funeral and final costs.",
    "Review final expense coverage options by age and state.",
  ],
  iul: [
    "Learn how indexed universal life insurance may work.",
    "Review life insurance protection and cash value potential.",
    "Compare IUL features, costs, and policy terms.",
  ],
};

function getVisualSubheadline(leadType: string, audienceSegment: string, seed: number, spanish: boolean): string {
  if (spanish) {
    if (leadType === "mortgage_protection") return "Compare opciones de protección hipotecaria para su hogar.";
    if (leadType === "iul") return "Conozca la protección y el valor en efectivo potencial de IUL.";
    return "Compare opciones privadas para gastos finales por edad y estado.";
  }

  void audienceSegment;
  const options = VISUAL_SUBHEADLINES[leadType] || VISUAL_SUBHEADLINES.final_expense;
  return pickSeeded(options, seed, "visual-subheadline");
}

function getLeadFallbackHeadline(leadType: string, spanish = false): string {
  if (spanish) {
    if (leadType === "mortgage_protection") return "Proteja el hogar de su familia";
    if (leadType === "iul") return "Opciones de IUL para su futuro";
    return "Opciones para gastos finales";
  }
  if (leadType === "veteran") return "Veterans Life Insurance";
  if (leadType === "trucker") return "Truck Driver Coverage";
  if (leadType === "mortgage_protection") return "Protect Your Family's Home";
  if (leadType === "iul") return "IUL Coverage Options";
  return "Final Expense Coverage";
}

function getLeadEyebrow(leadType: string, iaFamily: IaFamily, spanish = false): string {
  if (spanish) {
    if (leadType === "mortgage_protection") return "PROTECCIÓN HIPOTECARIA";
    if (leadType === "iul") return "VIDA UNIVERSAL INDEXADA";
    return "GASTOS FINALES";
  }
  if (leadType === "veteran") return iaFamily === "branch_selector" ? "COVERAGE FOR THOSE WHO SERVED" : "PRIVATE COVERAGE FOR VETERANS";
  if (leadType === "trucker") return iaFamily === "cdl_qualification" ? "CDL DRIVER CHECK" : "TRUCK DRIVER COVERAGE";
  if (leadType === "mortgage_protection") return iaFamily === "calculator_flow" ? "MORTGAGE PROTECTION CHECK" : "HOME PROTECTION OPTIONS";
  if (leadType === "iul") return "INDEXED UNIVERSAL LIFE";
  return iaFamily === "lock_rate" ? "RATE REVIEW" : "FINAL EXPENSE COVERAGE";
}

function makePalette(
  name: string,
  bg: string,
  accent: string,
  text: string,
  sub: string,
  button: string,
  buttonText: string
): Palette {
  const isLight = bg.startsWith("#f") || bg === "#fafafa" || bg === "#e8f5e9";
  return {
    name,
    fallback: bg,
    overlay: isLight
      ? `linear-gradient(180deg, rgba(255,255,255,0.78) 0%, ${bg} 48%, rgba(0,0,0,0.42) 100%)`
      : `linear-gradient(180deg, rgba(0,0,0,0.18) 0%, ${bg} 48%, rgba(0,0,0,0.72) 100%)`,
    glow: `inset 0 0 70px ${accent}22`,
    eyebrow: accent,
    headline: text,
    headlineBg: isLight ? "rgba(255,255,255,0.86)" : "rgba(0,0,0,0.42)",
    headlineBorder: `${accent}55`,
    subheadline: sub,
    accent,
    cta: button,
    panel: isLight ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.5)",
    panelBorder: `${accent}44`,
    button: "navy",
    benefit: isLight ? "light" : "dark",
    buttonBg: button,
    buttonText,
    buttonBorder: `1.5px solid ${accent}`,
  };
}

function getButtonStyle(state: CreativeState) {
  if (!state.palette.buttonBg || !state.palette.buttonText) return undefined;
  return {
    background: state.palette.buttonBg,
    color: state.palette.buttonText,
    border: state.palette.buttonBorder || `1.5px solid ${state.palette.accent}`,
    radius: state.radius,
  };
}

function getPalettes(leadType: string): Palette[] {
  const base: Record<string, Palette[]> = {
    veteran: [
      { name: "navy_gold_cream", fallback: "linear-gradient(145deg, #f5f0e8 0%, #1a2744 100%)", overlay: "linear-gradient(180deg, rgba(245,240,232,0.74) 0%, rgba(26,39,68,0.74) 52%, rgba(10,15,26,0.95) 100%)", glow: "inset 0 0 60px rgba(212,160,23,0.16)", eyebrow: "#8b1a1a", headline: "#1a2744", headlineBg: "rgba(245,240,232,0.92)", headlineBorder: "rgba(26,39,68,0.18)", subheadline: "#1a2744", accent: "#8b1a1a", cta: "#c0392b", panel: "rgba(245,240,232,0.9)", panelBorder: "rgba(26,39,68,0.18)", button: "navy", benefit: "dark" },
      { name: "distressed_flag_dark", fallback: "linear-gradient(160deg, #1a0a0a 0%, #0a0a2a 50%, #1a0a0a 100%)", overlay: "repeating-linear-gradient(0deg, rgba(0,0,0,0.16), rgba(0,0,0,0.16) 16px, rgba(192,57,43,0.18) 16px, rgba(192,57,43,0.18) 18px), linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.88) 100%)", glow: "inset 0 0 72px rgba(255,215,0,0.12)", eyebrow: "#ffd76a", headline: "#ffd76a", headlineBg: "rgba(0,0,0,0.52)", headlineBorder: "rgba(255,215,0,0.36)", subheadline: "#ffffff", accent: "#ffd76a", cta: "#c0392b", panel: "rgba(0,0,0,0.54)", panelBorder: "rgba(255,215,0,0.3)", button: "gold", benefit: "gold" },
      { name: "dark_premium_gold", fallback: "linear-gradient(145deg, #080b12 0%, #151000 100%)", overlay: "linear-gradient(180deg, rgba(8,11,18,0.35) 0%, rgba(8,11,18,0.98) 100%)", glow: "inset 0 0 82px rgba(201,168,76,0.18)", eyebrow: "#c9a84c", headline: "#ffffff", headlineBg: "rgba(8,11,18,0.76)", headlineBorder: "rgba(201,168,76,0.34)", subheadline: "#d7c58a", accent: "#c9a84c", cta: "#b8860b", panel: "rgba(8,11,18,0.76)", panelBorder: "rgba(201,168,76,0.34)", button: "gold", benefit: "gold" },
      makePalette("black_champagne_veteran", "#0a0a0a", "#c9a84c", "#ffffff", "#c9a84c", "#c9a84c", "#000000"),
      makePalette("deep_red_service", "#7b1113", "#ffffff", "#ffffff", "#f5c6c6", "#ffffff", "#7b1113"),
      makePalette("cream_paper_patriotic", "#f5f0e8", "#1a2744", "#1a2744", "#4a5568", "#1a2744", "#f5f0e8"),
      makePalette("green_gold_veteran", "#1a3a2a", "#d4af37", "#ffffff", "#a0c4a0", "#d4af37", "#000000"),
      makePalette("steel_blue_veteran", "#2d2d2d", "#4a90d9", "#ffffff", "#a0b8d0", "#4a90d9", "#ffffff"),
    ],
    trucker: [
      { name: "navy_orange", fallback: "linear-gradient(145deg, #070b16 0%, #14213d 50%, #2d1600 100%)", overlay: "linear-gradient(180deg, rgba(5,9,20,0.35) 0%, rgba(5,9,20,0.94) 100%)", glow: "inset 0 0 70px rgba(245,158,11,0.18)", eyebrow: "#f59e0b", headline: "#ffffff", headlineBg: "rgba(5,9,20,0.44)", headlineBorder: "rgba(245,158,11,0.18)", subheadline: "#e0faff", accent: "#f59e0b", cta: "#d97706", panel: "rgba(5,9,20,0.48)", panelBorder: "rgba(245,158,11,0.22)", button: "cyan", benefit: "cyan" },
      { name: "neon_cyan_amber", fallback: "linear-gradient(180deg, #050505 0%, #07131f 55%, #1a0e00 100%)", overlay: "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,10,16,0.72) 55%, rgba(0,0,0,0.96) 100%)", glow: "inset 0 0 70px rgba(0,229,255,0.22), inset 0 -90px 80px rgba(245,158,11,0.16)", eyebrow: "#00e5ff", headline: "#ffffff", headlineBg: "rgba(0,0,0,0.42)", headlineBorder: "rgba(0,229,255,0.26)", subheadline: "#fcd34d", accent: "#00e5ff", cta: "#1565c0", panel: "rgba(0,0,0,0.42)", panelBorder: "rgba(0,229,255,0.3)", button: "cyan", benefit: "cyan" },
      { name: "white_blue_clean", fallback: "linear-gradient(145deg, #eaf4ff 0%, #ffffff 50%, #dbeafe 100%)", overlay: "linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(219,234,254,0.58) 45%, rgba(15,35,70,0.82) 100%)", glow: "inset 0 0 0 7px rgba(29,78,216,0.08)", eyebrow: "#1d4ed8", headline: "#0f2346", headlineBg: "rgba(255,255,255,0.88)", headlineBorder: "rgba(29,78,216,0.18)", subheadline: "#1e3a5f", accent: "#1d4ed8", cta: "#1d4ed8", panel: "rgba(255,255,255,0.9)", panelBorder: "rgba(29,78,216,0.18)", button: "navy", benefit: "light" },
      makePalette("purple_red_trucker", "#1a1a2e", "#e94560", "#ffffff", "#a0a0c0", "#e94560", "#ffffff"),
      makePalette("white_blue_trucker", "#f5f5f5", "#1a1a2e", "#1a1a2e", "#555555", "#1a1a2e", "#ffffff"),
      makePalette("diesel_bronze", "#2c1810", "#f5a623", "#ffffff", "#d4956a", "#f5a623", "#000000"),
      makePalette("green_neon_trucker", "#0d3b2e", "#00e676", "#ffffff", "#80cbc4", "#00e676", "#000000"),
      makePalette("black_orange_trucker", "#1c1c1c", "#ff6b35", "#ffffff", "#ffb380", "#ff6b35", "#ffffff"),
    ],
    mortgage_protection: [
      { name: "red_white_navy", fallback: "linear-gradient(145deg, #f8f5f0 0%, #dbeafe 100%)", overlay: "linear-gradient(180deg, rgba(20,12,12,0.22) 0%, rgba(20,12,12,0.78) 100%)", glow: "inset 0 0 58px rgba(185,28,28,0.12)", eyebrow: "#b91c1c", headline: "#ffffff", headlineBg: "rgba(185,28,28,0.94)", headlineBorder: "rgba(255,255,255,0.18)", subheadline: "#4b5563", accent: "#b91c1c", cta: "#b91c1c", panel: "rgba(255,255,255,0.94)", panelBorder: "rgba(255,255,255,0.28)", button: "red", benefit: "light" },
      { name: "cream_gold_navy", fallback: "linear-gradient(145deg, #f8f5f0 0%, #efe3d0 58%, #1a2744 100%)", overlay: "linear-gradient(180deg, rgba(248,245,240,0.55) 0%, rgba(26,39,68,0.72) 100%)", glow: "inset 0 0 70px rgba(212,160,23,0.16)", eyebrow: "#d4a017", headline: "#1a2744", headlineBg: "rgba(248,245,240,0.93)", headlineBorder: "rgba(212,160,23,0.36)", subheadline: "#1a2744", accent: "#d4a017", cta: "#1a2744", panel: "rgba(248,245,240,0.93)", panelBorder: "rgba(212,160,23,0.36)", button: "gold", benefit: "light" },
      { name: "blue_trust", fallback: "linear-gradient(145deg, #dbeafe 0%, #ffffff 50%, #1e3a8a 100%)", overlay: "linear-gradient(180deg, rgba(219,234,254,0.62) 0%, rgba(30,58,138,0.76) 100%)", glow: "inset 0 0 70px rgba(29,78,216,0.18)", eyebrow: "#1d4ed8", headline: "#ffffff", headlineBg: "rgba(29,78,216,0.88)", headlineBorder: "rgba(255,255,255,0.2)", subheadline: "#1e3a5f", accent: "#1d4ed8", cta: "#1d4ed8", panel: "rgba(255,255,255,0.92)", panelBorder: "rgba(29,78,216,0.2)", button: "navy", benefit: "light" },
      makePalette("brown_cream_mortgage", "#f8f4ef", "#8b4513", "#2c1810", "#6b4c3b", "#8b4513", "#ffffff"),
      makePalette("cyan_dark_mortgage", "#0f2027", "#00d2ff", "#ffffff", "#7ecef0", "#00d2ff", "#000000"),
      makePalette("green_home_mortgage", "#1a472a", "#ffffff", "#ffffff", "#a8d5b5", "#ffffff", "#1a472a"),
      makePalette("clean_blue_mortgage", "#f0f4f8", "#2b6cb0", "#1a202c", "#4a5568", "#2b6cb0", "#ffffff"),
      makePalette("charcoal_gold_mortgage", "#2d3748", "#f6ad55", "#ffffff", "#e2c496", "#f6ad55", "#000000"),
    ],
    final_expense: [
      { name: "black_gold", fallback: "linear-gradient(145deg, #0f0e0a 0%, #2d2016 100%)", overlay: "linear-gradient(180deg, rgba(15,14,10,0.42) 0%, rgba(15,14,10,0.96) 100%)", glow: "inset 0 0 70px rgba(212,160,23,0.14)", eyebrow: "#d4a017", headline: "#ffffff", headlineBg: "rgba(15,14,10,0.48)", headlineBorder: "rgba(212,160,23,0.2)", subheadline: "#fff3c4", accent: "#d4a017", cta: "#a16207", panel: "rgba(15,14,10,0.5)", panelBorder: "rgba(212,160,23,0.22)", button: "gold", benefit: "gold" },
      { name: "cream_gold", fallback: "linear-gradient(145deg, #f8f5f0 0%, #e8dac2 100%)", overlay: "linear-gradient(180deg, rgba(248,245,240,0.92) 0%, rgba(45,32,22,0.86) 100%)", glow: "inset 0 0 0 7px rgba(212,160,23,0.09)", eyebrow: "#a16207", headline: "#2d2016", headlineBg: "rgba(255,255,255,0.82)", headlineBorder: "rgba(161,98,7,0.22)", subheadline: "#4a3728", accent: "#a16207", cta: "#2d2016", panel: "rgba(255,255,255,0.82)", panelBorder: "rgba(161,98,7,0.22)", button: "cream", benefit: "light" },
      { name: "dark_navy_gold", fallback: "linear-gradient(145deg, #0a1628 0%, #16213e 100%)", overlay: "linear-gradient(180deg, rgba(10,22,40,0.4) 0%, rgba(10,22,40,0.92) 100%)", glow: "inset 0 0 68px rgba(212,160,23,0.16)", eyebrow: "#d4a017", headline: "#ffffff", headlineBg: "rgba(22,33,62,0.72)", headlineBorder: "rgba(212,160,23,0.34)", subheadline: "#dbeafe", accent: "#d4a017", cta: "#a16207", panel: "rgba(22,33,62,0.72)", panelBorder: "rgba(212,160,23,0.34)", button: "gold", benefit: "gold" },
      makePalette("clean_white_final_expense", "#fafafa", "#2d3748", "#1a202c", "#4a5568", "#2d3748", "#ffffff"),
      makePalette("purple_final_expense", "#1a0a2e", "#9f7aea", "#ffffff", "#c4b0e8", "#9f7aea", "#ffffff"),
      makePalette("bronze_final_expense", "#744210", "#f6e05e", "#ffffff", "#f0d090", "#f6e05e", "#744210"),
      makePalette("green_final_expense", "#e8f5e9", "#2e7d32", "#1b5e20", "#4caf50", "#2e7d32", "#ffffff"),
      makePalette("black_gold_final_expense", "#1a1a1a", "#e2b96f", "#ffffff", "#c8a96e", "#e2b96f", "#000000"),
    ],
    iul: [
      { name: "deep_blue_gold", fallback: "linear-gradient(145deg, #0a1628 0%, #0f2040 100%)", overlay: "linear-gradient(180deg, rgba(10,22,40,0.38) 0%, rgba(10,22,40,0.92) 100%)", glow: "inset 0 0 70px rgba(212,160,23,0.16)", eyebrow: "#d4a017", headline: "#ffffff", headlineBg: "rgba(10,22,40,0.58)", headlineBorder: "rgba(212,160,23,0.28)", subheadline: "#93c5fd", accent: "#d4a017", cta: "#1d4ed8", panel: "rgba(10,22,40,0.58)", panelBorder: "rgba(212,160,23,0.28)", button: "gold", benefit: "gold" },
      { name: "black_champagne", fallback: "linear-gradient(135deg, #1a1200 0%, #0d0d0d 100%)", overlay: "linear-gradient(180deg, rgba(13,13,13,0.34) 0%, rgba(13,13,13,0.95) 100%)", glow: "inset 0 0 70px rgba(201,168,76,0.16)", eyebrow: "#c9a84c", headline: "#ffffff", headlineBg: "rgba(13,13,13,0.64)", headlineBorder: "rgba(201,168,76,0.3)", subheadline: "#c9a84c", accent: "#c9a84c", cta: "#b8860b", panel: "rgba(13,13,13,0.64)", panelBorder: "rgba(201,168,76,0.3)", button: "gold", benefit: "gold" },
      { name: "clean_blue_white", fallback: "linear-gradient(145deg, #f0f4ff 0%, #dbeafe 100%)", overlay: "linear-gradient(180deg, rgba(240,244,255,0.86) 0%, rgba(29,78,216,0.78) 100%)", glow: "inset 0 0 0 7px rgba(29,78,216,0.08)", eyebrow: "#1d4ed8", headline: "#ffffff", headlineBg: "rgba(29,78,216,0.9)", headlineBorder: "rgba(255,255,255,0.2)", subheadline: "#1e3a5f", accent: "#1d4ed8", cta: "#1d4ed8", panel: "rgba(255,255,255,0.9)", panelBorder: "rgba(29,78,216,0.2)", button: "navy", benefit: "light" },
      makePalette("teal_navy_iul", "#0a192f", "#64ffda", "#ffffff", "#8892b0", "#64ffda", "#000000"),
      makePalette("espresso_iul", "#f7f3ef", "#5c4033", "#3c2415", "#7d5a4f", "#5c4033", "#ffffff"),
      makePalette("red_navy_iul", "#1b1b2f", "#e43f5a", "#ffffff", "#c080a0", "#e43f5a", "#ffffff"),
      makePalette("green_iul", "#f0fff4", "#276749", "#1c4532", "#2f855a", "#276749", "#ffffff"),
      makePalette("charcoal_gold_iul", "#2a2a2a", "#ffd700", "#ffffff", "#d4b800", "#ffd700", "#000000"),
    ],
  };
  const referencePaletteNames: Record<string, string[]> = {
    veteran: ["navy_gold_cream", "distressed_flag_dark", "dark_premium_gold", "black_champagne_veteran", "cream_paper_patriotic"],
    trucker: ["navy_orange", "neon_cyan_amber", "diesel_bronze", "black_orange_trucker"],
    mortgage_protection: ["red_white_navy", "cream_gold_navy", "blue_trust", "brown_cream_mortgage", "clean_blue_mortgage"],
    final_expense: ["black_gold", "cream_gold", "dark_navy_gold", "green_final_expense", "black_gold_final_expense"],
    iul: ["deep_blue_gold", "black_champagne", "clean_blue_white", "charcoal_gold_iul"],
  };
  const palettes = base[leadType] || base.final_expense;
  const allowed = new Set(referencePaletteNames[leadType] || referencePaletteNames.final_expense);
  return palettes.filter((palette) => allowed.has(palette.name));
}

function buildCreativeState(draft: any, leadType: string, overlay: ReturnType<typeof getOverlay>): CreativeState {
  const spanish = draft?.language === "es" || draft?.audienceSegment === "spanish";
  const language = spanish ? "es" : "en";
  const copy = getRendererCopy(language);
  const audienceSegment = cleanText(draft?.audienceSegment || "standard").toLowerCase();
  const seed = hashString(getVariationSeed(draft, leadType));
  const variantIndex = pickVisualVariant(draft, leadType, VISUAL_VARIANT_COUNT);
  const basePalette = getPalettes(leadType)[variantIndex % getPalettes(leadType).length];
  const layoutFamily = resolveCreativeLayoutFamily(draft, leadType, seed, variantIndex);
  const backgroundUrl = getCreativeBackground(draft, leadType, variantIndex, layoutFamily);
  const palette = backgroundUrl
    ? {
        ...basePalette,
        eyebrow: "#f8cf5a",
        headline: "#ffffff",
        headlineBg: "rgba(0,0,0,0.66)",
        headlineBorder: "rgba(255,255,255,0.24)",
        subheadline: "#ffffff",
        accent: "#f8cf5a",
        panel: "rgba(0,0,0,0.66)",
        panelBorder: "rgba(255,255,255,0.24)",
        buttonBg: basePalette.cta,
        buttonText: "#ffffff",
        buttonBorder: "1.5px solid rgba(255,255,255,0.55)",
        benefit: "dark" as const,
      }
    : basePalette;
  const iaFamily = pickSeeded(IA_BY_LEAD_TYPE[leadType] || IA_BY_LEAD_TYPE.final_expense, seed + variantIndex * 17, "ia");
  // Creative quality must not depend on decorative randomness. The old frame
  // roulette could place diagonal bands and corner badges directly through
  // copy. Keep the variation in the actual offer, photo, palette and layout.
  const densityStyle: DensityStyle = "balanced";
  const typographyStyle: TypographyStyle = "premium_clean";
  const frameStyle: FrameStyle = "full_bleed";
  const overlayStyle: OverlayStyle = "deep_gradient";
  const fp = String(draft?.uniquenessFingerprint || "");
  const hash2 = Math.abs(hashString(`${fp}pad`));
  const hash3 = Math.abs(hashString(`${fp}gap`));
  const padOptions = [14, 18, 22, 26];
  const gapOptions = [8, 10, 12, 14];
  const ctaFlow: CtaFlow = "bottom_bar";
  const density = { pad: padOptions[hash2 % 4], gap: gapOptions[hash3 % 4], lineHeight: 1.08 };
  const productLabel = cleanText(draft?.visibleIdentityLabel) || (Number(draft?.creativeEngineVersion || 0) >= 1
    ? getVisibleIdentityLabel({ vertical: leadType, audienceSegment, language })
    : getProductLabel(leadType, audienceSegment, spanish));
  const headlineRaw = overlay.headline || cleanText(draft?.headline) || getLeadFallbackHeadline(leadType, spanish);
  const productClear = isProductClear(headlineRaw, leadType, spanish);
  const headline = clampCopy(productClear ? headlineRaw : productLabel, 58);
  const headlineSize = Math.max(20, 27 - (headline.length > 42 ? 3 : 0));
  const fallbackButtons = leadType === "mortgage_protection"
    ? ["$250,000", "$400,000", "$600,000"]
    : leadType === "trucker"
    ? ["35-44", "45-54", "55-64", "65+"]
    : ["Under 50", "50-60", "61-70", "71+"];
  const localizedFallbackButtons = spanish
    ? (leadType === "mortgage_protection"
      ? ["$250,000", "$400,000", "$600,000"]
      : ["Menos de 50", "50-60", "61-70", "71+"])
    : fallbackButtons;

  const rawButtons = (overlay.buttonLabels.length ? overlay.buttonLabels : localizedFallbackButtons).slice(0, 4);
  const localizedContract = draft?.selectorContract
    ? localizeSelectorContract(draft.selectorContract, language)
    : null;
  const buttons = spanish && localizedContract?.options?.length
    ? localizedContract.options.slice(0, 4)
    : rawButtons;

  return {
    draft,
    leadType,
    headline,
    // Feed-image copy must always be a complete, product-specific thought.
    // Longer funnel copy remains available in the post and landing page.
    subheadline: Number(draft?.creativeEngineVersion || 0) >= 1
      ? clampCopy(overlay.subheadline || draft?.primaryText || getVisualSubheadline(leadType, audienceSegment, seed + variantIndex, spanish), 92)
      : getVisualSubheadline(leadType, audienceSegment, seed + variantIndex, spanish),
    buttons,
    bullets: overlay.benefitBullets.slice(0, 3),
    cta: clampCopy(overlay.ctaStrip || (spanish ? "Conozca sus opciones →" : "Learn more ->"), 42),
    eyebrow: productLabel,
    // A selector answer is not a coverage promise. Only an amount explicitly
    // approved on the winning family may become the hero value.
    amount: cleanText(draft?.displayAmount),
    backgroundUrl,
    layoutFamily,
    iaFamily,
    frameStyle,
    densityStyle,
    typographyStyle,
    ctaFlow,
    overlayStyle,
    palette,
    seed,
    variantIndex,
    headlineSize,
    subSize: 12,
    gap: density.gap,
    pad: density.pad,
    radius: 8,
    lineHeight: density.lineHeight,
    spanish,
    copy,
  };
}

function getOverlayBackground(state: CreativeState): string {
  if (state.backgroundUrl) {
    return "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.20) 46%, rgba(0,0,0,0.72) 100%)";
  }
  if (state.overlayStyle === "soft_gradient") return "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(0,0,0,0.62) 100%)";
  if (state.overlayStyle === "hard_vignette") return "radial-gradient(circle at 50% 24%, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.8) 72%)";
  if (state.overlayStyle === "paper_wash") return "linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(0,0,0,0.42) 100%)";
  if (state.overlayStyle === "neon_glow") return "linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.84) 100%)";
  return state.palette.overlay;
}

function CreativeShell({ state, children }: { state: CreativeState; children: any }) {
  const baseBackground = state.backgroundUrl
    ? { backgroundImage: `url("${state.backgroundUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: state.palette.fallback };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", ...baseBackground }}>
      <div style={{ position: "absolute", inset: 0, background: getOverlayBackground(state) }} />
      <div style={{ position: "absolute", inset: 0, boxShadow: state.palette.glow }} />
      {children}
    </div>
  );
}

function Panel({ state, children, style = {} }: { state: CreativeState; children: any; style?: any }) {
  return (
    <div
      style={{
        background: state.frameStyle === "soft_glass" ? "rgba(255,255,255,0.18)" : state.palette.panel,
        border: `1px solid ${state.palette.panelBorder}`,
        borderRadius: state.radius,
        boxShadow: "0 14px 30px rgba(0,0,0,0.25)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function HeadlineBlock({ state, compact = false }: { state: CreativeState; compact?: boolean }) {
  const showEyebrow = state.eyebrow.toLowerCase() !== state.headline.toLowerCase();
  return (
    <div style={{ color: state.palette.headline, background: state.palette.headlineBg, border: `1px solid ${state.palette.headlineBorder}`, borderRadius: state.radius, padding: compact ? "8px 10px" : "10px 12px" }}>
      {showEyebrow && (
        <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 2, marginBottom: 5, textTransform: "uppercase" }}>
          {state.eyebrow}
        </div>
      )}
      <div style={{ fontSize: compact ? state.headlineSize - 3 : state.headlineSize, fontWeight: 950, lineHeight: state.lineHeight, textTransform: "uppercase", ...lineClampStyle(2) }}>
        {state.headline}
      </div>
      {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: state.subSize, fontWeight: 800, lineHeight: 1.28, marginTop: 6, ...lineClampStyle(2) }}>{state.subheadline}</div>}
    </div>
  );
}

function CtaUnit({ state, flow }: { state: CreativeState; flow?: CtaFlow }) {
  const ctaFlow = flow || state.ctaFlow;
  const base = {
    background: state.palette.cta,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    boxShadow: "0 10px 22px rgba(0,0,0,0.22)",
  };
  if (ctaFlow === "bottom_bar") return <BottomBar color={state.palette.cta} label={state.cta} />;
  if (ctaFlow === "floating_cta") return <div style={{ ...base, position: "absolute", right: 16, bottom: 14, borderRadius: 999, padding: "10px 15px", maxWidth: 184 }}>{state.cta}</div>;
  if (ctaFlow === "stacked_cta") return <div style={{ ...base, borderRadius: state.radius, minHeight: 38, marginTop: state.gap }}>{state.cta}</div>;
  if (ctaFlow === "inline_cta") return <span style={{ ...base, display: "inline-flex", borderRadius: 999, padding: "8px 12px" }}>{state.cta}</span>;
  return <div style={{ ...base, borderRadius: state.radius, minHeight: 38, padding: "0 10px" }}>{state.cta}</div>;
}

function MiniBenefits({ state, columns = 1 }: { state: CreativeState; columns?: number }) {
  const bullets = state.bullets.length ? state.bullets : [state.copy.compareOptions, state.copy.coverageFit, state.copy.nextStep];
  return (
    <div style={{ display: "grid", gridTemplateColumns: columns === 2 ? "1fr 1fr" : "1fr", gap: 7 }}>
      {bullets.slice(0, columns === 2 ? 2 : 3).map((bullet, index) => (
        <div key={`${bullet}-${index}`} style={{ background: state.palette.panel, border: `1px solid ${state.palette.panelBorder}`, borderRadius: state.radius, padding: "8px 9px", color: state.palette.subheadline, fontSize: 11, fontWeight: 850, lineHeight: 1.18 }}>
          <span style={{ color: state.palette.accent, fontWeight: 950 }}>✓ </span>{bullet}
        </div>
      ))}
    </div>
  );
}

function renderPosterStack(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: state.gap, textAlign: "center" }}>
        <HeadlineBlock state={state} />
        <div style={{ marginTop: "auto", display: "grid", gap: state.gap }}>
          {state.amount && <div><div style={{ color: state.palette.eyebrow, fontSize: 9, fontWeight: 950, letterSpacing: 1.1 }}>{state.copy.coverageOptionsUpTo}</div><div style={{ color: state.palette.accent, fontSize: 42, fontWeight: 950, lineHeight: 1, textShadow: "0 3px 14px rgba(0,0,0,0.55)" }}>{state.amount}</div><div style={{ color: state.palette.subheadline, fontSize: 8.5, fontWeight: 700, marginTop: 3 }}>{state.copy.amountDisclosure}</div></div>}
          <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
          <MiniBenefits state={state} />
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow={state.ctaFlow} />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderSplitPanel(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div data-creative-composition="problem-consequence-offer" style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", display: "grid", gridTemplateRows: "auto 1fr auto", padding: state.pad, gap: state.gap, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad }}>
        <HeadlineBlock state={state} compact />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, alignContent: "center" }}>
          <Panel state={state} style={{ padding: 12, minWidth: 0 }}>
            <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.4 }}>{state.copy.whatToReview}</div>
            <div style={{ color: state.palette.subheadline, fontSize: 12, fontWeight: 850, lineHeight: 1.3, marginTop: 8 }}>{state.subheadline}</div>
          </Panel>
          <Panel state={state} style={{ padding: 12, minWidth: 0 }}>
            <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.4 }}>{state.copy.nextStep.toUpperCase()}</div>
            {state.amount && <div style={{ color: state.palette.accent, fontSize: 30, fontWeight: 950, lineHeight: 1, marginTop: 8 }}>{state.amount}</div>}
            <div style={{ marginTop: 8 }}><MiniBenefits state={state} /></div>
          </Panel>
        </div>
        <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function getSelectorPrompt(state: CreativeState): string {
  const contractLabel = cleanText(state.draft?.selectorContract?.label);
  if (Number(state.draft?.creativeEngineVersion || 0) >= 1 && contractLabel) {
    const localized = localizeSelectorContract(state.draft.selectorContract, state.spanish ? "es" : "en");
    return cleanText(localized.label).toUpperCase();
  }
  const hasAmountChoices = state.buttons.some((label) => /\$/.test(label));
  if (state.leadType === "mortgage_protection") {
    return state.spanish ? "ELIJA EL SALDO DE SU HIPOTECA" : "SELECT YOUR MORTGAGE BALANCE";
  }
  if (hasAmountChoices) {
    return state.spanish ? "ELIJA UN MONTO DE COBERTURA" : "CHOOSE A COVERAGE AMOUNT";
  }
  if (state.leadType === "iul") {
    return state.spanish ? "ELIJA LO QUE DESEA CONOCER" : "CHOOSE WHAT YOU WANT TO LEARN";
  }
  return state.spanish ? "ELIJA SU EDAD" : "SELECT YOUR AGE";
}

function renderSelectorGrid(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "grid", gridTemplateRows: "auto 1fr auto", gap: state.gap, textAlign: "center" }}>
        <HeadlineBlock state={state} compact />
        <Panel state={state} style={{ padding: 11, alignSelf: "center" }}>
          <div style={{ color: state.palette.accent, fontSize: 12, fontWeight: 950, marginBottom: 9, letterSpacing: 1 }}>{getSelectorPrompt(state)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {state.buttons.map((label) => (
              <div key={label} style={{ background: state.palette.headlineBg, color: state.palette.headline, border: `1.5px solid ${state.palette.accent}`, borderRadius: state.radius, padding: "10px 7px", fontSize: 12, fontWeight: 950, lineHeight: 1 }}>
                {label}
              </div>
            ))}
          </div>
        </Panel>
        {state.ctaFlow === "bottom_bar" ? <MiniBenefits state={state} columns={2} /> : <CtaUnit state={state} flow="selector_cta" />}
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderChecklistFirst(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div data-creative-composition="licensed-agent-explainer" style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: state.gap }}>
        <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.5, textAlign: "center" }}>{state.copy.licensedAgentExplainer}</div>
        <MiniBenefits state={state} />
        <Panel state={state} style={{ padding: 12, marginTop: "auto", textAlign: "center" }}>
          <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 2 }}>{state.eyebrow}</div>
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.02, textTransform: "uppercase", marginTop: 6 , ...lineClampStyle(2) }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 12, fontWeight: 800, marginTop: 7 , ...lineClampStyle(2) }}>{state.subheadline}</div>}
          <div style={{ marginTop: 10 }}><ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} /></div>
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="stacked_cta" />}
        </Panel>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderAmountHero(state: CreativeState) {
  const selectionLabel = getSelectorPrompt(state);

  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, textAlign: "center", display: "flex", flexDirection: "column", gap: state.gap }}>
        <div style={{ color: state.palette.eyebrow, fontSize: 11, fontWeight: 950, letterSpacing: 2.2 }}>{state.eyebrow}</div>
        {state.amount && (
          <div><div style={{ color: state.palette.eyebrow, fontSize: 9, fontWeight: 950, letterSpacing: 1.1 }}>{state.copy.coverageOptionsUpTo}</div><div style={{ color: state.palette.accent, fontSize: 54, fontWeight: 950, lineHeight: 0.95, marginTop: 4, textShadow: "0 4px 18px rgba(0,0,0,0.65)" }}>{state.amount}</div><div style={{ color: state.palette.subheadline, fontSize: 8.5, fontWeight: 700, marginTop: 3 }}>{state.copy.amountDisclosure}</div></div>
        )}
        <div style={{ color: state.palette.headline, fontSize: state.amount ? state.headlineSize : Math.max(30, state.headlineSize + 5), fontWeight: 950, lineHeight: 1.02, textTransform: "uppercase", marginTop: state.amount ? 0 : 12, ...lineClampStyle(2) }}>{state.headline}</div>
        {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: state.subSize, fontWeight: 800, lineHeight: 1.3, maxWidth: "88%", margin: "0 auto" , ...lineClampStyle(2) }}>{state.subheadline}</div>}
        <div style={{ marginTop: "auto", display: "grid", gap: state.gap }}>
          <MiniBenefits state={state} columns={2} />
          <div style={{ color: state.palette.headline, fontSize: 10, fontWeight: 950, letterSpacing: 1.1, textTransform: "uppercase" }}>{selectionLabel}</div>
          <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="stacked_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderComparisonTable(state: CreativeState) {
  const bullets = state.bullets.length ? state.bullets : [state.copy.compareOptions, state.copy.coverageFit, state.copy.nextStep];
  const leftTitle = state.leadType === "iul" ? state.copy.howItWorks : state.copy.whatToReview;
  const rightTitle = state.leadType === "iul" ? state.copy.keyTradeoffs : state.copy.options;
  return (
    <CreativeShell state={state}>
      <div data-creative-composition="balanced-comparison" style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "grid", gridTemplateRows: "auto 1fr auto", gap: state.gap }}>
        <HeadlineBlock state={state} compact />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, minHeight: 0, alignContent: "center" }}>
          {[leftTitle, rightTitle].map((title, column) => (
            <Panel key={title} state={state} style={{ padding: 11, minWidth: 0 }}>
              <div style={{ color: state.palette.accent, fontSize: 10, fontWeight: 950, letterSpacing: 1.1, textTransform: "uppercase", minHeight: 24 }}>{title}</div>
              {bullets.slice(column, column + 2).map((bullet) => (
                <div key={bullet} style={{ color: state.palette.subheadline, fontSize: 11, fontWeight: 850, lineHeight: 1.25, marginTop: 9, display: "flex", gap: 5 }}><span style={{ color: state.palette.accent }}>✓</span><span>{bullet}</span></div>
              ))}
            </Panel>
          ))}
        </div>
        <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

/**
 * This layout used to imitate a one-question lead form. It read as a broken
 * survey in-feed (especially on final-expense ads), so it is deliberately a
 * direct-response offer instead: one promise, a meaningful visual, compact
 * proof points, and an age/coverage selector. The stable layout key remains
 * `quiz_card` so only the existing weak variants are replaced.
 */
function renderDirectResponseOffer(state: CreativeState) {
  const offerLabel: Record<string, string> = {
    veteran: "PRIVATE COVERAGE FOR VETERANS",
    trucker: "TRUCK DRIVER LIFE COVERAGE",
    mortgage_protection: "MORTGAGE PROTECTION",
    final_expense: "FINAL EXPENSE COVERAGE",
    iul: "INDEXED UNIVERSAL LIFE",
  };
  const selectorLabel = getSelectorPrompt(state);

  return (
    <CreativeShell state={state}>
      <div data-creative-composition="educational-assessment" style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: state.gap, textAlign: "center" }}>
        <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.7, textTransform: "uppercase" }}>
          {state.spanish ? state.eyebrow : (offerLabel[state.leadType] || state.eyebrow)} • {state.copy.education}
        </div>
        <Panel state={state} style={{ padding: "12px 12px 11px" }}>
          {state.amount && <div style={{ color: state.palette.accent, fontSize: 39, fontWeight: 950, lineHeight: 0.98, letterSpacing: -1, textShadow: "0 3px 14px rgba(0,0,0,0.28)" }}>{state.amount}</div>}
          <div style={{ color: state.palette.headline, fontSize: state.amount ? Math.max(19, state.headlineSize - 4) : state.headlineSize, fontWeight: 950, lineHeight: 1.03, textTransform: "uppercase", marginTop: state.amount ? 7 : 0 , ...lineClampStyle(2) }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 11, fontWeight: 800, lineHeight: 1.28, marginTop: 7 , ...lineClampStyle(2) }}>{state.subheadline}</div>}
        </Panel>
        <div style={{ marginTop: "auto", display: "grid", gap: 8 }}>
          <Panel state={state} style={{ padding: 9, color: state.palette.subheadline, fontSize: 11, fontWeight: 850 }}>
            {state.copy.whatToReview}: {state.bullets.slice(0, 2).join(" • ")}
          </Panel>
          <div style={{ color: state.palette.headline, fontSize: 10, fontWeight: 950, letterSpacing: 1.1, textTransform: "uppercase" }}>{selectorLabel}</div>
          <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="panel_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderReportCard(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div data-creative-composition="video-framework" style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "grid", gridTemplateRows: "auto 1fr auto", gap: state.gap }}>
        <Panel state={state} style={{ padding: 11 }}>
          <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.4 }}>{state.copy.videoFramework}</div>
          <div style={{ color: state.palette.subheadline, fontSize: 9.5, fontWeight: 900, letterSpacing: 1.1, marginTop: 4 }}>{state.eyebrow}</div>
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.04, textTransform: "uppercase", marginTop: 7 }}>{state.headline}</div>
        </Panel>
        <div style={{ position: "relative", minHeight: 0, borderRadius: state.radius, border: `1px solid ${state.palette.panelBorder}`, background: state.backgroundUrl ? "rgba(0,0,0,0.18)" : state.palette.panel, display: "grid", placeItems: "center" }}>
          <div style={{ width: 62, height: 62, borderRadius: 999, display: "grid", placeItems: "center", background: state.palette.cta, color: "#fff", fontSize: 26, boxShadow: "0 10px 25px rgba(0,0,0,0.35)" }}>▶</div>
          <div style={{ position: "absolute", left: 10, right: 10, bottom: 10, background: "rgba(0,0,0,0.72)", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 11, fontWeight: 850 }}>
            {state.copy.licensedAgentExplainer}
          </div>
        </div>
        <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderAdvisoryNotice(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: state.gap }}>
        <div style={{ background: state.palette.cta, color: "#fff", padding: "9px 12px", borderRadius: state.radius, fontSize: 12, fontWeight: 950, letterSpacing: 1 }}>IMPORTANT COVERAGE NOTICE</div>
        <Panel state={state} style={{ padding: 14, textAlign: "left" }}>
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.03, textTransform: "uppercase" , ...lineClampStyle(2) }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 12, fontWeight: 800, lineHeight: 1.35, marginTop: 8 , ...lineClampStyle(2) }}>{state.subheadline}</div>}
        </Panel>
        <MiniBenefits state={state} />
        <div style={{ marginTop: "auto" }}>{state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="inline_cta" />}</div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderMessengerPrompt(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ alignSelf: "flex-start", maxWidth: "82%", background: state.palette.panel, border: `1px solid ${state.palette.panelBorder}`, borderRadius: "14px 14px 14px 4px", padding: 11, color: state.palette.headline, fontSize: 18, fontWeight: 950, lineHeight: 1.05 , ...lineClampStyle(2) }}>{state.headline}</div>
        {state.subheadline && <div style={{ alignSelf: "flex-end", maxWidth: "78%", background: state.palette.headlineBg, border: `1px solid ${state.palette.headlineBorder}`, borderRadius: "14px 14px 4px 14px", padding: 10, color: state.palette.subheadline, fontSize: 12, fontWeight: 850 , ...lineClampStyle(2) }}>{state.subheadline}</div>}
        <div style={{ marginTop: "auto", display: "grid", gap: 8 }}>
          {state.buttons.slice(0, 3).map((button) => <div key={button} style={{ background: state.palette.cta, color: "#fff", borderRadius: 999, padding: "9px 12px", textAlign: "center", fontSize: 12, fontWeight: 950 }}>{button}</div>)}
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="floating_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderBenefitGrid(state: CreativeState) {
  const benefitLabels = state.bullets.length
    ? state.bullets
    : [state.copy.compareOptions, state.copy.coverageFit, state.copy.familyGoals, state.copy.nextStep];
  const veteranTheme = state.leadType === "veteran" || state.draft?.audienceSegment === "veteran";
  const visualState = veteranTheme ? {
    ...state,
    palette: {
      ...state.palette,
      headline: "#13213d",
      subheadline: "#24324a",
      eyebrow: "#7f1d1d",
      accent: "#7f1d1d",
      panel: "rgba(255,255,255,0.96)",
      panelBorder: "rgba(19,33,61,0.24)",
      buttonBg: "#13213d",
      buttonText: "#ffffff",
      buttonBorder: "1.5px solid #7f1d1d",
    },
  } : state;
  return (
    <CreativeShell state={visualState}>
      <div data-creative-composition="audience-benefit-grid" style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 14, paddingBottom: 50, display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 9, background: veteranTheme ? "linear-gradient(135deg, rgba(245,240,232,0.98), rgba(255,255,255,0.94))" : undefined, border: veteranTheme ? "6px solid rgba(127,29,29,0.9)" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: visualState.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.7 }}>
          <span>{state.eyebrow}</span>
          <span style={{ color: visualState.palette.accent }}>{state.leadType === "iul" ? state.copy.education : state.copy.options}</span>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: visualState.palette.headline, fontSize: state.headlineSize + 1, fontWeight: 950, lineHeight: 1, textTransform: "uppercase" , ...lineClampStyle(2) }}>{state.headline}</div>
          {state.amount && <div><div style={{ color: visualState.palette.eyebrow, fontSize: 9, fontWeight: 950, letterSpacing: 1.1, marginTop: 6 }}>{state.copy.coverageOptionsUpTo}</div><div style={{ color: visualState.palette.accent, fontSize: 45, fontWeight: 950, lineHeight: 0.95, marginTop: 3 }}>{state.amount}</div><div style={{ color: visualState.palette.subheadline, fontSize: 8.5, fontWeight: 700, marginTop: 3 }}>{state.copy.amountDisclosure}</div></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignContent: "center" }}>
          {benefitLabels.slice(0, 4).map((benefit, index) => (
            <Panel key={`${benefit}-${index}`} state={visualState} style={{ padding: "10px 8px", minHeight: 58, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", color: visualState.palette.subheadline, fontSize: 11, fontWeight: 950, lineHeight: 1.15 }}>
              {benefit}
            </Panel>
          ))}
        </div>
        <ButtonGrid labels={state.buttons} styleType={visualState.palette.button} customStyle={getButtonStyle(visualState)} />
      </div>
      <CtaUnit state={state} />
    </CreativeShell>
  );
}

function renderPriceTable(state: CreativeState) {
  const rows = state.buttons.length ? state.buttons : state.leadType === "final_expense" ? ["$5k", "$10k", "$15k", "$25k"] : ["$250,000", "$400,000", "$600,000"];
  const amountLabel = state.leadType === "mortgage_protection"
    ? (state.spanish ? "SALDO HIPOTECARIO" : "MORTGAGE BALANCE")
    : (state.spanish ? "COBERTURA" : "COVERAGE OPTION");
  const reviewLabel = state.spanish ? "VER OPCIONES" : "VIEW OPTIONS";
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 15, paddingBottom: 52, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
        <HeadlineBlock state={state} compact />
        <Panel state={state} style={{ alignSelf: "center", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", background: state.palette.cta, color: "#fff", padding: "9px 10px", fontSize: 10, fontWeight: 950, letterSpacing: 1 }}>
            <span>{amountLabel}</span><span>{reviewLabel}</span>
          </div>
          {rows.slice(0, 4).map((row, index) => (
            <div key={`${row}-${index}`} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", padding: "9px 10px", borderBottom: index === rows.length - 1 ? "none" : `1px solid ${state.palette.panelBorder}`, color: state.palette.subheadline, fontSize: 12, fontWeight: 900, background: index % 2 === 0 ? "rgba(255,255,255,0.08)" : "transparent" }}>
              <span>{row}</span><span style={{ color: state.palette.accent }}>{reviewLabel}</span>
            </div>
          ))}
        </Panel>
        <MiniBenefits state={state} columns={2} />
      </div>
      <CtaUnit state={state} />
    </CreativeShell>
  );
}

function renderAgeSelector(state: CreativeState) {
  const showEyebrow = state.eyebrow.toLowerCase() !== state.headline.toLowerCase();
  return (
    <CreativeShell state={state}>
      <div data-creative-layout="graphic-age-selector" style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 16, paddingBottom: 54, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, textAlign: "center" }}>
        <Panel state={state} style={{ padding: "12px 13px" }}>
          {showEyebrow && <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 2, textTransform: "uppercase" }}>{state.eyebrow}</div>}
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize + 1, fontWeight: 950, lineHeight: 1, textTransform: "uppercase", marginTop: showEyebrow ? 6 : 0, ...lineClampStyle(2) }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 11, fontWeight: 850, lineHeight: 1.25, marginTop: 7, ...lineClampStyle(2) }}>{state.subheadline}</div>}
        </Panel>
        <div data-creative-zone="offer" style={{ alignSelf: "center", display: "grid", gap: 9 }}>
          {state.amount && <div style={{ color: state.palette.accent, fontSize: 45, fontWeight: 950, lineHeight: 0.95, textShadow: "0 3px 14px rgba(0,0,0,0.34)" }}>{state.amount}</div>}
          <MiniBenefits state={state} columns={2} />
          <div style={{ color: state.palette.headline, fontSize: 11, fontWeight: 950, letterSpacing: 1.2, textTransform: "uppercase" }}>{getSelectorPrompt(state)}</div>
        </div>
        <div data-creative-zone="selector" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          {state.buttons.slice(0, 4).map((button) => (
            <div key={button} style={{ background: state.palette.cta, color: "#fff", border: `2px solid ${state.palette.accent}`, borderRadius: 8, padding: "11px 8px", fontSize: 13, fontWeight: 950, boxShadow: "0 10px 22px rgba(0,0,0,0.24)" }}>
              {button}
            </div>
          ))}
        </div>
      </div>
      <CtaUnit state={state} />
    </CreativeShell>
  );
}

function renderPhotoDirectResponse(state: CreativeState) {
  const audienceSegment = cleanText(state.draft?.audienceSegment).toLowerCase();
  const visualLeadType = audienceSegment === "veteran" || audienceSegment === "trucker"
    ? audienceSegment
    : state.leadType;
  const themes: Record<string, { header: string; surface: string; ink: string; accent: string; cta: string }> = {
    veteran: { header: "#101d38", surface: "#f5f0e8", ink: "#17233d", accent: "#d4af37", cta: "#b4232f" },
    trucker: { header: "#07131f", surface: "#f3f6f8", ink: "#102235", accent: "#f59e0b", cta: "#b45309" },
    mortgage_protection: { header: "#123b63", surface: "#f8fbff", ink: "#17324d", accent: "#5fbf9f", cta: "#2477a8" },
    final_expense: { header: "#1f2937", surface: "#faf7f1", ink: "#2d2418", accent: "#d4a017", cta: "#8a5a12" },
    iul: { header: "#0b2345", surface: "#f5f9ff", ink: "#10294a", accent: "#5ba9e6", cta: "#2563a6" },
  };
  const theme = themes[visualLeadType] || themes[state.leadType] || themes.final_expense;
  const showEyebrow = state.eyebrow.toLowerCase() !== state.headline.toLowerCase();
  const selectorColumns = state.buttons.length === 3 ? "repeat(3, 1fr)" : "1fr 1fr";

  return (
    <div data-creative-layout="photo-direct-response" style={{ position: "absolute", inset: 0, overflow: "hidden", background: theme.surface, color: theme.ink }}>
      <div style={{ height: "100%", boxSizing: "border-box", paddingBottom: 44, display: "grid", gridTemplateRows: "auto minmax(168px, 1fr) auto" }}>
        <div data-creative-zone="headline" style={{ background: theme.header, color: "#ffffff", padding: "12px 16px 11px", textAlign: "center", borderBottom: `4px solid ${theme.accent}` }}>
          {showEyebrow && <div style={{ color: theme.accent, fontSize: 9, fontWeight: 950, letterSpacing: 1.9, textTransform: "uppercase", marginBottom: 5 }}>{state.eyebrow}</div>}
          <div style={{ fontSize: Math.min(27, state.headlineSize + 1), fontWeight: 950, lineHeight: 1.01, textTransform: "uppercase", ...lineClampStyle(2) }}>{state.headline}</div>
          <div style={{ color: "#e8edf5", fontSize: 11, fontWeight: 750, lineHeight: 1.25, marginTop: 6, ...lineClampStyle(2) }}>{state.subheadline}</div>
        </div>
        <div
          data-creative-zone="photo"
          style={{
            position: "relative",
            minHeight: 168,
            overflow: "hidden",
            background: theme.header,
            boxShadow: "inset 0 -36px 38px rgba(0,0,0,0.34)",
          }}
        >
          <img
            src={state.backgroundUrl}
            alt=""
            aria-hidden="true"
            data-creative-photo="true"
            data-creative-photo-src={state.backgroundUrl}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: "cover",
              objectPosition: "center",
            }}
          />
          {state.amount && (
            <div style={{ position: "absolute", left: 14, bottom: 12, background: "rgba(7,19,31,0.88)", color: "#ffffff", border: `2px solid ${theme.accent}`, borderRadius: 8, padding: "7px 11px", fontSize: 30, fontWeight: 950, lineHeight: 1 }}>
              {state.amount}
            </div>
          )}
        </div>
        <div data-creative-zone="selector" style={{ background: theme.surface, padding: "9px 14px 11px", borderTop: `1px solid ${theme.accent}66` }}>
          <div style={{ color: theme.ink, fontSize: 10, fontWeight: 950, letterSpacing: 1.1, textAlign: "center", textTransform: "uppercase", marginBottom: 7 }}>{getSelectorPrompt(state)}</div>
          <div style={{ display: "grid", gridTemplateColumns: selectorColumns, gap: 7 }}>
            {state.buttons.slice(0, 4).map((button) => (
              <div key={button} style={{ minHeight: 34, display: "flex", alignItems: "center", justifyContent: "center", background: theme.header, color: "#ffffff", border: `2px solid ${theme.accent}`, borderRadius: 7, padding: "5px 6px", textAlign: "center", fontSize: button.length > 11 ? 10 : 12, fontWeight: 950, lineHeight: 1.05 }}>
                {button}
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomBar color={theme.cta} label={state.cta} />
    </div>
  );
}

function renderGraphicDirectResponse(state: CreativeState) {
  const selectionLabel = getSelectorPrompt(state);
  const showAmount = Boolean(state.amount);
  const compactButtons = state.buttons.some((button) => button.length > 11);

  return (
    <CreativeShell state={state}>
      <div data-creative-layout="graphic-direct-response" style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 16, paddingBottom: 54, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, textAlign: "center" }}>
        <HeadlineBlock state={state} compact />
        <div data-creative-zone="offer" style={{ alignSelf: "stretch", display: "grid", alignContent: "center", gap: 10 }}>
          {showAmount && (
            <div>
              <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.3, textTransform: "uppercase" }}>
                {state.spanish ? "OPCIONES DE COBERTURA HASTA" : "COVERAGE OPTIONS UP TO"}
              </div>
              <div style={{ color: state.palette.accent, fontSize: 48, fontWeight: 950, lineHeight: 0.98, marginTop: 5, textShadow: "0 4px 18px rgba(0,0,0,0.42)" }}>{state.amount}</div>
            </div>
          )}
          <MiniBenefits state={state} columns={showAmount ? 2 : 1} />
        </div>
        <div data-creative-zone="selector" style={{ display: "grid", gap: 8 }}>
          <div style={{ color: state.palette.headline, fontSize: 10, fontWeight: 950, letterSpacing: 1.15, textTransform: "uppercase" }}>{selectionLabel}</div>
          <div style={{ display: "grid", gridTemplateColumns: state.buttons.length === 3 && !compactButtons ? "repeat(3, 1fr)" : "1fr 1fr", gap: 7 }}>
            {state.buttons.slice(0, 4).map((button) => (
              <div key={button} style={{ minHeight: 36, display: "flex", alignItems: "center", justifyContent: "center", background: state.palette.buttonBg || state.palette.cta, color: state.palette.buttonText || "#ffffff", border: state.palette.buttonBorder || `2px solid ${state.palette.accent}`, borderRadius: 7, padding: "6px", fontSize: button.length > 12 ? 10 : 12, fontWeight: 950, lineHeight: 1.05, boxShadow: "0 8px 18px rgba(0,0,0,0.2)" }}>
                {button}
              </div>
            ))}
          </div>
        </div>
      </div>
      <CtaUnit state={state} />
    </CreativeShell>
  );
}

function renderPremiumDarkGold(state: CreativeState) {
  return (
    <CreativeShell state={{ ...state, palette: { ...state.palette, fallback: "linear-gradient(145deg, #050505 0%, #1a1200 100%)", accent: "#c9a84c", cta: "#b8860b", headline: "#ffffff", subheadline: "#e5d3a0", panel: "rgba(0,0,0,0.64)", panelBorder: "rgba(201,168,76,0.34)" } }}>
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 18, paddingBottom: 56, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 12 }}>
        <div style={{ border: "1px solid rgba(201,168,76,0.55)", padding: 14, textAlign: "center", boxShadow: "inset 0 0 40px rgba(201,168,76,0.08)" }}>
          <div style={{ color: "#c9a84c", fontSize: 10, fontWeight: 950, letterSpacing: 2 }}>{state.eyebrow}</div>
          <div style={{ color: "#fff", fontSize: state.headlineSize + 1, fontWeight: 950, lineHeight: 1, textTransform: "uppercase", marginTop: 8 , ...lineClampStyle(2) }}>{state.headline}</div>
        </div>
        <div style={{ display: "grid", gap: 8, alignContent: "center" }}>
          <MiniBenefits state={{ ...state, palette: { ...state.palette, panel: "rgba(0,0,0,0.64)", panelBorder: "rgba(201,168,76,0.34)", subheadline: "#e5d3a0", accent: "#c9a84c" } }} />
          <ButtonGrid labels={state.buttons} styleType="gold" />
        </div>
      </div>
      <BottomBar color="#b8860b" label={state.cta} />
    </CreativeShell>
  );
}

function renderCleanWhiteDiagram(state: CreativeState) {
  const items = state.bullets.length ? state.bullets.slice(0, 3) : [state.copy.howItWorks, state.copy.keyTradeoffs, state.copy.nextStep];
  const educationState = { ...state, palette: { ...state.palette, fallback: "#ffffff", eyebrow: "#1d4ed8", headline: "#0f172a", subheadline: "#334155", accent: "#1d4ed8", cta: "#1d4ed8", panel: "rgba(255,255,255,0.98)", panelBorder: "rgba(37,99,235,0.2)", headlineBg: "rgba(255,255,255,0.98)", headlineBorder: "rgba(37,99,235,0.2)", buttonBg: "#1d4ed8", buttonText: "#ffffff", buttonBorder: "1.5px solid #1d4ed8" } };
  return (
    <CreativeShell state={educationState}>
      <div data-creative-composition="educational-explainer" style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 16, paddingBottom: 52, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,255,0.96))" }}>
        <HeadlineBlock state={educationState} compact />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, alignContent: "center" }}>
          {items.map((item, index) => (
            <div key={item} style={{ minHeight: 118, borderRadius: 9, padding: "10px 7px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center", color: "#0f172a", background: index === 0 ? "#eaf2ff" : index === 1 ? "#eaf8ef" : "#fff7df", border: `1.5px solid ${index === 0 ? "#2563eb" : index === 1 ? "#16a34a" : "#a16207"}` }}>
              <span style={{ width: 28, height: 28, borderRadius: 999, display: "grid", placeItems: "center", background: "#0f172a", color: "#fff", fontSize: 12, fontWeight: 950 }}>{index + 1}</span>
              <span style={{ fontSize: 10.5, fontWeight: 900, lineHeight: 1.2 }}>{item}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          <div style={{ color: "#334155", fontSize: 10.5, fontWeight: 800, textAlign: "center" }}>{state.copy.requestEducation}</div>
          <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(educationState)} />
        </div>
      </div>
      <CtaUnit state={educationState} />
    </CreativeShell>
  );
}

function renderPatrioticNotice(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 12, paddingBottom: 52, background: "linear-gradient(135deg, rgba(245,240,232,0.92), rgba(255,255,255,0.75))", border: "5px solid #1a2744", outline: "4px solid rgba(139,26,26,0.8)", outlineOffset: -10, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
        <div style={{ background: "#1a2744", color: "#fff", padding: "8px 10px", textAlign: "center", fontSize: 11, fontWeight: 950, letterSpacing: 1.6 }}>
          {state.leadType === "mortgage_protection" ? "HOMEOWNER NOTICE" : state.leadType === "final_expense" ? "COVERAGE NOTICE" : "VETERANS 50+ NOTICE"}
        </div>
        <div style={{ textAlign: "center", alignSelf: "center" }}>
          <div style={{ color: "#8b1a1a", fontSize: 10, fontWeight: 950, letterSpacing: 1.7 }}>{state.leadType === "mortgage_protection" ? "HOME PROTECTION CHECK" : state.leadType === "final_expense" ? "FINAL COST PLANNING" : "VETERAN COVERAGE OPTIONS"}</div>
          <div style={{ color: "#1a2744", fontSize: state.headlineSize + 2, fontWeight: 950, lineHeight: 1, textTransform: "uppercase", marginTop: 8 , ...lineClampStyle(2) }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: "#334155", fontSize: 12, fontWeight: 850, lineHeight: 1.25, marginTop: 8 , ...lineClampStyle(2) }}>{state.subheadline}</div>}
        </div>
        <ButtonGrid labels={state.buttons} styleType="red" />
      </div>
      <BottomBar color="#8b1a1a" label={state.cta} />
    </CreativeShell>
  );
}

function renderHomeownerTable(state: CreativeState) {
  const rows = state.buttons.length ? state.buttons : ["$250,000", "$400,000", "$600,000"];
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 14, paddingBottom: 52, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10, background: "linear-gradient(180deg, rgba(255,255,255,0.78), rgba(219,234,254,0.68))" }}>
        <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1, textTransform: "uppercase" , ...lineClampStyle(2) }}>{state.headline}</div>
        <Panel state={state} style={{ overflow: "hidden", alignSelf: "center" }}>
          <div style={{ background: "#0f3b70", color: "#fff", padding: 10, fontSize: 11, fontWeight: 950, letterSpacing: 1 }}>MORTGAGE BALANCE</div>
          {rows.slice(0, 4).map((row, index) => (
            <div key={row} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", borderBottom: index === 3 ? "none" : "1px solid rgba(15,59,112,0.14)", color: "#0f172a", fontSize: 13, fontWeight: 900, background: index % 2 ? "rgba(255,255,255,0.72)" : "rgba(239,246,255,0.84)" }}>
              <span>{row}</span><span style={{ color: "#0f3b70" }}>View</span>
            </div>
          ))}
        </Panel>
        <MiniBenefits state={state} columns={2} />
      </div>
      <BottomBar color="#0f3b70" label={state.cta} />
    </CreativeShell>
  );
}

function renderTruckerHighway(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,19,31,0.15) 0%, rgba(7,19,31,0.88) 76%), linear-gradient(115deg, transparent 0 42%, rgba(245,158,11,0.18) 43% 47%, transparent 48% 100%)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 54, height: 72, background: "linear-gradient(90deg, rgba(255,255,255,0.12), rgba(245,158,11,0.24), rgba(255,255,255,0.12))", clipPath: "polygon(36% 0, 64% 0, 100% 100%, 0 100%)" }} />
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 16, paddingBottom: 58, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 10 }}>
        <div>
          <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 2 }}>{state.eyebrow}</div>
          <div style={{ color: "#fff", fontSize: state.headlineSize + 1, fontWeight: 950, lineHeight: 1, textTransform: "uppercase", marginTop: 7 , ...lineClampStyle(2) }}>{state.headline}</div>
        </div>
        <div style={{ alignSelf: "end", display: "grid", gap: 8 }}>
          <MiniBenefits state={state} />
          <div style={{ color: state.palette.headline, fontSize: 10, fontWeight: 950, letterSpacing: 1.1, textAlign: "center", textTransform: "uppercase" }}>{getSelectorPrompt(state)}</div>
          <ButtonGrid labels={state.buttons} styleType="cyan" customStyle={getButtonStyle(state)} />
        </div>
      </div>
      <BottomBar color={state.palette.cta} label={state.cta} />
    </CreativeShell>
  );
}

/**
 * Deep navy/black with a nested gold double-border and diamond corner
 * accents -- matches the "STATE-APPROVED WHOLE LIFE" style of ornate,
 * dignified gold-on-navy cards proven in the final expense / veteran niches.
 * Deliberately fully opaque -- never assigned a photo (see isLayoutPhotoFriendly).
 */
function renderOrnateGoldFrame(state: CreativeState) {
  const corner = (top: number | string, left: number | string) => (
    <div
      key={`${top}-${left}`}
      style={{
        position: "absolute",
        top,
        left,
        width: 14,
        height: 14,
        border: "2px solid #c9a84c",
        transform: "rotate(45deg)",
        opacity: 0.85,
      }}
    />
  );
  return (
    <CreativeShell state={{ ...state, overlayStyle: "deep_gradient", palette: { ...state.palette, fallback: "linear-gradient(160deg, #0a0a0a 0%, #16130a 100%)", overlay: "transparent", glow: "none" } }}>
      <div
        style={{
          position: "absolute",
          inset: 10,
          border: "2px solid #c9a84c",
          outline: "1px solid rgba(201,168,76,0.5)",
          outlineOffset: 6,
        }}
      />
      {corner(6, 6)}
      {corner(6, "calc(100% - 20px)")}
      {corner("calc(100% - 20px)", 6)}
      {corner("calc(100% - 20px)", "calc(100% - 20px)")}
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 26, paddingBottom: state.ctaFlow === "bottom_bar" ? 60 : 26, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 12, textAlign: "center" }}>
        <div style={{ color: "#e03c3c", fontSize: 12, fontWeight: 950, letterSpacing: 2.4, textTransform: "uppercase" }}>{state.eyebrow}</div>
        <div style={{ display: "grid", gap: 10, alignContent: "center" }}>
          <div style={{ color: "#f5eddc", fontSize: state.headlineSize + 1, fontWeight: 950, lineHeight: 1.05, textTransform: "uppercase", ...lineClampStyle(2) }}>{state.headline}</div>
          {state.amount && <div style={{ color: "#c9a84c", fontSize: 48, fontWeight: 950, lineHeight: 1, textShadow: "0 3px 12px rgba(201,168,76,0.35)" }}>{state.amount}</div>}
          {state.subheadline && <div style={{ color: "#d7c58a", fontSize: 12, fontWeight: 700, lineHeight: 1.3, ...lineClampStyle(2) }}>{state.subheadline}</div>}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <ButtonGrid labels={state.buttons} styleType="gold" />
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="panel_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

const PARCHMENT_MOTIF: Record<string, string> = {
  veteran: "\u{1F396}️",
  mortgage_protection: "\u{1F3E0}",
  final_expense: "\u{1F54A}️",
  trucker: "\u{1F69B}",
  iul: "\u{1F4C8}",
};

/**
 * Warm cream "aged paper" texture with a torn-corner effect and a dark
 * ribbon header -- matches the distressed/parchment style seen on real
 * VA mortgage and burial-coverage winning ads. Fully opaque; never assigned
 * a photo.
 */
function renderAgedParchment(state: CreativeState) {
  const motif = PARCHMENT_MOTIF[state.leadType] || "✦";
  return (
    <CreativeShell state={{ ...state, overlayStyle: "deep_gradient", palette: { ...state.palette, fallback: "linear-gradient(160deg, #f2e6c8 0%, #e8d8ac 55%, #ddc98e 100%)", overlay: "transparent", glow: "none" } }}>
      <div style={{ position: "absolute", top: 0, right: 0, width: 0, height: 0, borderTop: "42px solid rgba(0,0,0,0.14)", borderLeft: "42px solid transparent" }} />
      <div data-creative-composition="eligibility-notice" style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", display: "grid", gridTemplateRows: "auto auto 1fr auto", gap: 8, paddingBottom: 52 }}>
        <div style={{ background: "#1a2744", color: "#f2e6c8", padding: "10px 14px", textAlign: "center", fontSize: 11, fontWeight: 950, letterSpacing: 1.8, textTransform: "uppercase" }}>
          {state.leadType === "mortgage_protection" ? state.copy.homeownerNotice : state.copy.coverageNotice}
        </div>
        <div style={{ padding: "8px 16px 0", textAlign: "center" }}>
          <div style={{ color: "#7f1d1d", fontSize: 10, fontWeight: 950, letterSpacing: 1.4 }}>{motif} {state.eyebrow}</div>
          <div style={{ color: "#2d2410", fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.05, textTransform: "uppercase", ...lineClampStyle(2) }}>{state.headline}</div>
          {state.amount && <div style={{ color: "#7c2d12", fontSize: 36, fontWeight: 950, lineHeight: 1, marginTop: 5 }}>{state.amount}</div>}
        </div>
        <div style={{ padding: "0 18px", display: "grid", alignContent: "center", gap: 7 }}>
          {state.subheadline && <div style={{ color: "#3f2d1f", fontSize: 11.5, fontWeight: 750, lineHeight: 1.3, textAlign: "center" }}>{state.subheadline}</div>}
          <div style={{ color: "#2d2410", fontSize: 9, fontWeight: 850, lineHeight: 1.25, textAlign: "center" }}>{state.copy.availabilityDisclosure}</div>
        </div>
        <div data-creative-zone="selector" style={{ padding: "0 16px 10px", display: "grid", gap: 7 }}>
          <div style={{ color: "#2d2410", fontSize: 9.5, fontWeight: 950, letterSpacing: 0.7, textAlign: "center", textTransform: "uppercase" }}>{getSelectorPrompt(state)}</div>
          <ButtonGrid labels={state.buttons} styleType="cream" />
        </div>
      </div>
      <CtaUnit state={state} />
    </CreativeShell>
  );
}

/**
 * Bold black background with radiating comic-burst rays and a halftone dot
 * texture -- matches the pop-art "NO MEDICAL EXAM" style proven to stop the
 * scroll in the trucker niche. Fully opaque; never assigned a photo.
 */
function renderPopArtBurst(state: CreativeState) {
  const burstColor = state.palette.accent || "#f59e0b";
  return (
    <CreativeShell state={{ ...state, overlayStyle: "deep_gradient", palette: { ...state.palette, fallback: "#0a0a0a", overlay: "transparent", glow: "none" } }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `repeating-conic-gradient(from 0deg, ${burstColor}33 0deg 9deg, transparent 9deg 18deg)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.14) 1.5px, transparent 1.5px)",
          backgroundSize: "10px 10px",
        }}
      />
      <div style={{ position: "relative", height: "100%", boxSizing: "border-box", overflow: "hidden", padding: 20, paddingBottom: state.ctaFlow === "bottom_bar" ? 58 : 20, display: "grid", gridTemplateRows: "auto 1fr auto", gap: 12, textAlign: "center" }}>
        <div style={{ color: burstColor, fontSize: 12, fontWeight: 950, letterSpacing: 1.6, textTransform: "uppercase" }}>{state.eyebrow}</div>
        <div style={{ display: "grid", gap: 10, alignContent: "center" }}>
          <div
            style={{
              color: "#ffffff",
              fontSize: state.headlineSize + 3,
              fontWeight: 950,
              lineHeight: 1,
              textTransform: "uppercase",
              WebkitTextStroke: `2px ${burstColor}`,
              ...lineClampStyle(2),
            }}
          >
            {state.headline}
          </div>
          {state.subheadline && (
            <div style={{ color: "#ffffff", background: burstColor, display: "inline-block", padding: "6px 12px", borderRadius: 4, fontSize: 12, fontWeight: 900, lineHeight: 1.25, justifySelf: "center", ...lineClampStyle(2) }}>
              {state.subheadline}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <ButtonGrid labels={state.buttons} styleType="red" customStyle={{ background: burstColor, color: "#000000", border: "2px solid #ffffff", radius: 6 }} />
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="panel_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderTemplateFamily(state: CreativeState) {
  // Creative Intelligence drafts carry an explicit, validated layout contract.
  // They use the real layout renderers below even when a photo is present; this
  // is what makes hierarchy/composition diversity visible in the final upload.
  const intelligenceLayout = Number(state.draft?.creativeEngineVersion || 0) >= 1
    && Boolean(state.draft?.layoutId);
  if (intelligenceLayout) {
    if (state.layoutFamily === "split_panel") return renderSplitPanel(state);
    if (state.layoutFamily === "selector_grid") return renderSelectorGrid(state);
    if (state.layoutFamily === "checklist_first" || state.layoutFamily === "trust_medical") return renderChecklistFirst(state);
    if (state.layoutFamily === "amount_hero") return renderAmountHero(state);
    if (state.layoutFamily === "comparison_table") return renderComparisonTable(state);
    if (state.layoutFamily === "quiz_card") return renderDirectResponseOffer(state);
    if (state.layoutFamily === "report_card" || state.layoutFamily === "mobile_native") return renderReportCard(state);
    if (state.layoutFamily === "benefit_grid") return renderBenefitGrid(state);
    if (state.layoutFamily === "clean_white_diagram") return renderCleanWhiteDiagram(state);
    if (state.layoutFamily === "aged_parchment") return renderAgedParchment(state);
    if (state.layoutFamily === "premium_card" || state.layoutFamily === "dark_response") return renderPosterStack(state);
    return renderPosterStack(state);
  }
  // Wide paid/generated backgrounds are shown in a dedicated image zone.
  // This preserves the subject and keeps all copy outside the crop instead of
  // stretching a landscape photo behind a portrait ad.
  if (state.backgroundUrl) return renderPhotoDirectResponse(state);
  // Graphic ads use a single audited direct-response skeleton. Layout and
  // palette data still create variety, but no enabled family can fall back to
  // a sparse legacy poster with an empty or collision-prone center.
  if (state.draft?.renderLegacyCreative !== true) return renderGraphicDirectResponse(state);
  // Explicit opt-in retained only for exact rendering of archived drafts.
  if (state.layoutFamily === "split_panel") return renderSplitPanel(state);
  if (state.layoutFamily === "selector_grid") return renderSelectorGrid(state);
  if (state.layoutFamily === "checklist_first" || state.layoutFamily === "trust_medical") return renderChecklistFirst(state);
  if (state.layoutFamily === "amount_hero") return renderAmountHero(state);
  if (state.layoutFamily === "comparison_table") return renderComparisonTable(state);
  if (state.layoutFamily === "quiz_card") return renderDirectResponseOffer(state);
  if (state.layoutFamily === "report_card" || state.layoutFamily === "mobile_native") return renderReportCard(state);
  if (state.layoutFamily === "advisory_notice") return renderAdvisoryNotice(state);
  if (state.layoutFamily === "messenger_prompt") return renderMessengerPrompt(state);
  if (state.layoutFamily === "benefit_grid") return renderBenefitGrid(state);
  if (state.layoutFamily === "price_table") return renderPriceTable(state);
  if (state.layoutFamily === "age_selector") return renderAgeSelector(state);
  if (state.layoutFamily === "premium_dark_gold") return renderPremiumDarkGold(state);
  if (state.layoutFamily === "clean_white_diagram") return renderCleanWhiteDiagram(state);
  if (state.layoutFamily === "patriotic_notice") return renderPatrioticNotice(state);
  if (state.layoutFamily === "homeowner_table") return renderHomeownerTable(state);
  if (state.layoutFamily === "trucker_highway") return renderTruckerHighway(state);
  if (state.layoutFamily === "ornate_gold_frame") return renderOrnateGoldFrame(state);
  if (state.layoutFamily === "aged_parchment") return renderAgedParchment(state);
  if (state.layoutFamily === "pop_art_burst") return renderPopArtBurst(state);
  if (state.layoutFamily === "premium_card" || state.layoutFamily === "dark_response" || state.layoutFamily === "patriotic_badge") return renderPosterStack(state);
  return renderPosterStack(state);
}

function FinishedCreativeRenderer({
  draft,
  leadType,
  overlay,
}: {
  draft: any;
  leadType: string;
  overlay: ReturnType<typeof getOverlay>;
}) {
  return renderTemplateFamily(buildCreativeState(draft, leadType, overlay));
}

// Text is never visually clamped. Copy is shortened at word boundaries, and
// the launch flow rejects any remaining DOM overflow before image capture.
function lineClampStyle(lines: number): React.CSSProperties {
  void lines;
  return {
    overflowWrap: "normal",
    wordBreak: "keep-all",
    hyphens: "none",
  } as React.CSSProperties;
}

export function ProductionFeedCreative({
  draft,
  creativeRef,
}: {
  draft: any;
  creativeRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const overlay = getOverlay(draft);
  const leadType = cleanText(draft?.leadType || "final_expense");
  const designWidth = 375;
  const designHeight = 468.75;
  const productionScale = 540 / designWidth;

  return (
    <div
      ref={creativeRef}
      data-creative-root="true"
      data-creative-language={draft?.language === "es" ? "es" : "en"}
      data-creative-layout={cleanText(draft?.layoutId || draft?.layoutFamily || "")}
      style={{
        width: 540,
        height: 675,
        position: "relative",
        overflow: "hidden",
        background: "#0f172a",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div
        data-creative-design-canvas="true"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: designWidth,
          height: designHeight,
          transform: `scale(${productionScale})`,
          transformOrigin: "top left",
        }}
      >
          <FinishedCreativeRenderer draft={draft} leadType={leadType} overlay={overlay} />
      </div>
    </div>
  );
}

function pickTemplate(fingerprint: string, leadType: string): number {
  let hash = 0;
  const str = String(fingerprint || `${leadType}|default`);
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  const TEMPLATE_COUNTS: Record<string, number> = {
    veteran: 6,
    trucker: 4,
    final_expense: 4,
    mortgage_protection: 4,
    iul: 3,
  };
  const count = TEMPLATE_COUNTS[leadType] || 4;
  return Math.abs(hash) % count;
}

function VeteranCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  if (templateIndex === 0) {
    const ctaText = isAgeTapCta(overlay.ctaStrip)
      ? overlay.ctaStrip.replace(/\s*→\s*$/, "").toUpperCase()
      : "TAP YOUR AGE TO SEE IF YOU QUALIFY";

    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f5f0e8", color: "#1a2744" }}>
        <div style={{ paddingTop: 20 }}>
          <div style={{ color: "#1a2744", fontSize: 32, fontWeight: 900, textAlign: "center", letterSpacing: 2, textTransform: "uppercase", padding: "0 16px", lineHeight: 1.05 }}>
            {overlay.headline}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, color: "#8b1a1a", margin: "12px auto", width: "80%" }}>
            <div style={{ flex: 1, borderTop: "1px solid #8b1a1a" }} />
            <div style={{ fontSize: 16, lineHeight: 1 }}>★</div>
            <div style={{ flex: 1, borderTop: "1px solid #8b1a1a" }} />
          </div>
          <div style={{ color: "#1a2744", fontSize: 13, fontWeight: 700, textAlign: "center", padding: "0 16px", lineHeight: 1.35 }}>
            {overlay.subheadline}
          </div>
          <div style={{ height: 16 }} />
          <div style={{ color: "#1a2744", fontSize: 11, fontWeight: 700, textAlign: "center", letterSpacing: 1, padding: "0 16px" }}>
            {ctaText}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", margin: "12px 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1a2744", color: "#ffffff", borderRadius: 50, padding: "10px 18px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#c0392b" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0f1a" }}>
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ color: "#c9a84c", fontSize: 11, fontWeight: 700, textAlign: "center", letterSpacing: 3, marginBottom: 8 }}>
            •BUILT FOR VETERANS•
          </div>
          <div style={{ borderTop: "1px solid #c9a84c", marginBottom: 12 }} />
          <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 900, textAlign: "center", lineHeight: 1.05, letterSpacing: 1, textTransform: "uppercase" }}>
            {overlay.headline}
          </div>
          <div style={{ borderBottom: "1px solid #c9a84c", margin: "12px 0" }} />
          <div style={{ color: "#c9a84c", fontSize: 13, fontWeight: 700, textAlign: "center", lineHeight: 1.35 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "16px 0" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1d4ed8", color: "#ffffff", borderRadius: 6, padding: "10px 18px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#1d4ed8" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(160deg, #1a0a0a 0%, #0a0a2a 50%, #1a0a0a 100%)" }}>
        <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 18px, rgba(180,0,0,0.08) 18px, rgba(180,0,0,0.08) 20px), repeating-linear-gradient(90deg, transparent, transparent 18px, rgba(0,0,180,0.06) 18px, rgba(0,0,180,0.06) 20px)" }} />
        <div style={{ position: "relative", padding: "22px 16px 0" }}>
          <div style={{ color: "#FFD700", fontSize: 30, fontWeight: 900, textAlign: "center", textTransform: "uppercase", lineHeight: 1.05, letterSpacing: 1, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#ffffff", fontSize: 12, fontWeight: 700, textAlign: "center", margin: "10px 0", lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ color: "#FFD700", fontSize: 11, fontWeight: 800, textAlign: "center", letterSpacing: 2, margin: "8px 0" }}>
            TAP YOUR AGE TO VIEW AVAILABLE BENEFITS
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "10px 0" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #FFD700", background: "rgba(0,0,0,0.5)", color: "#FFD700", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#c0392b" label="Apply now →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0d1117" }}>
        <div style={{ padding: "18px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#60a5fa", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 10 }}>
            VETERANS LIFE INSURANCE
          </div>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 6 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 52, fontWeight: 900, lineHeight: 1, margin: "10px 0 4px" }}>
            $50,000
          </div>
          <div style={{ color: "#60a5fa", fontSize: 12, marginBottom: 14 }}>
            Immediate Coverage Available
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1e3a5f", border: "1px solid #3b82f6", color: "#ffffff", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#1d4ed8" label="Check My Options →" />
      </div>
    );
  }

  if (templateIndex === 4) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f8f8f8" }}>
        <div style={{ background: "#c0392b", padding: "18px 20px 14px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#1a2744", fontSize: 13, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ color: "#c0392b", fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 10 }}>
            TAP YOUR AGE TO SEE IF YOU QUALIFY
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#1a2744", color: "#ffffff", borderRadius: 6, padding: "10px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#1a2744" checkColor="#c0392b" padding="12px 0 0" />
        </div>
        <BottomBar color="#c0392b" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 5) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(135deg, #0a0f1a 0%, #1a0a0a 50%, #0a0a1a 100%)" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, background: "linear-gradient(90deg, #c0392b 33%, #ffffff 33%, #ffffff 66%, #1d4ed8 66%)" }} />
        <div style={{ padding: "22px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 8 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#93c5fd", fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "1.5px solid #ffffff", background: "transparent", color: "#ffffff", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#e2e8f0" checkColor="#22c55e" padding="0 10px" />
        </div>
        <BottomBar color="#c0392b" label="See If I Qualify →" />
      </div>
    );
  }

  return null;
}

function TruckerCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0a0a" }}>
        <div style={{ minHeight: "100%", background: "linear-gradient(180deg, #0a0a0a 0%, #0d1a0d 100%)", boxShadow: "inset 0 0 58px rgba(0, 229, 255, 0.16), inset 0 -80px 95px rgba(255, 0, 170, 0.08)" }}>
          <div style={{ fontSize: 36, fontWeight: 900, textAlign: "center", color: "transparent", background: "linear-gradient(90deg, #00e5ff 0%, #00bcd4 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", paddingTop: 20, lineHeight: 1 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#ff00aa", fontSize: 13, fontWeight: 700, textAlign: "center", padding: "8px 16px", lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "12px 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #00e5ff", background: "transparent", color: "#ffffff", borderRadius: 6, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap", boxShadow: "0 0 12px rgba(0, 229, 255, 0.28)" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#1565c0" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a0a0a" }}>
        <div style={{ background: "linear-gradient(180deg, #8b0000 0%, #0a0a1a 40%)", padding: "0 0 0" }}>
          <div style={{ background: "linear-gradient(90deg, #c0392b 0%, #8b0000 50%, #1d4ed8 100%)", height: 8 }} />
          <div style={{ padding: "16px 16px 0", textAlign: "center" }}>
            <div style={{ color: "#ffffff", fontSize: 34, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, letterSpacing: 1 }}>
              {overlay.headline}
            </div>
            <div style={{ color: "#f59e0b", fontSize: 12, fontWeight: 700, margin: "8px 0 12px", lineHeight: 1.4 }}>
              {overlay.subheadline}
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#c0392b", color: "#ffffff", borderRadius: 4, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <BottomBar color="#1565c0" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(180deg, #0a0a0a 0%, #1a0e00 60%, #2d1600 100%)" }}>
        <div style={{ padding: "20px 16px 0", textAlign: "center" }}>
          <div style={{ color: "#f59e0b", fontSize: 34, fontWeight: 900, textTransform: "uppercase", lineHeight: 1, textShadow: "0 0 20px rgba(245,158,11,0.5)" }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#fcd34d", fontSize: 12, fontWeight: 700, margin: "10px 0 14px", lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #f59e0b", background: "rgba(245,158,11,0.1)", color: "#fcd34d", borderRadius: 6, padding: "8px 14px", fontSize: 11, fontWeight: 800, letterSpacing: 1, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#fcd34d" checkColor="#f59e0b" padding="0 10px" />
        </div>
        <BottomBar color="#d97706" label="See How It Works →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0a1628" }}>
        <div style={{ padding: "20px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#00bcd4", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 8 }}>
            CDL DRIVER COVERAGE
          </div>
          <div style={{ color: "#ffffff", fontSize: 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 10 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 16, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#00bcd4", color: "#000000", borderRadius: 4, padding: "8px 14px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#e2e8f0" checkColor="#00bcd4" padding="0 10px" />
        </div>
        <BottomBar color="#00838f" label="Check My Options →" />
      </div>
    );
  }

  return null;
}

function FinalExpenseCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  const showButtons = overlay.buttonLabels.length > 0;

  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0f0e0a" }}>
        <div style={{ color: "#d4a017", fontSize: 28, fontWeight: 900, textAlign: "center", padding: "24px 16px 8px", textTransform: "uppercase", lineHeight: 1.1 }}>
          {overlay.headline}
        </div>
        <div style={{ borderTop: "1px solid #d4a017", margin: "0 32px 12px" }} />
        <div style={{ color: "#ffffff", fontSize: 13, textAlign: "center", padding: "0 16px", lineHeight: 1.4 }}>
          {overlay.subheadline}
        </div>
        {showButtons ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "12px 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "1.5px solid #d4a017", background: "transparent", color: "#d4a017", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <CheckList bullets={overlay.benefitBullets} />
          </div>
        )}
        <BottomBar color="#a16207" label="Learn more →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#1a1a2e" }}>
        <div style={{ background: "#16213e", borderBottom: "2px solid #d4a017", padding: "16px 20px", textAlign: "center" }}>
          <div style={{ color: "#d4a017", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 6 }}>
            FINAL EXPENSE COVERAGE
          </div>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 14 }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#d4a017", color: "#000000", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#e2e8f0" checkColor="#d4a017" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#a16207" label="See What I Qualify For →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f8f5f0" }}>
        <div style={{ background: "#2d2016", padding: "18px 20px 14px", textAlign: "center" }}>
          <div style={{ color: "#d4a017", fontSize: 28, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.05, letterSpacing: 1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#4a3728", fontSize: 13, fontWeight: 600, marginBottom: 12, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ color: "#2d2016", fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 10 }}>
            SELECT YOUR AGE TO SEE OPTIONS
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#2d2016", color: "#d4a017", borderRadius: 6, padding: "10px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#2d2016" checkColor="#a16207" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#2d2016" label="Check My Rate →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(160deg, #0f0a06 0%, #1a1206 100%)" }}>
        <div style={{ padding: "22px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#fbbf24", fontSize: 26, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 8 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#e5c88a", fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ border: "1.5px solid #fbbf24", background: "transparent", color: "#fbbf24", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#e5c88a" checkColor="#fbbf24" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#92400e" label="See Your Options →" />
      </div>
    );
  }

  return null;
}

function MortgageCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  const photo = MORTGAGE_PHOTOS[templateIndex % MORTGAGE_PHOTOS.length] || MORTGAGE_BACKGROUND;

  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
        <div style={{ position: "relative", background: "#ffffff", borderRadius: 8, padding: 16, margin: 20, textAlign: "center", boxShadow: "0 10px 28px rgba(0,0,0,0.22)" }}>
          <div style={{ color: "#b91c1c", fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#555555", fontSize: 12, margin: "6px 0 12px" }}>
            Select your mortgage amount
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "8px 0" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "2px solid #b91c1c", background: "#ffffff", color: "#b91c1c", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
          <CheckList bullets={overlay.benefitBullets} color="#166534" checkColor="#16a34a" padding="4px 4px 0" />
        </div>
        <BottomBar color="#b91c1c" label="See My Rate →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.85) 60%)" }} />
        <div style={{ position: "absolute", bottom: 44, left: 0, right: 0, padding: "0 16px 12px" }}>
          <div style={{ color: "#ffffff", fontSize: 24, fontWeight: 900, textAlign: "center", textTransform: "uppercase", marginBottom: 6 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#fca5a5", fontSize: 12, textAlign: "center", marginBottom: 12 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.15)", border: "1.5px solid #ffffff", color: "#ffffff", borderRadius: 6, padding: "8px 14px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#b91c1c" label="See My Rate →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#1a1a2e" }}>
        <div style={{ padding: "20px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 24, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1, marginBottom: 6 }}>
            {overlay.headline}
          </div>
          <div style={{ color: "#f87171", fontSize: 12, marginBottom: 16, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 10px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#16213e", border: "1px solid #b91c1c", borderRadius: 6, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: "#ffffff", fontSize: 14, fontWeight: 700 }}>{label}</span>
                <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700 }}>See My Rate →</span>
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#b91c1c" label="Check My Options →" />
      </div>
    );
  }

  if (templateIndex === 3) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundImage: `url("${photo}")`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, background: "#b91c1c", padding: "14px 20px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 22, fontWeight: 900, textTransform: "uppercase", lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 44, left: 0, right: 0, padding: "0 16px 12px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 12, marginBottom: 10, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ background: "#b91c1c", color: "#ffffff", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
        <BottomBar color="#b91c1c" label="See My Rate →" />
      </div>
    );
  }

  return null;
}

function IulCreative({
  overlay,
  templateIndex,
}: {
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  const showButtons = overlay.buttonLabels.length > 0;

  if (templateIndex === 0) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "linear-gradient(145deg, #0a1628 0%, #0f2040 100%)" }}>
        <div style={{ color: "#d4a017", fontSize: 26, fontWeight: 900, textAlign: "center", padding: "24px 16px 8px", lineHeight: 1.1 }}>
          {overlay.headline}
        </div>
        <div style={{ color: "#93c5fd", fontSize: 12, textAlign: "center", padding: "0 16px 12px", lineHeight: 1.4 }}>
          {overlay.subheadline}
        </div>
        {showButtons ? (
          <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", margin: "0 16px" }}>
            {overlay.buttonLabels.map((label) => (
              <div key={label} style={{ border: "1.5px solid #d4a017", color: "#d4a017", background: "transparent", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                {label}
              </div>
            ))}
          </div>
        ) : (
          <CheckList bullets={overlay.benefitBullets} />
        )}
        <BottomBar color="#1d4ed8" label="Learn More →" />
      </div>
    );
  }

  if (templateIndex === 1) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#0d0d0d" }}>
        <div style={{ background: "linear-gradient(135deg, #1a1200 0%, #0d0d0d 100%)", padding: "22px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#c9a84c", fontSize: 11, fontWeight: 700, letterSpacing: 3, marginBottom: 8 }}>
            INDEXED UNIVERSAL LIFE
          </div>
          <div style={{ color: "#ffffff", fontSize: 26, fontWeight: 900, lineHeight: 1.1, marginBottom: 8 }}>
            {overlay.headline}
          </div>
          <div style={{ borderTop: "1px solid #c9a84c", margin: "0 20px 12px" }} />
          <div style={{ color: "#c9a84c", fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#c9a84c", color: "#000000", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#c9a84c" checkColor="#d4a017" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#b8860b" label="Learn How It Works →" />
      </div>
    );
  }

  if (templateIndex === 2) {
    return (
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#f0f4ff" }}>
        <div style={{ background: "#1d4ed8", padding: "16px 20px", textAlign: "center" }}>
          <div style={{ color: "#ffffff", fontSize: 11, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>
            FINANCIAL STRATEGY
          </div>
          <div style={{ color: "#ffffff", fontSize: 24, fontWeight: 900, lineHeight: 1.1 }}>
            {overlay.headline}
          </div>
        </div>
        <div style={{ padding: "14px 20px 0", textAlign: "center" }}>
          <div style={{ color: "#1e3a5f", fontSize: 13, fontWeight: 600, marginBottom: 14, lineHeight: 1.4 }}>
            {overlay.subheadline}
          </div>
          {showButtons ? (
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", marginBottom: 12 }}>
              {overlay.buttonLabels.map((label) => (
                <div key={label} style={{ background: "#1d4ed8", color: "#ffffff", borderRadius: 4, padding: "8px 14px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {label}
                </div>
              ))}
            </div>
          ) : (
            <CheckList bullets={overlay.benefitBullets} color="#1e3a5f" checkColor="#1d4ed8" padding="0 10px" />
          )}
        </div>
        <BottomBar color="#1d4ed8" label="Explore Options →" />
      </div>
    );
  }

  return null;
}

function CreativeRenderer({
  leadType,
  overlay,
  templateIndex,
}: {
  leadType: string;
  overlay: ReturnType<typeof getOverlay>;
  templateIndex: number;
}) {
  if (leadType === "veteran") return <VeteranCreative overlay={overlay} templateIndex={templateIndex} />;
  if (leadType === "trucker") return <TruckerCreative overlay={overlay} templateIndex={templateIndex} />;
  if (leadType === "mortgage_protection") return <MortgageCreative overlay={overlay} templateIndex={templateIndex} />;
  if (leadType === "iul") return <IulCreative overlay={overlay} templateIndex={templateIndex} />;
  return <FinalExpenseCreative overlay={overlay} templateIndex={templateIndex} />;
}

export default function AdPreviewCard({
  draft,
  selectedStates: _selectedStates = [],
  regenerateAttempts: _regenerateAttempts = 0,
  regenerating = false,
  onRegenerate,
  creativeRef,
}: {
  draft: any;
  selectedStates?: string[];
  regenerateAttempts?: number;
  regenerating?: boolean;
  onRegenerate: () => void;
  creativeRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const canRegenerate = !regenerating;
  const overlay = getOverlay(draft);
  const leadType = cleanText(draft?.leadType || "final_expense");
  const pageName = PAGE_NAMES[leadType] || "Insurance Info Center";
  const accent = PAGE_ACCENTS[leadType] || "#1d4ed8";
  const adHeadline = cleanText(draft?.headline || overlay.headline);
  const fullText = cleanText(draft?.primaryText);
  const truncated = fullText.length > 120;
  const primaryText = truncated ? fullText.slice(0, 120) : fullText;

  return (
    <div
      style={{
        maxWidth: 375,
        width: "100%",
        background: "#ffffff",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div
        style={{
          padding: "12px 14px 8px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            background: `linear-gradient(135deg, ${accent} 0%, #0a0f1a 100%)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontWeight: 800,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {pageName.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13.5,
              color: "#1c1e21",
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {pageName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#65676b",
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 1,
            }}
          >
            <span>Sponsored</span>
            <span aria-hidden="true">·</span>
            <span aria-hidden="true">🌐</span>
          </div>
        </div>
        <div style={{ color: "#65676b", fontSize: 20, letterSpacing: 1.5 }}>
          ···
        </div>
      </div>

      {primaryText && (
        <div
          style={{
            padding: "0 14px 10px",
            fontSize: 14,
            color: "#1c1e21",
            lineHeight: 1.5,
          }}
        >
          {primaryText}
          {truncated && (
            <span style={{ color: "#65676b" }}>
              {" "}
              … <span style={{ fontWeight: 600 }}>See more</span>
            </span>
          )}
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: 375,
          height: 468.75,
          overflow: "hidden",
          background: "#0f172a",
          flexShrink: 0,
        }}
      >
        <div style={{ width: 540, height: 675, transform: `scale(${375 / 540})`, transformOrigin: "top left" }}>
          <ProductionFeedCreative draft={draft} creativeRef={creativeRef} />
        </div>
      </div>

      <div
        style={{
          background: "#f0f2f5",
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid #dddfe2",
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "#65676b",
              marginBottom: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            covecrm.com
          </div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: "#1c1e21",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {adHeadline}
          </div>
        </div>
        <button
          type="button"
          disabled
          style={{
            background: "#e4e6eb",
            border: "none",
            borderRadius: 6,
            padding: "8px 14px",
            fontWeight: 700,
            fontSize: 13,
            color: "#1c1e21",
            cursor: "default",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          Learn more
        </button>
      </div>

      <div
        style={{
          padding: "10px 14px 12px",
          background: "#f0f2f5",
          borderTop: "1px solid #dddfe2",
        }}
      >
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!canRegenerate}
          style={{
            width: "100%",
            padding: "9px 0",
            borderRadius: 8,
            background: canRegenerate ? accent : "#9ca3af",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 13,
            border: "none",
            cursor: canRegenerate ? "pointer" : "not-allowed",
            opacity: canRegenerate ? 1 : 0.65,
            transition: "opacity 0.15s",
          }}
        >
          {regenerating
            ? "Regenerating…"
            : "↺  Regenerate"}
        </button>
      </div>
    </div>
  );
}
