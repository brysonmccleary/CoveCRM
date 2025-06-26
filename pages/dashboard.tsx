import React, { useState, FormEvent } from "react";
import { getCsrfToken, signIn } from "next-auth/react";

interface SignInProps {
  csrfToken: string;
}

export default function SignIn({ csrfToken }: SignInProps) {
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    const res = await signIn("credentials", {
      redirect: false,
      email,
      password,
    });
    if (res?.error) {
      setError(res.error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-4">
      <h1 className="text-2xl mb-4">Sign In</h1>
      <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
      <input
        name="email"
        type="email"
        placeholder="Email"
        className="w-full mb-2 p-2 border rounded"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        className="w-full mb-4 p-2 border rounded"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-green-600 text-white rounded"
      >
        Sign In
      </button>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </form>
  );
}

export async function getServerSideProps(context: any) {
  const csrfToken = await getCsrfToken(context);
  return {
    props: {
      csrfToken: csrfToken ?? "",
    },
  };
}

