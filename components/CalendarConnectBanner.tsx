// components/CalendarConnectBanner.tsx

export default function CalendarConnectBanner() {
  const handleConnect = () => {
    // Use a full-page redirect so the OAuth 302 to Google is followed correctly
    window.location.href = "/api/connect/google-calendar";
  };

  return (
    <div className="bg-yellow-500 text-black p-6 rounded-md shadow-md mb-6">
      <h2 className="text-xl font-bold mb-2">⚠️ Google Calendar Not Connected</h2>
      <p className="mb-4">
        To enable calendar bookings, please connect your Google Calendar.
      </p>
      <button
        onClick={handleConnect}
        className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800 transition"
      >
        Connect Google Calendar
      </button>
    </div>
  );
}
