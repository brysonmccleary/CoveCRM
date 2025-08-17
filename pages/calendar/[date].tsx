// /pages/calendar/[date].tsx
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DayEvent = {
  id: string;
  summary: string;
  start: string; // ISO
  end: string;   // ISO
  description?: string;
  location?: string;
  colorId?: string | null;
};

function startEndOfLocalDayISO(dateStr: string) {
  // Interpret dateStr (YYYY-MM-DD) in the *browser's* local zone, then convert to UTC ISO.
  const [y, m, d] = dateStr.split("-").map((n) => parseInt(n, 10));
  const startLocal = new Date(y, (m - 1), d, 0, 0, 0, 0);
  const endLocal = new Date(y, (m - 1), d, 23, 59, 59, 999);
  return { startISO: startLocal.toISOString(), endISO: endLocal.toISOString() };
}

export default function DayViewPage() {
  const router = useRouter();
  const { date } = router.query as { date?: string };
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const { startISO, endISO } = useMemo(() => {
    const safe = (date || "").match(/^\d{4}-\d{2}-\d{2}$/) ? date! : new Date().toISOString().slice(0, 10);
    return startEndOfLocalDayISO(safe);
  }, [date]);

  useEffect(() => {
    async function run() {
      try {
        setLoading(true);
        const res = await fetch(`/api/calendar/events?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load events");
        setEvents((data.events || []).map((e: any) => ({
          id: e.id,
          summary: e.summary || "",
          start: e.start,
          end: e.end,
          description: e.description || "",
          location: e.location || "",
          colorId: e.colorId || null,
        })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    if (date) run();
  }, [date, startISO, endISO]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="min-h-screen bg-[#0b0f19] text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Appointments for {date}</h1>
          <Link href="/calendar">
            <span className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600 cursor-pointer">Back to Calendar</span>
          </Link>
        </div>

        {loading ? (
          <p className="opacity-80">Loading...</p>
        ) : events.length === 0 ? (
          <div className="opacity-70">No appointments for this day.</div>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="bg-[#121826] rounded p-4 border border-slate-700">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">{e.summary || "Untitled"}</div>
                  <div className="text-sm opacity-80">{fmt(e.start)} — {fmt(e.end)}</div>
                </div>
                {e.location && <div className="text-sm mt-1 opacity-80">📍 {e.location}</div>}
                {e.description && <div className="text-sm mt-2 opacity-90">{e.description}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
