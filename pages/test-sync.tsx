import { useState } from "react";
import axios from "axios";

export default function TestSyncPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSync = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await axios.post("/api/numbers/sync");
      setResult(res.data);
    } catch (err: any) {
      console.error("Sync failed", err);
      setError(err?.response?.data?.message || "Sync failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Test Number Sync</h1>
      <button
        onClick={runSync}
        disabled={loading}
        style={{
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: "#2563eb",
          color: "white",
          cursor: "pointer",
        }}
      >
        {loading ? "Syncing..." : "Run Sync"}
      </button>

      {error && (
        <pre
          style={{
            marginTop: 16,
            background: "#fee2e2",
            color: "#991b1b",
            padding: 12,
            borderRadius: 8,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
      )}

      {result && (
        <pre
          style={{
            marginTop: 16,
            background: "#111827",
            color: "#e5e7eb",
            padding: 12,
            borderRadius: 8,
            overflowX: "auto",
            maxWidth: 900,
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
