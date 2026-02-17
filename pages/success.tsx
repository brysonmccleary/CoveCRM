import { useEffect } from "react";
import { useRouter } from "next/router";
import toast from "react-hot-toast";

export default function Success() {
  const router = useRouter();
  const { email } = router.query;

  useEffect(() => {
    if (email) {
      toast.success("🎉 Payment successful! You now have full access.");
    }
  }, [email]);

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white rounded shadow text-center">
      <h1 className="text-2xl font-bold mb-4">Success!</h1>
      <p className="mb-4">
        Thank you for subscribing to <strong>Cove CRM</strong>. Your account is
        now active.
      </p>
      <button
        onClick={() => router.push("/dashboard")}
        className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        Go to Dashboard
      </button>
    </div>
  );
}
