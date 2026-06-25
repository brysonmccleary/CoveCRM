// components/settings/BillingPanel.tsx
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useElements, useStripe } from "@stripe/react-stripe-js";
import toast from "react-hot-toast";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

type PlanCode = "free" | "base" | "ai";
type BillingInterval = "monthly" | "annual";

type SubscriptionSummary = {
  planCode?: PlanCode | null;
  billingInterval?: BillingInterval | null;
  amount?: number | null;
  nextBillingDate?: string | null;
  status?: string | null;
  trialEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  hasAIUpgrade?: boolean;
};

type PaymentMethod = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
} | null;

type InvoiceRow = {
  date: string;
  amount: number;
  status: string;
  pdfUrl?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function planLabel(planCode?: string | null) {
  if (planCode === "base") return "Base Plan";
  if (planCode === "ai") return "AI Plan";
  return "Legacy (Grandfathered)";
}

function intervalLabel(interval?: string | null) {
  return interval === "annual" ? "Annual" : "Monthly";
}

function monthlyAmount(planCode?: string | null, hasAIUpgrade?: boolean) {
  if (planCode === "ai") return 150;
  if (planCode === "base" && hasAIUpgrade) return 150;
  if (planCode === "base") return 100;
  return null;
}

function PaymentMethodForm({
  email,
  planCode,
  interval,
  onSaved,
  onNumberProvisionMessage,
}: {
  email: string;
  planCode: PlanCode;
  interval: BillingInterval;
  onSaved: () => void;
  onNumberProvisionMessage: (message: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadSetupIntent = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/create-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, planCode, interval }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Unable to initialize payment method");
        if (cancelled) return;
        setClientSecret(data.setupClientSecret || data.clientSecret || null);
        setSubscriptionId(data.subscriptionId || null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Unable to initialize payment method");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (email) loadSetupIntent();
    return () => {
      cancelled = true;
    };
  }, [email, interval, planCode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || !clientSecret) return;
    const card = elements.getElement(CardElement);
    if (!card) return;

    setSaving(true);
    setError(null);
    try {
      const confirmParams = {
        payment_method: {
          card,
          billing_details: { email },
        },
      };
      const result = clientSecret.startsWith("pi_")
        ? await stripe.confirmCardPayment(clientSecret, confirmParams)
        : await stripe.confirmCardSetup(clientSecret, confirmParams);
      if (result.error) throw new Error(result.error.message || "Card setup failed");
      const paymentMethodId = String(
        (result as any).setupIntent?.payment_method ||
          (result as any).paymentIntent?.payment_method ||
          "",
      );
      if (!paymentMethodId) throw new Error("Card saved, but payment method was missing");

      const res = await fetch("/api/stripe/set-default-payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, subscriptionId, paymentMethodId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Payment method could not be saved");
      try {
        const provisionRes = await fetch("/api/twilio/provision-number", { method: "POST" });
        const provisionData = await provisionRes.json().catch(() => ({}));
        if (provisionRes.ok && provisionData?.provisioned === true) {
          onNumberProvisionMessage("Your phone number has been assigned! You can find it in the Numbers tab.");
          toast.success("Your phone number has been assigned!");
        } else if (provisionRes.ok && provisionData?.alreadyProvisioned === true) {
          onNumberProvisionMessage(null);
        } else {
          onNumberProvisionMessage("Card saved. Your phone number will be assigned shortly.");
        }
      } catch {
        onNumberProvisionMessage("Card saved. Your phone number will be assigned shortly.");
      }
      toast.success("Payment method saved");
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Payment method could not be saved");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-400">Loading secure card form...</p>;
  if (error && !clientSecret) return <p className="text-sm text-red-300">{error}</p>;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-white/10 bg-[#0f172a] p-4">
      <div className="rounded bg-white p-3">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#111827",
                fontFamily: "Inter, sans-serif",
                "::placeholder": { color: "#9CA3AF" },
              },
              invalid: { color: "#EF4444" },
            },
          }}
        />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || saving || !clientSecret}
        className="rounded bg-[var(--cove-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ cursor: !stripe || saving || !clientSecret ? "not-allowed" : "pointer" }}
      >
        {saving ? "Saving..." : "Save Payment Method"}
      </button>
    </form>
  );
}

export default function BillingPanel() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const email = String(user?.email || "");
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCardForm, setShowCardForm] = useState(false);
  const [upgradeConfirming, setUpgradeConfirming] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [numberProvisionMessage, setNumberProvisionMessage] = useState<string | null>(null);

  const loadBilling = async () => {
    try {
      setLoading(true);
      const [subRes, pmRes, invoiceRes] = await Promise.all([
        fetch("/api/stripe/get-subscription", { cache: "no-store" }),
        fetch("/api/stripe/get-payment-method", { cache: "no-store" }),
        fetch("/api/stripe/get-invoices", { cache: "no-store" }),
      ]);

      const subData = await subRes.json().catch(() => ({}));
      const pmData = await pmRes.json().catch(() => null);
      const invoiceData = await invoiceRes.json().catch(() => []);

      if (subRes.ok) setSubscription(subData || {});
      if (pmRes.ok) setPaymentMethod(pmData || null);
      if (invoiceRes.ok && Array.isArray(invoiceData)) setInvoices(invoiceData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, []);

  const effectivePlanCode: PlanCode =
    subscription?.planCode === "ai" || subscription?.planCode === "base" || subscription?.planCode === "free"
      ? subscription.planCode
      : user?.planCode === "ai" || user?.planCode === "base"
        ? user.planCode
        : "free";
  const effectiveInterval: BillingInterval =
    subscription?.billingInterval === "annual" || user?.billingInterval === "annual" ? "annual" : "monthly";
  const hasAIUpgrade = subscription?.hasAIUpgrade === true || user?.aiEntitlementSource === "upgrade";
  const amount = monthlyAmount(effectivePlanCode, hasAIUpgrade);
  const trialEnd = subscription?.trialEnd || user?.trialEndsAt || null;
  const trialEndsAtMs = trialEnd ? new Date(trialEnd).getTime() : 0;
  const trialActive = Boolean(trialEndsAtMs && trialEndsAtMs > Date.now());
  const cardOnFile = paymentMethod !== null || user?.cardOnFile === true;
  const isBasePlan = effectivePlanCode === "base" && user?.hasAI !== true && !hasAIUpgrade;
  const paidUser = cardOnFile && Boolean((user?.stripeSubscriptionId || subscription?.status) && effectivePlanCode !== "free");

  const planForSetup = useMemo<PlanCode>(() => {
    return effectivePlanCode === "ai" ? "ai" : "base";
  }, [effectivePlanCode]);

  const confirmUpgrade = async () => {
    setUpgradeLoading(true);
    setUpgradeError(null);
    setUpgradeMessage(null);
    try {
      const res = await fetch("/api/stripe/create-ai-upgrade", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) throw new Error(data?.error || "Upgrade failed");
      setUpgradeMessage(data?.message || "AI features unlocked!");
      setTimeout(() => {
        window.location.href = window.location.href;
      }, 2000);
    } catch (err: any) {
      setUpgradeError(err?.message || "Upgrade failed");
    } finally {
      setUpgradeLoading(false);
    }
  };

  const confirmCancel = async () => {
    setCancelLoading(true);
    setCancelError(null);
    try {
      const res = await fetch("/api/stripe/cancel-subscription", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) throw new Error(data?.error || "Cancellation failed");
      toast.success("Subscription will cancel at period end");
      await loadBilling();
      setCancelConfirming(false);
    } catch (err: any) {
      setCancelError(err?.message || "Cancellation failed");
    } finally {
      setCancelLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 p-6 rounded shadow">
        <p className="text-sm text-gray-400">Loading billing...</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded shadow space-y-6">
      <h2 className="text-xl font-bold">Billing & Usage</h2>

      <section className="border border-white/10 rounded p-4 space-y-3">
        <h3 className="font-semibold text-lg">Current Plan</h3>
        <p className="text-sm font-semibold text-white">
          {planLabel(effectivePlanCode)} — {intervalLabel(effectiveInterval)} — {amount === null ? "Included" : `$${amount}/mo`}
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <p className="text-sm text-gray-300">Plan: <span className="font-semibold text-white">{planLabel(effectivePlanCode)}</span></p>
          <p className="text-sm text-gray-300">Billing interval: <span className="font-semibold text-white">{intervalLabel(effectiveInterval)}</span></p>
          <p className="text-sm text-gray-300">Next billing date: <span className="font-semibold text-white">{formatDate(subscription?.nextBillingDate || null)}</span></p>
          <p className="text-sm text-gray-300">Monthly amount: <span className="font-semibold text-white">{amount === null ? "Included" : `$${amount}`}</span></p>
        </div>
        {trialActive && (
          <p className="rounded bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
            Your free trial ends on {formatDate(trialEnd)}. You won&apos;t be charged until then.
          </p>
        )}
        <p className={`rounded px-3 py-2 text-sm ${cardOnFile ? "bg-emerald-500/10 text-emerald-300" : "bg-yellow-500/10 text-yellow-200"}`}>
          {cardOnFile ? "Payment method on file" : "No payment method — add one to keep access after trial"}
        </p>
      </section>

      <section className="border border-white/10 rounded p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-lg">Payment Method</h3>
            {paymentMethod ? (
              <p className="text-sm text-gray-300">
                {paymentMethod.brand.toUpperCase()} ending in {paymentMethod.last4} · Expires {paymentMethod.expMonth}/{paymentMethod.expYear}
              </p>
            ) : (
            <p className="text-sm text-gray-400">Add a card to activate your phone number and keep access after trial.</p>
            )}
            {numberProvisionMessage && (
              <p className="mt-2 rounded bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                {numberProvisionMessage}
              </p>
            )}
          </div>
          {cardOnFile && (
            <button
              type="button"
              onClick={() => setShowCardForm((v) => !v)}
              className="rounded border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
              style={{ cursor: "pointer" }}
            >
              Update payment method
            </button>
          )}
        </div>

        {(!cardOnFile || showCardForm) && email && (
          <Elements stripe={stripePromise}>
            <PaymentMethodForm
              email={email}
              planCode={planForSetup}
              interval={effectiveInterval}
              onNumberProvisionMessage={setNumberProvisionMessage}
              onSaved={async () => {
                setShowCardForm(false);
                await loadBilling();
              }}
            />
          </Elements>
        )}
      </section>

      {isBasePlan && (
        <section className="border border-purple-500/30 rounded p-4 space-y-4 bg-purple-500/5">
          <div>
            <h3 className="font-semibold text-lg">Unlock AI Features</h3>
            <p className="text-sm text-gray-300 mt-1">
              Add Kayla, the AI voice dialer, auto-calling, transcripts, live transfer, and AI SMS for $50/month. Cancel anytime.
            </p>
          </div>
          <ul className="space-y-1.5 text-sm text-gray-300">
            {[
              "Kayla AI voice dialer",
              "AI auto-call new leads",
              "AI call transcripts & summaries",
              "Live transfer AI to agent",
              "AI SMS responses",
            ].map((feature) => (
              <li key={feature} className="flex gap-2">
                <span className="text-blue-400">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setUpgradeConfirming(true)}
            className="rounded bg-[var(--cove-accent)] px-4 py-2 text-sm font-semibold text-white"
            style={{ cursor: "pointer" }}
          >
            Upgrade to AI — $50/month
          </button>
          {upgradeConfirming && (
            <div className="rounded-xl border border-white/10 bg-[#0f172a] p-4 space-y-3">
              <p className="text-sm text-gray-200">
                You&apos;re about to add the AI upgrade for $50/month starting today. This will be charged to your card on file.
              </p>
              {upgradeError && <p className="text-sm text-red-300">{upgradeError}</p>}
              {upgradeMessage && <p className="text-sm text-emerald-300">AI features unlocked!</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={confirmUpgrade}
                  disabled={upgradeLoading}
                  className="rounded bg-[var(--cove-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ cursor: upgradeLoading ? "not-allowed" : "pointer" }}
                >
                  {upgradeLoading ? "Upgrading..." : "Confirm Upgrade"}
                </button>
                <button
                  type="button"
                  onClick={() => setUpgradeConfirming(false)}
                  className="rounded border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                  style={{ cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {paidUser && (
        <section className="border border-white/10 rounded p-4 space-y-3">
          <button
            type="button"
            onClick={() => setCancelConfirming(true)}
            className="text-sm text-red-300 underline"
            style={{ cursor: "pointer" }}
          >
            Cancel subscription
          </button>
          {cancelConfirming && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 space-y-3">
              <p className="text-sm text-gray-200">
                Canceling will end your access at the end of the current billing period.
              </p>
              {cancelError && <p className="text-sm text-red-300">{cancelError}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={confirmCancel}
                  disabled={cancelLoading}
                  className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ cursor: cancelLoading ? "not-allowed" : "pointer" }}
                >
                  {cancelLoading ? "Canceling..." : "Confirm Cancel"}
                </button>
                <button
                  type="button"
                  onClick={() => setCancelConfirming(false)}
                  className="rounded border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
                  style={{ cursor: "pointer" }}
                >
                  Keep Subscription
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {cardOnFile && (
        <section className="border border-white/10 rounded p-4 space-y-3">
          <h3 className="font-semibold text-lg">Invoices</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-400">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={`${invoice.date}-${invoice.amount}`} className="border-t border-white/10">
                      <td className="py-2 pr-4">{formatDate(invoice.date)}</td>
                      <td className="py-2 pr-4">${invoice.amount.toFixed(2)}</td>
                      <td className="py-2 pr-4 capitalize">{invoice.status}</td>
                      <td className="py-2 pr-4">
                        {invoice.pdfUrl ? (
                          <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="text-blue-300 underline" style={{ cursor: "pointer" }}>
                            PDF
                          </a>
                        ) : (
                          <span className="text-gray-500">Unavailable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
