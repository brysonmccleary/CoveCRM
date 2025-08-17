// /components/CallRowClose.tsx
import { useMemo, useState } from "react";

type Row = {
  id: string;
  callSid: string;
  userEmail: string;
  leadId?: string;
  direction?: "inbound" | "outbound";
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  talkTime?: number;
  recordingUrl?: string;
  hasRecording?: boolean;
  aiSummary?: string;
  aiActionItems?: string[];
  aiSentiment?: "positive" | "neutral" | "negative";
  hasAI?: boolean;
};

function fmtDateTime(d?: string | Date) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}
function fmtSecs(n?: number) {
  if (!n && n !== 0) return "—";
  const s = Math.max(0, Math.floor(n));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
function badgeClass(kind: "inbound" | "outbound") {
  return kind === "inbound"
    ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40"
    : "bg-sky-900/40 text-sky-300 border border-sky-700/40";
}
function sentimentClass(s?: "positive" | "neutral" | "negative") {
  if (s === "positive") return "text-emerald-400";
  if (s === "negative") return "text-rose-400";
  return "text-gray-300";
}

export default function CallRowClose({
  row,
  userHasAI,
  defaultFromNumber,
  onOpenCall,
  onRefresh,
}: {
  row: Row;
  userHasAI: boolean;
  defaultFromNumber?: string;
  onOpenCall?: (callId: string) => void;
  onRefresh?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [calling, setCalling] = useState(false);

  const sentiment = row.aiSentiment || "neutral";
  const aiSnippet = useMemo(() => {
    if (!row.aiSummary) return null;
    const first = row.aiSummary.split("\n").slice(0, 4).join("\n").trim();
    return first.length > 400 ? `${first.slice(0, 400)}…` : first;
  }, [row.aiSummary]);

  async function callBack() {
    if (!row.leadId) return alert("No lead attached.");
    setCalling(true);
    try {
      const res = await fetch("/api/twilio/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: row.leadId,
          fromNumber: defaultFromNumber || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to call back.");
      }
      alert("Calling lead now…");
    } catch (e: any) {
      alert(e?.message || "Failed to call back.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <div className="rounded-lg">
      {/* Header line (Close-style) */}
      <div className="flex items-center gap-3">
        {row.direction ? (
          <span className={`px-2 py-0.5 rounded-full text-xs ${badgeClass(row.direction)}`}>
            {row.direction === "inbound" ? "Inbound" : "Outbound"}
          </span>
        ) : null}

        <div className="text-sm text-white">
          {fmtDateTime(row.startedAt)}
          <span className="text-gray-500"> • </span>
          <span className="text-gray-300">
            Duration: <span className="text-white">{fmtSecs(row.duration)}</span>
          </span>
          <span className="text-gray-500"> • </span>
          <span className="text-gray-300">
            Talk: <span className="text-white">{fmtSecs(row.talkTime)}</span>
          </span>
          {row.hasRecording ? (
            <>
              <span className="text-gray-500"> • </span>
              <span className="text-emerald-300">Recording</span>
            </>
          ) : null}
          {row.hasAI ? (
            <>
              <span className="text-gray-500"> • </span>
              <span className="text-indigo-300">AI</span>
            </>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "View"}
          </button>
          <button
            className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-xs text-white disabled:opacity-60"
            onClick={callBack}
            disabled={calling}
          >
            {calling ? "Calling…" : "Call Back"}
          </button>
          <button
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white"
            onClick={() => (onOpenCall ? onOpenCall(row.id) : window.open(`/calls/${row.id}`, "_blank"))}
          >
            Open
          </button>
          <button
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs text-white"
            onClick={() => onRefresh && onRefresh()}
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {open ? (
        <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          {/* Recording player */}
          {row.recordingUrl ? (
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Recording</div>
              <audio controls preload="none" src={row.recordingUrl} className="w-full" />
            </div>
          ) : (
            <div className="text-xs text-gray-500 mb-2">No recording available.</div>
          )}

          {/* AI Overview */}
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold text-white">AI Overview</div>
            <div className={`text-xs ${sentimentClass(sentiment)}`}>Sentiment: {sentiment}</div>
          </div>

          {userHasAI ? (
            row.aiSummary ? (
              <>
                <div className="text-sm text-gray-200 whitespace-pre-line">{aiSnippet}</div>
                {Array.isArray(row.aiActionItems) && row.aiActionItems.length > 0 ? (
                  <div className="mt-3">
                    <div className="text-sm text-gray-300 font-medium mb-1">Action Items</div>
                    <ul className="list-disc ml-5 text-sm space-y-1">
                      {row.aiActionItems.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-gray-400">AI summary not available yet.</div>
            )
          ) : (
            <div className="text-sm text-gray-400">Upgrade to enable AI call summaries.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
