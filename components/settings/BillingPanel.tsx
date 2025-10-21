import { useEffect, useState } from "react";

type SubResp = {
  // existing
  amount?: number;                 // base monthly price in USD (e.g. 99)
  hasAIUpgrade?: boolean;

  // optional extras (handled gracefully if present)
  effectiveAmount?: number;        // amount after discounts/promo
  discountLabel?: string;          // e.g. "Founders 20% off" or "$20 off 3 mo"
  currency?: string;               // e.g. "usd"
  adminView?: boolean;             // if the viewer is an admin seat
};

function money(v?: number | null, currency = "usd") {
  if (v == null || Number.isNaN(v)) return null;
  const fmt = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: "symbol",
    maximumFractionDigits: 0,
  });
  return fmt.format(v);
}

export default function BillingPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [buyingAI, setBuyingAI] = useState(false);

  // pricing/state
  const [hasAIUpgrade, setHasAIUpgrade] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [effectiveAmount, setEffectiveAmount] = useState<number | null>(null);
  const [discountLabel, setDiscountLabel] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("usd");
  const [adminView, setAdminView] = useState<boolean>(false);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await fetch("/api/stripe/get-subscription", { cache: "no-store" });
        const data: SubResp = await res.json();

        if (typeof data.hasAIUpgrade === "boolean") setHasAIUpgrade(data.hasAIUpgrade);
        if (typeof data.amount === "number") setAmount(data.amount);
        if (typeof data.effectiveAmount === "number") setEffectiveAmount(data.effectiveAmount);
        if (typeof data.discountLabel === "string") setDiscountLabel(data.discountLabel);
        if (typeof data.currency === "string") setCurrency(data.currency);
        if (typeof data.adminView === "boolean") setAdminView(data.adminView);
      } catch (err) {
        console.error("Error fetching subscription info:", err);
      }
    };
    fetchBilling();
  }, []);

  const goToBilling = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/create-stripe-portal?debug=1", { method: "POST" });
      const data = await res.json();

      if (res.status === 409 && data?.needsCheckout) {
        const ok = confirm("You don’t have a billing profile yet. Start your subscription now?");
        if (ok) {
          const r = await fetch("/api/stripe/create-checkout-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wantsUpgrade: false }),
          });
          const j = await r.json();
          if (!r.ok || !j?.url) throw new Error(j?.error || "Failed to start checkout");
          window.location.href = j.url;
        }
        return;
      }

      if (!res.ok) {
        const msg = data?.reason || data?.error || "There was a problem creating the billing portal session.";
        alert(msg);
        return;
      }

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No URL returned from billing portal.");
      }
    } catch (err: any) {
      console.error("Stripe portal error:", err);
      alert(err?.message || "Failed to create portal session");
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

  const baseStr = money(amount, currency) ? `${money(amount, currency)}/month` : null;
  const effStr = money(effectiveAmount, currency) ? `${money(effectiveAmount, currency)}/month` : null;

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Billing & Subscription</h2>
      <p>Manage your plan, add-ons, and payment details below.</p>

      <div className="border rounded p-4">
        <h3 className="font-semibold text-lg mb-2">Current Plan</h3>
        <p className="mb-1">
          🟢 <strong>CRM Cove</strong> – {effStr || baseStr || "Loading..."}
        </p>

        {/* If there’s a discount, show both the effective price and the original */}
        {discountLabel && (
          <p className="text-sm text-emerald-300">
            {`Including discount: ${discountLabel}`}
            {baseStr && effectiveAmount != null && amount != null && effectiveAmount !== amount
              ? ` (was ${baseStr})`
              : ""}
          </p>
        )}

        <p className="text-sm text-gray-500 dark:text-gray-300">
          This organization is billed {(effStr || baseStr || "$…")} plus tax and call/text usage.
        </p>
        {adminView && (
          <p className="text-xs text-gray-400 mt-1">
            You’re viewing an admin seat. Amounts may be hidden if billed externally.
          </p>
        )}
      </div>

      <div className="border rounded p-4 space-y-4">
        <h3 className="font-semibold text-lg mb-2">Add-ons</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">AI Assistant</p>
            <p className="text-sm text-gray-500 dark:text-gray-300">
              <span className="font-semibold">SMS automation</span> only
            </p>
            <ul className="text-sm text-gray-500 dark:text-gray-300 mt-1 list-disc ml-5">
              <li>$50 monthly access fee</li>
              <li>Plus SMS usage</li>
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
