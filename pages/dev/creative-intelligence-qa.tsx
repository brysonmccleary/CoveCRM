import type { GetServerSideProps } from "next";
import { ProductionFeedCreative } from "@/components/FacebookAds/AdPreviewCard";
import { generateCreativeIntelligenceDrafts } from "@/lib/facebook/creativeIntelligence/engine";
import { CREATIVE_LAYOUTS } from "@/lib/facebook/creativeIntelligence/layouts";

export default function CreativeIntelligenceQa({ drafts }: { drafts: Array<Record<string, any>> }) {
  return (
    <main style={{ background: "#111827", minHeight: "100vh", padding: 24, color: "white", fontFamily: "system-ui" }}>
      <h1 style={{ margin: "0 0 6px" }}>Creative Intelligence — 12 Layout QA</h1>
      <p style={{ margin: "0 0 24px", color: "#cbd5e1" }}>Development-only render surface. No Cove or Meta objects are created.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(560px, 1fr))", gap: 28 }}>
        {drafts.map((draft) => (
          <section key={String(draft.layoutId)} style={{ display: "grid", gap: 10 }}>
            <div>
              <strong>{String(draft.layoutId)}</strong>
              <div style={{ color: "#94a3b8", fontSize: 13 }}>{String(draft.leadType)} · {String(draft.winningFamilyId)} · {String(draft.visualTreatment)}</div>
            </div>
            <ProductionFeedCreative draft={draft} />
          </section>
        ))}
      </div>
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = async () => {
  if (process.env.NODE_ENV !== "development") return { notFound: true };
  const configs = [
    ["veteran", "veteran", "en"], ["final_expense", "standard", "en"],
    ["mortgage_protection", "standard", "en"], ["iul", "standard", "en"],
    ["trucker", "trucker", "en"], ["final_expense", "spanish", "es"],
  ] as const;
  const byLayout = new Map<string, Record<string, any>>();
  for (let round = 0; round < 80 && byLayout.size < CREATIVE_LAYOUTS.length; round++) {
    const [vertical, audienceSegment, language] = configs[round % configs.length];
    const drafts = generateCreativeIntelligenceDrafts({
      vertical, audienceSegment, language, userKey: `visual-qa-${round}`,
      campaignName: "Visual QA", requestedCount: 5, generationNonce: `visual-qa-${round}`,
    });
    for (const draft of drafts) if (!byLayout.has(draft.layoutId)) byLayout.set(draft.layoutId, draft);
  }
  return {
    props: {
      drafts: CREATIVE_LAYOUTS.map((layout) => byLayout.get(layout.layoutId)).filter(Boolean),
    },
  };
};
