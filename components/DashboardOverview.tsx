import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import toast from "react-hot-toast";
import { FaPhoneAlt } from "react-icons/fa";

interface StatEntry {
  date: string;
  dials: number;
  talks: number;
}

type ObjRange = "today" | "7days" | "30days";

interface TopObjection {
  objection: string;
  count: number;
  suggestedResponse: string | null;
}

function TopObjectionsWidget() {
  const [range, setRange] = useState<ObjRange>("7days");
  const [objections, setObjections] = useState<TopObjection[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/calls/top-objections?range=${range}`);
        const data = await res.json();
        if (!cancelled) setObjections(data.objections || []);
      } catch {
        if (!cancelled) setObjections([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [range]);

  const RANGE_LABELS: { value: ObjRange; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "7days", label: "7 Days" },
    { value: "30days", label: "30 Days" },
  ];

  const RANK_STYLES = [
    "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    "bg-gray-400/20 text-gray-300 border-gray-400/30",
    "bg-amber-700/20 text-amber-400 border-amber-700/30",
  ];

  return (
    <div className="bg-[#1F2937] text-white p-6 rounded-lg shadow">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span>🚧</span> Top Objections
        </h2>
        <div className="flex gap-1">
          {RANGE_LABELS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                range === value
                  ? "bg-indigo-600 text-white"
                  : "bg-white/10 text-gray-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : objections.length === 0 ? (
        <p className="text-gray-500 text-sm">
          No objection data yet. Generate call overviews to track objections.
        </p>
      ) : (
        <div className="space-y-3">
          {objections.map((obj, idx) => (
            <div key={idx} className={`border rounded-xl p-4 ${RANK_STYLES[idx] || "bg-white/5 border-white/10 text-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-lg font-bold w-7 shrink-0 ${idx === 0 ? "text-yellow-300" : idx === 1 ? "text-gray-300" : "text-amber-400"}`}>
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-white font-medium text-sm truncate">{obj.objection}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{obj.count} time{obj.count !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                {obj.suggestedResponse && (
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                    className="text-xs text-blue-400 hover:text-blue-300 shrink-0 border border-blue-500/20 px-2 py-1 rounded"
                  >
                    {expanded[idx] ? "Hide" : "View Response"}
                  </button>
                )}
              </div>
              {expanded[idx] && obj.suggestedResponse && (
                <div className="mt-3 bg-blue-900/20 border border-blue-500/20 rounded-lg px-3 py-2">
                  <p className="text-xs text-blue-300 font-semibold mb-1">Suggested Response</p>
                  <p className="text-sm text-blue-100">{obj.suggestedResponse}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardOverview() {
  const [data, setData] = useState<StatEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/dashboard/stats");
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to load stats");

        const raw: { date: string; dials: number; talks: number }[] = result.data;

        // Get last 10 days
        const today = new Date();
        const last10 = [...Array(10)].map((_, i) => {
          const d = new Date(today);
          d.setDate(d.getDate() - (9 - i));
          const key = d.toISOString().split("T")[0];
          return {
            key,
            label: d.toLocaleDateString("default", { month: "short", day: "numeric" }),
          };
        });

        // Fill in zeros for missing days
        const mapped = last10.map(({ key, label }) => {
          const found = raw.find((r) => r.date.startsWith(key));
          return {
            date: label,
            dials: found?.dials || 0,
            talks: found?.talks || 0,
          };
        });

        setData(mapped);
      } catch (err: any) {
        toast.error(err.message || "Error fetching dashboard data.");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const lastEntry = data[data.length - 1];
  const dailyCalls = lastEntry?.dials || 0;
  const dailyTalks = lastEntry?.talks || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Top Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-[#1F2937] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center">
          <div className="text-sm uppercase text-gray-400">Daily Calls</div>
          <div className="text-2xl font-bold">{dailyCalls}</div>
        </div>
        <div className="bg-[#1F2937] text-white rounded-lg p-4 shadow flex flex-col items-center justify-center">
          <div className="text-sm uppercase text-gray-400">Daily Talks</div>
          <div className="text-2xl font-bold">{dailyTalks}</div>
        </div>
      </div>

      {/* Top Objections */}
      <TopObjectionsWidget />

      {/* Chart Section */}
      <div className="bg-[#1F2937] text-white p-6 rounded-lg shadow">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <FaPhoneAlt className="text-pink-400" />
          Call Performance (Last 10 Days)
        </h2>

        <div className="h-80">
          {loading ? (
            <p className="text-gray-400">Loading chart...</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  {/* NO grid lines */}
                  <XAxis dataKey="date" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" domain={[0, "auto"]} />
                  <Tooltip
                    formatter={(value) => `${Number(value ?? 0)} calls`}
                    labelStyle={{ color: "#fff" }}
                    contentStyle={{ backgroundColor: "#111827", borderColor: "#4B5563" }}
                  />
                  <Line type="monotone" dataKey="dials" stroke="#60A5FA" strokeWidth={2} name="Total Dials" />
                  <Line type="monotone" dataKey="talks" stroke="#34D399" strokeWidth={2} name="Talks Connected" />
                </LineChart>
              </ResponsiveContainer>

              {/* Legend BELOW the chart */}
              <div className="flex justify-center gap-6 mt-4 text-sm">
                <div className="flex items-center gap-2 text-green-400">
                  <span className="inline-block w-3 h-1 bg-green-400" />
                  Talks Connected
                </div>
                <div className="flex items-center gap-2 text-blue-400">
                  <span className="inline-block w-3 h-1 bg-blue-400" />
                  Total Dials
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
