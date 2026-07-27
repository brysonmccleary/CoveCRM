import { useState } from "react";
import toast from "react-hot-toast";

interface AvailableNumber {
  phoneNumber: string;
  city: string;
  state: string;
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
      return data?.message || data?.error || "Failed to purchase number";
  }
};

export default function NumberPurchasePanel({ onPurchased }: { onPurchased?: () => void | Promise<void> }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!searchTerm.trim()) return;
    setLoading(true);
    setSelectedNumber(null);
    try {
      const res = await fetch(`/api/twilio/available-numbers?query=${encodeURIComponent(searchTerm.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not find available numbers");
      setNumbers(data.numbers || []);
      if (!(data.numbers || []).length) toast("No matching numbers are available right now.");
    } catch (error: any) {
      toast.error(error.message || "Could not search for numbers");
      setNumbers([]);
    } finally {
      setLoading(false);
    }
  };

  const purchase = async () => {
    if (!selectedNumber) return;
    const number = selectedNumber;
    setLoading(true);
    try {
      const res = await fetch("/api/twilio/buy-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: number.phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(purchaseBlockMessage(data));

      toast.success(`Number purchased: ${data.phoneNumber || number.phoneNumber}`);
      setNumbers([]);
      setSelectedNumber(null);
      setSearchTerm("");
      await onPurchased?.();
    } catch (error: any) {
      toast.error(error.message || "An error occurred while purchasing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-black dark:border-white p-4 rounded space-y-3 mt-4">
      <h2 className="text-xl font-bold">Purchase Phone Number</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">Enter an area code, state abbreviation, or state name.</p>
      <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Area code, state, or abbreviation (e.g., 415, CA, California)" className="border p-2 rounded w-full" />
      <button onClick={search} disabled={loading || !searchTerm.trim()} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-60">
        {loading ? "Searching..." : "Search Available Numbers"}
      </button>

      {numbers.length > 0 && (
        <ul className="space-y-2 pt-2">
          {numbers.map((number) => (
            <li key={number.phoneNumber} className="flex items-center justify-between gap-3 border border-black/10 dark:border-white/10 rounded p-3">
              <div><p className="font-medium">{number.phoneNumber}</p><p className="text-sm text-gray-500 dark:text-gray-400">{number.city}, {number.state}</p></div>
              {selectedNumber?.phoneNumber === number.phoneNumber ? (
                <button onClick={purchase} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded disabled:opacity-60">{loading ? "Purchasing..." : "Confirm $1.15/mo"}</button>
              ) : (
                <button onClick={() => setSelectedNumber(number)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded disabled:opacity-60">Buy</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
