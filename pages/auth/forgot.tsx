// /pages/auth/forgot.tsx
import { useState } from "react";
import Head from "next/head";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always shows success (we don’t leak whether an email exists)
      if (!res.ok) throw new Error("Failed to request reset");
      setSent(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Forgot Password — Cove CRM</title>
      </Head>
      <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
        <div className="bg-[#1e293b] p-8 rounded shadow-md w-full max-w-md text-white">
          <h1 className="text-2xl font-bold mb-2 text-center">
            Forgot Password
          </h1>
          <p className="text-gray-300 text-center mb-6">
            Enter your account email and we’ll send you a reset link.
          </p>

          {sent ? (
            <div className="rounded-md border border-green-400/40 bg-green-400/10 p-4 text-green-300">
              If an account exists for <b>{email}</b>, a reset link has been
              sent. Check your inbox (and spam) for the email.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="block mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          <div className="mt-4 text-center">
            <a
              href="/auth/signin"
              className="text-blue-400 hover:underline text-sm"
            >
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
