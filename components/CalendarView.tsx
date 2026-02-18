// /components/CalendarView.tsx
import { useEffect, useRef, useState } from "react";
import { Calendar, Views, View, DateLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { localizer } from "@/lib/localizer";
import Modal from "react-modal";
import axios from "axios";
import ConnectGoogleCalendarButton from "@/components/calendar/ConnectGoogleCalendarButton";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";

type EventType = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  colorId?: string;
  source?: "crm" | "manual" | "unknown";
};

type LeadType = {
  _id: string;
  "First Name"?: string;
  "Last Name"?: string;
  Email?: string;
  Phone?: string;
  Notes?: string;
  Age?: string;
};

if (typeof window !== "undefined") {
  Modal.setAppElement("#__next");
}

const googleColorMap: Record<string, string> = {
  "1": "#a4bdfc",
  "2": "#7ae7bf",
  "3": "#dbadff",
  "4": "#ff887c",
  "5": "#fbd75b",
  "6": "#ffb878",
  "7": "#46d6db",
  "8": "#e1e1e1",
  "9": "#5484ed",
  "10": "#51b749",
  "11": "#dc2127",
};

const toISO = (d: Date) => new Date(d.getTime()).toISOString();

function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}
function endOfWeek(d: Date) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function monthVisibleRange(date: Date) {
  const mStart = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  const mEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start: startOfWeek(mStart), end: endOfWeek(mEnd) };
}
function weekVisibleRange(date: Date) {
  return { start: startOfWeek(date), end: endOfWeek(date) };
}
function dayVisibleRange(date: Date) {
  const s = new Date(date);
  s.setHours(0, 0, 0, 0);
  const e = new Date(date);
  e.setHours(23, 59, 59, 999);
  return { start: s, end: e };
}

/* helpers for phone extraction */
function onlyDigits10(raw?: string) {
  const d = String(raw || "").replace(/\D+/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}
function extractPhoneFromEvent(e: { title?: string; description?: string; location?: string }) {
  const hay = [e.description, e.location, e.title].filter(Boolean).join(" ");
  if (!hay) return "";
  const match = hay.match(
    /(\+?1?[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d[^0-9]*\d)/
  );
  return onlyDigits10(match?.[1]);
}


function sanitizeEventText(input?: string) {
  if (!input) return "";
  const raw = String(input);

  // Block dialer/call logs and any internal debug dumps from ever showing in the calendar modal.
  const looksLikeLogs =
    /callsid=|durations?ec=|ai dialer fallback|twilio status=|outcome=disconnected|twilio status=completed|\[ai dialer/i.test(raw);

  if (looksLikeLogs) return "";

  // Normalize + cap
  const cleaned = raw.replace(/\r?\n/g, "\n").trim();

  // Keep it readable but never "dump": limit lines + line length
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);

  const MAX_LINES = 6;
  const MAX_LINE_LEN = 140;
  const MAX_TOTAL = 420;

  const sliced = lines.slice(0, MAX_LINES).map((l) => (l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) + "…" : l));
  let out = sliced.join("\n");
  if (out.length > MAX_TOTAL) out = out.slice(0, MAX_TOTAL) + "…";
  return out;
}


export default function CalendarView() {
  const router = useRouter();
  const { data: session } = useSession();

  const [events, setEvents] = useState<EventType[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<LeadType | null>(null);

  // Persistent view/date
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return Views.MONTH;
    return (localStorage.getItem("calendar:view") as View) || Views.MONTH;
  });
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    if (typeof window === "undefined") return new Date();
    const saved = localStorage.getItem("calendar:date");
    return saved ? new Date(saved) : new Date();
  });

  // Visible range + debounced fetch
  const rangeRef = useRef<{ start?: Date; end?: Date }>({});
  const fetchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1) Is calendar connected?
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get("/api/calendar-status");
        setCalendarConnected(!!res.data.calendarConnected);
      } catch {
        setCalendarConnected(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const computeRange = (v: View, d: Date) => {
    switch (v) {
      case Views.WEEK:
        return weekVisibleRange(d);
      case Views.DAY:
        return dayVisibleRange(d);
      case Views.MONTH:
      default:
        return monthVisibleRange(d);
    }
  };

  // 2) Fetch events for visible range
  const fetchRange = async (start?: Date, end?: Date) => {
    if (!start || !end) return;
    try {
      const url = `/api/calendar/events?start=${encodeURIComponent(toISO(start))}&end=${encodeURIComponent(
        toISO(end)
      )}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load events");

      const parsed: EventType[] = (data.events || []).map((e: any) => ({
        id: e.id,
        title: e.summary || "",
        start: new Date(e.start),
        end: new Date(e.end),
        description: e.description,
        location: e.location,
        colorId: e.colorId || undefined,
      }));

      // Tag CRM events by eventId
      const ids = parsed.map((e) => e.id);
      const matchRes = await fetch("/api/leads/by-event-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds: ids }),
      });
      const { matchedIds = [] } = await matchRes.json();

      setEvents(parsed.map((e) => ({ ...e, source: matchedIds.includes(e.id) ? "crm" : "manual" })));
    } catch (err) {
      console.error("❌ Failed to load events", err);
    }
  };

  const scheduleFetch = () => {
    if (!calendarConnected) return;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchRange(rangeRef.current.start, rangeRef.current.end);
    }, 120);
  };

  // RBC callbacks
  const handleRangeChange = (range: Date[] | { start: Date; end: Date }) => {
    if (Array.isArray(range)) {
      const min = new Date(Math.min(...range.map((d) => +d)));
      const max = new Date(Math.max(...range.map((d) => +d)));
      rangeRef.current = { start: min, end: max };
    } else if (range?.start && range?.end) {
      rangeRef.current = { start: range.start, end: range.end };
    }
    scheduleFetch();
  };

  const handleNavigate = (date: Date) => {
    setCurrentDate(date);
    if (typeof window !== "undefined") localStorage.setItem("calendar:date", date.toISOString());
    rangeRef.current = computeRange(view, date);
    scheduleFetch();
  };

  const handleView = (nextView: View) => {
    setView(nextView);
    if (typeof window !== "undefined") localStorage.setItem("calendar:view", String(nextView));
    rangeRef.current = computeRange(nextView, currentDate);
    scheduleFetch();
  };

  // Day click / empty slot click → go to canonical calendar tab (no interim page)
  const handleDrillDown = () => {
    router.replace("/dashboard?tab=calendar");
  };
  const handleSelectSlot = () => {
    router.replace("/dashboard?tab=calendar");
  };

  // Initial fetch
  useEffect(() => {
    if (!calendarConnected) return;
    rangeRef.current = computeRange(view, currentDate);
    fetchRange(rangeRef.current.start, rangeRef.current.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarConnected]);

  // Refetch when webhooks notify
  useEffect(() => {
    const handleUpdate = () => {
      if (!calendarConnected) return;
      scheduleFetch();
    };
    window.addEventListener("calendarUpdated", handleUpdate);
    return () => window.removeEventListener("calendarUpdated", handleUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarConnected]);

  // Modal / lead lookup
  const handleEventClick = async (event: EventType) => {
    setSelectedEvent(event);
    setLead(null);
    setModalOpen(true);

    const l10 = extractPhoneFromEvent({
      title: event.title,
      description: event.description,
      location: event.location,
    });
    if (!l10) return;

    try {
      const resp = await axios.get(`/api/leads/by-phone/${l10}`, {
        withCredentials: true,
        headers: { "x-user-email": session?.user?.email ?? "" },
        validateStatus: () => true,
      });

      if (resp.status === 200 && resp.data?.lead) {
        setLead(resp.data.lead);
      }
    } catch (err) {
      console.warn("Lead lookup by phone failed:", err);
    }
  };

  const closeModal = () => {
    setSelectedEvent(null);
    setLead(null);
    setModalOpen(false);
  };

  const handleCallNow = () => {
    if (lead?._id) router.push(`/dial-session?leadId=${lead._id}`);
  };

  return (
    <div className="min-h-[82vh] bg-[#111] rounded-lg p-4 text-white shadow-md">
      <style>
        {`
          .rbc-today {
            background-color: inherit !important;
            border: 2px solid #6366f1 !important;
            border-radius: 6px;
            box-shadow: none !important;
          }
          .rbc-month-view .rbc-date-cell, .rbc-month-view .rbc-day-bg { pointer-events: auto; }
          .rbc-calendar { min-height: 72vh; }
        `}
      </style>

      {!calendarConnected && !loading && (
        <div className="mb-4">
          <ConnectGoogleCalendarButton />
        </div>
      )}

      {calendarConnected && (
        <div style={{ height: "calc(100vh - 9.5rem)" }}>
          <Calendar
            localizer={localizer as unknown as DateLocalizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            view={view}
            date={currentDate}
            views={["month", "week", "day"]}
            drilldownView="day"
            selectable
            onSelectSlot={handleSelectSlot}
            onDrillDown={handleDrillDown}
            onView={handleView}
            onNavigate={handleNavigate}
            onRangeChange={handleRangeChange}
            popup
            onSelectEvent={handleEventClick}
            style={{ height: "100%" }}
            components={{
              toolbar: ({ label, onNavigate, onView, view }) => (
                <div className="flex justify-between items-center mb-3 px-2">
                  <div>
                    <button onClick={() => onNavigate("PREV")} className="mr-2 px-3 py-1 bg-[#222] text-white rounded">←</button>
                    <button onClick={() => onNavigate("TODAY")} className="mr-2 px-3 py-1 bg-[#2563eb] text-white rounded">Today</button>
                    <button onClick={() => onNavigate("NEXT")} className="px-3 py-1 bg-[#222] text-white rounded">→</button>
                  </div>
                  <h2 className="text-lg font-semibold">{label}</h2>
                  <select
                    value={view}
                    onChange={(e) => onView(e.target.value as View)}
                    className="bg-[#222] text-white border border-gray-700 rounded px-3 py-1"
                  >
                    <option value="month">Month</option>
                    <option value="week">Week</option>
                    <option value="day">Day</option>
                  </select>
                </div>
              ),
            }}
            eventPropGetter={(event: EventType) => {
              if (event.source === "crm") {
                return { style: { backgroundColor: "#2563eb", color: "white", borderRadius: "6px", padding: "4px", border: "none" } };
              } else if (event.source === "manual") {
                return { style: { backgroundColor: "#51b749", color: "white", borderRadius: "6px", padding: "4px", border: "none" } };
              }
              const bg = event.colorId ? googleColorMap[event.colorId] || "#888" : "#888";
              return { style: { backgroundColor: bg, color: "white", borderRadius: "6px", padding: "4px", border: "none" } };
            }}
          />
        </div>
      )}

      <Modal
        isOpen={modalOpen}
        onRequestClose={closeModal}
        contentLabel="Event Details"
        className="bg-[#1c1c1c] rounded-lg p-6 max-w-md mx-auto mt-20 outline-none"
        overlayClassName="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center"
      >
        {selectedEvent && (
          <div className="text-white space-y-2">
            <h2 className="text-xl font-bold">{selectedEvent.title}</h2>
            <p><strong>Start:</strong> {selectedEvent.start.toLocaleString()}</p>
            <p><strong>End:</strong> {selectedEvent.end.toLocaleString()}</p>
            {(() => {
              const d = sanitizeEventText(selectedEvent.description);
              return d ? (
                <p className="whitespace-pre-wrap"><strong>Description:</strong> {d}</p>
              ) : null;
            })()}
            {selectedEvent.location && <p><strong>Location:</strong> {selectedEvent.location}</p>}
            {lead ? (
              <>
                <hr className="my-2 border-gray-700" />
                <p><strong>Lead:</strong> {lead["First Name"]} {lead["Last Name"]}</p>
                <p><strong>Email:</strong> {lead.Email}</p>
                <p><strong>Phone:</strong> {lead.Phone}</p>
                {(() => {
                  const n = sanitizeEventText(lead.Notes);
                  return <p><strong>Notes:</strong> {n || "—"}</p>;
                })()}
                <button
                  onClick={() => lead?._id && router.push(`/dashboard?tab=leads&leadId=${lead._id}`)}
                  className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white w-full"
                >
                  👤 Open Lead Profile
                </button>

                <button onClick={handleCallNow} className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white w-full">
                  📞 Call Now
                </button>
              </>
            ) : (
              <p className="mt-3 italic text-sm text-gray-400">No matching lead found for this event.</p>
            )}
            <div className="mt-4 text-right">
              <button onClick={closeModal} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded">Close</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
