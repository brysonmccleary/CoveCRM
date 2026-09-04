import type { CSSProperties } from "react";
import type { ApprovedVeteranConcept } from "@/lib/facebook/approvedVeteranCreative";
import styles from "@/styles/VeteranMarketDirect.module.css";

const PALETTES: Record<string, Record<string, string>> = {
  midnight_gold: { bg: "#041426", bg2: "#092f57", ink: "#ffffff", accent: "#f4c84d", action: "#f1bd2f", actionInk: "#06172a", panel: "#0a315a", line: "#8fb3d7" },
  navy_gold: { bg: "#061a32", bg2: "#0b3b69", ink: "#ffffff", accent: "#f0bd3d", action: "#f0bd3d", actionInk: "#07192d", panel: "#0c365e", line: "#9bb7d0" },
  royal_gold: { bg: "#08245a", bg2: "#13529a", ink: "#ffffff", accent: "#ffd45c", action: "#f4c63f", actionInk: "#08204a", panel: "#103f7f", line: "#aec8e8" },
  slate_gold: { bg: "#172333", bg2: "#31455b", ink: "#ffffff", accent: "#f3c453", action: "#eebd43", actionInk: "#111d2a", panel: "#26384b", line: "#a8b6c5" },
  black_gold: { bg: "#090b0e", bg2: "#20252a", ink: "#ffffff", accent: "#efbf48", action: "#efbf48", actionInk: "#080b0e", panel: "#181d22", line: "#a9aaac" },
  ink_amber: { bg: "#11151d", bg2: "#273245", ink: "#ffffff", accent: "#ffb52e", action: "#f5a91f", actionInk: "#15171b", panel: "#202a38", line: "#aab4c1" },
  navy_red: { bg: "#061a32", bg2: "#0b3b69", ink: "#ffffff", accent: "#efbe46", action: "#c51f2d", actionInk: "#ffffff", panel: "#0c365e", line: "#9bb7d0" },
  royal_red: { bg: "#092250", bg2: "#144b89", ink: "#ffffff", accent: "#f5d16a", action: "#ba1827", actionInk: "#ffffff", panel: "#113b72", line: "#b4c9e0" },
  cream_navy: { bg: "#f7f2e9", bg2: "#ffffff", ink: "#071c35", accent: "#b5841f", action: "#082f5f", actionInk: "#ffffff", panel: "#fffaf0", line: "#496785" },
  cream_red: { bg: "#f5efe6", bg2: "#ffffff", ink: "#0a2039", accent: "#a91c25", action: "#b51d28", actionInk: "#ffffff", panel: "#fffaf3", line: "#6e7f91" },
  white_navy: { bg: "#ffffff", bg2: "#eaf1f8", ink: "#061c37", accent: "#0c4177", action: "#0b3565", actionInk: "#ffffff", panel: "#f7fbff", line: "#66829d" },
  silver_navy: { bg: "#e8edf2", bg2: "#ffffff", ink: "#071d37", accent: "#173f68", action: "#092f59", actionInk: "#ffffff", panel: "#f6f8fa", line: "#72869a" },
};

function CheckIcon() {
  return <span className={styles.check} aria-hidden="true">✓</span>;
}

function AgeGrid({ ages }: { ages: string[] }) {
  return <div className={styles.ageGrid}>{ages.map((age) => <span key={age}>{age}</span>)}</div>;
}

function paletteStyle(concept: ApprovedVeteranConcept): CSSProperties {
  const palette = PALETTES[concept.palette] || PALETTES.midnight_gold;
  const surface = Math.max(1, Number(concept.panelTreatment.match(/(\d+)$/)?.[1] || 1));
  return {
    "--market-bg": palette.bg,
    "--market-bg-2": palette.bg2,
    "--market-ink": palette.ink,
    "--market-accent": palette.accent,
    "--market-action": palette.action,
    "--market-action-ink": palette.actionInk,
    "--market-panel": palette.panel,
    "--market-line": palette.line,
    "--market-angle": `${118 + surface * 3}deg`,
    "--market-stripe": `${18 + surface * 2}px`,
  } as CSSProperties;
}

function OfferFirst({ concept }: { concept: ApprovedVeteranConcept }) {
  return <div className={`${styles.card} ${styles.offerFirst}`} style={paletteStyle(concept)} data-market-direct-layout="offer-first">
    <div className={styles.texture} />
    <div className={styles.badge}>★ FOR U.S. VETERANS</div>
    <h1>VETERANS</h1>
    <h2>WHOLE LIFE COVERAGE</h2>
    <div className={styles.waitBar}>NO 2-YEAR WAIT</div>
    <section className={styles.amountPanel}><small>COVERAGE OPTIONS UP TO</small><strong>$100,000</strong></section>
    <div className={styles.benefitRow}>{concept.benefits.map((benefit) => <div key={benefit}><CheckIcon /><b>{benefit}</b></div>)}</div>
    <div className={styles.ageBlock}><b>SELECT YOUR AGE TO SEE OPTIONS:</b><AgeGrid ages={concept.ageOptions} /></div>
    <div className={styles.cta}>{concept.cta}<span>›</span></div>
    <small className={styles.disclaimer}>Private coverage. Not affiliated with the VA.</small>
  </div>;
}

function FamilyBurden({ concept }: { concept: ApprovedVeteranConcept }) {
  return <div className={`${styles.card} ${styles.familyBurden}`} style={paletteStyle(concept)} data-market-direct-layout="family-burden">
    <div className={styles.texture} />
    <div className={styles.badge}>FOR U.S. VETERANS</div>
    <h1>DON’T LEAVE THE<br />BURDEN TO YOUR FAMILY</h1>
    <p>Help cover final costs and give your loved ones peace of mind.</p>
    <div className={styles.benefitCards}>{concept.benefits.map((benefit) => <div key={benefit}><CheckIcon /><b>{benefit}</b></div>)}</div>
    <section className={styles.amountPanel}><small>COVERAGE OPTIONS UP TO</small><strong>$100,000</strong></section>
    <div className={styles.ageBlock}><b>SELECT YOUR AGE:</b><AgeGrid ages={concept.ageOptions} /></div>
    <div className={styles.cta}>{concept.cta}<span>›</span></div>
    <small className={styles.disclaimer}>No obligation. Private coverage.</small>
  </div>;
}

export function VeteranMarketDirectCard({ concept }: { concept: ApprovedVeteranConcept }) {
  return concept.masterId === "VET_MARKET_02"
    ? <FamilyBurden concept={concept} />
    : <OfferFirst concept={concept} />;
}
