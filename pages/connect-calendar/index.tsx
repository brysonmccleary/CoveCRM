import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { getAuthUrl } from "@/lib/googleOAuth";

export default function ConnectCalendarPage() {
  const router = useRouter();
  const raw = router.query.email;
  const email = Array.isArray(raw) ? raw.join("/") : raw || "";

  const [authUrl, setAuthUrl] = useState("");

  useEffect(() => {
    if (!email) return;
    setAuthUrl(getAuthUrl());
  }, [email]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white px-4">
      <div className="bg-slate-800 p-6 rounded shadow-lg max-w-md w-full text-center">
        <h1 className="text-2xl font-bold mb-4">
          🔗 Connect Your Google Calendar
        </h1>
        <p className="mb-6">
          We need access to your calendar to let others book appointments with
          you.
        </p>

        <a
          href={authUrl}
          className="inline-block bg-blue-600 hover:bg-blue-700 px-6 py-3 text-white rounded font-semibold transition"
        >
          Connect with Google
        </a>

        <p className="text-sm mt-6 text-gray-400">
          You're connecting calendar access for: <br />
          <span className="font-mono">{email || "unknown user"}</span>
        </p>
      </div>
    </div>
  );
}
