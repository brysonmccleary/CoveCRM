import type { CSSProperties } from "react";
import { VeteranReferenceReplicaCard } from "@/components/FacebookAds/VeteranReferenceReplicaCard";
import type { ApprovedVeteranConcept } from "@/lib/facebook/approvedVeteranCreative";

const REPLICA_SIZES = [
  [332, 413], [331, 413], [334, 413], [332, 388], [331, 388], [334, 388],
  [332, 347], [331, 347], [334, 347], [332, 350], [331, 350], [334, 350],
] as const;

const COLOR_TREATMENTS = [
  { hue: 0, saturation: 1, brightness: 1 },
  { hue: -8, saturation: 1.05, brightness: 1.02 },
  { hue: 8, saturation: 1.08, brightness: 0.98 },
  { hue: -16, saturation: 0.94, brightness: 1.04 },
  { hue: 16, saturation: 1.12, brightness: 0.96 },
  { hue: -24, saturation: 1.08, brightness: 0.98 },
  { hue: 24, saturation: 0.92, brightness: 1.04 },
  { hue: -32, saturation: 1.14, brightness: 0.97 },
  { hue: 32, saturation: 1.06, brightness: 1.01 },
  { hue: -40, saturation: 0.9, brightness: 1.05 },
  { hue: 40, saturation: 1.15, brightness: 0.96 },
  { hue: -48, saturation: 1.04, brightness: 1.02 },
  { hue: 48, saturation: 0.96, brightness: 1 },
  { hue: -56, saturation: 1.12, brightness: 0.97 },
  { hue: 56, saturation: 1.08, brightness: 1.03 },
  { hue: -64, saturation: 0.94, brightness: 1.01 },
  { hue: 64, saturation: 1.1, brightness: 0.96 },
  { hue: -72, saturation: 1.06, brightness: 1.04 },
  { hue: 72, saturation: 0.92, brightness: 1 },
  { hue: 88, saturation: 1.12, brightness: 0.98 },
];

function executionNumber(executionId: string) {
  return Math.max(1, Number(executionId.match(/EXEC_(\d+)$/)?.[1] || 1));
}

export function VeteranMarketDirectCard({ concept }: { concept: ApprovedVeteranConcept }) {
  const tile = Math.min(12, Math.max(1, concept.referenceTile || 1));
  const [width, height] = REPLICA_SIZES[tile - 1];
  const scale = 540 / width;
  const treatment = COLOR_TREATMENTS[(executionNumber(concept.executionId) - 1) % COLOR_TREATMENTS.length];
  const filter = `hue-rotate(${treatment.hue}deg) saturate(${treatment.saturation}) brightness(${treatment.brightness})`;

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
      <VeteranReferenceReplicaCard tile={tile} amount="$100,000" />
    </div>
  </div>;
}
