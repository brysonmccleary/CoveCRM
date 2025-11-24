// components/BuyNumberPanel.tsx
import { useState, useEffect } from "react";
import axios from "axios";

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

export default function BuyNumberPanel() {
  const [areaCode, setAreaCode] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [ownedNumbers, setOwnedNumbers] = useState<TwilioNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [numberToDelete, setNumberToDelete] = useState<TwilioNumber | null>(null);

  const fetchOwnedNumbers = async () => {
    try {
      const res = await axios.get("/api/getNumbers");
      setOwnedNumbers(res.data.numbers);
    } catch (err) {
      console.error("Error fetching owned numbers", err);
    }
  };

  useEffect(() => {
    fetchOwnedNumbers();
  }, []);

  const fetchAvailableNumbers = async () => {
    if (!areaCode) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/twilio/available-numbers?areaCode=${areaCode}`);
      setAvailableNumbers(res.data.numbers);
    } catch (err) {
      console.error("Error fetching available numbers", err);
      setError("Failed to fetch available numbers");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectNumber = (num: AvailableNumber) => {
    setSelectedNumber(num);
    setConfirming(true);
  };

  const handleSelectDelete = (num: TwilioNumber) => {
    setNumberToDelete(num);
    setDeleteConfirming(true);
  };

  const handleBuyNumber = async () => {
    if (!selectedNumber) return;

    // Immediately close the popup so they can't double-click / re-trigger
    const numberToBuy = selectedNumber;
    setConfirming(false);
    setSelectedNumber(null);

    setLoading(true);
    setError("");
    try {
      await axios.post("/api/twilio/buy-number", { number: numberToBuy.phoneNumber });
      await fetchOwnedNumbers();
      alert(`Successfully purchased ${numberToBuy.phoneNumber}`);
    } catch (err: any) {
      console.error("Error purchasing number", err);
      setError(err?.response?.data?.message || "Error purchasing number");
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
      alert(`Deleted ${numberToDelete.phoneNumber}`);
      setDeleteConfirming(false);
      setNumberToDelete(null);
    } catch (err) {
      console.error("Error deleting number", err);
      alert("Failed to delete number");
    }
  };

  return (
    <div className="p-4 border border-black dark:border-white rounded space-y-4 relative">
      <h2 className="text-xl font-bold">Buy a New Phone Number</h2>
      <input
        value={areaCode}
        onChange={(e) => setAreaCode(e.target.value)}
        placeholder="Enter area code (e.g., 415)"
        className="border border-black dark:border-white p-2 rounded w-full"
      />
      <button
        onClick={fetchAvailableNumbers}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        disabled={loading || !areaCode}
      >
        {loading ? "Loading..." : "Search Available Numbers"}
      </button>

      {error && <p className="text-red-600">Error: {error}</p>}

      <h3 className="text-lg font-semibold mt-4">Available Numbers</h3>
      <ul className="space-y-2">
        {availableNumbers.map((num) => (
          <li key={num.phoneNumber} className="flex justify-between items-center border p-2 rounded">
            <div>
              <p className="font-medium">{formatPhoneNumber(num.phoneNumber)}</p>
              <p className="text-sm text-gray-400">
                {num.city}, {num.state}
              </p>
            </div>
            <button
              onClick={() => handleSelectNumber(num)}
              className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded cursor-pointer"
            >
              Buy
            </button>
          </li>
        ))}
      </ul>

      <h3 className="text-lg font-semibold mt-6">Your Numbers</h3>
      <ul className="space-y-2">
        {ownedNumbers.map((num) => (
          <li key={num.sid} className="border p-3 rounded">
            <div className="flex justify-between items-center">
              <span className="font-medium">{formatPhoneNumber(num.phoneNumber)}</span>
              <button
                onClick={() => handleSelectDelete(num)}
                className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded cursor-pointer"
              >
                Delete
              </button>
            </div>
            <div className="text-sm text-gray-600 mt-1">
              <p>
                Status: <span className="capitalize">{num.subscriptionStatus}</span>
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
          </li>
        ))}
      </ul>

      {/* Confirm Purchase Modal */}
      {confirming && selectedNumber && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white text-black p-6 rounded shadow-lg space-y-4 max-w-sm w-full">
            <h2 className="text-lg font-bold">Confirm Number Purchase</h2>
            <p>Number: {formatPhoneNumber(selectedNumber.phoneNumber)}</p>
            <p>
              Location: {selectedNumber.city}, {selectedNumber.state}
            </p>
            <p>Price: $2.00/month</p>
            <div className="flex space-x-4 mt-4">
              <button
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded cursor-pointer disabled:opacity-60"
                onClick={handleBuyNumber}
                disabled={loading}
              >
                {loading ? "Purchasing..." : "Confirm Purchase"}
              </button>
              <button
                className="bg-gray-400 hover:bg-gray-500 text-black px-4 py-2 rounded cursor-pointer"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
