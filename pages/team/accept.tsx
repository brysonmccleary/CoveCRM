// pages/team/accept.tsx
// Invite acceptance page — user lands here from email link
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";

export default function TeamAcceptPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [result, setResult] = useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  useEffect(() => {
    const { token, owner } = router.query as { token?: string; owner?: string };
    if (!token || !owner) return;
    setOwnerEmail(decodeURIComponent(owner || ""));

    if (status === "loading") return;

    if (!session?.user?.email) {
      // Not logged in — prompt sign-in then return
      signIn(undefined, { callbackUrl: window.location.href });
      return;
    }

    const accept = async () => {
      try {
        const res = await fetch("/api/team/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            ownerEmail: decodeURIComponent(owner || ""),
            acceptorEmail: session.user!.email,
            acceptorName: session.user!.name || session.user!.email,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult("success");
          setMessage("You joined the team successfully.");
        } else {
          setResult("error");
          setMessage(data.error || "Failed to accept invite.");
        }
      } catch {
        setResult("error");
        setMessage("Something went wrong.");
      }
    };

    accept();
  }, [router.query, session, status]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1e293b] text-white">
      <div className="bg-[#0f172a] rounded-xl p-8 max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold">Team Invite</h1>

        {result === "pending" && (
          <p className="text-gray-400">Processing your invite...</p>
        )}

        {result === "success" && (
          <>
            <div className="text-5xl">🎉</div>
            <p className="text-green-400 text-lg font-semibold">{message}</p>
            <p className="text-gray-400 text-sm">You joined {ownerEmail}'s team successfully. You can continue in your dashboard now.</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg"
            >
              Go to Dashboard
            </button>
          </>
        )}

        {result === "error" && (
          <>
            <div className="text-5xl">⚠️</div>
            <p className="text-red-400 text-lg font-semibold">{message}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg"
            >
              Go to Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
}
