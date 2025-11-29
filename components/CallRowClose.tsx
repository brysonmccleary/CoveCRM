// /components/CallRowClose.tsx
import { useMemo } from "react";

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

export default function CallRowClose({
  row,
}: {
  row: Row;
  userHasAI: boolean;
  defaultFromNumber?: string;
  onOpenCall?: (callId: string) => void;
  onRefresh?: () => void;
}) {
  const hasRecording = !!row.recordingUrl || row.hasRecording;
  const durationLabel = useMemo(() => fmtSecs(row.duration), [row.duration]);
  const talkTimeLabel = useMemo(() => fmtSecs(row.talkTime), [row.talkTime]);

  return (
    <div className="rounded-lg">
      {/* Header line */}
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
            Duration: <span className="text-white">{durationLabel}</span>
          </span>
          <span className="text-gray-500"> • </span>
          <span className="text-gray-300">
            Talk: <span className="text-white">{talkTimeLabel}</span>
          </span>
          {hasRecording ? (
            <>
              <span className="text-gray-500"> • </span>
              <span className="text-emerald-300">Recording available</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Recording section */}
      <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        {row.recordingUrl ? (
          <div>
            <div className="text-xs text-gray-400 mb-1">Recording</div>
            <audio
              controls
              preload="none"
              src={row.recordingUrl}
              className="w-full"
            />
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            No recording available for this call.
          </div>
        )}
      </div>
    </div>
  );
}
