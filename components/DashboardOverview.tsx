import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const data = [
  { date: "Jun 21", dials: 50, talks: 30 },
  { date: "Jun 22", dials: 60, talks: 35 },
  { date: "Jun 23", dials: 55, talks: 25 },
  { date: "Jun 24", dials: 70, talks: 40 },
  { date: "Jun 25", dials: 65, talks: 38 },
  { date: "Jun 26", dials: 80, talks: 45 },
  { date: "Jun 27", dials: 90, talks: 50 },
  { date: "Jun 28", dials: 85, talks: 48 },
  { date: "Jun 29", dials: 95, talks: 52 },
  { date: "Jun 30", dials: 100, talks: 55 },
];

export default function DashboardOverview() {
  const dailyCalls = data[data.length - 1].dials;
  const dailyTalks = data[data.length - 1].talks;
  const dailySales = Math.floor(dailyTalks * 0.2);

  return (
    <div className="w-full space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-black dark:border-white rounded p-4">
          <h2 className="text-lg font-semibold">Daily Calls</h2>
          <p className="text-2xl font-bold">{dailyCalls}</p>
        </div>
        <div className="border border-black dark:border-white rounded p-4">
          <h2 className="text-lg font-semibold">Daily Talks</h2>
          <p className="text-2xl font-bold">{dailyTalks}</p>
        </div>
        <div className="border border-black dark:border-white rounded p-4">
          <h2 className="text-lg font-semibold">Daily Sales</h2>
          <p className="text-2xl font-bold">{dailySales}</p>
        </div>
      </div>

      <div className="w-full h-80 border border-black dark:border-white rounded">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="date" stroke="currentColor" />
            <YAxis stroke="currentColor" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="dials" stroke="#1e3a8a" />
            <Line type="monotone" dataKey="talks" stroke="#f97316" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

