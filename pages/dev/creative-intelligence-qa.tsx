import type { GetServerSideProps } from "next";
import { ProductionFeedCreative } from "@/components/FacebookAds/AdPreviewCard";
import { buildCreativeVisualQaCorpus } from "@/lib/facebook/creativeIntelligence/qaCorpus";

export default function CreativeIntelligenceQa({ drafts, title }: { drafts: Array<Record<string, any>>; title: string }) {
  return (
    <main style={{ background: "#111827", minHeight: "100vh", padding: 22, color: "white", fontFamily: "system-ui" }}>
      <h1 style={{ margin: "0 0 6px" }}>Creative Intelligence — {title}</h1>
      <p style={{ margin: "0 0 24px", color: "#cbd5e1" }}>Development-only render surface. No Cove or Meta objects are created.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 216px)", gap: 24 }}>
        {drafts.map((draft) => (
          <section key={String(draft.previewId)} data-preview-id={String(draft.previewId)} style={{ display: "grid", gap: 8, width: 216 }}>
            <div>
              <strong style={{ fontSize: 11 }}>{String(draft.previewId)} · {String(draft.qaConfigLabel)}</strong>
              <div style={{ color: "#94a3b8", fontSize: 8, minHeight: 20 }}>{String(draft.layoutId)} · {String(draft.winningFamilyId)} · {String(draft.visualTreatment)}</div>
            </div>
            <div style={{ width: 216, height: 270, overflow: "hidden" }}>
              <div style={{ width: 540, height: 675, transform: "scale(0.4)", transformOrigin: "top left" }}>
                <ProductionFeedCreative draft={draft} />
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  if (process.env.NODE_ENV !== "development") return { notFound: true };
  const corpus = buildCreativeVisualQaCorpus();
  const group = String(query.group || "veteran");
  const sheet = Math.max(1, Number(query.sheet || 1));
  const layout = String(query.layout || "");
  const batch = String(query.batch || "");
  const matches = batch
    ? corpus.previews.filter((draft) => draft.qaBatchId === batch)
    : layout ? corpus.previews.filter((draft) => draft.layoutId === layout)
      : corpus.previews.filter((draft) => draft.qaGroup === group);
  const drafts = JSON.parse(JSON.stringify(matches.slice((sheet - 1) * 6, sheet * 6)));
  return {
    props: {
      drafts,
      title: batch ? `${batch}` : layout ? `${layout} · sheet ${sheet}` : `${group} · sheet ${sheet}`,
    },
  };
};
