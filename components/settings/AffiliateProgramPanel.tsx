// /components/settings/AffiliateProgramPanel.tsx

import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

interface Referral {
  name?: string;
  email: string;
  joinedAt: string;
}

interface Payout {
  amount: number;
  date: string;
}

type ConnectStatus = "pending" | "verified" | "incomplete" | "restricted" | "disabled";

interface AffiliateStats {
  // Core
  code?: string; // undefined => hasn’t applied yet
  signups: number;
  referrals: Referral[];
  totalCommission: number;

  // Payouts & Stripe
  stripeConnectId?: string;
  onboardingCompleted?: boolean;
  connectedAccountStatus?: ConnectStatus;

  // Money
  payoutDue: number;
  totalPayoutsSent: number;
  payoutHistory?: Payout[];

  // Program gating
  approved?: boolean; // admin flips this true when coupon is live
}

export default function AffiliateProgramPanel() {
  const { data: session } = useSession();
  const router = useRouter();

  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [codeAvailable, setCodeAvailable] = useState<null | boolean>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const [submittingForm, setSubmittingForm] = useState(false);

  const [copySuccess, setCopySuccess] = useState(false);
  const [connectingStripe, setConnectingStripe] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const res = await axios.get<AffiliateStats>("/api/affiliate/stats", {
        headers: { "Cache-Control": "no-cache" },
      });
      setStats(res.data);
    } catch {
      toast.error("Failed to load affiliate data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + window focus refresh (useful after Stripe onboarding redirect)
  useEffect(() => {
    if (!session?.user?.email) return;
    refreshStats();

    const onFocus = () => refreshStats();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [session, refreshStats]);

  // Handle query params we may set in dev (e.g. ?stripe=mock) or if you add ?connected=1
  useEffect(() => {
    if (!router.isReady) return;
    const { stripe, connected } = router.query;

    if (stripe === "mock" || connected === "1") {
      toast.success("Stripe status refreshed");
      refreshStats().finally(() => {
        // Clean the URL so the toast doesn’t repeat
        const newQuery = { ...router.query };
        delete (newQuery as any).stripe;
        delete (newQuery as any).connected;
        router.replace({ pathname: router.pathname, query: newQuery }, undefined, { shallow: true });
      });
    }
  }, [router, refreshStats]);

  const checkCodeAvailability = async () => {
    if (!codeInput) return;
    setCheckingCode(true);
    setCodeAvailable(null);
    try {
      const res = await axios.post<{ available: boolean }>("/api/affiliate/check-code", {
        code: codeInput.trim().toUpperCase(),
      });
      setCodeAvailable(res.data.available);
      if (res.data.available) toast.success("Code is available!");
      else toast.error("Code is already taken.");
    } catch {
      toast.error("Failed to check code");
    } finally {
      setCheckingCode(false);
    }
  };

  const submitApplication = async () => {
    if (!codeAvailable || !name || !teamSize) {
      toast.error("Please complete the form and ensure code is available");
      return;
    }
    setSubmittingForm(true);
    try {
      const res = await axios.post<{ stripeUrl: string }>("/api/affiliate/apply", {
        name,
        email: session?.user?.email,
        teamSize,
        code: codeInput.trim().toUpperCase(),
      });
      // Redirect to Stripe onboarding (or mock in dev)
      window.location.href = res.data.stripeUrl;
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Application failed";
      toast.error(msg);
    } finally {
      setSubmittingForm(false);
    }
  };

  const connectStripe = async () => {
    setConnectingStripe(true);
    try {
      const res = await axios.post<{ url: string }>("/api/stripe/onboard-affiliate");
      window.location.href = res.data.url;
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Stripe connection failed";
      toast.error(msg);
      setConnectingStripe(false);
    }
  };

  const copyCode = () => {
    if (!stats?.code) return;
    navigator.clipboard.writeText(stats.code);
    setCopySuccess(true);
    toast.success("Code copied");
    setTimeout(() => setCopySuccess(false), 1500);
  };

  const statusBadge = useMemo(() => {
    if (!stats) return null;

    // 1) Not applied yet — no badge (the form is shown)
    if (!stats.code) return null;

    // 2) Applied but not approved yet
    if (!stats.approved) {
      return (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-600 text-yellow-200 px-3 py-2 text-sm">
          Application received — awaiting approval. We’ll email you when your code is active.
        </div>
      );
    }

    // 3) Approved but Stripe onboarding incomplete
    if (stats.approved && !stats.onboardingCompleted) {
      const label =
        stats.connectedAccountStatus && stats.connectedAccountStatus !== "pending"
          ? `status: ${stats.connectedAccountStatus}`
          : "action needed";

      return (
        <div className="rounded-md bg-blue-500/10 border border-blue-600 text-blue-200 px-3 py-2 text-sm">
          Approved — finish Stripe onboarding ({label}) to enable payouts.
        </div>
      );
    }

    // 4) Fully active
    if (stats.approved && stats.onboardingCompleted) {
      return (
        <div className="rounded-md bg-green-500/10 border border-green-600 text-green-200 px-3 py-2 text-sm">
          Payouts active — your commissions will be paid automatically.
        </div>
      );
    }

    return null;
  }, [stats]);

  if (loading) return <div className="text-white">Loading...</div>;

  return (
    <div className="text-white space-y-6">
      <h2 className="text-xl font-semibold">Affiliate Program</h2>

      {/* ===== Apply form (no code yet) ===== */}
      {!stats?.code && (
        <div className="bg-[#2C3447] p-4 rounded-xl space-y-4">
          <p className="text-sm text-gray-300">Apply to become an affiliate:</p>

          <input
            type="text"
            placeholder="Full Name"
            className="bg-[#1E2533] border border-gray-600 p-2 rounded w-full text-white"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <input
            type="email"
            disabled
            value={session?.user?.email || ""}
            className="bg-[#1E2533] border border-gray-600 p-2 rounded w-full text-white opacity-60"
          />

          <input
            type="text"
            placeholder="Team Size (e.g. 5 agents)"
            className="bg-[#1E2533] border border-gray-600 p-2 rounded w-full text-white"
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
          />

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Desired Code (e.g. JESS25)"
              className="bg-[#1E2533] border border-gray-600 p-2 rounded w-full text-white uppercase"
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value.toUpperCase());
                setCodeAvailable(null);
              }}
            />
            <button
              onClick={checkCodeAvailability}
              disabled={checkingCode || !codeInput}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
            >
              {checkingCode ? "Checking..." : "Check"}
            </button>
          </div>

          {codeAvailable === true && (
            <div className="text-green-400 text-sm">Code is available!</div>
          )}
          {codeAvailable === false && (
            <div className="text-red-400 text-sm">Code is already taken.</div>
          )}

          <button
            onClick={submitApplication}
            disabled={!codeAvailable || submittingForm}
            className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm w-full"
          >
            {submittingForm ? "Submitting..." : "Apply & Connect Stripe"}
          </button>
        </div>
      )}

      {/* ===== Dashboard (has code) ===== */}
      {stats?.code && (
        <>
          {statusBadge}

          <div className="bg-[#2C3447] p-4 rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-300">Your Referral Code</p>
                <p className="text-lg font-mono">{stats.code}</p>
              </div>
              <button
                onClick={copyCode}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
              >
                {copySuccess ? "Copied!" : "Copy Code"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm text-gray-300">
              <div>
                <p className="text-xs">Total Referrals</p>
                <p className="text-lg text-white font-bold">{stats.signups}</p>
              </div>
              <div>
                <p className="text-xs">Total Commission</p>
                <p className="text-lg text-green-400 font-bold">
                  ${stats.totalCommission.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs">Payout Due</p>
                <p className="text-lg text-yellow-400 font-bold">
                  ${stats.payoutDue.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs">Total Paid</p>
                <p className="text-lg text-white font-bold">
                  ${stats.totalPayoutsSent.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs">Stripe Status</p>
                <p
                  className={`text-lg font-bold ${
                    stats.onboardingCompleted ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {stats.onboardingCompleted ? "✅ Verified" : "❌ Not Connected"}
                </p>
                {stats.connectedAccountStatus && (
                  <p className="text-xs text-gray-400 mt-1">
                    ({stats.connectedAccountStatus})
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs">Program Approval</p>
                <p
                  className={`text-lg font-bold ${
                    stats.approved ? "text-green-400" : "text-yellow-300"
                  }`}
                >
                  {stats.approved ? "Approved" : "Pending"}
                </p>
              </div>
            </div>

            {!stats.onboardingCompleted && (
              <div className="pt-4">
                <p className="text-sm text-gray-300 mb-2">
                  {stats.approved
                    ? "Finish Stripe onboarding to receive payouts:"
                    : "You can start Stripe onboarding now; payouts will begin once you’re approved:"}
                </p>
                <button
                  onClick={connectStripe}
                  disabled={connectingStripe || !stats.stripeConnectId}
                  className={`px-4 py-2 rounded text-sm ${
                    connectingStripe || !stats.stripeConnectId
                      ? "bg-purple-800 opacity-60 cursor-not-allowed"
                      : "bg-purple-600 hover:bg-purple-700"
                  }`}
                >
                  {connectingStripe ? "Connecting..." : "Connect Stripe Account"}
                </button>
                {!stats.stripeConnectId && (
                  <p className="text-xs text-gray-400 mt-2">
                    Waiting for account provisioning…
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={refreshStats}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded text-xs"
              >
                Refresh status
              </button>
            </div>
          </div>

          {stats?.referrals?.length > 0 && (
            <div>
              <p className="text-sm text-gray-400 mb-2 mt-6">Recent Signups</p>
              <ul className="space-y-2">
                {stats.referrals.map((ref, idx) => (
                  <li key={idx} className="bg-[#1E2533] p-3 rounded-md text-sm">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-white">{ref.name || "Unnamed User"}</p>
                        <p className="text-gray-400">{ref.email}</p>
                      </div>
                      <p className="text-gray-500 text-xs">
                        {new Date(ref.joinedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Array.isArray(stats.payoutHistory) && stats.payoutHistory.length > 0 && (
            <div>
              <p className="text-sm text-gray-400 mt-6 mb-2">Payout History</p>
              <ul className="space-y-1 text-sm">
                {stats.payoutHistory.map((payout, idx) => (
                  <li
                    key={idx}
                    className="flex justify-between bg-[#1E2533] px-4 py-2 rounded-md"
                  >
                    <span>${payout.amount.toFixed(2)}</span>
                    <span className="text-gray-400">
                      {new Date(payout.date).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
