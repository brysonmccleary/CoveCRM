import type { GetServerSideProps } from "next";
import ApprovedVeteranCreative from "@/components/FacebookAds/ApprovedVeteranCreative";
import {
  buildApprovedVeteranLibrary,
  isOwnerSelectableVeteranExecution,
  selectApprovedVeteranConcepts,
  type ApprovedVeteranConcept,
} from "@/lib/facebook/approvedVeteranCreative";
import { VETERAN_AUG29_GOLDEN_VISUALS } from "@/lib/facebook/veteranGoldenVisualAuthority";

type ReviewMode = "full" | "random" | "images" | "golden" | "authenticated";

function deterministicOrder(values: ApprovedVeteranConcept[], seed: string) {
  const score = (value: string) => {
    let hash = 2166136261;
    for (const character of `${seed}:${value}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  return [...values].sort((left, right) => score(left.executionId) - score(right.executionId));
}

export default function VeteranFinalProductionReview({ mode, concepts }: { mode: ReviewMode; concepts: ApprovedVeteranConcept[] }) {
  return <main data-veteran-review-root="true" data-review-mode={mode}>
    <style jsx global>{`html,body,#__next{margin:0;min-height:100%;background:#071426}*{box-sizing:border-box}`}</style>
    <header>
      <strong>VETERAN FINAL PRODUCTION QA</strong>
      <span>{mode.toUpperCase()} · {concepts.length} ACTUAL PRODUCTION-SELECTABLE EXECUTIONS</span>
      <small>Recovered August 29 pixel authority · no regeneration · no Meta launch</small>
    </header>
    <section className="grid">
      {concepts.map((concept) => <article data-review-card="true" data-execution-id={concept.executionId} key={concept.executionId}>
        <div className="creative"><ApprovedVeteranCreative draft={{ approvedVeteranConcept: concept }} /></div>
        <div className="meta"><b>{concept.executionId}</b><span>{concept.renderFingerprint}</span><span>{concept.backgroundAssetId || "PURE GRAPHIC"} · {concept.imageTreatment}</span></div>
      </article>)}
    </section>
    <style jsx>{`
      main{width:1460px;padding:18px;color:#fff;font-family:Arial,sans-serif}
      header{display:flex;flex-direction:column;gap:5px;align-items:center;border:2px solid #eebb45;background:#0c2a46;padding:16px;margin-bottom:16px}
      header strong{font-size:24px;color:#eebb45}header span{font-size:16px;font-weight:900}header small{color:#c8d6e5}
      .grid{display:grid;grid-template-columns:repeat(5,270px);gap:16px}
      article{width:270px;background:#0b1c2d;border:1px solid #38516a;padding:0 0 8px;overflow:hidden}
      .creative{width:270px;height:337.5px;overflow:hidden;background:#071525}
      .meta{padding:7px 8px 0;min-height:51px;display:flex;flex-direction:column;gap:2px;font-size:8px;color:#aebfd0;overflow-wrap:anywhere}
      .meta b{font-size:10px;color:#fff}.meta span:last-child{color:#eebb45}
    `}</style>
  </main>;
}

export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  if (process.env.NODE_ENV !== "development") return { notFound: true };
  const mode = (["full", "random", "images", "golden", "authenticated"].includes(String(query.mode)) ? String(query.mode) : "full") as ReviewMode;
  const eligible = buildApprovedVeteranLibrary().filter(isOwnerSelectableVeteranExecution);
  let concepts: ApprovedVeteranConcept[];
  if (mode === "golden") {
    const ids = new Set(VETERAN_AUG29_GOLDEN_VISUALS.map((golden) => golden.executionId));
    concepts = eligible.filter((concept) => ids.has(concept.executionId));
  } else if (mode === "images") {
    concepts = deterministicOrder(eligible.filter((concept) => Boolean(concept.backgroundAssetId)), "VETERAN-FINAL-IMAGE-60").slice(0, 60);
  } else if (mode === "random") {
    concepts = deterministicOrder(eligible, "VETERAN-FINAL-RANDOM-60").slice(0, 60);
  } else if (mode === "authenticated") {
    concepts = selectApprovedVeteranConcepts({ seed: "VETERAN-AUTHENTICATED-5", count: 5 });
  } else {
    concepts = eligible;
  }
  return { props: { mode, concepts: JSON.parse(JSON.stringify(concepts)) } };
};
