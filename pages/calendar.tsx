// pages/calendar.tsx
import { useSession } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import Sidebar from "@/components/Sidebar";
import dynamic from "next/dynamic";
import CalendarConnectBanner from "@/components/CalendarConnectBanner";
import { io, Socket } from "socket.io-client";

// Load CalendarView dynamically to avoid SSR issues
const CalendarView = dynamic(() => import("@/components/CalendarView"), {
  ssr: false,
});

function shouldReconnect(status?: number, data?: any) {
  if (data?.needsReconnect === true) return true;
  if (status === 401) return true;

  const err = String(data?.error || data?.code || "").trim();
  const errLower = err.toLowerCase();

  if (
    errLower === "google_reconnect_required" ||
    errLower === "invalid_grant" ||
    errLower === "insufficient_scopes" ||
    errLower === "no_credentials"
  ) {
    return true;
  }

  if (
    errLower.includes("google_reconnect_required") ||
    errLower.includes("invalid_grant") ||
    (errLower.includes("insufficient") && errLower.includes("scope")) ||
    errLower.includes("no_credentials")
  ) {
    return true;
  }

  return false;
}

export default function CalendarPage() {
  const { data: session, status: sessionStatus } = useSession();
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState(
    "Checking calendar connection..."
  );
  const [eventCount, setEventCount] = useState<number | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCalendarStatus = async () => {
    try {
      const res = await axios.get("/api/calendar-status");
      console.log("✅ calendar-status:", res.data);

      const connected =
        res.data.calendarConnected === true ||
        !!res.data.googleCalendar?.accessToken;

      setCalendarConnected(connected);
      setNeedsReconnect(false);

      setStatusMessage(
        connected ? "✅ Google Calendar Connected" : "⚠️ Not Connected"
      );

      if (res.data?.calendarId) {
        setCalendarId(res.data.calendarId);
      }

      // If connected, fetch events count
      if (connected) {
        try {
          // NOTE: leaving your existing call shape intact; only improving reconnect detection
          const eventsRes = await axios.get("/api/calendar/events");
          const count = eventsRes.data?.events?.length || 0;
          console.log("📆 Events fetched:", count);
          setEventCount(count);
        } catch (err: any) {
          const data = err?.response?.data;
          const status = err?.response?.status;

          // ✅ Critical: honor needsReconnect even on 500
          if (shouldReconnect(status, data)) {
            console.warn("Calendar requires reconnect:", data);
            setNeedsReconnect(true);
            setCalendarConnected(false);
            setStatusMessage(
              "⚠️ Google Calendar connection expired. Please reconnect."
            );
            return;
          }

          console.error("❌ Error loading calendar events:", err);
          setStatusMessage("❌ Error loading calendar events");
        }
      }
    } catch (error) {
      console.error("❌ Error checking calendar status:", error);
      setStatusMessage("❌ Error checking status");
      setCalendarConnected(false);
      setNeedsReconnect(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    fetchCalendarStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  // 🔁 Listen for socket-based calendar updates
  useEffect(() => {
    if (
      session?.user?.email &&
      calendarConnected &&
      typeof window !== "undefined"
    ) {
      if (!socketRef.current) {
        socketRef.current = io(undefined, { path: "/api/socket/" });
      }

      const socket = socketRef.current;
      socket.emit("joinRoom", `user-${session.user.email}`);

      socket.on("calendarUpdated", (payload) => {
        console.log("🔁 calendarUpdated received:", payload);

        // Debounce refetch to avoid multiple rapid updates
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          fetchCalendarStatus();
        }, 1000);
      });

      return () => {
        socket.off("calendarUpdated");
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [calendarConnected, session?.user?.email]);

  return (
    <div className="flex">
      <Sidebar />
      <main className="p-8 w-full text-white">
        <h1 className="text-2xl font-bold mb-6">📅 Booking Calendar</h1>

        {/* Connection status */}
        <div className="mb-4">
          <p>
            Status: <strong>{loading ? "Loading..." : statusMessage}</strong>
          </p>
          {calendarId && (
            <p className="text-sm text-gray-400 mt-1">
              Calendar ID: {calendarId}
            </p>
          )}
          {eventCount !== null && (
            <p className="text-sm text-green-400 mt-1">
              Upcoming events: {eventCount}
            </p>
          )}
        </div>

        {/* ✅ Show banner if either not connected OR backend says reconnect required */}
        {!loading && (calendarConnected === false || needsReconnect) && (
          <CalendarConnectBanner />
        )}

        {/* Calendar view if connected (and not currently forcing reconnect UI) */}
        {!loading && calendarConnected === true && !needsReconnect && (
          <div className="mt-8">
            <CalendarView />
          </div>
        )}
      </main>
    </div>
  );
}
