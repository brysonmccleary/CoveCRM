import { useEffect, useState } from "react";

export default function BillingPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [portalUrl, setPortalUrl] = useState("");
  const [billingAmount, setBillingAmount] = useState<string | null>(null);
  const [hasAIUpgrade, setHasAIUpgrade] = useState(false);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await fetch("/api/stripe/get-subscription");
        const data = await res.json();
        if (data.amount) {
          setBillingAmount(`$${data.amount}/month`);
        }
        if (data.hasAIUpgrade !== undefined) {
          setHasAIUpgrade(data.hasAIUpgrade);
        }
      } catch (err) {
        console.error("Error fetching subscription info:", err);
      }
    };
    fetchBilling();
  }, []);

  const goToBilling = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/create-stripe-portal", {
        method: "POST",
      });
      const data = await res.json();
      if (data.url) {
        setPortalUrl(data.url);
        window.location.href = data.url;
      } else {
        throw new Error("No URL returned");
      }
    } catch (err) {
      console.error("Stripe portal error:", err);
      alert("There was a problem redirecting to billing.");
    } finally {
      setIsLoading(false);
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
          This organization is billed {billingAmount || "$..."} plus tax where applicable and call/text usage.
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
          <div>
            <label className="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={hasAIUpgrade}
                readOnly
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer dark:bg-gray-700 peer-checked:bg-blue-600"></div>
            </label>
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
