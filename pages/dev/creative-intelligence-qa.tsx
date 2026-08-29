import type { GetServerSideProps } from "next";
import { ProductionFeedCreative } from "@/components/FacebookAds/AdPreviewCard";
import { buildCreativeVisualQaCorpus } from "@/lib/facebook/creativeIntelligence/qaCorpus";

export default function CreativeIntelligenceQa({ drafts, title, single }: { drafts: Array<Record<string, any>>; title: string; single: boolean }) {
  if (single) {
    return (
      <>
        <style jsx global>{`html, body, #__next { margin: 0; padding: 0; width: 540px; min-width: 540px; background: #0f172a; }`}</style>
        <ProductionFeedCreative draft={drafts[0]} />
      </>
    );
  }
  return (
    <main style={{ background: "#111827", minHeight: "100vh", padding: 22, color: "white", fontFamily: "system-ui" }}>
      <h1 style={{ margin: "0 0 6px" }}>Creative Intelligence — {title}</h1>
      <p style={{ margin: "0 0 24px", color: "#cbd5e1" }}>Development-only render surface. No Cove or Meta objects are created.</p>
      <div style={{ display: "grid", gridTemplateColumns: single ? "540px" : "repeat(3, 216px)", gap: 24 }}>
        {drafts.map((draft) => (
          <section key={String(draft.previewId)} data-preview-id={String(draft.previewId)} style={{ display: "grid", gap: 8, width: single ? 540 : 216 }}>
            <div>
              <strong style={{ fontSize: 11 }}>{String(draft.previewId)} · {String(draft.qaConfigLabel)}</strong>
              <div style={{ color: "#94a3b8", fontSize: 8, minHeight: 20 }}>{String(draft.layoutId)} · {String(draft.cssExecutionId)} · {String(draft.visualTreatment)}</div>
            </div>
            <div style={{ width: single ? 540 : 216, height: single ? 675 : 270, overflow: "hidden" }}>
              <div style={{ width: 540, height: 675, transform: single ? undefined : "scale(0.4)", transformOrigin: "top left" }}>
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
  const preview = String(query.preview || "");
  const sheet = Math.max(1, Number(query.sheet || 1));
  const layout = String(query.layout || "");
  const batch = String(query.batch || "");
  const matches = preview
    ? corpus.previews.filter((draft) => draft.previewId === preview)
    : batch
    ? corpus.previews.filter((draft) => draft.qaBatchId === batch)
    : layout ? corpus.previews.filter((draft) => draft.layoutId === layout)
      : corpus.previews.filter((draft) => draft.qaGroup === group);
  const drafts = JSON.parse(JSON.stringify(preview ? matches : matches.slice((sheet - 1) * 6, sheet * 6)));
  return {
    props: {
      drafts,
      title: preview || (batch ? `${batch}` : layout ? `${layout} · sheet ${sheet}` : `${group} · sheet ${sheet}`),
      single: Boolean(preview),
    },
  };
};
