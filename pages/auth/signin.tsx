import { getCsrfToken, signIn } from "next-auth/react";
import React, { useState, FormEvent } from "react";

export default function SignIn({ csrfToken }: { csrfToken: string }) {
  const [error, setError] = useState(null);
  return (
    <form
  onSubmit={async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const password = (form.elements.namedItem("password") as HTMLInputElement).value;

    const res = await signIn("credentials", {
      redirect: false,
      email,
      password
    });
    if (res?.error) {
      setError(res.error);
    }
  }}
  ...
>
      className="max-w-md mx-auto p-4"
    >
      <h1 className="text-2xl mb-4">Sign In</h1>
      <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
      <input
        name="email"
        placeholder="Email"
        className="w-full mb-2 p-2 border"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        className="w-full mb-4 p-2 border"
      />
      <button type="submit" className="px-4 py-2 bg-green-600 text-white">
        Sign In
      </button>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </form>
  );
}

export async function getServerSideProps(context) {
  return { props: { csrfToken: await getCsrfToken(context) } };
}

