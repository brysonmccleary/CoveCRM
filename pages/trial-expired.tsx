import { useSession } from "next-auth/react";

type PlanCode = "base" | "ai";
type BillingInterval = "monthly" | "annual";

const PLAN_PRICES: Record<PlanCode, Record<BillingInterval, string>> = {
  base: {
    monthly: "$100/month",
    annual: "$1,000/year",
  },
  ai: {
    monthly: "$150/month",
    annual: "$1,500/year",
  },
};

export default function TrialExpiredPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const planCode: PlanCode = user?.planCode === "ai" ? "ai" : "base";
  const billingInterval: BillingInterval = user?.billingInterval === "annual" ? "annual" : "monthly";
  const planName = planCode === "ai" ? "AI" : "Base";
  const price = PLAN_PRICES[planCode][billingInterval];

  return (
    <main className="min-h-screen bg-gradient-to-b from-[var(--cove-bg-dark)] to-[var(--cove-bg)] px-4 py-10 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl flex-col items-center justify-center text-center">
        <div className="w-full rounded-2xl border border-[#1e293b] bg-[var(--cove-card)] p-8 shadow-xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--cove-accent)]">
            CoveCRM {planName} Trial
          </p>
          <h1 className="text-4xl font-bold">Your 7-day trial has ended</h1>
          <p className="mt-4 text-gray-300">
            Add a payment method to continue using CoveCRM
          </p>
          <div className="mt-6 rounded-xl border border-white/10 bg-[#0f172a] px-4 py-3">
            <p className="text-sm text-gray-400">Trial plan</p>
            <p className="mt-1 text-lg font-semibold">
              {planName} Plan — {price}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/settings?tab=billing";
            }}
            className="mt-8 w-full rounded bg-[var(--cove-accent)] px-5 py-3 font-semibold text-white hover:opacity-95"
            style={{ cursor: "pointer" }}
          >
            Add Payment Method
          </button>
        </div>
      </div>
    </main>
  );
}
