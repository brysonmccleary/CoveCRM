import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

export default function VerifyEmailPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const email = useMemo(() => {
    const raw = router.query.email;
    return (Array.isArray(raw) ? raw[0] : raw) || "";
  }, [router.query.email]);

  const nextBillingUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const key of ["email", "price", "ai", "trial", "code"]) {
      const raw = router.query[key];
      const value = (Array.isArray(raw) ? raw[0] : raw) || "";
      if (value) params.set(key === "code" ? "promoCode" : key, value);
    }
    return `/billing?${params.toString()}`;
  }, [router.query]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !code.trim()) {
      toast.error("Enter the verification code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Verification failed");
      toast.success("Email verified. Continue to billing.");
      router.push(nextBillingUrl);
    } catch (err: any) {
      toast.error(err?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email) {
      toast.error("Missing email address.");
      return;
    }

    setResending(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, action: "resend" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Could not resend code");
      toast.success("New verification code sent.");
    } catch (err: any) {
      toast.error(err?.message || "Could not resend code");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-b from-[var(--cove-bg-dark)] to-[var(--cove-bg)]">
      <div className="max-w-md w-full p-6 rounded-2xl shadow-xl bg-[var(--cove-card)] text-white border border-[#1e293b]">
        <h1 className="text-3xl font-bold mb-3 text-center">Verify Your Email</h1>
        <p className="text-sm text-gray-300 text-center mb-6">
          Enter the 6-digit code we sent to {email || "your email"}.
        </p>

        <form onSubmit={verify} className="space-y-4">
          <input
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            className="w-full p-3 rounded bg-[#0f172a] border border-[#1e293b] text-white text-center text-2xl tracking-[0.35em] placeholder-gray-500"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full py-3 rounded text-white font-semibold bg-[var(--cove-accent)] hover:opacity-95 disabled:opacity-60"
          >
            {loading ? "Verifying..." : "Verify Email"}
          </button>
        </form>

        <button
          type="button"
          onClick={resend}
          disabled={resending}
          className="mt-4 w-full text-sm text-blue-300 hover:text-blue-200 disabled:opacity-60"
        >
          {resending ? "Sending..." : "Resend code"}
        </button>
      </div>
    </div>
  );
}
