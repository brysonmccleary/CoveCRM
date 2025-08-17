// components/calendar/ConnectGoogleCalendarButton.tsx
import React from "react";

export default function ConnectGoogleCalendarButton() {
  const handleConnect = () => {
    window.location.href = "/api/connect/google-calendar"; // ✅ Correct path
  };

  return (
    <button
      onClick={handleConnect}
      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
    >
      Connect Google Calendar
    </button>
  );
}
