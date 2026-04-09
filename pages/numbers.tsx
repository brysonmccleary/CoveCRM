import DashboardLayout from "@/components/DashboardLayout";
import NumberPurchasePanel from "@/components/NumberPurchasePanel";
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
  _id?: string;
  friendlyName?: string;
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
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);

  const fetchAll = async () => {
    try {
      const [numRes, spamRes, defRes] = await Promise.all([
        fetch("/api/getNumbers"),
        fetch("/api/numbers/spam-check"),
        fetch("/api/settings/default-number"),
      ]);
      const numData = await numRes.json();
      setNumbers(numData?.numbers ?? []);

      if (spamRes.ok) {
        const spamData = await spamRes.json();
        const map: Record<string, SpamStatus> = {};
        for (const s of spamData.statuses || []) map[s.phoneNumber] = s;
        setSpamStatuses(map);
      }

      if (defRes.ok) {
        const defData = await defRes.json();
        const existingDefault = defData.defaultSmsNumberId || null;
        setDefaultId(existingDefault);

        // Auto-select first number as primary if none is set
        if (!existingDefault) {
          const nums = numData?.numbers ?? [];
          if (nums.length >= 1) {
            const autoId = nums[0]._id || nums[0].sid || nums[0].id;
            // Fire and forget — don't await
            fetch("/api/settings/default-number", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ numberId: autoId }),
            }).then(() => setDefaultId(autoId)).catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error("Error fetching numbers:", error);
      setNumbers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

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

  const setDefault = async (numberId: string | null) => {
    setSavingDefault(true);
    try {
      const res = await fetch("/api/settings/default-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numberId }),
      });
      if (res.ok) {
        setDefaultId(numberId);
        setConfirmedId(numberId);
        setTimeout(() => setConfirmedId(null), 2000);
      } else {
        toast.error("Failed to save primary number");
      }
    } catch {
      toast.error("Failed to save default");
    } finally {
      setSavingDefault(false);
    }
  };

  const handleRelease = async (numberId: string, force = false) => {
    setReleasing(true);
    try {
      const url = `/api/numbers/${numberId}${force ? "?force=true" : ""}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();

      if (res.status === 409 && data.requiresConfirmation) {
        setReleaseConfirm(numberId);
        return;
      }

      if (res.ok) {
        toast.success("Number released");
        setReleaseConfirm(null);
        await fetchAll();
      } else {
        toast.error(data.message || "Failed to release number");
      }
    } catch {
      toast.error("Failed to release number");
    } finally {
      setReleasing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 space-y-6">
        <h1 className="text-2xl font-bold">Manage Numbers</h1>

        {/* Primary SMS Number */}
        {!loading && numbers.length > 0 && (
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5">
            <h2 className="text-base font-semibold text-white mb-1">Primary SMS Number</h2>
            <p className="text-xs text-gray-400 mb-4">
              Choose which number sends outbound SMS by default. If no primary is set, the first available number is used.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 bg-[#1e293b] rounded-lg px-4 py-2.5 cursor-pointer border border-white/10 hover:border-indigo-500 transition">
                <input
                  type="radio"
                  name="primaryNumber"
                  checked={!defaultId}
                  onChange={() => setDefault(null)}
                  className="accent-indigo-500"
                  disabled={savingDefault}
                />
                <span className="text-gray-400 text-sm">Auto (use first available)</span>
              </label>
              {numbers.map((num) => {
                const id = num._id || num.sid || num.id;
                const isPrimary = defaultId === id;
                const justConfirmed = confirmedId === id;
                return (
                  <label
                    key={id}
                    className={`flex items-center gap-3 rounded-lg px-4 py-2.5 cursor-pointer border transition ${
                      isPrimary
                        ? "bg-indigo-900/20 border-indigo-500"
                        : "bg-[#1e293b] border-white/10 hover:border-indigo-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="primaryNumber"
                      checked={isPrimary}
                      onChange={() => setDefault(id)}
                      className="accent-indigo-500"
                      disabled={savingDefault}
                    />
                    <span className="text-white text-sm font-medium flex-1">{num.phoneNumber}</span>
                    {justConfirmed && (
                      <span className="text-xs bg-blue-800 text-blue-300 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                        ✓ Updated
                      </span>
                    )}
                    {isPrimary && !justConfirmed && (
                      <span className="text-xs bg-green-800 text-green-300 px-2 py-0.5 rounded-full font-semibold">
                        ✓ Primary
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

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
                const numId = number._id || number.sid || number.id;
                const isDefault = defaultId === numId;
                return (
                  <li
                    key={number.id}
                    className="bg-[#0f172a] border border-white/10 p-4 rounded-xl flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{number.phoneNumber}</p>
                        {isDefault && (
                          <span className="text-xs bg-green-800 text-green-300 px-2 py-0.5 rounded-full">
                            ✓ Primary SMS
                          </span>
                        )}
                      </div>
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
                          <span className="text-xs text-gray-500">Score: {spam.spamScore}/100</span>
                          <span className="text-xs text-gray-600">
                            Checked {new Date(spam.checkedAt).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {!isDefault && (
                        <button
                          onClick={() => setDefault(numId)}
                          disabled={savingDefault}
                          className="text-xs bg-indigo-900/30 hover:bg-indigo-900/60 border border-indigo-700 text-indigo-300 px-3 py-1.5 rounded-lg disabled:opacity-50"
                        >
                          Set as Primary
                        </button>
                      )}
                      <button
                        onClick={() => checkSpam(number.phoneNumber)}
                        disabled={checkingSpam === number.phoneNumber}
                        className="text-xs bg-[#1e293b] hover:bg-[#2d3f55] border border-white/10 text-gray-300 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        {checkingSpam === number.phoneNumber ? "Checking..." : "Check Spam"}
                      </button>
                      <button
                        onClick={() => handleRelease(number._id || number.sid, false)}
                        disabled={releasing}
                        className="text-xs bg-red-900/30 hover:bg-red-900/50 border border-red-800 text-red-300 px-3 py-1.5 rounded-lg disabled:opacity-50"
                      >
                        Release
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Release confirmation modal */}
      {releaseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setReleaseConfirm(null)} />
          <div className="relative bg-[#0f172a] border border-white/10 rounded-xl p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2">⚠️ Release Number?</h3>
            <p className="text-gray-300 text-sm mb-5">
              This number has active drip campaigns or is your default SMS number. Releasing it will stop messages from sending and remove it from your account. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setReleaseConfirm(null)}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRelease(releaseConfirm, true)}
                disabled={releasing}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {releasing ? "Releasing..." : "Yes, Release Number"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default NumbersPage;
