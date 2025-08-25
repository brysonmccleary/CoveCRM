// /components/settings/BillingPanel.tsx
import { useEffect, useState } from "react";

export default function BillingPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [buyingAI, setBuyingAI] = useState(false);
  const [billingAmount, setBillingAmount] = useState<string | null>(null);
  const [hasAIUpgrade, setHasAIUpgrade] = useState(false);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await fetch("/api/stripe/get-subscription", { cache: "no-store" });
        const data = await res.json();
        if (data.amount != null) setBillingAmount(`$${data.amount}/month`);
        if (typeof data.hasAIUpgrade === "boolean") setHasAIUpgrade(data.hasAIUpgrade);
      } catch (err) {
        console.error("Error fetching subscription info:", err);
      }
    };
    fetchBilling();
  }, []);

  const goToBilling = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/create-stripe-portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "There was a problem redirecting to billing.");
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No URL returned from billing portal.");
      }
    } catch (err: any) {
      console.error("Stripe portal error:", err);
      alert(err?.message || "There was a problem redirecting to billing.");
    } finally {
      setIsLoading(false);
    }
  };

  const buyAI = async () => {
    setBuyingAI(true);
    try {
      const r = await fetch("/api/billing/create-ai-checkout", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j?.url) throw new Error(j?.error || "Failed to start checkout");
      window.location.href = j.url;
    } catch (e: any) {
      alert(e?.message || "Unable to start checkout");
    } finally {
      setBuyingAI(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Billing & Subscription</h2>
      <p>Manage your plan, add-ons, and payment details below.</p>

      <div className="border rounded p-4">
        <h3 className="font-semibold text-lg mb-2">Current Plan</h3>
        <p className="mb-1">
          🟢 <strong>CRM Cove</strong> – {billingAmount || "Loading..."}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-300">
          This organization is billed {billingAmount || "$…"} plus tax and call/text usage.
        </p>
      </div>

      <div className="border rounded p-4 space-y-4">
        <h3 className="font-semibold text-lg mb-2">Add-ons</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">AI Assistant</p>
            <p className="text-sm text-gray-500 dark:text-gray-300">
              Transcripts and AI summaries on recorded calls & SMS automation
            </p>
            <ul className="text-sm text-gray-500 dark:text-gray-300 mt-1 list-disc ml-5">
              <li>$50 monthly access fee</li>
              <li>$0.02 per minute on recorded calls</li>
            </ul>
          </div>
          <div className="flex items-center gap-3">
            {hasAIUpgrade ? (
              <span className="px-3 py-1.5 rounded bg-emerald-600/20 text-emerald-200 text-sm">
                Enabled
              </span>
            ) : (
              <button
                onClick={buyAI}
                disabled={buyingAI}
                className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
              >
                {buyingAI ? "Starting checkout…" : "Enable AI Add-on"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">Manage Billing</h3>
          <p className="text-sm text-gray-400 dark:text-gray-300">
            Update card, view invoices, cancel plan
          </p>
        </div>
        <button
          onClick={goToBilling}
          disabled={isLoading}
          className="btn btn-primary underline font-semibold cursor-pointer"
        >
          {isLoading ? "Loading..." : "Open Billing Portal"}
        </button>
      </div>
    </div>
  );
}
