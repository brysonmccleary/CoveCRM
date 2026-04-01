import { useEffect, useState } from "react";
import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import Head from "next/head";

const INCLUDED = [
  "AI Voice Appointment Setter — auto-calls new leads",
  "AI SMS Assistant — drafts reply suggestions",
  "AI Call Summaries & Coaching",
  "AI Dial Sessions — batch outbound AI calling",
  "Smart Follow-Up Nudges",
  "Full CRM — leads, folders, drip campaigns",
  "Twilio SMS & calling integration",
  "Email sequences with CAN-SPAM compliance",
  "Booking & calendar management",
];

export default function UpgradePage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [hasPro, setHasPro] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/stripe/create-checkout-session");
      window.location.href = res.data.url;
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const checkPlan = async () => {
      if (!session?.user?.email) return;
      try {
        const res = await axios.get("/api/user/plan");
        if (res.data?.hasAI || res.data?.plan === "Pro") setHasPro(true);
      } catch {}
    };
    checkPlan();
  }, [session]);

  if (status === "loading") return null;

  if (!session) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center">
        <Head><title>Login Required</title></Head>
        <h2 className="text-xl font-semibold text-white mb-4">Please sign in to upgrade</h2>
        <button
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
          onClick={() => signIn()}
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center px-4 py-16">
      <Head><title>Upgrade to Pro — CoveCRM</title></Head>

      <div className="max-w-lg w-full space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-extrabold text-white">Upgrade to Pro</h1>
          <p className="text-gray-400 mt-2">
            Everything you need to close more deals — AI calling, SMS, and full CRM in one place.
          </p>
        </div>

        <div className="bg-[#1e293b] border border-indigo-500/30 rounded-2xl p-6 text-left space-y-3">
          <div className="text-center mb-4">
            <span className="text-4xl font-extrabold text-indigo-400">$99</span>
            <span className="text-gray-400 text-sm">/month</span>
            <p className="text-xs text-gray-500 mt-1">Cancel anytime</p>
          </div>

          <p className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-2">
            Everything included:
          </p>
          <ul className="space-y-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-green-400 shrink-0 mt-0.5">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {hasPro ? (
          <div className="text-green-400 font-semibold text-lg">
            You&apos;re already on Pro!
          </div>
        ) : (
          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-base transition disabled:opacity-50"
          >
            {loading ? "Redirecting to checkout…" : "Upgrade Now →"}
          </button>
        )}

        <p className="text-xs text-gray-500">
          Questions?{" "}
          <a href="mailto:support@covecrm.com" className="text-gray-400 hover:text-white underline">
            support@covecrm.com
          </a>
        </p>
      </div>
    </div>
  );
}
