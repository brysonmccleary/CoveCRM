// components/settings/BillingPanel.tsx
import { useEffect, useState } from "react";

export default function BillingPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [buyingAI, setBuyingAI] = useState(false);

  const [billingAmount, setBillingAmount] = useState<string | null>(null);
  const [hasAIUpgrade, setHasAIUpgrade] = useState(false);

  // (Optional) keep showing dialer minutes + status for transparency
  const [aiDialerLoading, setAiDialerLoading] = useState(true);
  const [aiDialerError, setAiDialerError] = useState<string | null>(null);
  const [aiMinutesRemaining, setAiMinutesRemaining] = useState<number | null>(null);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await fetch("/api/stripe/get-subscription", { cache: "no-store" });
        const data = await res.json();
        if (data.amount != null) setBillingAmount(`$${data.amount}/month`);
        if (typeof data.hasAIUpgrade === "boolean") setHasAIUpgrade(data.hasAIUpgrade);
      } catch (err) {
        console.error("Error fetching billing:", err);
      }
    };

    const fetchAiDialer = async () => {
      try {
        setAiDialerLoading(true);
        const res = await fetch("/api/ai-calls/billing-status");
        const data = await res.json();

        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to load AI Dialer status");
        }

        setAiMinutesRemaining(
          typeof data.minutesRemaining === "number" ? data.minutesRemaining : null
        );
      } catch (err: any) {
        console.error("AI Dialer status error:", err);
        setAiDialerError(err?.message || "Failed to load AI Dialer status");
        setAiMinutesRemaining(null);
      } finally {
        setAiDialerLoading(false);
      }
    };

    fetchBilling();
    fetchAiDialer();
  }, []);

  const goToBilling = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/create-stripe-portal?debug=1", { method: "POST" });
      const data = await res.json();

      if (res.status === 409 && data?.needsCheckout) {
        const ok = confirm("Start your subscription now?");
        if (ok) {
          const r = await fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wantsUpgrade: false }),
          });
          const j = await r.json();
          if (!r.ok || !j?.url) throw new Error("Failed to start checkout");
          window.location.href = j.url;
        }
        return;
      }

      if (!res.ok) {
        alert(data?.error || "Unable to open billing portal");
        return;
      }

      window.location.href = data.url;
    } catch (err: any) {
      alert(err?.message || "Billing portal error");
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
    } catch (err: any) {
      alert(err?.message || "Unable to start checkout");
    } finally {
      setBuyingAI(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Billing & Subscription</h2>

      {/* Current Plan */}
      <div className="border rounded p-4">
        <h3 className="font-semibold text-lg">Current Plan</h3>
        <p>🟢 Cove CRM – {billingAmount || "Loading..."}</p>
        <p className="text-sm text-gray-500">Includes full CRM access.</p>
      </div>

      {/* Add-ons */}
      <div className="border rounded p-4 space-y-6">
        <h3 className="font-semibold text-lg">Add-ons</h3>

        {/* AI Suite */}
        <div className="flex justify-between">
          <div>
            <p className="font-medium">AI Suite (SMS + Calls)</p>
            <p className="text-sm text-gray-500">
              Unlocks the AI SMS Assistant and the AI Dialer.
            </p>

            <ul className="text-sm text-gray-400 mt-1 list-disc ml-5">
              <li>$50 monthly access</li>
              <li>SMS usage billed separately (Twilio usage)</li>
              <li>AI Dialer billed at usage (per connected minute)</li>
              <li>
                Auto-reload: charges $20 only after you actually start using AI Dialer
                and your dialer balance reaches 0
              </li>
            </ul>

            <div className="text-xs text-gray-400 mt-2">
              {aiDialerLoading ? (
                <>Checking AI Dialer status…</>
              ) : aiDialerError ? (
                <>AI Dialer status: {aiDialerError}</>
              ) : (
                <>
                  AI Dialer minutes remaining:{" "}
                  <span className="font-semibold">
                    {Math.max(0, Math.floor(aiMinutesRemaining || 0))}
                  </span>
                </>
              )}
            </div>
          </div>

          {hasAIUpgrade ? (
            <span className="px-3 py-1.5 rounded bg-emerald-600/20 text-emerald-200 text-sm">
              Enabled
            </span>
          ) : (
            <button
              onClick={buyAI}
              disabled={buyingAI}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm"
            >
              {buyingAI ? "Loading…" : "Enable"}
            </button>
          )}
        </div>
      </div>

      {/* Billing Portal */}
      <div className="flex justify-between">
        <div>
          <h3 className="font-semibold text-lg">Manage Billing</h3>
          <p className="text-sm text-gray-400">Invoices, card, subscription</p>
        </div>
        <button
          onClick={goToBilling}
          disabled={isLoading}
          className="underline font-semibold"
        >
          {isLoading ? "Loading…" : "Open Billing Portal"}
        </button>
      </div>
    </div>
  );
}
