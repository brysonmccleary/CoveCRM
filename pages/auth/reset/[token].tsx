// /pages/auth/reset/[token].tsx
import { useRouter } from "next/router";
import { useState } from "react";
import Head from "next/head";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { token } = router.query as { token?: string };

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);

    if (!token) return setErr("Missing token");
    if (!password || password.length < 8) return setErr("Password must be at least 8 characters");
    if (password !== confirm) return setErr("Passwords do not match");

    setLoading(true);
    try {
      const r = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data?.error || "Reset failed");

      setMsg("Password updated. Redirecting to sign in…");
      setTimeout(() => router.push("/auth/signin"), 1200);
    } catch (e: any) {
      setErr(e?.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head><title>Reset Password — CRM Cove</title></Head>
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white">
        <form onSubmit={onSubmit} className="w-full max-w-md space-y-4 bg-neutral-900 p-6 rounded-xl border border-neutral-800">
          <h1 className="text-2xl font-semibold">Set a new password</h1>
          <div className="space-y-2">
            <label className="block text-sm opacity-80">New password</label>
            <input
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 outline-none"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm opacity-80">Confirm password</label>
            <input
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 outline-none"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </div>

          {err && <p className="text-red-400 text-sm">{err}</p>}
          {msg && <p className="text-green-400 text-sm">{msg}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-white/10 hover:bg-white/20 border border-neutral-700 py-2 transition"
          >
            {loading ? "Saving…" : "Save password"}
          </button>
        </form>
      </div>
    </>
  );
}
