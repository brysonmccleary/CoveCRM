// pages/auth/signin.tsx
import React, { useState } from "react";
import { getCsrfToken, signIn } from "next-auth/react";
import { useRouter } from "next/router";

interface SignInProps {
  csrfToken: string;
}

export default function SignIn({ csrfToken }: SignInProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
    });
    if (res?.error) {
      setError(res.error);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="max-w-md w-full bg-white p-6 rounded shadow space-y-4">
        <h1 className="text-2xl font-bold text-center">Sign In</h1>
        <input name="csrfToken" type="hidden" defaultValue={csrfToken} />

        <div>
          <label htmlFor="email" className="block mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 border rounded"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 transition"
        >
          Sign In
        </button>

        {error && <p className="text-red-500 mt-2 text-center">{error}</p>}
      </form>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  const csrfToken = (await getCsrfToken(context)) || "";
  return { props: { csrfToken } };
}

