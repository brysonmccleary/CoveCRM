// components/CallCoachReport.tsx
// Sandwich-method AI Call Coach Report component
import { useState } from "react";

type ScoreBreakdown = {
  opening: number;
  rapport: number;
  discovery: number;
  presentation: number;
  objectionHandling: number;
  closing: number;
};

type ObjectionItem = {
  objection: string;
  howHandled: string;
  betterResponse: string;
  wasOvercome: boolean;
  conceptConfusion?: string | null;
};

type SandwichFeedback = {
  topBread?: string[];
  filling?: string[];
  bottomBread?: string[];
};

type Report = {
  _id?: string;
  callScore: number;
  scoreBreakdown: ScoreBreakdown;
  whatWentWell?: string[];
  whatToImprove?: string[];
  sandwichFeedback?: SandwichFeedback;
  managerSuggestion?: string | null;
  objectionsEncountered: ObjectionItem[];
  nextStepRecommendation: string;
  callSummary: string;
  leadName?: string;
  durationSeconds?: number;
  generatedAt?: string;
};

function scoreColor(score: number) {
  if (!score && score !== 0) return "text-gray-400";
  if (score >= 8) return "text-green-400";
  if (score >= 5) return "text-yellow-400";
  return "text-red-400";
}

function scoreBg(score: number) {
  if (score >= 8) return "bg-green-500";
  if (score >= 5) return "bg-yellow-500";
  return "bg-red-500";
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-xs text-gray-400 text-right shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${scoreBg(score)}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={`text-sm font-bold w-6 text-right ${scoreColor(score)}`}>{score}</div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="text-xs px-2 py-0.5 rounded bg-blue-800/40 hover:bg-blue-700/40 text-blue-300 border border-blue-700/30 transition shrink-0"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function ObjectionCard({ item, index }: { item: ObjectionItem; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/5 hover:bg-white/8 transition text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400">#{index + 1}</span>
          <span className="text-sm text-white font-medium">{item.objection}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.wasOvercome ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
            {item.wasOvercome ? "Overcome" : "Not Overcome"}
          </span>
        </div>
        <svg className={`h-4 w-4 text-gray-400 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 py-3 space-y-3 bg-[#0b1220]">
          <div>
            <p className="text-xs text-gray-400 mb-1">What you said</p>
            <p className="text-sm text-gray-200">{item.howHandled}</p>
          </div>
          <div className="border-l-2 border-blue-500/60 pl-3">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-xs text-blue-400 font-semibold">Better Response</p>
              <CopyButton text={item.betterResponse} />
            </div>
            <p className="text-sm text-gray-200">{item.betterResponse}</p>
          </div>
          {item.conceptConfusion && (
            <div className="bg-yellow-900/20 border border-yellow-500/20 rounded-lg px-3 py-2">
              <p className="text-xs text-yellow-300">⚠️ Insurance jargon note: {item.conceptConfusion}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CallCoachReport({
  callId,
  leadName,
  userHasAI,
}: {
  callId: string;
  leadName?: string;
  userHasAI?: boolean;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/calls/coach-report?callId=${encodeURIComponent(callId)}`, { cache: "no-store" });
      const j = await r.json();
      if (j.report) setReport(j.report);
    } catch {
      // silent — will show generate button
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  if (!loaded && !loading) load();

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/calls/coach-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, leadName }),
      });
      const j = await r.json();
      if (j.report) setReport(j.report);
      else setError(j.error || "Failed to generate report.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  if (!userHasAI) return null;

  const BREAKDOWN_LABELS: [keyof ScoreBreakdown, string][] = [
    ["opening", "Opening"],
    ["rapport", "Rapport"],
    ["discovery", "Discovery"],
    ["presentation", "Presentation"],
    ["objectionHandling", "Objection Handling"],
    ["closing", "Closing"],
  ];

  // Resolve sandwich or legacy fields
  const topBread = report?.sandwichFeedback?.topBread?.length
    ? report.sandwichFeedback.topBread
    : (report?.whatWentWell || []);
  const filling = report?.sandwichFeedback?.filling?.length
    ? report.sandwichFeedback.filling
    : (report?.whatToImprove || []);
  const bottomBread = report?.sandwichFeedback?.bottomBread || [];

  const displayScore = report?.callScore ?? null;

  return (
    <div className="mt-4 bg-[#0b1220] border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <span className="text-white text-sm">🎯</span>
          </div>
          <span className="text-white font-semibold">AI Call Coach</span>
          {displayScore !== null && (
            <span className={`text-sm font-bold ${scoreColor(displayScore)}`}>
              {displayScore}/10
            </span>
          )}
        </div>
        {loaded && !report && !generating && (
          <button
            onClick={generate}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg font-medium transition"
          >
            Generate Coach Report
          </button>
        )}
        {report && (
          <button
            onClick={generate}
            disabled={generating}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/15 text-gray-300 text-xs rounded-lg transition"
          >
            {generating ? "Regenerating..." : "Regenerate"}
          </button>
        )}
      </div>

      {(loading || generating) && (
        <div className="px-5 py-8 text-center text-gray-400 text-sm">
          {generating ? "Generating your coaching report…" : "Loading…"}
        </div>
      )}

      {error && !generating && (
        <div className="px-5 py-4 text-red-400 text-sm">{error}</div>
      )}

      {loaded && !report && !loading && !generating && !error && (
        <div className="px-5 py-6 text-center text-gray-400 text-sm">
          No coaching report yet.{" "}
          <button onClick={generate} className="text-blue-400 hover:underline">Generate one now</button>{" "}
          to get AI feedback on this call.
        </div>
      )}

      {report && !loading && !generating && (
        <div className="p-5 space-y-6">
          {/* Overall Score */}
          <div className="flex items-center gap-5">
            <div className="relative flex items-center justify-center h-20 w-20 shrink-0">
              <svg className="absolute inset-0 h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                <circle
                  cx="40" cy="40" r="34" fill="none" strokeWidth="8" strokeLinecap="round"
                  className={displayScore !== null && displayScore >= 8 ? "stroke-green-500" : displayScore !== null && displayScore >= 5 ? "stroke-yellow-500" : "stroke-red-500"}
                  strokeDasharray={`${((displayScore || 0) / 10) * 213.6} 213.6`}
                />
              </svg>
              <span className={`text-2xl font-bold ${scoreColor(displayScore || 0)}`}>
                {displayScore ?? "—"}
              </span>
            </div>
            <div>
              <div className="text-white font-semibold text-lg">
                {displayScore !== null
                  ? displayScore >= 8 ? "Strong Call" : displayScore >= 5 ? "Decent Call" : "Needs Work"
                  : "Analyzing…"}
              </div>
              {report.callSummary && (
                <p className="text-gray-400 text-sm mt-1 leading-relaxed">{report.callSummary}</p>
              )}
            </div>
          </div>

          {/* 🍞 TOP BREAD — What You Did Well (FIRST — sandwich top) */}
          {topBread.length > 0 && (
            <div>
              <div className="text-xs text-green-400 uppercase tracking-wider font-medium mb-2">✓ What You Did Well</div>
              <div className="space-y-2">
                {topBread.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 bg-green-900/10 border border-green-500/15 rounded-lg px-3 py-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-green-500/20 flex items-center justify-center">
                      <svg className="h-2.5 w-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-sm text-green-100">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score Breakdown */}
          <div className="space-y-2.5">
            <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-3">Score Breakdown</div>
            {BREAKDOWN_LABELS.map(([key, label]) => (
              <ScoreBar key={key} label={label} score={report.scoreBreakdown?.[key] ?? 5} />
            ))}
          </div>

          {/* 🥪 FILLING — Areas to Improve */}
          {filling.length > 0 && (
            <div>
              <div className="text-xs text-amber-400 uppercase tracking-wider font-medium mb-2">→ Areas to Improve</div>
              <div className="space-y-2">
                {filling.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 bg-amber-900/10 border border-amber-500/15 rounded-lg px-3 py-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold">!</span>
                    <span className="text-sm text-amber-100">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Objections */}
          {report.objectionsEncountered?.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">
                Objections on This Call ({report.objectionsEncountered.length})
              </div>
              <div className="space-y-2">
                {report.objectionsEncountered.map((item, i) => (
                  <ObjectionCard key={i} item={item} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* 🍞 BOTTOM BREAD — Keep Building On */}
          {bottomBread.length > 0 && (
            <div>
              <div className="text-xs text-green-400 uppercase tracking-wider font-medium mb-2">⭐ Keep Building On</div>
              <div className="space-y-2">
                {bottomBread.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 bg-green-900/10 border border-green-500/15 rounded-lg px-3 py-2">
                    <span className="mt-0.5 text-green-400 text-xs">★</span>
                    <span className="text-sm text-green-100">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Your Next Step */}
          {report.nextStepRecommendation && (
            <div className="rounded-xl bg-blue-600/10 border border-blue-500/20 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider">
                  Your Next Step{leadName ? ` — when you call ${leadName} back, say:` : ""}
                </div>
                <CopyButton text={report.nextStepRecommendation} />
              </div>
              <p className="text-sm text-blue-100">{report.nextStepRecommendation}</p>
            </div>
          )}

          {/* Manager Suggestion */}
          {report.managerSuggestion && (
            <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
              <p className="text-sm text-gray-300">
                <span className="font-semibold text-gray-200">💡 Pro tip:</span> {report.managerSuggestion}
              </p>
            </div>
          )}

          {report.generatedAt && (
            <div className="text-xs text-gray-600 text-right">
              Generated {new Date(report.generatedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
