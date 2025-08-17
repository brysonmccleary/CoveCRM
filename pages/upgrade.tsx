import { useEffect, useState } from "react";
import axios from "axios";
import { signIn, useSession } from "next-auth/react";
import Head from "next/head";

export default function UpgradePage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [hasPro, setHasPro] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await axios.post("/api/stripe/create-checkout-session");
      window.location.href = res.data.url;
    } catch (err) {
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
        if (res.data?.hasAI || res.data?.plan === "Pro") {
          setHasPro(true);
        }
      } catch (err) {
        console.error("Failed to fetch plan info");
      }
    };

    checkPlan();
  }, [session]);

  if (status === "loading") return null;
  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <Head><title>Login Required</title></Head>
        <h2 className="text-xl font-semibold mb-4">Please sign in to upgrade</h2>
        <button
          className="px-4 py-2 bg-black text-white rounded"
          onClick={() => signIn()}
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <Head><title>Upgrade</title></Head>
      <h1 className="text-3xl font-bold mb-2">Upgrade to Pro</h1>
      <p className="mb-6 text-gray-600 max-w-xl">
        Unlock premium features like AI Call Summaries, Smart SMS Assistant, Auto Appointment Booking, and more.
      </p>

      {hasPro ? (
        <div className="text-green-600 font-semibold text-lg">🎉 You're already upgraded to Pro!</div>
      ) : (
        <button
          className="px-6 py-3 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          onClick={handleUpgrade}
          disabled={loading}
        >
          {loading ? "Redirecting..." : "Upgrade Now"}
        </button>
      )}
    </div>
  );
}
