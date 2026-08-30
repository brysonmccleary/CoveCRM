import type { CSSProperties, ReactNode } from "react";
import {
  getApprovedTruckerImageUrl,
  type ApprovedTruckerConcept,
  type PaletteId,
} from "@/lib/facebook/approvedTruckerCreative";
import styles from "./ApprovedTruckerCreative.module.css";

const PALETTES: Record<PaletteId, {
  ink: string;
  paper: string;
  accent: string;
  accent2: string;
  muted: string;
}> = {
  black_gold: { ink: "#06080b", paper: "#f7f1df", accent: "#f3bd45", accent2: "#9b6a15", muted: "#d5d1c8" },
  navy_amber: { ink: "#071a2f", paper: "#f6f8fb", accent: "#f6b73c", accent2: "#e16f2d", muted: "#b9c8d8" },
  dark_orange: { ink: "#101820", paper: "#fffaf3", accent: "#f47a2a", accent2: "#d84c23", muted: "#d6d7d8" },
  purple_gold: { ink: "#24113d", paper: "#fff9ed", accent: "#f0c75e", accent2: "#9d48e8", muted: "#d9c9e7" },
  cream_rust: { ink: "#34271f", paper: "#f3e6c9", accent: "#c4572c", accent2: "#8b331d", muted: "#d6c3a2" },
  patriotic: { ink: "#071b3a", paper: "#fffaf0", accent: "#d73535", accent2: "#2e6ccc", muted: "#ced7e8" },
  white_navy: { ink: "#0b213d", paper: "#fffdf7", accent: "#c63d35", accent2: "#e0a735", muted: "#dfe5eb" },
};

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

function Heading({ concept }: { concept: ApprovedTruckerConcept }) {
  return (
    <>
      <div className={styles.lane}>{concept.lane === "trucker_iul" ? "TRUCKER IUL" : "TRUCKER LIFE"}</div>
      <h1 className={styles.headline}>{concept.master.headline}</h1>
      <p className={styles.subhead}>{concept.master.subhead}</p>
    </>
  );
}

function Qualifier({ concept }: { concept: ApprovedTruckerConcept }) {
  if (!concept.master.qualifier.length) return null;
  return (
    <div className={styles.qualifier}>
      {concept.master.qualifier.map((label, index) => (
        <div className={styles.qualifierCard} key={`${label}-${index}`}>
          <small>{index === 0 ? "SELECT" : "OPTION"}</small>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function Bullets({ concept }: { concept: ApprovedTruckerConcept }) {
  if (!concept.master.bullets.length) return null;
  return (
    <div className={styles.bullets}>
      {concept.master.bullets.map((label, index) => (
        <div className={styles.bullet} key={`${label}-${index}`}>
          <span className={styles.bulletIndex}>{index + 1}</span>
          <b className={styles.bulletText}>{label}</b>
        </div>
      ))}
    </div>
  );
}

function Cta({ concept }: { concept: ApprovedTruckerConcept }) {
  return (
    <div className={styles.cta}>
      {concept.master.cta}
      <span className={styles.ctaArrow}>→</span>
    </div>
  );
}

function RouteBadge({ concept }: { concept: ApprovedTruckerConcept }) {
  return (
    <div className={styles.routeBadge}>
      <small>PRIVATE REVIEW</small>
      <b>{concept.lane === "trucker_iul" ? "IUL" : "CDL"}</b>
      <small>ROAD AHEAD</small>
    </div>
  );
}

function Section({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={cx(styles.section, className)}>{children}</section>;
}

function ApprovedMasterLayout({ concept }: { concept: ApprovedTruckerConcept }) {
  const heading = <Heading concept={concept} />;
  const bullets = <Bullets concept={concept} />;
  const qualifier = <Qualifier concept={concept} />;
  const cta = <Cta concept={concept} />;

  switch (concept.master.kind) {
    case "age_selector":
      return <Section className={cx(styles.center)}>{heading}<div className={styles.heroSpacer} />{qualifier}{cta}</Section>;
    case "benefit_grid":
      return <Section className={cx(styles.center)}>{heading}<div className={styles.heroSpacerShort} />{bullets}{qualifier}{cta}</Section>;
    case "truck_right":
      return <Section className={styles.copyLeft}>{heading}{bullets}{qualifier}{cta}</Section>;
    case "policy_poster":
      return <Section className={styles.topCopy}>{heading}{bullets}{qualifier}{cta}</Section>;
    case "hook_poster":
      return <Section className={styles.hook}>{heading}{qualifier}{cta}</Section>;
    case "driver_qualifier":
      return <Section className={styles.driverCopy}>{heading}{qualifier}{cta}</Section>;
    case "open_road":
      return <Section className={styles.roadCard}>{heading}{bullets}{cta}</Section>;
    case "home_base":
      return <Section className={styles.homeCopy}><div className={styles.shield}>⌂</div>{heading}{bullets}{cta}</Section>;
    case "problem_solution":
      return <Section className={styles.problem}>{heading}{bullets}{qualifier}{cta}</Section>;
    case "identity_badge":
      return <Section className={styles.identity}><RouteBadge concept={concept} />{heading}{qualifier}{bullets}{cta}</Section>;
    case "split_offer":
      return <Section className={styles.splitCopy}>{heading}{bullets}{qualifier}{cta}</Section>;
    case "route_vintage":
      return <Section className={styles.vintage}><RouteBadge concept={concept} />{heading}{bullets}{cta}</Section>;
    case "future_steps":
      return <Section className={styles.steps}>{heading}{bullets}{cta}</Section>;
    case "editorial":
      return <Section className={styles.editorial}>{heading}<div className={styles.rule} />{bullets}{qualifier}{cta}</Section>;
  }
}

export default function ApprovedTruckerCreative({ draft }: { draft: Record<string, any> }) {
  const concept = draft?.approvedTruckerConcept as ApprovedTruckerConcept | undefined;
  if (!concept?.visualConceptId || !concept?.imageNumber || !concept?.treatment) return null;
  const palette = PALETTES[concept.palette];
  const variables = {
    "--ink": palette.ink,
    "--paper": palette.paper,
    "--accent": palette.accent,
    "--accent2": palette.accent2,
    "--muted": palette.muted,
  } as CSSProperties;

  return (
    <div
      className={styles.frame}
      data-approved-trucker-creative="true"
      data-visual-concept-id={concept.visualConceptId}
      data-truck-visible="true"
      style={{ background: palette.ink }}
    >
      <div className={styles.square}>
        <div
          className={styles.canvas}
          data-treatment={concept.treatment}
          data-crop={concept.cropPosition}
          data-zoom={concept.imageZoom}
          data-lane={concept.lane}
          data-master={concept.master.id}
          style={variables}
        >
          <img
            alt=""
            className={styles.photo}
            data-creative-photo="true"
            src={getApprovedTruckerImageUrl(concept.imageNumber)}
          />
          <div className={styles.overlay} />
          <div className={styles.border} />
          <ApprovedMasterLayout concept={concept} />
        </div>
      </div>
    </div>
  );
}
