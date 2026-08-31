import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Veteran24MasterReviewCard } from "@/components/FacebookAds/Veteran24MasterReviewCard";
import { VeteranReferenceLockedCard } from "@/components/FacebookAds/VeteranReferenceLockedCard";
import { VeteranReferenceReplicaCard } from "@/components/FacebookAds/VeteranReferenceReplicaCard";
import { buildVeteran24MasterReview, type VeteranMasterPreview } from "@/lib/facebook/veteran24MasterReview";
import { buildVeteranReferenceLocked12, type VeteranReferencePreview } from "@/lib/facebook/veteranReferenceLocked12";
import type { ApprovedVeteranConcept } from "@/lib/facebook/approvedVeteranCreative";
import styles from "@/components/FacebookAds/ApprovedVeteranCreative.module.css";

const existingMasters = buildVeteran24MasterReview().safePreviews;
const referenceLockedMasters = buildVeteranReferenceLocked12().safePreviews;
const paletteExisting: Record<string, VeteranMasterPreview["palette"]> = {
  navy_gold: "navy", paper_red: "paper", black_gold: "black", navy_white: "split", patriotic_split: "poster",
};
const paletteLocked: Record<string, VeteranReferencePreview["palette"]> = {
  navy_gold: "dark", paper_red: "light", black_gold: "black", navy_white: "dark", patriotic_split: "image-dark",
};
const replicaSizes = [[332,413],[331,413],[334,413],[332,388],[331,388],[334,388],[332,347],[331,347],[334,347],[332,350],[331,350],[334,350]];
const heroBoxes = [
  {left:20,top:141,width:292,height:70},{left:36,top:159,width:259,height:94},{left:57,top:132,width:220,height:112},{left:20,top:141,width:292,height:70},
  {left:25,top:251,width:281,height:66},{left:25,top:149,width:284,height:78},{left:20,top:277,width:155,height:56},{left:20,top:224,width:291,height:62},
  {left:34,top:132,width:266,height:70},{left:36,top:140,width:260,height:72},{left:20,top:207,width:291,height:67},{left:20,top:217,width:294,height:62},
];

function sourceIndex(id: string) {
  return Math.max(0, Number(id.match(/(\d+)$/)?.[1] || 1) - 1);
}

function VeteranCanvas({ concept }: { concept: ApprovedVeteranConcept }) {
  const commonStyle = {
    "--veteran-image": concept.backgroundUrl ? `url("${concept.backgroundUrl}")` : "none",
    "--veteran-image-position": concept.imageFocalPosition,
  } as CSSProperties;
  const qualityData = {
    "data-visual-concept-id": concept.visualConceptId,
    "data-customer-eligible": concept.customerEligible ? "true" : "false",
    "data-selection-style": concept.selectionStyleCategory,
    "data-hero-contrast": concept.visualQuality.heroContrast,
    "data-hero-prominence": concept.visualQuality.heroProminence,
    "data-headline-contrast": concept.visualQuality.headlineContrast,
    "data-image-copy-collision": concept.visualQuality.imageCopyCollision,
    "data-simplicity": concept.visualQuality.simplicity,
    "data-overflow": concept.visualQuality.overflow,
    "data-clipping": concept.visualQuality.clipping,
  };

  if (concept.masterKind === "literal_replica") {
    const tile = concept.referenceTile || 1;
    const [width, height] = replicaSizes[tile - 1];
    const scale = 540 / width;
    const box = heroBoxes[tile - 1];
    return <div
      className={`${styles.canvas} ${styles.literal} ${styles[concept.palette]} ${styles[concept.compositionMode]} ${styles[concept.borderTreatment]} ${styles[concept.panelTreatment]}`}
      data-approved-veteran-creative="true"
      data-master-kind={concept.masterKind}
      data-reference-tile={tile}
      data-background-treatment={concept.imageTreatment}
      style={commonStyle}
      {...qualityData}
    >
      <div className={styles.replicaInner} style={{ width, height, transform: `scale(${scale})`, top: (675 - height * scale) / 2 }}>
        <VeteranReferenceReplicaCard tile={tile} amount="$50,000" />
        <div className={styles.safeMask} data-safe-mask="true" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
          <small>PRIVATE REVIEW</small>
          <strong>{concept.heroContent.map(line => <span key={line}>{line}</span>)}</strong>
        </div>
      </div>
    </div>;
  }

  if (concept.masterKind === "existing") {
    const base = existingMasters[sourceIndex(concept.sourceMasterId)];
    const preview = {
      ...base,
      masterId: concept.masterId,
      previewId: concept.executionId,
      palette: paletteExisting[concept.palette] || base.palette,
      headline: concept.headline,
      hero: concept.heroContent,
      heroKind: "safe",
      benefits: concept.benefits,
      cta: concept.cta,
      imageUrl: concept.backgroundUrl || "",
      imageTreatment: concept.imageTreatment,
      imageFocalPosition: concept.imageFocalPosition,
      mode: concept.backgroundUrl ? "IMAGE_VARIANT" : "SAFE_MODE",
      capabilityFixtureId: null,
    } as VeteranMasterPreview;
    return <div className={`${styles.canvas} ${styles[concept.borderTreatment]} ${styles[concept.panelTreatment]}`} data-approved-veteran-creative="true" style={commonStyle} {...qualityData}>
      <Veteran24MasterReviewCard preview={preview} />
    </div>;
  }

  const base = referenceLockedMasters[sourceIndex(concept.sourceMasterId)];
  const preview = {
    ...base,
    masterId: concept.masterId,
    previewId: concept.executionId,
    palette: paletteLocked[concept.palette] || base.palette,
    headline: concept.headline,
    hero: concept.heroContent,
    heroKind: "safe",
    benefits: concept.benefits,
    cta: concept.cta,
    imageUrl: concept.backgroundUrl || "",
    imageTreatment: concept.imageTreatment,
    imageFocalPosition: concept.imageFocalPosition,
    mode: concept.backgroundUrl ? "IMAGE_VARIANT" : "SAFE_MODE",
    capabilityFixtureId: null,
  } as VeteranReferencePreview;
  return <div className={`${styles.canvas} ${styles[concept.borderTreatment]} ${styles[concept.panelTreatment]}`} data-approved-veteran-creative="true" style={commonStyle} {...qualityData}>
    <VeteranReferenceLockedCard preview={preview} />
  </div>;
}

export default function ApprovedVeteranCreative({ draft }: { draft: Record<string, any> }) {
  const concept = draft?.approvedVeteranConcept as ApprovedVeteranConcept | undefined;
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => setScale((hostRef.current?.clientWidth || 540) / 540);
    update();
    const observer = new ResizeObserver(update);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, []);
  if (!concept?.visualConceptId || concept.claimMode !== "SAFE_MODE" || !concept.customerEligible) return null;
  return <div ref={hostRef} className={styles.frame} data-approved-veteran-runtime="true">
    <div className={styles.square}>
      <div style={{ width: 540, height: 675, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <VeteranCanvas concept={concept} />
      </div>
    </div>
  </div>;
}
