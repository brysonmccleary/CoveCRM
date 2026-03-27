// components/CallCoachTrends.tsx
// Mini dashboard widget showing call coaching trends
import { useEffect, useState } from "react";
import Link from "next/link";

type TrendsData = {
  totalCoached: number;
  averages: {
    overall: number;
    opening: number;
    rapport: number;
    discovery: number;
    presentation: number;
    objectionHandling: number;
    closing: number;
  } | null;
  topObjection: string | null;
  scoreTrend: { score: number; date: string }[];
};

function scoreColor(score: number) {
  if (score >= 8) return "text-green-400";
  if (score >= 5) return "text-yellow-400";
  return "text-red-400";
}

function TrendArrow({ trend }: { trend: number[] }) {
  if (trend.length < 2) return null;
  const first = trend[0];
  const last = trend[trend.length - 1];
  const diff = last - first;
  if (diff > 0.4)
    return (
      <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    );
  if (diff < -0.4)
    return (
      <svg className="h-4 w-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    );
  return (
    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
    </svg>
  );
}

export default function CallCoachTrends() {
  const [data, setData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/calls/coach-trends", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setData(j);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data || data.totalCoached === 0) return null;

  const avg = data.averages?.overall ?? 0;
  const trend = data.scoreTrend.map((p) => p.score);

  return (
    <div className="bg-[#0f172a] rounded-xl p-5 mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <span className="h-6 w-6 rounded-md bg-blue-600/30 flex items-center justify-center">
            <svg className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.5 3.5 0 01-4.95 0l-.347-.347z" />
            </svg>
          </span>
          AI Call Coach
        </h3>
        <Link href="/calls" className="text-xs text-blue-400 hover:text-blue-300 transition">
          View All Calls →
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Avg Score */}
        <div className="text-center">
          <div className={`text-2xl font-bold ${scoreColor(avg)}`}>{avg}</div>
          <div className="text-xs text-gray-400 mt-0.5">Avg Score</div>
        </div>

        {/* Trend */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1">
            <TrendArrow trend={trend} />
            <span className="text-sm font-semibold text-gray-200">
              {trend.length >= 2
                ? `${trend[trend.length - 1] > trend[0] ? "+" : ""}${(trend[trend.length - 1] - trend[0]).toFixed(1)}`
                : "—"}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">Trend</div>
        </div>

        {/* Total Coached */}
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{data.totalCoached}</div>
          <div className="text-xs text-gray-400 mt-0.5">Calls Coached</div>
        </div>
      </div>

      {/* Top Objection */}
      {data.topObjection && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="text-xs text-gray-400">
            Top Objection:{" "}
            <span className="text-yellow-300 capitalize">{data.topObjection}</span>
          </div>
        </div>
      )}
    </div>
  );
}
