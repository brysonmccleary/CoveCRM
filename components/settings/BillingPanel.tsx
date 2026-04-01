// components/settings/BillingPanel.tsx
import { useEffect, useState } from "react";

export default function BillingPanel() {
  const [isLoading, setIsLoading] = useState(false);

  const [billingAmount, setBillingAmount] = useState<string | null>(null);

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

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Billing & Subscription</h2>

      {/* Current Plan */}
      <div className="border rounded p-4">
        <h3 className="font-semibold text-lg">Current Plan</h3>
        <p>🟢 Cove CRM – {billingAmount || "Loading..."}</p>
        <p className="text-sm text-gray-500">Includes full CRM access.</p>
      </div>

      {/* AI Features */}
      <div className="border rounded p-4 space-y-3">
        <h3 className="font-semibold text-lg">AI Features</h3>
        <p className="text-sm text-gray-400">
          All AI features are included with your CoveCRM subscription.
        </p>
        <ul className="text-sm text-gray-300 space-y-1.5">
          {[
            "AI Call Coach",
            "AI Call Overview",
            "AI SMS Assistant",
            "AI Lead Scoring",
            "AI New Lead Call (enable in AI Settings)",
            "AI Dial Session (enable in AI Settings)",
          ].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-emerald-400">✓</span>
              {f}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500 pt-1">
          Usage note: Standard Twilio charges apply for outbound calls and SMS messages. These appear as usage charges on your monthly statement.
        </p>
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
