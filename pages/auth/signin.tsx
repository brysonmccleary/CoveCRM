// /pages/auth/signin.tsx
import { signIn, getCsrfToken } from "next-auth/react";
import Head from "next/head";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";

type Props = {
  csrfToken: string | null;
  googleEnabled: boolean; // kept for compatibility; not rendered
};

export default function SignIn({ csrfToken /* , googleEnabled */ }: Props) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
    });
    if (res?.ok) {
      toast.success("✅ Login successful");
      window.location.href = "/dashboard";
    } else {
      toast.error("❌ Login failed. Check your email/password.");
    }
    setLoading(false);
  };

  return (
    <>
      <Head>
        <title>Sign In • CoveCRM</title>
        {/* ensure tab icon matches site on first load */}
        <link rel="icon" href="/favicon.ico?v=2" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </Head>

      <div className="min-h-screen w-full bg-gradient-to-br from-blue-950 via-blue-900 to-blue-700 text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3">
            <img src="/logo.png" alt="CoveCRM" className="h-12 w-auto" />
            <h1 className="text-2xl font-bold tracking-tight">
              Sign in to CoveCRM
            </h1>
            <p className="text-sm text-blue-100/80">
              Welcome back — let’s get you to your dashboard.
            </p>
          </div>

          <div className="rounded-2xl border border-blue-400/20 bg-blue-900/30 backdrop-blur-md shadow-2xl p-6">
            <form onSubmit={handleCredentials} className="space-y-4">
              <input
                name="csrfToken"
                type="hidden"
                defaultValue={csrfToken ?? ""}
              />

              <div>
                <label className="mb-1 block text-sm text-blue-100">
                  Email
                </label>
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="w-full rounded-lg border border-blue-400/30 bg-blue-950/40 px-3 py-2 outline-none ring-0 placeholder:text-blue-200/40 focus:border-blue-300/60"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-blue-100">
                  Password
                </label>
                <input
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full rounded-lg border border-blue-400/30 bg-blue-950/40 px-3 py-2 outline-none ring-0 placeholder:text-blue-200/40 focus:border-blue-300/60"
                />
                <div className="mt-2 text-right">
                  <Link
                    href="/auth/forgot"
                    className="text-sm text-blue-200 hover:text-white underline underline-offset-4"
                  >
                    Forgot your password?
                  </Link>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-blue-500 py-2 font-semibold hover:bg-blue-400 disabled:opacity-50"
              >
                {loading ? "Signing in…" : "Sign in with Email"}
              </button>
            </form>

            {/* Removed the divider and Google button */}
            {/* 
            <div className="my-4 flex items-center gap-3 text-blue-100/70">
              <div className="h-px flex-1 bg-blue-300/20" />
              <span className="text-xs uppercase tracking-wider">or</span>
              <div className="h-px flex-1 bg-blue-300/20" />
            </div>

            <button ...>Continue with Google</button>
            */}

            <p className="mt-6 text-center text-xs text-blue-100/70">
              By continuing you agree to the{" "}
              <Link href="/legal/terms" className="underline hover:text-white">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/legal/privacy" className="underline hover:text-white">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export async function getServerSideProps(ctx: any) {
  const csrfToken = await getCsrfToken(ctx);
  const googleEnabled = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  return { props: { csrfToken: csrfToken ?? null, googleEnabled } };
}
