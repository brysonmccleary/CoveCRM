import { useEffect, useMemo, useState, useCallback } from "react";
import { getSocket } from "@/lib/socketClient";

type Call = {
  id?: string;
  _id?: string;
  callSid: string;
  userEmail: string;
  leadId?: string;
  direction?: "inbound" | "outbound";
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  talkTime?: number;
  hasRecording?: boolean;
  recordingUrl?: string;
  hasAI?: boolean;
  aiSummary?: string;
  aiActionItems?: string[];
  aiBullets?: string[];
  aiScore?: number;
  aiSentiment?: "positive" | "neutral" | "negative";
  lead?: { id: string; name?: string; phone?: string; email?: string; };
};

function fmtTime(d?: string | Date) {
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

export default function CallDetailCard({
  callId, callSid, userHasAI, onOpenLead, defaultFromNumber,
}: {
  callId?: string; callSid?: string; userHasAI?: boolean;
  onOpenLead?: (leadId: string) => void; defaultFromNumber?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [call, setCall] = useState<Call | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idOrSid = callId ? `id=${encodeURIComponent(callId)}` : `callSid=${encodeURIComponent(callSid || "")}`;

  const canShowAI = userHasAI && (call?.aiSummary || (call?.aiBullets?.length || 0) > 0 || (call?.aiActionItems?.length || 0) > 0);
  const leadName = call?.lead?.name || "Unknown Lead";
  const leadPhone = call?.lead?.phone || "";

  const load = useCallback(async () => {
    if (!callId && !callSid) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/calls/get?${idOrSid}&includeLead=1`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && j?.call) {
        const c = j.call as Call;
        c.id = c.id || (c as any)._id || undefined;
        setCall(c);
      } else setError(j?.message || "Failed to load call");
    } catch (e: any) { setError(e?.message || "Failed to load call"); }
    finally { setLoading(false); }
  }, [callId, callSid, idOrSid]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const s = getSocket(); if (!s) return;
    const match = (p: any) => {
      const pid = p?.id || p?._id; const psid = p?.callSid;
      if (callId && pid && String(pid) === String(callId)) return true;
      if (callSid && psid && String(psid) === String(callSid)) return true;
      return false;
    };
    const onAny = (p: any) => { if (match(p)) load(); };
    s.on("call:updated", onAny); s.on("call:status", onAny); s.on("call:amd", onAny);
    return () => { s.off("call:updated", onAny); s.off("call:status", onAny); s.off("call:amd", onAny); };
  }, [callId, callSid, load]);

  async function callBack() {
    try {
      if (!call?.lead?.id) return alert("No lead attached to this call.");
      const res = await fetch("/api/twilio/voice/call", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: call.lead.id, fromNumber: defaultFromNumber || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to start callback.");
      }
      alert("Calling the lead now…");
    } catch (e: any) { alert(e?.message || "Failed to start callback."); }
  }

  async function upgradeAI() {
    try {
      const r = await fetch("/api/billing/create-ai-checkout", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j?.url) throw new Error(j?.error || "Failed to start checkout");
      window.location.href = j.url;
    } catch (e: any) {
      alert(e?.message || "Unable to start checkout");
    }
  }

  const sentimentLabel = useMemo(() => call?.aiSentiment || "neutral", [call?.aiSentiment]);
  const bullets = useMemo(() => Array.isArray(call?.aiBullets) ? call!.aiBullets! : [], [call?.aiBullets]);
  const actionItems = useMemo(() => Array.isArray(call?.aiActionItems) ? call!.aiActionItems! : [], [call?.aiActionItems]);

  return (
    <div className="bg-[#0b1220] border border-white/10 rounded-xl p-4 text-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-300">Call Detail</div>
          <div className="text-base md:text-lg font-semibold truncate">
            {leadName}{leadPhone ? (<span className="text-gray-400 font-normal"> • {leadPhone}</span>) : null}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            {call?.direction ? (
              <span className={`px-2 py-0.5 rounded-full ${badgeClass(call.direction)}`}>
                {call.direction === "inbound" ? "Inbound" : "Outbound"}
              </span>
            ) : null}
            <span className="text-gray-400">Started</span><span>{fmtTime(call?.startedAt)}</span>
            <span className="text-gray-500">•</span>
            <span className="text-gray-400">Completed</span><span>{fmtTime(call?.completedAt)}</span>
            {typeof call?.aiScore === "number" ? (
              <>
                <span className="text-gray-500">•</span>
                <span className="text-gray-400">Score</span>
                <span className="font-semibold">{call.aiScore}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex-none flex items-center gap-2">
          {call?.lead?.id ? (
            <button className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs"
              onClick={() => (onOpenLead ? onOpenLead(call.lead!.id) : window.location.assign(`/leads/${call.lead!.id}`))}
            >
              Open Lead
            </button>
          ) : null}
          <button className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-xs" onClick={callBack}>
            Call Back
          </button>
          <button className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-gray-400">Duration</div><div className="font-semibold">{fmtSecs(call?.duration)}</div></div>
        <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-gray-400">Talk Time</div><div className="font-semibold">{fmtSecs(call?.talkTime)}</div></div>
        <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-gray-400">Recording</div><div className="font-semibold">{call?.recordingUrl ? "Available" : "—"}</div></div>
        <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-gray-400">AI</div><div className="font-semibold">{canShowAI ? "Ready" : userHasAI ? "Pending" : "Disabled"}</div></div>
      </div>

      {call?.recordingUrl ? (
        <div className="mt-3">
          <div className="text-sm text-gray-300 mb-1">Recording</div>
          <audio controls preload="none" src={call.recordingUrl} className="w-full" />
        </div>
      ) : null}

      {/* AI Overview */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">AI Overview</div>
          <div className={`text-xs ${sentimentClass(sentimentLabel)}`}>Sentiment: {sentimentLabel}</div>
        </div>

        {canShowAI ? (
          <>
            {bullets.length > 0 ? (
              <div className="mt-2">
                <div className="text-sm text-gray-300 font-medium mb-1">Key Points</div>
                <ul className="list-disc ml-5 text-sm space-y-1">
                  {bullets.map((b, i) => (<li key={i}>{b}</li>))}
                </ul>
              </div>
            ) : null}

            {call?.aiSummary ? (
              <div className="mt-3 text-sm text-gray-200 whitespace-pre-line">
                {call.aiSummary}
              </div>
            ) : null}

            {actionItems.length > 0 ? (
              <div className="mt-3">
                <div className="text-sm text-gray-300 font-medium mb-1">Action Items</div>
                <ul className="list-disc ml-5 text-sm space-y-1">
                  {actionItems.map((it, i) => (<li key={i}>{it}</li>))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-2 text-sm text-gray-400 flex items-center justify-between">
            <span>Upgrade to enable AI call summaries.</span>
            <button
              onClick={upgradeAI}
              className="ml-3 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs"
            >
              Enable AI
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
