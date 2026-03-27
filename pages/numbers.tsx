import DashboardLayout from "@/components/DashboardLayout";
import NumberPurchasePanel from "@/components/NumberPurchasePanel";
import React, { useEffect, useState } from "react";

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
}

interface SpamStatus {
  phoneNumber: string;
  spamScore: number;
  spamLabel: string;
  isSpam: boolean;
  checkedAt: string;
}

function NumbersPage() {
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [spamStatuses, setSpamStatuses] = useState<Record<string, SpamStatus>>({});
  const [checkingSpam, setCheckingSpam] = useState<string | null>(null);

  useEffect(() => {
    const fetchNumbers = async () => {
      try {
        const [numRes, spamRes] = await Promise.all([
          fetch("/api/getNumbers"),
          fetch("/api/numbers/spam-check"),
        ]);
        const numData = await numRes.json();
        setNumbers(numData?.numbers ?? []);

        if (spamRes.ok) {
          const spamData = await spamRes.json();
          const map: Record<string, SpamStatus> = {};
          for (const s of spamData.statuses || []) {
            map[s.phoneNumber] = s;
          }
          setSpamStatuses(map);
        }
      } catch (error) {
        console.error("Error fetching numbers:", error);
        setNumbers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchNumbers();
  }, []);

  const checkSpam = async (phoneNumber: string) => {
    setCheckingSpam(phoneNumber);
    try {
      const res = await fetch("/api/numbers/spam-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      if (res.ok) {
        const data = await res.json();
        setSpamStatuses((prev) => ({ ...prev, [phoneNumber]: data.status }));
      }
    } catch {
      console.error("Spam check failed");
    } finally {
      setCheckingSpam(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-6">
        <h1 className="text-2xl font-bold">Manage Numbers</h1>

        <NumberPurchasePanel />

        <div>
          <h2 className="text-lg font-semibold mt-6 mb-3">Your Numbers</h2>

          {loading ? (
            <p>Loading numbers...</p>
          ) : !numbers || numbers.length === 0 ? (
            <p>No numbers found. Purchase one above.</p>
          ) : (
            <ul className="space-y-3">
              {(numbers ?? []).map((number) => {
                const spam = spamStatuses[number.phoneNumber];
                return (
                  <li
                    key={number.id}
                    className="bg-[#0f172a] border border-white/10 p-4 rounded-xl flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-white font-semibold">{number.phoneNumber}</p>
                      <p className="text-xs text-gray-500">SID: {number.sid}</p>
                      {spam && (
                        <div className="mt-1 flex items-center gap-2">
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                              spam.isSpam
                                ? "bg-red-900 text-red-300"
                                : spam.spamScore >= 40
                                ? "bg-yellow-900 text-yellow-300"
                                : "bg-green-900 text-green-300"
                            }`}
                          >
                            {spam.isSpam ? "⚠️ " : "✓ "}{spam.spamLabel || (spam.isSpam ? "Spam Risk" : "Clean")}
                          </span>
                          <span className="text-xs text-gray-500">
                            Score: {spam.spamScore}/100
                          </span>
                          <span className="text-xs text-gray-600">
                            Checked {new Date(spam.checkedAt).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => checkSpam(number.phoneNumber)}
                      disabled={checkingSpam === number.phoneNumber}
                      className="text-xs bg-[#1e293b] hover:bg-[#2d3f55] border border-white/10 text-gray-300 px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {checkingSpam === number.phoneNumber ? "Checking..." : "Check Spam"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

export default NumbersPage;
