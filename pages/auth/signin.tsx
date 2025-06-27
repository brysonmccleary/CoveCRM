// pages/auth/signin.tsx
import React from "react";
import { getCsrfToken } from "next-auth/react";

interface SignInProps {
  csrfToken: string;
}

export default function SignIn({ csrfToken }: SignInProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        method="post"
        action="/api/auth/callback/credentials"
        className="max-w-md w-full bg-white p-6 rounded shadow space-y-4"
      >
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
      </form>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  const csrfToken = (await getCsrfToken(context)) || "";
  return {
    props: { csrfToken },
  };
}

