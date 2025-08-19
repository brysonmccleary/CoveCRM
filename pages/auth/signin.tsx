// /pages/auth/signin.tsx
import { signIn, getCsrfToken } from "next-auth/react";
import Head from "next/head";
import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";

type Props = {
  csrfToken: string | null;
  googleEnabled: boolean;
};

export default function SignIn({ csrfToken, googleEnabled }: Props) {
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

  const handleGoogle = () => {
    signIn("google", { callbackUrl: "/dashboard" });
  };

  return (
    <>
      <Head>
        <title>Sign In • CoveCRM</title>
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

            <div className="my-4 flex items-center gap-3 text-blue-100/70">
              <div className="h-px flex-1 bg-blue-300/20" />
              <span className="text-xs uppercase tracking-wider">or</span>
              <div className="h-px flex-1 bg-blue-300/20" />
            </div>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={!googleEnabled}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-300/30 bg-blue-900/40 py-2 font-semibold hover:bg-blue-800/40 disabled:opacity-50"
              title={
                googleEnabled ? "Sign in with Google" : "Google not configured"
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 48 48"
              >
                <path
                  fill="#FFC107"
                  d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.7 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 19.5-9 19.5-20c0-1.2-.1-2.3-.3-3.5z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.3 14.7l6.6 4.8C14.3 15.9 18.8 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.7 6.1 29.6 4 24 4 16 4 9 8.5 6.3 14.7z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.2 0 10.1-2 13.7-5.2l-6.3-5.2C29.3 36 26.8 37 24 37c-5.2 0-9.6-3.4-11.3-8l-6.6 5.1C9 39.6 16 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.6 20.5H42V20H24v8h11.3c-1 2.6-3 4.6-5.6 6l6.3 5.2C38.9 36.4 41.5 31.7 41.5 24c0-1.2-.1-2.3-.3-3.5z"
                />
              </svg>
              Continue with Google
            </button>

            <p className="mt-6 text-center text-xs text-blue-100/70">
              By continuing you agree to the{" "}
              <Link href="/legal/terms" className="underline hover:text-white">
                Terms
              </Link>{" "}
              and{" "}
              <Link
                href="/legal/privacy"
                className="underline hover:text-white"
              >
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
