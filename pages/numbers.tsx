import DashboardLayout from "@/components/DashboardLayout";
import NumberPurchasePanel from "@/components/NumberPurchasePanel";
import React, { useEffect, useState } from "react";

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
}

function NumbersPage() {
  // 🛡️ Always default
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNumbers = async () => {
      try {
        const res = await fetch("/api/getNumbers");
        const data = await res.json();
        // 💥 Defensive default
        setNumbers(data?.numbers ?? []);
      } catch (error) {
        console.error("Error fetching numbers:", error);
        setNumbers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchNumbers();
  }, []);

  return (
    <DashboardLayout>
      <div className="p-4 space-y-6">
        <h1 className="text-2xl font-bold">Manage Numbers</h1>

        <NumberPurchasePanel />

        <h2 className="text-lg font-semibold mt-6">Your Numbers</h2>

        {loading ? (
          <p>Loading numbers...</p>
        ) : !numbers || numbers.length === 0 ? (
          <p>No numbers found. Purchase one above.</p>
        ) : (
          <ul className="space-y-2">
            {(numbers ?? []).map((number) => (
              <li
                key={number.id}
                className="border border-black dark:border-white p-2 rounded"
              >
                <p>{number.phoneNumber}</p>
                <p className="text-xs text-gray-500">SID: {number.sid}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}

export default NumbersPage;
