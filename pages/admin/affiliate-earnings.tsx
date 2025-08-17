import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

interface AffiliateRow {
  name: string;
  history: { [month: string]: number };
}

export default function AdminAffiliateEarnings() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [rows, setRows] = useState<AffiliateRow[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/admin/affiliate-earnings");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch");

        setRows(data.rows);
        setMonths(data.months);
      } catch (err: any) {
        toast.error(err.message || "Could not load earnings data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-[#1e293b] text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Affiliate Earnings (Admin View)</h1>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <div className="overflow-auto border border-gray-700 rounded-md">
          <table className="min-w-full text-sm">
            <thead className="bg-[#334155]">
              <tr>
                <th className="p-3 text-left border-r border-gray-600">Affiliate</th>
                {months.map((month) => (
                  <th key={month} className="p-3 text-left border-r border-gray-600">
                    {new Date(month + "-01").toLocaleString("default", {
                      month: "short",
                      year: "numeric",
                    })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-gray-700">
                  <td className="p-3 border-r border-gray-700 font-semibold">{row.name}</td>
                  {months.map((month) => (
                    <td key={month} className="p-3 border-r border-gray-700">
                      {row.history[month] ? `$${row.history[month].toFixed(2)}` : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
