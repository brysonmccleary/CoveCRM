// /components/CallSummary.tsx
import { useEffect, useMemo, useState } from "react";

type CallShape = {
  _id?: string;
  callSid?: string;
  recordingUrl?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiSentiment?: "positive" | "neutral" | "negative";
};

export default function CallSummary({
  call,
  lead,            // kept for backward-compat: will read aiSummary if provided
  callId,          // optional: if provided, we can refetch
  userHasAI,       // gate the AI panel
}: {
  call?: CallShape | null;
  lead?: any;
  callId?: string;
  userHasAI?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [currentCall, setCurrentCall] = useState<CallShape | null>(call || null);

  const aiAvailable = useMemo(() => {
    const c = currentCall || {};
    return Boolean(userHasAI && (c.aiSummary || (lead && lead.aiSummary)));
  }, [currentCall, userHasAI, lead]);

  useEffect(() => {
    if (call) setCurrentCall(call);
  }, [call]);

  async function refresh() {
    if (!callId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/calls/get?id=${encodeURIComponent(callId)}`, { cache: "no-store" });
      const json = await r.json();
      if (json?.call) setCurrentCall(json.call);
    } finally {
      setLoading(false);
    }
  }

  const sentiment = currentCall?.aiSentiment || "neutral";
  const actionItems = currentCall?.aiActionItems || [];

  return (
    <div className="bg-[#0f172a] p-4 border rounded text-white">
      {/* Audio */}
      {currentCall?.recordingUrl ? (
        <div className="mb-4">
          <div className="text-sm text-gray-300 mb-1">Call Recording</div>
          <audio controls preload="none" src={currentCall.recordingUrl} className="w-full" />
        </div>
      ) : null}

      {/* AI Overview */}
      {aiAvailable ? (
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold mb-2">AI Overview</h3>
            {callId ? (
              <button
                onClick={refresh}
                disabled={loading}
                className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-sm"
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            ) : null}
          </div>

          <div className="text-sm text-gray-200 whitespace-pre-line mb-3">
            {currentCall?.aiSummary || lead?.aiSummary}
          </div>

          {actionItems.length > 0 ? (
            <div className="mb-3">
              <div className="text-sm font-semibold text-gray-300">Action Items</div>
              <ul className="list-disc ml-5 space-y-1 text-sm">
                {actionItems.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="text-xs text-gray-400">
            Sentiment:{" "}
            <span
              className={
                sentiment === "positive"
                  ? "text-green-400"
                  : sentiment === "negative"
                  ? "text-red-400"
                  : "text-gray-300"
              }
            >
              {sentiment}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-gray-400">
          {userHasAI ? "AI summary not available yet." : "Upgrade to enable AI call summaries."}
        </div>
      )}
    </div>
  );
}
