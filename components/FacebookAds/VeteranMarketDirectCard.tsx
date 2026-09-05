import type { CSSProperties } from "react";
import { VeteranReferenceReplicaCard } from "@/components/FacebookAds/VeteranReferenceReplicaCard";
import type { ApprovedVeteranConcept } from "@/lib/facebook/approvedVeteranCreative";

const REPLICA_SIZES = [
  [332, 413], [331, 413], [334, 413], [332, 388], [331, 388], [334, 388],
  [332, 347], [331, 347], [334, 347], [332, 350], [331, 350], [334, 350],
] as const;

// Preserve the reference palette. These are restrained print/surface treatments,
// not hue rotations: navy stays navy, red stays red, and gold stays gold.
// The previous wide hue shifts produced neon green, pink, and purple executions
// that did not resemble the owner-approved references.
const COLOR_TREATMENTS = [
  "none",
  "saturate(.96) brightness(1.01)",
  "saturate(.92) contrast(1.02)",
  "saturate(.88) brightness(1.02)",
  "saturate(.9) contrast(1.04)",
  "saturate(.98) contrast(1.03)",
  "saturate(1.03) brightness(.99)",
  "saturate(1.06) contrast(1.02)",
  "saturate(1.08) brightness(.98)",
  "saturate(.94) brightness(.98) contrast(1.05)",
  "saturate(.86) brightness(1.03) contrast(.99)",
  "saturate(.82) contrast(1.03)",
  "saturate(.78) brightness(1.02) contrast(1.04)",
  "saturate(.9) sepia(.03) contrast(1.02)",
  "saturate(.86) sepia(.05) brightness(1.01)",
  "saturate(.82) sepia(.07) contrast(1.03)",
  "saturate(.95) grayscale(.02) contrast(1.02)",
  "saturate(.9) grayscale(.04) brightness(1.01)",
  "saturate(.85) grayscale(.06) contrast(1.04)",
  "saturate(.8) grayscale(.08) brightness(1.02)",
] as const;

function executionNumber(executionId: string) {
  return Math.max(1, Number(executionId.match(/EXEC_(\d+)$/)?.[1] || 1));
}

export function VeteranMarketDirectCard({ concept }: { concept: ApprovedVeteranConcept }) {
  const tile = Math.min(12, Math.max(1, concept.referenceTile || 1));
  const [width, height] = REPLICA_SIZES[tile - 1];
  const scale = 540 / width;
  const filter = COLOR_TREATMENTS[(executionNumber(concept.executionId) - 1) % COLOR_TREATMENTS.length];
  const amount = concept.heroAmount === 40_000
    ? "$40,000"
    : concept.heroAmount === 50_000
      ? "$50,000"
      : "$100,000";

  return <div
    data-market-direct-layout={`reference-${String(tile).padStart(2, "0")}`}
    data-reference-replica-variant={executionNumber(concept.executionId)}
    style={{ position: "absolute", inset: 0, width: 540, height: 675, overflow: "hidden", background: "#071426" }}
  >
    <div style={{
      position: "absolute",
      width,
      height,
      left: 0,
      top: (675 - height * scale) / 2,
      transform: `scale(${scale})`,
      transformOrigin: "top left",
      filter,
    } as CSSProperties}>
      <VeteranReferenceReplicaCard tile={tile} amount={amount} />
    </div>
  </div>;
}
