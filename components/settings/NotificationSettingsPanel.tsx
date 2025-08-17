import { useEffect, useState } from "react";

export default function NotificationSettingsPanel() {
  const [dripAlerts, setDripAlerts] = useState(true);
  const [bookingConfirmations, setBookingConfirmations] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const res = await fetch("/api/settings/notifications", {
          method: "GET",
          headers: { "Cache-Control": "no-store" },
        });

        if (!res.ok) throw new Error("Failed with status " + res.status);

        const data = await res.json();
        setDripAlerts(data?.dripAlerts ?? true);
        setBookingConfirmations(data?.bookingConfirmations ?? true);
      } catch (err) {
        console.warn("Notification load failed — silently ignored");
        setDripAlerts(true);
        setBookingConfirmations(true);
      } finally {
        setLoading(false);
      }
    };

    loadNotifications();
  }, []);

  const handleSave = async () => {
    try {
      await fetch("/api/settings/update-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dripAlerts, bookingConfirmations }),
      });
    } catch (err) {
      console.warn("Notification save failed — silently ignored");
    }
  };

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading...</div>;

  return (
    <div className="p-4 space-y-4 max-w-lg">
      <h2 className="text-xl font-semibold">Notification Preferences</h2>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Receive drip campaign alerts</label>
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={dripAlerts}
          onChange={(e) => setDripAlerts(e.target.checked)}
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Booking confirmations</label>
        <input
          type="checkbox"
          className="w-5 h-5"
          checked={bookingConfirmations}
          onChange={(e) => setBookingConfirmations(e.target.checked)}
        />
      </div>

      <button
        onClick={handleSave}
        className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
      >
        Save Preferences
      </button>
    </div>
  );
}
