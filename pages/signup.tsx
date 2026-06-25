import { useMemo, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";

type PlanCode = "base" | "ai";
type BillingInterval = "monthly" | "annual";

const PLAN_COPY: Record<PlanCode, { label: string; monthly: string; annual: string }> = {
  base: {
    label: "Base Plan",
    monthly: "$100/month",
    annual: "$1,000/year",
  },
  ai: {
    label: "AI Plan",
    monthly: "$150/month",
    annual: "$1,500/year",
  },
};

function getQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default function SignUp() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedPlan = useMemo<PlanCode>(() => {
    const raw = getQueryValue(router.query.plan).toLowerCase();
    return raw === "ai" ? "ai" : "base";
  }, [router.query.plan]);

  const selectedInterval = useMemo<BillingInterval>(() => {
    const raw = getQueryValue(router.query.interval).toLowerCase();
    return raw === "annual" ? "annual" : "monthly";
  }, [router.query.interval]);

  const referralCode = useMemo(() => getQueryValue(router.query.ref).trim(), [router.query.ref]);

  const selectedPlanCopy = PLAN_COPY[selectedPlan];
  const selectedPrice =
    selectedInterval === "annual" ? selectedPlanCopy.annual : selectedPlanCopy.monthly;

  const changePlanHref = useMemo(() => {
    const params = new URLSearchParams();
    if (referralCode) params.set("ref", referralCode);
    return `/${params.toString() ? `?${params.toString()}` : ""}#pricing`;
  }, [referralCode]);

  const pwMismatch = useMemo(
    () => confirmPassword.length > 0 && password !== confirmPassword,
    [password, confirmPassword],
  );

  const canSubmit = useMemo(() => {
    return !!name && !!email && !!password && !!confirmPassword && !pwMismatch && !isSubmitting;
  }, [name, email, password, confirmPassword, pwMismatch, isSubmitting]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      if (pwMismatch) toast.error("Passwords do not match.");
      else toast.error("Please fill out all fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await axios.post("/api/register", {
        name,
        email,
        password,
        confirmPassword,
        plan: selectedPlan,
        interval: selectedInterval,
        ref: referralCode || undefined,
      });

      const isAdmin = !!res.data?.admin;
      if (isAdmin) {
        toast.success("Account created! (admin — no billing)");
        window.location.href = "/";
        return;
      }

      toast.success("Account created! Check your email for the verification code.");
      const veParams = new URLSearchParams({
        email,
        trial: "1",
        plan: selectedPlan,
        interval: selectedInterval,
      });
      if (referralCode) veParams.set("ref", referralCode);
      window.location.href = `/verify-email?${veParams.toString()}`;
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Signup failed. Try again.";
      toast.error(msg);
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-[var(--cove-bg-dark)] to-[var(--cove-bg)]">
      <div className="max-w-md w-full p-6 rounded-2xl shadow-xl bg-[var(--cove-card)] text-white border border-[#1e293b]">
        <h1 className="text-3xl font-bold mb-4 text-center">
          Create Your Cove CRM Account
        </h1>

        <div className="mb-6 rounded-xl border border-white/10 bg-[#0f172a] p-4">
          <p className="text-sm text-gray-400">You selected:</p>
          <div className="mt-1 flex items-center justify-between gap-4">
            <p className="font-semibold text-white">
              {selectedPlanCopy.label} — {selectedPrice}
            </p>
            <button
              type="button"
              onClick={() => {
                window.location.href = changePlanHref;
              }}
              className="text-sm text-blue-300 hover:text-blue-200 underline"
              style={{ cursor: "pointer" }}
            >
              Change plan
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <input
            type="text"
            placeholder="Full Name"
            className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            placeholder="Email"
            className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="space-y-3">
            <input
              type="password"
              placeholder="Password"
              className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div>
              <input
                type="password"
                placeholder="Confirm Password"
                className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white placeholder-gray-400"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {pwMismatch && (
                <p className="text-xs text-red-400 mt-1">Passwords do not match.</p>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded text-white font-semibold bg-[var(--cove-accent)] hover:opacity-95 disabled:opacity-60"
            style={{ cursor: canSubmit ? "pointer" : "not-allowed" }}
          >
            {isSubmitting ? "Creating Account..." : "Start Free Trial"}
          </button>

          <p className="text-xs text-center text-gray-400 mt-3">
            7-day free trial • No charge until day 8
          </p>
        </form>
      </div>
    </div>
  );
}
