// components/CallsList.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { getSocket } from "@/lib/socketClient";

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
  isVoicemail?: boolean;
  hasRecording?: boolean;
  recordingUrl?: string;
  hasAI?: boolean;
  aiSummary?: string;
  aiSentiment?: "positive" | "neutral" | "negative";
  lead?: {
    id: string;
    name?: string;
    phone?: string;
    email?: string;
  };
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
function dirPill(kind?: "inbound" | "outbound") {
  if (!kind) return null;
  const cls =
    kind === "inbound"
      ? "bg-emerald-900/40 text-emerald-300 border border-emerald-700/40"
      : "bg-sky-900/40 text-sky-300 border border-sky-700/40";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cls}`}>
      {kind === "inbound" ? "Inbound" : "Outbound"}
    </span>
  );
}
function vmPill(v?: boolean) {
  if (!v) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/40">
      Voicemail
    </span>
  );
}

export default function CallsList({
  onSelect,
  selectedId,
  pageSize = 50,
}: {
  onSelect: (id: string) => void;
  selectedId?: string | null;
  pageSize?: number;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (pageNum = 1) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/calls/list?page=${pageNum}&pageSize=${pageSize}&includeLead=1`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (r.ok) {
        setRows(j.rows || []);
        setTotal(j.total || 0);
        setPage(j.page || pageNum);
      } else {
        setError(j?.message || "Failed to load calls");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => { load(1); }, [load]);

  // Auto-select first row if nothing selected
  useEffect(() => {
    if (!selectedId && rows.length > 0) {
      onSelect(rows[0].id);
    }
  }, [rows, selectedId, onSelect]);

  const totalPages = useMemo(() => {
    if (!pageSize) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total, pageSize]);

  // 🔔 Live refresh when server emits call events
  useEffect(() => {
    const s = getSocket();
    if (!s) return;

    const refresh = () => load(page);
    s.on("call:status", refresh);
    s.on("call:updated", refresh);
    s.on("call:amd", refresh);

    return () => {
      s.off("call:status", refresh);
      s.off("call:updated", refresh);
      s.off("call:amd", refresh);
    };
  }, [load, page]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-300">Recent Calls</div>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-xs"
            onClick={() => load(page)}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg border border-white/10 divide-y divide-white/5 bg-[#0b1220]">
        {error ? (
          <div className="p-3 text-sm text-rose-300">{error}</div>
        ) : rows.length === 0 && !loading ? (
          <div className="p-3 text-sm text-gray-300">No calls yet.</div>
        ) : (
          rows.map((r) => {
            const isSel = r.id === selectedId;
            return (
              <button
                key={r.id}
                className={`w-full text-left p-3 transition ${
                  isSel ? "bg-white/10" : "hover:bg-white/5"
                }`}
                onClick={() => onSelect(r.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-medium">
                        {r.lead?.name || r.lead?.phone || r.callSid}
                      </div>
                      {dirPill(r.direction)}
                      {vmPill(r.isVoicemail)}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      {fmtTime(r.startedAt)}
                      {r.duration !== undefined ? (
                        <>
                          <span className="mx-1.5 text-gray-600">•</span>
                          Duration {fmtSecs(r.duration)}
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex-none text-xs text-gray-300 flex items-center gap-2">
                    {r.hasRecording ? <span title="Recording available">🎙</span> : null}
                    {r.hasAI ? <span title="AI summary ready">✨</span> : null}
                  </div>
                </div>
                {r.hasAI && r.aiSummary ? (
                  <div className="mt-1 text-xs text-gray-400 line-clamp-2">
                    {r.aiSummary}
                  </div>
                ) : null}
              </button>
            );
          })
        )}
        {loading ? <div className="p-3 text-xs text-gray-400">Loading…</div> : null}
      </div>

      {/* Pagination (simple) */}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-300">
        <div>
          Page {page} of {totalPages} • {total} total
        </div>
        <div className="flex items-center gap-1">
          <button
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => load(page - 1)}
          >
            Prev
          </button>
          <button
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => load(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
