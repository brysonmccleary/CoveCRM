// components/CallPanelClose.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import CallRowClose from "./CallRowClose";

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

  // ✅ optional Close-style overview on Call (for future UI usage)
  aiOverviewReady?: boolean;
  aiOverview?: any;
};

export default function CallPanelClose({
  leadId,
  userHasAI,
  defaultFromNumber,
  onOpenCall, // optional navigation override
}: {
  leadId: string;
  userHasAI: boolean;
  defaultFromNumber?: string;
  onOpenCall?: (callId: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/calls/by-lead?leadId=${encodeURIComponent(
          leadId
        )}&page=${page}&pageSize=${pageSize}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Failed to load calls.");

      const rawRows: Row[] = Array.isArray(j?.rows) ? j.rows : [];

      // ✅ IMPORTANT: Browser playback of Twilio RecordingUrl will often be 00:00 due to auth/CORS.
      // Route playback through our server-side proxy endpoint (per-tenant safe).
      // We do NOT change call creation or AI dialer audio streaming — this only affects playback UI.
      const normalized: Row[] = rawRows.map((row) => {
        const hasRec = !!row?.recordingUrl || !!row?.hasRecording;
        const proxyUrl = row?.id
          ? `/api/recordings/proxy?callId=${encodeURIComponent(row.id)}`
          : row?.callSid
          ? `/api/recordings/proxy?callSid=${encodeURIComponent(row.callSid)}`
          : "";

        return {
          ...row,
          hasRecording: hasRec,
          // If a recording exists, always use the proxy for playback
          ...(hasRec && proxyUrl ? { recordingUrl: proxyUrl } : {}),
        };
      });

      setRows(normalized);
      setTotal(j.total || 0);
    } catch (e: any) {
      setError(e?.message || "Failed to load calls.");
    } finally {
      setLoading(false);
    }
  }, [leadId, page]);

  useEffect(() => {
    load();
  }, [load]);

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total]
  );

  return (
    <div className="bg-[#0b1220] border border-white/10 rounded-xl">
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-400">Activity</div>
          <div className="text-base font-semibold text-white">Calls</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            disabled={loading}
            className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-xs text-white"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <div className="text-xs text-gray-400">
            Page {page} / {pageCount}
          </div>
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Prev
            </button>
            <button
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="p-4 text-sm text-rose-300">{error}</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-sm text-gray-300">
          No calls yet for this lead.
        </div>
      ) : (
        <ul className="divide-y divide-white/10">
          {rows.map((row) => (
            <li key={row.id} className="px-3 py-2">
              <CallRowClose
                row={row}
                userHasAI={userHasAI}
                defaultFromNumber={defaultFromNumber}
                onOpenCall={onOpenCall}
                onRefresh={load}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
