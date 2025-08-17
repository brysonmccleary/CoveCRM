// components/Admin/AffiliateCodeStats.tsx
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

export default function AffiliateCodeStats() {
  const [stats, setStats] = useState<{ code: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/admin/affiliate-stats");
        const json = await res.json();
        setStats(json.data || []);
      } catch (err) {
        toast.error("Failed to load affiliate stats");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Affiliate Code Usage</h2>

      {loading ? (
        <p>Loading...</p>
      ) : stats.length === 0 ? (
        <p>No active affiliates yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-auto border-collapse border border-gray-300">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-2 text-left border">Affiliate Code</th>
                <th className="px-4 py-2 text-left border">Active Users</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(({ code, count }) => (
                <tr key={code}>
                  <td className="px-4 py-2 border">{code}</td>
                  <td className="px-4 py-2 border">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
