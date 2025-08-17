// /components/dial/DialHistory.tsx
import { useEffect, useRef } from "react";

export type TimelineEvent =
  | { type: "sms"; id: string; dir: "inbound" | "outbound" | "ai"; text: string; date: string; sid?: string; status?: string }
  | { type: "call"; id: string; date: string; durationSec?: number; status?: string; recordingUrl?: string; summary?: string; sentiment?: string }
  | { type: "booking"; id: string; date: string; title?: string; startsAt?: string; endsAt?: string; calendarId?: string }
  | { type: "note"; id: string; date: string; text: string }
  | { type: "status"; id: string; date: string; from?: string; to?: string };

export default function DialHistory({
  events,
  onLoadMore,
  hasMore,
  loading,
}: {
  events: TimelineEvent[];
  onLoadMore?: () => void;
  hasMore?: boolean;
  loading?: boolean;
}) {
  const topRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll (fetch older as you reach bottom)
  useEffect(() => {
    if (!onLoadMore) return;
    const el = topRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
        onLoadMore();
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [onLoadMore]);

  return (
    <div ref={topRef} className="h-[70vh] overflow-auto border rounded p-2 bg-white dark:bg-zinc-900">
      {events.length === 0 && !loading && (
        <div className="text-sm text-gray-500">No history yet.</div>
      )}

      {events.map((ev) => {
        const ts = new Date(ev.date).toLocaleString();
        if (ev.type === "sms") {
          const badge =
            ev.dir === "inbound" ? "bg-blue-100 text-blue-800" :
            ev.dir === "outbound" ? "bg-emerald-100 text-emerald-800" :
            "bg-purple-100 text-purple-800";
          const label =
            ev.dir === "inbound" ? "SMS In" :
            ev.dir === "outbound" ? "SMS Out" : "AI Msg";
          return (
            <div key={ev.id} className="border-b py-2">
              <div className="flex items-center justify-between">
                <span className={`text-xs px-2 py-0.5 rounded ${badge}`}>{label}</span>
                <span className="text-xs text-gray-500">{ts}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap">{ev.text || "—"}</div>
              {ev.status && <div className="text-xs text-gray-500 mt-1">Status: {ev.status}</div>}
            </div>
          );
        }

        if (ev.type === "call") {
          return (
            <div key={ev.id} className="border-b py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">Call</span>
                <span className="text-xs text-gray-500">{ts}</span>
              </div>
              <div className="mt-1 text-sm">
                {ev.status ? `Status: ${ev.status}` : ""}
                {ev.durationSec != null ? ` • ${ev.durationSec}s` : ""}
              </div>
              {ev.summary && (
                <div className="mt-1 text-sm whitespace-pre-wrap">
                  <span className="font-semibold">Summary: </span>{ev.summary}
                </div>
              )}
              {ev.sentiment && (
                <div className="text-xs text-gray-500 mt-1">Sentiment: {ev.sentiment}</div>
              )}
              {ev.recordingUrl && (
                <audio className="mt-2 w-full" controls src={ev.recordingUrl}></audio>
              )}
            </div>
          );
        }

        if (ev.type === "booking") {
          return (
            <div key={ev.id} className="border-b py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">Booking</span>
                <span className="text-xs text-gray-500">{ts}</span>
              </div>
              <div className="mt-1 text-sm">{ev.title || "Booked Appointment"}</div>
              {ev.startsAt && (
                <div className="text-xs text-gray-600">
                  {new Date(ev.startsAt).toLocaleString()}
                  {ev.endsAt ? ` → ${new Date(ev.endsAt).toLocaleString()}` : ""}
                </div>
              )}
            </div>
          );
        }

        if (ev.type === "note") {
          return (
            <div key={ev.id} className="border-b py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-800">Note</span>
                <span className="text-xs text-gray-500">{ts}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap">{ev.text || "—"}</div>
            </div>
          );
        }

        // status
        return (
          <div key={ev.id} className="border-b py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-800">Status</span>
              <span className="text-xs text-gray-500">{ts}</span>
            </div>
            <div className="mt-1 text-sm">
              {ev.from ? `${ev.from} → ` : ""}
              <span className="font-semibold">{(ev as any).to || "New"}</span>
            </div>
          </div>
        );
      })}

      {loading && <div className="py-2 text-sm text-gray-500">Loading…</div>}
      {hasMore && !loading && (
        <div className="py-2 text-center text-sm text-gray-500">Scroll to load more…</div>
      )}
    </div>
  );
}
