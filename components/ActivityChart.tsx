import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const sampleData = [
  { date: "Day 1", dials: 20 },
  { date: "Day 2", dials: 35 },
  { date: "Day 3", dials: 28 },
  { date: "Day 4", dials: 45 },
  { date: "Day 5", dials: 32 },
  { date: "Day 6", dials: 40 },
  { date: "Day 7", dials: 30 },
  { date: "Day 8", dials: 50 },
  { date: "Day 9", dials: 60 },
  { date: "Day 10", dials: 55 },
];

export default function ActivityChart() {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow mt-8">
      <h3 className="text-lg font-bold mb-4">Dial Activity - Last 10 Days</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={sampleData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="dials" stroke="#2563eb" strokeWidth={3} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

