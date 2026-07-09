import { useState } from "react";
import toast from "react-hot-toast";

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

export default function NumberPurchasePanel() {
  const [areaCode, setAreaCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handlePurchase = async () => {
    if (!areaCode.trim()) {
      toast.error("❌ Please enter an area code");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/twilio/buy-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaCode }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(`✅ Number purchased: ${data.phoneNumber}`);
        setAreaCode("");
      } else {
        toast.error(`❌ ${purchaseBlockMessage(data)}`);
      }
    } catch (error) {
      console.error("Purchase error:", error);
      toast.error("❌ An error occurred while purchasing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-black dark:border-white p-4 rounded space-y-2 mt-4">
      <h2 className="text-xl font-bold">Purchase Phone Number</h2>
      <input
        type="text"
        value={areaCode}
        onChange={(e) => setAreaCode(e.target.value)}
        placeholder="Enter area code (e.g., 415)"
        className="border p-2 rounded w-full"
      />
      <button
        onClick={handlePurchase}
        disabled={loading}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
      >
        {loading ? "Purchasing..." : "Purchase Number"}
      </button>
    </div>
  );
}
