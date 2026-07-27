// components/BuyNumberPanel.tsx
import { useState, useEffect } from "react";
import axios from "axios";
import { getNumberState } from "@/lib/twilio/localPresence";

function formatPhoneNumber(number: string) {
  const cleaned = number.replace(/[^0-9]/g, "");
  if (cleaned.length === 11) {
    return `${cleaned[0]}-${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  } else {
    return number;
  }
}

interface TwilioNumber {
  sid: string;
  phoneNumber: string;
  _id?: string;
  id?: string;
  subscriptionStatus: string;
  nextBillingDate: string | null;
  usage: {
    callsMade: number;
    callsReceived: number;
    textsSent: number;
    textsReceived: number;
    cost: number;
  };
}

interface AvailableNumber {
  phoneNumber: string;
  city: string;
  state: string;
}

type CallHealthLabel = "Healthy" | "Watch" | "Spam Risk" | "Unknown";

interface CallHealth {
  phoneNumber: string;
  label: CallHealthLabel;
  score: number;
  lastCheckedAt: string | null;
  providerSpamSignal: boolean;
  answerRate: number | null;
  shortCallRate: number | null;
  outboundVolume7d: number;
  inboundVolume7d: number;
  flags: string[];
  recommendations: string[];
}

export default function BuyNumberPanel() {
  const [search, setSearch] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [ownedNumbers, setOwnedNumbers] = useState<TwilioNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [numberToDelete, setNumberToDelete] = useState<TwilioNumber | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [callHealth, setCallHealth] = useState<Record<string, CallHealth>>({});
  const [openHealthNumber, setOpenHealthNumber] = useState<string | null>(null);

  const fetchOwnedNumbers = async () => {
    try {
      const res = await axios.get("/api/getNumbers");
      setOwnedNumbers(res.data.numbers);
    } catch (err) {
      console.error("Error fetching owned numbers", err);
    }
  };

  const fetchDefaultNumber = async () => {
    try {
      const res = await axios.get("/api/settings/default-number");
      setDefaultId(res.data?.defaultSmsNumberId || null);
    } catch (err) {
      console.error("Error fetching default number", err);
    }
  };

  const fetchCallHealth = async () => {
    try {
      const res = await axios.get("/api/numbers/call-health");
      const map: Record<string, CallHealth> = {};
      for (const item of res.data?.health || []) {
        if (item?.phoneNumber) map[item.phoneNumber] = item;
      }
      setCallHealth(map);
    } catch (err) {
      console.error("Error fetching call health", err);
    }
  };

  useEffect(() => {
    fetchOwnedNumbers();
    fetchDefaultNumber();
    fetchCallHealth();
  }, []);

  const fetchAvailableNumbers = async () => {
    if (!search.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await axios.get(`/api/twilio/available-numbers?query=${encodeURIComponent(search.trim())}`);
      setAvailableNumbers(res.data.numbers);
    } catch (err) {
      console.error("Error fetching available numbers", err);
      setError("Failed to fetch available numbers");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectNumber = (num: AvailableNumber) => {
    setSelectedNumber((current) => current?.phoneNumber === num.phoneNumber ? null : num);
  };

  const handleSelectDelete = (num: TwilioNumber) => {
    setNumberToDelete(num);
    setDeleteConfirming(true);
  };

  const handleBuyNumber = async () => {
    if (!selectedNumber) return;

    // Clear the selected result immediately so it cannot be double-purchased.
    const numberToBuy = selectedNumber;
    setSelectedNumber(null);

    setLoading(true);
    setError("");
    try {
      await axios.post("/api/twilio/buy-number", { number: numberToBuy.phoneNumber });
      await fetchOwnedNumbers();
      await fetchDefaultNumber();
      await fetchCallHealth();
      // Return the user to their owned numbers instead of leaving a stale search list open.
      setAvailableNumbers([]);
      setSearch("");
    } catch (err: any) {
      console.error("Error purchasing number", err);
      setError(purchaseBlockMessage(err?.response?.data));
      // Optional: you could reopen the modal here if you wanted, but it's safer to leave it closed.
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNumber = async () => {
    if (!numberToDelete) return;
    try {
      await axios.delete("/api/twilio/release-number", {
        data: { phoneNumber: numberToDelete.phoneNumber },
      });
      await fetchOwnedNumbers();
      await fetchDefaultNumber();
      await fetchCallHealth();
      alert(`Deleted ${numberToDelete.phoneNumber}`);
      setDeleteConfirming(false);
      setNumberToDelete(null);
    } catch (err) {
      console.error("Error deleting number", err);
      alert("Failed to delete number");
    }
  };

  const handleSetPrimary = async (numberId: string) => {
    try {
      await axios.post("/api/settings/default-number", { numberId });
      setDefaultId(numberId);
    } catch (err) {
      console.error("Error setting default number", err);
      alert("Failed to set primary number");
    }
  };

  const getHealthStyles = (label?: CallHealthLabel) => {
    if (label === "Healthy") {
      return "bg-green-900/30 border border-green-800 text-green-300";
    }
    if (label === "Watch") {
      return "bg-yellow-900/30 border border-yellow-800 text-yellow-300";
    }
    if (label === "Spam Risk") {
      return "bg-red-900/30 border border-red-800 text-red-300";
    }
    return "bg-[#1e293b] border border-white/10 text-gray-300";
  };

  return (
    <div className="p-4 border border-black dark:border-white rounded space-y-4 relative">
      <h2 className="text-xl font-bold">Buy a New Phone Number</h2>
      <p className="text-sm text-gray-400">Enter an area code, state abbreviation, or state name. Calling is ready as soon as you purchase a number.</p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Area code, state, or abbreviation (e.g., 415, CA, California)"
        className="border border-black dark:border-white p-2 rounded w-full"
      />
      <button
        onClick={fetchAvailableNumbers}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        disabled={loading || !search.trim()}
      >
        {loading ? "Loading..." : "Search Available Numbers"}
      </button>

      {error && <p className="text-red-600">Error: {error}</p>}

      <h3 className="text-lg font-semibold mt-4">Available Numbers</h3>
      {!loading && availableNumbers.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/10 bg-[#0f172a]/40 px-4 py-5 text-sm text-gray-400">
          Choose a state or enter a three-digit area code to search for numbers available to purchase.
        </div>
      )}
      <ul className="space-y-2">
        {availableNumbers.map((num) => (
          <li key={num.phoneNumber} className="flex justify-between items-center border p-2 rounded">
            <div>
              <p className="font-medium">{formatPhoneNumber(num.phoneNumber)}</p>
              <p className="text-sm text-gray-400">
                {num.city}, {num.state}
              </p>
            </div>
            {selectedNumber?.phoneNumber === num.phoneNumber ? (
              <button
                onClick={handleBuyNumber}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded cursor-pointer disabled:opacity-60"
                disabled={loading}
              >
                {loading ? "Purchasing..." : "Confirm $1.15/mo"}
              </button>
            ) : (
              <button
                onClick={() => handleSelectNumber(num)}
                className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded cursor-pointer"
              >
                Buy
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="text-lg font-semibold mt-6">Your Numbers</h3>
      <ul className="space-y-2">
        {ownedNumbers.map((num) => (
          <li key={num.sid} className="border p-3 rounded">
            {(() => {
              const numId = String(num._id || num.sid || num.id || "");
              const isPrimary = defaultId === numId;
              const health = callHealth[num.phoneNumber];
              const healthLabel = health?.label || "Unknown";
              const healthOpen = openHealthNumber === num.phoneNumber;
              return (
                <>
            <div className="flex justify-between items-center">
              <span className="font-medium">{formatPhoneNumber(num.phoneNumber)}{getNumberState(num.phoneNumber) ? ` · ${getNumberState(num.phoneNumber)}` : ""}</span>
              <div className="flex items-center gap-2 relative">
                {isPrimary ? (
                  <span className="bg-green-900/30 border border-green-800 text-green-300 px-2 py-1 rounded cursor-default text-sm">
                    Primary
                  </span>
                ) : (
                  <button
                    onClick={() => handleSetPrimary(numId)}
                    className="bg-[#1e293b] hover:bg-[#2d3f55] border border-white/10 text-gray-300 px-2 py-1 rounded cursor-pointer text-sm"
                  >
                    Set Primary
                  </button>
                )}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenHealthNumber(healthOpen ? null : num.phoneNumber)}
                    onMouseEnter={() => setOpenHealthNumber(num.phoneNumber)}
                    className={`px-2 py-1 rounded cursor-pointer text-sm ${getHealthStyles(healthLabel)}`}
                    title="Call health is informational only and does not change calling behavior."
                  >
                    {healthLabel} ▾
                  </button>
                  {healthOpen && (
                    <div
                      onMouseLeave={() => setOpenHealthNumber(null)}
                      className="absolute right-0 top-full mt-2 z-20 w-72 rounded-lg border border-white/10 bg-[#0f172a] p-3 text-xs text-gray-300 shadow-xl"
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-semibold text-white">Call Health</span>
                        <span className={`px-2 py-0.5 rounded-full ${getHealthStyles(healthLabel)}`}>
                          {healthLabel}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <p>Score: {health?.score ?? 0}/100</p>
                        <p>
                          Provider signal:{" "}
                          {health?.providerSpamSignal ? "Possible spam risk detected" : "No provider spam signal"}
                        </p>
                        <p>Outbound 7d: {health?.outboundVolume7d ?? 0}</p>
                        <p>Inbound 7d: {health?.inboundVolume7d ?? 0}</p>
                        <p>
                          Answer rate:{" "}
                          {typeof health?.answerRate === "number" ? `${health.answerRate}%` : "Not enough data"}
                        </p>
                        <p>
                          Short-call rate:{" "}
                          {typeof health?.shortCallRate === "number" ? `${health.shortCallRate}%` : "Not enough data"}
                        </p>
                        <p>
                          Last checked:{" "}
                          {health?.lastCheckedAt ? new Date(health.lastCheckedAt).toLocaleDateString() : "No provider check cached"}
                        </p>
                      </div>
                      {!!health?.flags?.length && (
                        <div className="mt-2">
                          <p className="font-semibold text-gray-200">Signals</p>
                          <ul className="list-disc pl-4 space-y-0.5">
                            {health.flags.slice(0, 3).map((flag) => (
                              <li key={flag}>{flag}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!!health?.recommendations?.length && (
                        <div className="mt-2">
                          <p className="font-semibold text-gray-200">Recommendation</p>
                          <p>{health.recommendations[0]}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <details className="relative">
                  <summary className="cursor-pointer list-none rounded border border-white/10 bg-[#1e293b] px-2 py-1 text-sm text-gray-300 hover:bg-[#2d3f55]">
                    Actions
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 w-40 rounded-lg border border-white/10 bg-[#0f172a] p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => handleSelectDelete(num)}
                      className="w-full rounded px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10"
                    >
                      Release number
                    </button>
                  </div>
                </details>
              </div>
            </div>
            <div className="text-sm text-gray-600 mt-1">
              <p>
                Status:{" "}
                <span className="capitalize" title={num.subscriptionStatus === "unknown" ? "Billing status is not currently available." : undefined}>
                  {num.subscriptionStatus === "unknown" ? "Status unavailable" : num.subscriptionStatus}
                </span>
              </p>
              {num.nextBillingDate && (
                <p>Next Billing: {new Date(num.nextBillingDate).toLocaleDateString()}</p>
              )}
              <p>
                Calls: {num.usage.callsMade} made / {num.usage.callsReceived} received
              </p>
              <p>
                Texts: {num.usage.textsSent} sent / {num.usage.textsReceived} received
              </p>
            </div>
                </>
              );
            })()}
          </li>
        ))}
      </ul>

      {/* Confirm Delete Modal */}
      {deleteConfirming && numberToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white text-black p-6 rounded shadow-lg space-y-4 max-w-sm w-full">
            <h2 className="text-lg font-bold">Confirm Delete</h2>
            <p>Are you sure you want to delete:</p>
            <p className="font-medium">{formatPhoneNumber(numberToDelete.phoneNumber)}</p>
            <div className="flex space-x-4 mt-4">
              <button
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded cursor-pointer"
                onClick={handleDeleteNumber}
              >
                Confirm Delete
              </button>
              <button
                className="bg-gray-400 hover:bg-gray-500 text-black px-4 py-2 rounded cursor-pointer"
                onClick={() => setDeleteConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const purchaseBlockMessage = (data: any) => {
  switch (data?.reason) {
    case "no_card_on_file":
      return "Add a payment method before purchasing a number.";
    case "no_stripe_customer":
      return "Finish billing setup before purchasing a number.";
    case "no_active_subscription":
      return "Activate or restore your CoveCRM subscription before purchasing a number.";
    default:
      return data?.message || data?.error || "Error purchasing number";
  }
};
