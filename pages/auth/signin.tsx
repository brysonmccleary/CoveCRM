import { getCsrfToken } from "next-auth/react";

export default function SignIn({ csrfToken }: any) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f172a]">
      <div className="bg-[#1e293b] p-8 rounded shadow-md w-full max-w-md text-white">
<div className="flex justify-center mb-6">
  <img src="/logo.png" alt="CoveCRM Logo" className="h-12" />
</div>
        <h1 className="text-2xl font-bold mb-6 text-center">Sign In to CoveCRM</h1>
        <form method="post" action="/api/auth/callback/credentials" className="space-y-4">
          <input name="csrfToken" type="hidden" defaultValue={csrfToken} />
          <div>
            <label className="block mb-1">Email</label>
            <input
              name="email"
              type="email"
              className="w-full p-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="block mb-1">Password</label>
            <input
              name="password"
              type="password"
              className="w-full p-2 rounded bg-gray-800 border border-gray-600 focus:outline-none"
              required
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded"
          >
            Sign In
          </button>
        </form>
        <div className="mt-4 text-center">
          <a href="/auth/forgot" className="text-blue-400 hover:underline text-sm">
            Forgot your password?
          </a>
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  return {
    props: {
      csrfToken: await getCsrfToken(context),
    },
  };
}

