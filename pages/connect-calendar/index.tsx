import { useState } from "react";

export default function ConnectCalendar() {
  const [loading, setLoading] = useState(false);

  const start = async () => {
    try {
      setLoading(true);
      const r = await fetch("/api/google-auth/start");
      const j = await r.json();
      if (!r.ok || !j?.url) throw new Error("Failed to get auth URL");
      window.location.href = j.url;
    } catch (e: any) {
      alert(e?.message || "Failed to start Google auth");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white px-4">
      <div className="bg-slate-800 p-6 rounded shadow-lg max-w-md w-full text-center">
        <h1 className="text-2xl font-bold mb-4">🔗 Connect Your Google Calendar</h1>
        <p className="mb-6">
          We need access to your calendar to let others book appointments with you.
        </p>
        <button
          onClick={start}
          disabled={loading}
          className="inline-block bg-blue-600 hover:bg-blue-700 px-6 py-3 text-white rounded font-semibold transition disabled:opacity-60"
        >
          {loading ? "Starting…" : "Connect with Google"}
        </button>
      </div>
    </div>
  );
}
