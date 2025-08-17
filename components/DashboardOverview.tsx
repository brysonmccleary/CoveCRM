import React, { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import toast from "react-hot-toast";
import { FaPhoneAlt } from "react-icons/fa";

interface StatEntry {
  date: string;
  dials: number;
  talks: number;
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
                    formatter={(value: number) => `${value} calls`}
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
