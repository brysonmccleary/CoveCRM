const PAGE_NAMES: Record<string, string> = {
  veteran: "Veteran Benefits Center",
  trucker: "Trucker Life Coverage",
  final_expense: "Final Expense Planning",
  mortgage_protection: "Mortgage Protection Center",
  iul: "IUL Education Center",
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

function getCreativeBackground(draft: any, leadType: string): string {
  const imageUrl = cleanText(draft?.imageUrl);
  if (imageUrl) return imageUrl;
  if (leadType === "mortgage_protection") return MORTGAGE_BACKGROUND;
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

  const styles: Record<string, { background: string; color: string; border: string; radius: number }> = {
    navy: { background: "#1a2744", color: "#ffffff", border: "1px solid rgba(255,255,255,0.22)", radius: 999 },
    gold: { background: "rgba(212,160,23,0.14)", color: "#ffd76a", border: "1.5px solid #d4a017", radius: 6 },
    red: { background: "#ffffff", color: "#b91c1c", border: "2px solid #b91c1c", radius: 6 },
    cyan: { background: "rgba(0,229,255,0.12)", color: "#ffffff", border: "1.5px solid #00e5ff", radius: 6 },
    cream: { background: "#f8f5f0", color: "#2d2016", border: "1px solid rgba(45,32,22,0.18)", radius: 6 },
  };
  const selected = customStyle ? { ...customStyle, radius: customStyle.radius ?? styles[styleType].radius } : styles[styleType];

  return (
    <div style={{ display: "flex", gap: 7, justifyContent: "center", flexWrap: "wrap" }}>
      {labels.slice(0, 4).map((label) => (
        <div
          key={label}
          style={{
            background: selected.background,
            color: selected.color,
            border: selected.border,
            borderRadius: selected.radius,
            padding: "9px 13px",
            minWidth: styleType === "red" ? 92 : undefined,
            textAlign: "center",
            fontSize: 12,
            fontWeight: 900,
            lineHeight: 1,
            whiteSpace: "nowrap",
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
  | "patriotic_badge";
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
};

const LAYOUTS_BY_LEAD_TYPE: Record<string, LayoutFamily[]> = {
  veteran: ["patriotic_badge", "amount_hero", "quiz_card", "split_panel", "checklist_first", "poster_stack", "advisory_notice"],
  trucker: ["split_panel", "dark_response", "selector_grid", "report_card", "messenger_prompt", "poster_stack", "mobile_native"],
  mortgage_protection: ["selector_grid", "comparison_table", "premium_card", "split_panel", "mobile_native", "report_card", "quiz_card"],
  final_expense: ["premium_card", "checklist_first", "quiz_card", "advisory_notice", "comparison_table", "dark_response", "trust_medical"],
  iul: ["premium_card", "report_card", "split_panel", "trust_medical", "mobile_native", "checklist_first"],
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

function clampCopy(value: string, maxLength: number): string {
  const text = cleanText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function getLeadFallbackHeadline(leadType: string): string {
  if (leadType === "veteran") return "Veterans Life Insurance";
  if (leadType === "trucker") return "Truck Driver Coverage";
  if (leadType === "mortgage_protection") return "Protect Your Family's Home";
  if (leadType === "iul") return "IUL Coverage Options";
  return "Final Expense Coverage";
}

function getLeadEyebrow(leadType: string, iaFamily: IaFamily): string {
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
  return base[leadType] || base.final_expense;
}

function buildCreativeState(draft: any, leadType: string, overlay: ReturnType<typeof getOverlay>): CreativeState {
  const seed = hashString(getVariationSeed(draft, leadType));
  const variantIndex = pickVisualVariant(draft, leadType, 7);
  const palette = getPalettes(leadType)[variantIndex % getPalettes(leadType).length];
  const layoutFamily = pickSeeded(LAYOUTS_BY_LEAD_TYPE[leadType] || LAYOUTS_BY_LEAD_TYPE.final_expense, seed + variantIndex * 11, "layout");
  const iaFamily = pickSeeded(IA_BY_LEAD_TYPE[leadType] || IA_BY_LEAD_TYPE.final_expense, seed + variantIndex * 17, "ia");
  const densityStyle = pickSeeded<DensityStyle>(["compact", "balanced", "roomy"], seed + variantIndex, "density");
  const typographyStyle = pickSeeded<TypographyStyle>(["condensed_poster", "premium_clean", "utility_ui", "aggressive_response", "trust_editorial", "modern_minimal"], seed + variantIndex, "type");
  const seededCtaFlow = pickSeeded<CtaFlow>(["bottom_bar", "floating_cta", "panel_cta", "selector_cta", "stacked_cta", "inline_cta", "comparison_cta", "quiz_cta"], seed + variantIndex, "cta");
  const frameStyle = pickSeeded<FrameStyle>(["full_bleed", "inset_card", "bottom_sheet", "top_banner", "split_overlay", "corner_badge", "diagonal_band", "soft_glass"], seed + variantIndex, "frame");
  const overlayStyle = pickSeeded<OverlayStyle>(["deep_gradient", "soft_gradient", "hard_vignette", "paper_wash", "neon_glow"], seed + variantIndex, "overlay");
  const fp = String(draft?.uniquenessFingerprint || "");
  const hash2 = Math.abs(hashString(`${fp}pad`));
  const hash3 = Math.abs(hashString(`${fp}gap`));
  const hash4 = Math.abs(hashString(`${fp}cta`));
  const padOptions = [14, 18, 22, 26];
  const gapOptions = [8, 10, 12, 14];
  const ctaFlow: CtaFlow = hash4 % 2 === 0 ? "inline_cta" : "bottom_bar";
  const density = {
    compact: { pad: padOptions[hash2 % 4], gap: gapOptions[hash3 % 4], lineHeight: 1.03 },
    balanced: { pad: padOptions[hash2 % 4], gap: gapOptions[hash3 % 4], lineHeight: 1.08 },
    roomy: { pad: padOptions[hash2 % 4], gap: gapOptions[hash3 % 4], lineHeight: 1.12 },
  }[densityStyle];
  void seededCtaFlow;
  const headlineRaw = overlay.headline || cleanText(draft?.headline) || getLeadFallbackHeadline(leadType);
  const headline = clampCopy(headlineRaw, headlineRaw.length > 46 ? 50 : 58);
  const headlineBase = typographyStyle === "aggressive_response" ? 30 : typographyStyle === "utility_ui" ? 24 : typographyStyle === "modern_minimal" ? 25 : 27;
  const headlineSize = Math.max(20, headlineBase - (headline.length > 42 ? 3 : 0) - (densityStyle === "compact" ? 1 : 0));
  const fallbackButtons = leadType === "mortgage_protection"
    ? ["Under $150k", "$150k-$300k", "$300k-$500k", "$500k+"]
    : leadType === "trucker"
    ? ["35-44", "45-54", "55-64", "65+"]
    : ["Under 50", "50-60", "61-70", "71+"];

  return {
    draft,
    leadType,
    headline,
    subheadline: clampCopy(overlay.subheadline, 82),
    buttons: (overlay.buttonLabels.length ? overlay.buttonLabels : fallbackButtons).slice(0, 4),
    bullets: overlay.benefitBullets.slice(0, 3),
    cta: clampCopy(overlay.ctaStrip || "Learn more ->", 42),
    eyebrow: getLeadEyebrow(leadType, iaFamily),
    amount: (overlay.buttonLabels.find((label) => label.includes("$")) || (leadType === "veteran" ? "$50,000" : "")),
    backgroundUrl: getCreativeBackground(draft, leadType),
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
    subSize: densityStyle === "compact" ? 11 : 12,
    gap: density.gap,
    pad: density.pad,
    radius: frameStyle === "corner_badge" ? 3 : frameStyle === "soft_glass" ? 14 : 8,
    lineHeight: density.lineHeight,
  };
}

function getOverlayBackground(state: CreativeState): string {
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
      {state.frameStyle === "diagonal_band" && <div style={{ position: "absolute", left: -50, right: -50, top: 142, height: 64, transform: "rotate(-11deg)", background: state.palette.cta, opacity: 0.84 }} />}
      {state.frameStyle === "corner_badge" && <div style={{ position: "absolute", top: 0, right: 0, borderTop: `76px solid ${state.palette.cta}`, borderLeft: "76px solid transparent" }} />}
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
  return (
    <div style={{ color: state.palette.headline, background: state.palette.headlineBg, border: `1px solid ${state.palette.headlineBorder}`, borderRadius: state.radius, padding: compact ? "8px 10px" : "10px 12px" }}>
      <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 2, marginBottom: 5, textTransform: "uppercase" }}>
        {state.eyebrow}
      </div>
      <div style={{ fontSize: compact ? state.headlineSize - 3 : state.headlineSize, fontWeight: 950, lineHeight: state.lineHeight, textTransform: "uppercase" }}>
        {state.headline}
      </div>
      {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: state.subSize, fontWeight: 800, lineHeight: 1.28, marginTop: 6 }}>{state.subheadline}</div>}
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
  const bullets = state.bullets.length ? state.bullets : ["Licensed review", "No obligation", "Fast options check"];
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
          {state.amount && <div style={{ color: state.palette.accent, fontSize: 42, fontWeight: 950, lineHeight: 1, textShadow: "0 3px 14px rgba(0,0,0,0.55)" }}>{state.amount}</div>}
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
      <div style={{ position: "relative", height: "100%", display: "grid", gridTemplateColumns: "44% 56%", padding: state.pad, gap: state.gap, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad }}>
        <div style={{ display: "flex", flexDirection: "column", gap: state.gap, justifyContent: "space-between" }}>
          <Panel state={state} style={{ padding: 10 }}>
            <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.8 }}>{state.eyebrow}</div>
            <div style={{ color: state.palette.accent, fontSize: state.amount ? 34 : 28, fontWeight: 950, lineHeight: 1, marginTop: 8 }}>{state.amount || "FAST CHECK"}</div>
          </Panel>
          <MiniBenefits state={state} />
        </div>
        <Panel state={state} style={{ padding: 12, display: "flex", flexDirection: "column", justifyContent: "space-between", textAlign: "left" }}>
          <div>
            <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1, textTransform: "uppercase" }}>{state.headline}</div>
            {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 12, fontWeight: 800, lineHeight: 1.3, marginTop: 8 }}>{state.subheadline}</div>}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
            {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="panel_cta" />}
          </div>
        </Panel>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderSelectorGrid(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "grid", gridTemplateRows: "auto 1fr auto", gap: state.gap, textAlign: "center" }}>
        <HeadlineBlock state={state} compact />
        <Panel state={state} style={{ padding: 11, alignSelf: "center" }}>
          <div style={{ color: state.palette.accent, fontSize: 12, fontWeight: 950, marginBottom: 9, letterSpacing: 1 }}>SELECT ONE OPTION</div>
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
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: state.gap }}>
        <MiniBenefits state={state} />
        <Panel state={state} style={{ padding: 12, marginTop: "auto", textAlign: "center" }}>
          <div style={{ color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 2 }}>{state.eyebrow}</div>
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.02, textTransform: "uppercase", marginTop: 6 }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 12, fontWeight: 800, marginTop: 7 }}>{state.subheadline}</div>}
          <div style={{ marginTop: 10 }}><ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} /></div>
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="stacked_cta" />}
        </Panel>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderAmountHero(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, textAlign: "center", display: "flex", flexDirection: "column" }}>
        <div style={{ color: state.palette.eyebrow, fontSize: 11, fontWeight: 950, letterSpacing: 2.2 }}>{state.eyebrow}</div>
        <div style={{ color: state.palette.accent, fontSize: 54, fontWeight: 950, lineHeight: 0.95, margin: "16px 0 8px", textShadow: "0 4px 18px rgba(0,0,0,0.65)" }}>{state.amount || "$50,000"}</div>
        <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.02, textTransform: "uppercase" }}>{state.headline}</div>
        <div style={{ marginTop: "auto", display: "grid", gap: state.gap }}>
          <ButtonGrid labels={state.buttons} styleType={state.palette.button} customStyle={getButtonStyle(state)} />
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="floating_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderComparisonTable(state: CreativeState) {
  const rows = state.buttons.length ? state.buttons : ["Option A", "Option B", "Option C"];
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "grid", gridTemplateRows: "auto 1fr auto", gap: state.gap }}>
        <HeadlineBlock state={state} compact />
        <Panel state={state} style={{ padding: 10 }}>
          {rows.slice(0, 4).map((row, index) => (
            <div key={row} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 6px", borderBottom: index === rows.length - 1 ? "none" : `1px solid ${state.palette.panelBorder}`, color: state.palette.subheadline, fontSize: 12, fontWeight: 900 }}>
              <span>{row}</span>
              <span style={{ color: state.palette.accent }}>{index === 0 ? "Best" : "View"}</span>
            </div>
          ))}
        </Panel>
        <CtaUnit state={state} flow={state.ctaFlow === "bottom_bar" ? "comparison_cta" : state.ctaFlow} />
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderQuizCard(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "flex", flexDirection: "column", gap: state.gap }}>
        <Panel state={state} style={{ padding: 13, textAlign: "center" }}>
          <div style={{ color: state.palette.eyebrow, fontSize: 11, fontWeight: 950 }}>QUESTION 1 OF 1</div>
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.03, textTransform: "uppercase", marginTop: 7 }}>{state.headline}</div>
        </Panel>
        <div style={{ display: "grid", gap: 8 }}>
          {state.buttons.map((button, index) => (
            <div key={button} style={{ display: "flex", alignItems: "center", gap: 9, background: state.palette.panel, border: `1px solid ${state.palette.panelBorder}`, borderRadius: state.radius, padding: "9px 10px", color: state.palette.subheadline, fontSize: 12, fontWeight: 950 }}>
              <span style={{ width: 20, height: 20, borderRadius: 999, background: state.palette.cta, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>{index + 1}</span>
              {button}
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto" }}>{state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="quiz_cta" />}</div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderReportCard(state: CreativeState) {
  return (
    <CreativeShell state={state}>
      <div style={{ position: "relative", height: "100%", padding: state.pad, paddingBottom: state.ctaFlow === "bottom_bar" ? 54 : state.pad, display: "grid", gap: state.gap }}>
        <Panel state={state} style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: state.palette.eyebrow, fontSize: 10, fontWeight: 950, letterSpacing: 1.4 }}>
            <span>REVIEW</span><span>READY</span>
          </div>
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.04, textTransform: "uppercase", marginTop: 8 }}>{state.headline}</div>
        </Panel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Panel state={state} style={{ padding: 10, color: state.palette.subheadline, fontSize: 11, fontWeight: 900 }}>Options<br /><span style={{ color: state.palette.accent, fontSize: 24 }}>✓</span></Panel>
          <Panel state={state} style={{ padding: 10, color: state.palette.subheadline, fontSize: 11, fontWeight: 900 }}>Time<br /><span style={{ color: state.palette.accent, fontSize: 20 }}>Fast</span></Panel>
        </div>
        <MiniBenefits state={state} />
        {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="panel_cta" />}
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
          <div style={{ color: state.palette.headline, fontSize: state.headlineSize, fontWeight: 950, lineHeight: 1.03, textTransform: "uppercase" }}>{state.headline}</div>
          {state.subheadline && <div style={{ color: state.palette.subheadline, fontSize: 12, fontWeight: 800, lineHeight: 1.35, marginTop: 8 }}>{state.subheadline}</div>}
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
        <div style={{ alignSelf: "flex-start", maxWidth: "82%", background: state.palette.panel, border: `1px solid ${state.palette.panelBorder}`, borderRadius: "14px 14px 14px 4px", padding: 11, color: state.palette.headline, fontSize: 18, fontWeight: 950, lineHeight: 1.05 }}>{state.headline}</div>
        {state.subheadline && <div style={{ alignSelf: "flex-end", maxWidth: "78%", background: state.palette.headlineBg, border: `1px solid ${state.palette.headlineBorder}`, borderRadius: "14px 14px 4px 14px", padding: 10, color: state.palette.subheadline, fontSize: 12, fontWeight: 850 }}>{state.subheadline}</div>}
        <div style={{ marginTop: "auto", display: "grid", gap: 8 }}>
          {state.buttons.slice(0, 3).map((button) => <div key={button} style={{ background: state.palette.cta, color: "#fff", borderRadius: 999, padding: "9px 12px", textAlign: "center", fontSize: 12, fontWeight: 950 }}>{button}</div>)}
          {state.ctaFlow !== "bottom_bar" && <CtaUnit state={state} flow="floating_cta" />}
        </div>
      </div>
      {state.ctaFlow === "bottom_bar" && <CtaUnit state={state} />}
    </CreativeShell>
  );
}

function renderTemplateFamily(state: CreativeState) {
  if (state.layoutFamily === "split_panel") return renderSplitPanel(state);
  if (state.layoutFamily === "selector_grid") return renderSelectorGrid(state);
  if (state.layoutFamily === "checklist_first" || state.layoutFamily === "trust_medical") return renderChecklistFirst(state);
  if (state.layoutFamily === "amount_hero") return renderAmountHero(state);
  if (state.layoutFamily === "comparison_table") return renderComparisonTable(state);
  if (state.layoutFamily === "quiz_card") return renderQuizCard(state);
  if (state.layoutFamily === "report_card" || state.layoutFamily === "mobile_native") return renderReportCard(state);
  if (state.layoutFamily === "advisory_notice") return renderAdvisoryNotice(state);
  if (state.layoutFamily === "messenger_prompt") return renderMessengerPrompt(state);
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
  regenerateAttempts = 0,
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
  const canRegenerate = regenerateAttempts < 3 && !regenerating;
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
        ref={creativeRef}
        style={{
          position: "relative",
          width: 375,
          height: 375,
          overflow: "hidden",
          background: "#ffffff",
          flexShrink: 0,
        }}
      >
        <FinishedCreativeRenderer draft={draft} leadType={leadType} overlay={overlay} />
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
            : canRegenerate
            ? `↺  Regenerate (${3 - regenerateAttempts} left)`
            : "No regenerations left"}
        </button>
      </div>
    </div>
  );
}
