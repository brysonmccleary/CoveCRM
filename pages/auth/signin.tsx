import { getCsrfToken, signIn } from "next-auth/react";
import { useState } from "react";

export default function SignIn({ csrfToken }) {
  const [error, setError] = useState(null);
  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        const res = await signIn("credentials", {
          redirect: false,
          email: e.target.email.value,
          password: e.target.password.value
        });
        if (res.error) setError(res.error);
      }}
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

