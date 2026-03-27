// components/CallCoachReport.tsx
// Rich dark-theme AI Call Coach Report component
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
};

type Report = {
  _id?: string;
  callScore: number;
  scoreBreakdown: ScoreBreakdown;
  whatWentWell: string[];
  whatToImprove: string[];
  objectionsEncountered: ObjectionItem[];
  nextStepRecommendation: string;
  callSummary: string;
  leadName?: string;
  durationSeconds?: number;
  generatedAt?: string;
};

function scoreColor(score: number) {
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
        <div
          className={`h-full rounded-full transition-all ${scoreBg(score)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`text-sm font-bold w-6 text-right ${scoreColor(score)}`}>{score}</div>
    </div>
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
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">#{index + 1}</span>
          <span className="text-sm text-white font-medium">{item.objection}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              item.wasOvercome
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {item.wasOvercome ? "Overcome" : "Not Overcome"}
          </span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 py-3 space-y-3 bg-[#0b1220]">
          <div>
            <p className="text-xs text-gray-400 mb-1">How It Was Handled</p>
            <p className="text-sm text-gray-200">{item.howHandled}</p>
          </div>
          <div className="border-l-2 border-blue-500/60 pl-3">
            <p className="text-xs text-blue-400 mb-1 font-semibold">Better Response</p>
            <p className="text-sm text-gray-200">{item.betterResponse}</p>
          </div>
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
      const r = await fetch(`/api/calls/coach-report?callId=${encodeURIComponent(callId)}`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (j.report) setReport(j.report);
    } catch {
      // silent — will show generate button
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  // Auto-load on first render
  if (!loaded && !loading) {
    load();
  }

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
      if (j.report) {
        setReport(j.report);
      } else {
        setError(j.error || "Failed to generate report.");
      }
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

  return (
    <div className="mt-4 bg-[#0b1220] border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.5 3.5 0 01-4.95 0l-.347-.347z" />
            </svg>
          </div>
          <span className="text-white font-semibold">AI Call Coach</span>
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

      {/* Loading state */}
      {(loading || generating) && (
        <div className="px-5 py-8 text-center text-gray-400 text-sm">
          {generating ? "Generating your coaching report…" : "Loading…"}
        </div>
      )}

      {/* Error */}
      {error && !generating && (
        <div className="px-5 py-4 text-red-400 text-sm">{error}</div>
      )}

      {/* No report yet */}
      {loaded && !report && !loading && !generating && !error && (
        <div className="px-5 py-6 text-center text-gray-400 text-sm">
          No coaching report yet.{" "}
          <button onClick={generate} className="text-blue-400 hover:underline">
            Generate one now
          </button>{" "}
          to get AI feedback on this call.
        </div>
      )}

      {/* Report */}
      {report && !loading && !generating && (
        <div className="p-5 space-y-6">
          {/* Overall score */}
          <div className="flex items-center gap-5">
            <div className="relative flex items-center justify-center h-20 w-20 shrink-0">
              <svg className="absolute inset-0 h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                <circle
                  cx="40"
                  cy="40"
                  r="34"
                  fill="none"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className={
                    report.callScore >= 8
                      ? "stroke-green-500"
                      : report.callScore >= 5
                      ? "stroke-yellow-500"
                      : "stroke-red-500"
                  }
                  strokeDasharray={`${(report.callScore / 10) * 213.6} 213.6`}
                />
              </svg>
              <span className={`text-2xl font-bold ${scoreColor(report.callScore)}`}>
                {report.callScore}
              </span>
            </div>
            <div>
              <div className="text-white font-semibold text-lg">
                {report.callScore >= 8
                  ? "Strong Call"
                  : report.callScore >= 5
                  ? "Decent Call"
                  : "Needs Work"}
              </div>
              <div className="text-gray-400 text-sm mt-0.5">Overall Score · {report.callSummary}</div>
            </div>
          </div>

          {/* Score breakdown bars */}
          <div className="space-y-2.5">
            <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-3">Score Breakdown</div>
            {BREAKDOWN_LABELS.map(([key, label]) => (
              <ScoreBar key={key} label={label} score={report.scoreBreakdown?.[key] ?? 5} />
            ))}
          </div>

          {/* What Went Well */}
          {report.whatWentWell?.length > 0 && (
            <div>
              <div className="text-xs text-green-400 uppercase tracking-wider font-medium mb-2">What Went Well</div>
              <div className="space-y-1.5">
                {report.whatWentWell.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-green-500/20 flex items-center justify-center">
                      <svg className="h-2.5 w-2.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-sm text-gray-200">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What To Improve */}
          {report.whatToImprove?.length > 0 && (
            <div>
              <div className="text-xs text-yellow-400 uppercase tracking-wider font-medium mb-2">What To Improve</div>
              <div className="space-y-1.5">
                {report.whatToImprove.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-yellow-500/20 flex items-center justify-center">
                      <svg className="h-2.5 w-2.5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
                      </svg>
                    </span>
                    <span className="text-sm text-gray-200">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Objections Encountered */}
          {report.objectionsEncountered?.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-2">
                Objections Encountered ({report.objectionsEncountered.length})
              </div>
              <div className="space-y-2">
                {report.objectionsEncountered.map((item, i) => (
                  <ObjectionCard key={i} item={item} index={i} />
                ))}
              </div>
            </div>
          )}

          {/* Next Step Recommendation */}
          {report.nextStepRecommendation && (
            <div className="rounded-xl bg-blue-600/10 border border-blue-500/20 px-4 py-3">
              <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-1">Next Step</div>
              <p className="text-sm text-blue-100">{report.nextStepRecommendation}</p>
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
