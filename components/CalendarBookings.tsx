// components/CalendarBookings.tsx
// COMPLETE REPLACEMENT
//
// Dashboard calendar using range-based Google Calendar fetching.
// - Pane + calendar grid use the darker sidebar blue (#0f172a).
// - Uniform event color (#3b82f6), selected event darker.
// - Lead matching on click via phone detection from description/title/location.
// - Month/Week/Day with persistence; Prev/Today/Next; click a day opens /calendar/YYYY-MM-DD.
// - Connect banner if not connected.
// - Upcoming-in-15-min alert.
// - Tall layout with RBC clickability fixes.
//
// Requires:
//   GET  /api/calendar-status
//   GET  /api/calendar/events?start=ISO&end=ISO
//   POST /api/leads/by-event-ids
//   GET  /api/leads/by-phone/:digitsOnly
//
// And the RBC localizer:
//   import { localizer } from "@/lib/localizer";
//
// Also:
//   import ConnectGoogleCalendarButton from "@/components/calendar/ConnectGoogleCalendarButton";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Views, View, DateLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { localizer } from "@/lib/localizer";
import Modal from "react-modal";
import axios from "axios";
import { useRouter } from "next/router";
import ConnectGoogleCalendarButton from "@/components/calendar/ConnectGoogleCalendarButton";

// -----------------------------
// Types
// -----------------------------
type EventType = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  colorId?: string | null;
  attendeesEmails?: string[];
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

// -----------------------------
// Constants & helpers
// -----------------------------
Modal.setAppElement("#__next");

const toISO = (d: Date) => new Date(d.getTime()).toISOString();

const ymd = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

// Week math using Sunday as first day (RBC default)
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0..6 (Sun..Sat)
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
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function monthVisibleRange(date: Date) {
  const mStart = startOfMonth(date);
  const mEnd = endOfMonth(date);
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

// Extract a US phone number from free text (digits only)
const extractPhone = (text?: string): string | null => {
  if (!text) return null;
  const match = text.match(/(?:\+?1[-.\s]?)?(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})/);
  return match ? match.slice(1).join("") : null;
};

// -----------------------------
// Component
// -----------------------------
export default function CalendarBookings() {
  const router = useRouter();

  // Calendar events + selection
  const [events, setEvents] = useState<EventType[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventType | null>(null);
  const [lead, setLead] = useState<LeadType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Connection + UI state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // View/date persistence
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return Views.MONTH;
    return (localStorage.getItem("calendar:view") as View) || Views.MONTH;
  });
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    if (typeof window === "undefined") return new Date();
    const saved = localStorage.getItem("calendar:date");
    return saved ? new Date(saved) : new Date();
  });

  // Range & debounced fetch
  const rangeRef = useRef<{ start?: Date; end?: Date }>({});
  const fetchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Upcoming alert (within 15 min)
  const upcoming: EventType | null = useMemo(() => {
    const now = new Date();
    const soon = new Date(now.getTime() + 15 * 60 * 1000);
    const next = [...events]
      .filter((e) => e.start >= now && e.start <= soon)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    return next || null;
  }, [events]);

  // -----------------------------------
  // 1) Check calendar connection
  // -----------------------------------
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get("/api/calendar-status");
        setCalendarConnected(!!res.data?.calendarConnected);
      } catch {
        setCalendarConnected(false);
      } finally {
        setLoadingStatus(false);
      }
    })();
  }, []);

  // -----------------------------------
  // 2) Fetch events for visible range
  // -----------------------------------
  const fetchRange = async (start?: Date, end?: Date) => {
    if (!start || !end) return;
    setErrorMsg(null);

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
        colorId: e.colorId ?? null,
        attendeesEmails: Array.isArray(e.attendees) ? e.attendees.filter(Boolean) : [],
        source: "unknown",
      }));

      // Tag CRM events by IDs
      const ids = parsed.map((e) => e.id);
      const matchRes = await fetch("/api/leads/by-event-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds: ids }),
      });
      const match = await matchRes.json();
      const matchedIds: string[] = match?.matchedIds || [];

      setEvents(
        parsed.map((e) => ({
          ...e,
          source: matchedIds.includes(e.id) ? "crm" : "manual",
        }))
      );
    } catch (err: any) {
      console.error("❌ Calendar fetch error:", err?.message || err);
      setErrorMsg(err?.message || "Failed to load events");
    }
  };

  const scheduleFetch = () => {
    if (!calendarConnected) return;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(() => {
      fetchRange(rangeRef.current.start, rangeRef.current.end);
    }, 120);
  };

  // -----------------------------------
  // 3) Compute & track visible range
  // -----------------------------------
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
    if (typeof window !== "undefined") {
      localStorage.setItem("calendar:date", date.toISOString());
    }
    rangeRef.current = computeRange(view, date);
    scheduleFetch();
  };

  const handleView = (nextView: View) => {
    setView(nextView);
    if (typeof window !== "undefined") {
      localStorage.setItem("calendar:view", String(nextView));
    }
    rangeRef.current = computeRange(nextView, currentDate);
    scheduleFetch();
  };

  // Initial fetch after connection status is known
  useEffect(() => {
    if (!calendarConnected) return;
    rangeRef.current = computeRange(view, currentDate);
    fetchRange(rangeRef.current.start, rangeRef.current.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarConnected]);

  // Optional: when other parts of the app dispatch window "calendarUpdated"
  useEffect(() => {
    const onUpdate = () => {
      if (!calendarConnected) return;
      scheduleFetch();
    };
    window.addEventListener("calendarUpdated", onUpdate);
    return () => window.removeEventListener("calendarUpdated", onUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarConnected]);

  // -----------------------------------
  // 4) Event modal + robust lead lookup
  // -----------------------------------
  const findLeadForEvent = async (event: EventType) => {
    // Try description → title → location for a phone number
    const phone =
      extractPhone(event.description) ||
      extractPhone(event.title) ||
      extractPhone(event.location);

    if (!phone) return null;

    try {
      const res = await axios.get(`/api/leads/by-phone/${phone}`);
      return res.data?.lead || null;
    } catch (err) {
      console.error("❌ Lead fetch error:", err);
      return null;
    }
  };

  const onEventClick = async (event: EventType) => {
    setSelectedEvent(event);
    setLead(null);
    setModalOpen(true);

    const l = await findLeadForEvent(event);
    if (l) setLead(l);
  };

  const closeModal = () => {
    setSelectedEvent(null);
    setLead(null);
    setModalOpen(false);
  };

  const callNow = () => {
    if (lead?._id) {
      router.push(`/dial-session?leadId=${lead._id}`);
    }
  };

  // -----------------------------------
  // 5) Render
  // -----------------------------------
  return (
    <div className="p-4">
      <style>
        {`
          /* Use the darker sidebar blue throughout the calendar */
          .rbc-calendar,
          .rbc-month-view,
          .rbc-time-view,
          .rbc-agenda-view {
            background-color: #0f172a !important; /* sidebar color */
            color: #ffffff;
          }
          .rbc-toolbar,
          .rbc-header {
            background-color: #0f172a !important;
            color: #e5e7eb !important;
            border-color: #1e293b !important;
          }
          .rbc-header + .rbc-header { border-left-color: #1e293b !important; }
          .rbc-off-range-bg { background-color: #0b1220 !important; }
          .rbc-today {
            background-color: inherit !important;
            border: 2px solid #6366f1 !important;
            border-radius: 6px;
            box-shadow: none !important;
          }
          .rbc-event {
            background-color: #3b82f6 !important; /* uniform blue */
            color: #ffffff !important;
            border: none !important;
          }
          .rbc-event.rbc-selected {
            background-color: #2563eb !important; /* darker on select */
          }
          .rbc-slot-selection {
            background: rgba(59, 130, 246, 0.25) !important;
          }
          .rbc-time-content,
          .rbc-time-gutter,
          .rbc-timeslot-group,
          .rbc-day-bg,
          .rbc-month-row,
          .rbc-day-slot,
          .rbc-agenda-table,
          .rbc-month-view,
          .rbc-time-view {
            border-color: #1e293b !important;
          }
          .rbc-date-cell { color: #cbd5e1; }
          /* Ensure day cells are clickable even if external CSS affects pointer events */
          .rbc-month-view .rbc-date-cell, .rbc-month-view .rbc-day-bg { pointer-events: auto; }
          /* Make the calendar grid tall */
          .rbc-calendar { min-height: 72vh; }
        `}
      </style>

      <h2 className="text-2xl font-semibold mb-4 text-white">📅 Booking Calendar</h2>

      {/* Connection banner */}
      {!loadingStatus && !calendarConnected && (
        <div className="mb-4">
          <ConnectGoogleCalendarButton />
        </div>
      )}

      {/* Upcoming in 15 min alert */}
      {calendarConnected && upcoming && (
        <div className="bg-yellow-100 text-yellow-900 px-4 py-3 rounded mb-4 shadow">
          ⚠️ Upcoming appointment: <strong>{upcoming.title}</strong>{" "}
          at{" "}
          {upcoming.start.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      )}

      {/* Calendar (only when connected) */}
      {calendarConnected && (
        <div
          style={{ height: "calc(100vh - 12rem)" }}
          className="bg-[#0f172a] rounded-lg p-4 text-white shadow-md"
        >
          <Calendar
            localizer={localizer as unknown as DateLocalizer}
            events={events}
            startAccessor="start"
            endAccessor="end"
            view={view}
            date={currentDate}
            views={["month", "week", "day"]}
            popup
            selectable
            onSelectEvent={onEventClick}
            onSelectSlot={(slot) => router.push(`/calendar/${ymd(slot.start as Date)}`)}
            drilldownView="day"
            onDrillDown={(date /*, fromView*/) => router.push(`/calendar/${ymd(date)}`)}
            onView={handleView}
            onNavigate={handleNavigate}
            onRangeChange={handleRangeChange}
            style={{ height: "100%" }}
            components={{
              toolbar: ({ label, onNavigate, onView, view }) => (
                <div className="flex justify-between items-center mb-3 px-2">
                  <div>
                    <button
                      onClick={() => onNavigate("PREV")}
                      className="mr-2 px-3 py-1 bg-[#1e293b] text-white rounded"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => onNavigate("TODAY")}
                      className="mr-2 px-3 py-1 bg-[#2563eb] text-white rounded"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => onNavigate("NEXT")}
                      className="px-3 py-1 bg-[#1e293b] text-white rounded"
                    >
                      →
                    </button>
                  </div>
                  <h2 className="text-lg font-semibold">{label}</h2>
                  <select
                    value={view}
                    onChange={(e) => onView(e.target.value as View)}
                    className="bg-[#1e293b] text-white border border-[#334155] rounded px-3 py-1"
                  >
                    <option value="month">Month</option>
                    <option value="week">Week</option>
                    <option value="day">Day</option>
                  </select>
                </div>
              ),
            }}
            // Event color is uniform, but keep this in case RBC CSS changes
            eventPropGetter={() => ({
              style: {
                backgroundColor: "#3b82f6",
                color: "white",
                borderRadius: "5px",
                paddingLeft: "5px",
                border: "none",
              },
            })}
          />
        </div>
      )}

      {/* Errors */}
      {errorMsg && (
        <p className="text-red-500 mt-3">
          {errorMsg}
        </p>
      )}

      {/* Modal */}
      <Modal
        isOpen={modalOpen}
        onRequestClose={closeModal}
        contentLabel="Event Details"
        className="bg-[#0f172a] rounded-lg p-6 max-w-md mx-auto mt-20 outline-none"
        overlayClassName="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center"
      >
        {selectedEvent && (
          <div className="text-white space-y-2">
            <h2 className="text-xl font-bold">{selectedEvent.title}</h2>
            <p>
              <strong>Start:</strong>{" "}
              {selectedEvent.start.toLocaleString()}
            </p>
            <p>
              <strong>End:</strong>{" "}
              {selectedEvent.end.toLocaleString()}
            </p>
            {selectedEvent.location && (
              <p>
                <strong>Location:</strong> {selectedEvent.location}
              </p>
            )}
            {selectedEvent.description && (
              <p className="whitespace-pre-wrap">
                <strong>Description:</strong> {selectedEvent.description}
              </p>
            )}
            {selectedEvent.attendeesEmails && selectedEvent.attendeesEmails.length > 0 && (
              <p>
                <strong>Attendee:</strong> {selectedEvent.attendeesEmails[0]}
              </p>
            )}

            {lead ? (
              <>
                <hr className="my-2 border-[#1e293b]" />
                <p>
                  <strong>Lead:</strong> {lead["First Name"]} {lead["Last Name"]}
                </p>
                <p>
                  <strong>Email:</strong> {lead.Email}
                </p>
                <p>
                  <strong>Phone:</strong> {lead.Phone}
                </p>
                <p>
                  <strong>Notes:</strong> {lead.Notes || "—"}
                </p>

                <button
                  onClick={callNow}
                  className="mt-4 px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white w-full"
                >
                  📞 Call Now
                </button>
              </>
            ) : (
              <p className="mt-3 italic text-sm text-gray-300">
                No matching lead found for this event.
              </p>
            )}

            <div className="mt-4 text-right">
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
