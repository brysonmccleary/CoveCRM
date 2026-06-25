// /components/settings/AffiliateProgramPanel.tsx

import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { useSession } from "next-auth/react";
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

interface LedgerPayout {
  month: string;
  amount: number;
  status: string;
  paidAt?: string | null;
  stripeTransferId?: string | null;
}

type ConnectStatus = "pending" | "verified" | "incomplete" | "restricted" | "disabled";

interface AffiliateStats {
  // Core
  code?: string; // undefined => hasn’t applied yet
  referralCode?: string | null;
  referralLink?: string | null;
  signups: number;
  referredUsersCount?: number;
  referrals: Referral[];
  totalCommission: number;
  monthlyPayoutRate?: number;

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

  const [stats, setStats] = useState<AffiliateStats | null>(null);
  const [ledgerPayouts, setLedgerPayouts] = useState<LedgerPayout[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [submittingForm, setSubmittingForm] = useState(false);

  const [copySuccess, setCopySuccess] = useState(false);
  const [connectingStripe, setConnectingStripe] = useState(false);

  const refreshStats = useCallback(async () => {
    try {
      const res = await axios.get<AffiliateStats>("/api/affiliate/stats", {
        headers: { "Cache-Control": "no-cache" },
      });
      setStats(res.data);
      if (res.data?.code) {
        const payouts = await axios.get<LedgerPayout[]>("/api/affiliate/payout-history", {
          headers: { "Cache-Control": "no-cache" },
        });
        setLedgerPayouts(Array.isArray(payouts.data) ? payouts.data : []);
      }
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
    const query = new URLSearchParams(window.location.search);
    const stripe = query.get("stripe");
    const connected = query.get("connected");

    if (stripe === "mock" || connected === "1") {
      toast.success("Stripe status refreshed");
      refreshStats().finally(() => {
        query.delete("stripe");
        query.delete("connected");
        const next = `${window.location.pathname}${query.toString() ? `?${query.toString()}` : ""}`;
        window.history.replaceState(null, "", next);
      });
    }
  }, [refreshStats]);

  const submitApplication = async () => {
    if (!name || !teamSize) {
      toast.error("Please complete the form");
      return;
    }
    setSubmittingForm(true);
    try { 
      const res = await axios.post<{ stripeUrl: string; referralCode: string; referralLink: string }>("/api/affiliate/apply", {
        name,
        email: session?.user?.email,
        teamSize,
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

  async function copyToClipboard(value: string) {
    try {
      // Safari can block clipboard on non-HTTPS; prefer modern API when available
      if (navigator?.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {}

    // Fallback: hidden textarea (works on Safari/localhost)
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  const copyCode = async () => {
    if (!stats?.code) return;
    const referralLink = `https://covecrm.com/?ref=${encodeURIComponent(String(stats.code))}#pricing`;
    const ok = await copyToClipboard(referralLink);
    setCopySuccess(true);
    ok ? toast.success("Link copied") : toast.error("Copy failed");
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

          <button
            onClick={submitApplication}
            disabled={submittingForm}
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
                <p className="text-sm text-gray-300">Your referral link</p>
                <p className="text-sm font-mono break-all">
                  {`https://covecrm.com/?ref=${stats.code}#pricing`}
                </p>
              </div>
              <button
                onClick={copyCode}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
              >
                {copySuccess ? "Copied!" : "Copy Link"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm text-gray-300">
              <div>
                <p className="text-xs">Active Referred Agents</p>
                <p className="text-lg text-white font-bold">{stats.referredUsersCount ?? stats.signups}</p>
              </div>
              <div>
                <p className="text-xs">Payout Rate</p>
                <p className="text-lg text-green-400 font-bold">
                  ${(stats.monthlyPayoutRate || 12.5).toFixed(2)}/month
                </p>
                <p className="text-xs text-gray-500">per active referred agent</p>
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

          {ledgerPayouts.length > 0 && (
            <div>
              <p className="text-sm text-gray-400 mt-6 mb-2">Monthly Payout Ledger</p>
              <ul className="space-y-1 text-sm">
                {ledgerPayouts.map((payout) => (
                  <li
                    key={`${payout.month}-${payout.stripeTransferId || payout.status}`}
                    className="flex justify-between bg-[#1E2533] px-4 py-2 rounded-md"
                  >
                    <span>{payout.month}</span>
                    <span>${Number(payout.amount || 0).toFixed(2)}</span>
                    <span className="capitalize text-gray-400">{payout.status}</span>
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
