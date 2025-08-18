import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import moment from "moment";

export default function PublicBookingPage() {
  const router = useRouter();
  const raw = router.query.email;
  const email = Array.isArray(raw) ? raw.join("/") : raw || "";

  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [formData, setFormData] = useState({ name: "", email: "", phone: "" });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;

    const fetchSlots = async () => {
      try {
        const res = await fetch(
          `/api/get-available-slots?email=${encodeURIComponent(email)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to fetch slots");
        setAvailableSlots(data.slots || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSlots();
  }, [email]);

  const handleBooking = async () => {
    if (!selectedSlot || !formData.name || !formData.email) {
      setError("Please fill out all fields and select a time.");
      return;
    }

    try {
      const res = await fetch("/api/create-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarOwnerEmail: email,
          ...formData,
          time: selectedSlot,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Booking failed");

      setSuccess(true);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (success) {
    return (
      <div className="p-6 text-center max-w-xl mx-auto">
        <h1 className="text-2xl font-bold text-green-600 mb-4">
          ✅ Booking Confirmed
        </h1>
        <p className="text-gray-700">
          You’ll receive an email or SMS reminder shortly.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Book a Call with {email}</h1>

      {loading ? (
        <p>Loading available times...</p>
      ) : error === "No calendar linked to this email" ? (
        <div className="text-center">
          <p className="text-yellow-400 mb-4">
            ⛔ This email has not linked a calendar yet.
          </p>
          <a
            href={`/connect-calendar?email=${encodeURIComponent(email)}`}
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Connect Google Calendar
          </a>
        </div>
      ) : error ? (
        <p className="text-red-500">{error}</p>
      ) : (
        <>
          <label className="block mb-2 font-medium">Select a Time:</label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {availableSlots.map((slot) => (
              <button
                key={slot}
                onClick={() => setSelectedSlot(slot)}
                className={`px-3 py-2 border rounded ${
                  selectedSlot === slot
                    ? "bg-blue-600 text-white"
                    : "hover:bg-gray-100"
                }`}
              >
                {moment(slot).format("ddd, MMM D @ h:mm A")}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Your Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full border p-2 rounded mb-2"
          />
          <input
            type="email"
            placeholder="Your Email"
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full border p-2 rounded mb-2"
          />
          <input
            type="tel"
            placeholder="Your Phone"
            value={formData.phone}
            onChange={(e) =>
              setFormData({ ...formData, phone: e.target.value })
            }
            className="w-full border p-2 rounded mb-4"
          />

          <button
            onClick={handleBooking}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded"
          >
            Confirm Booking
          </button>
        </>
      )}
    </div>
  );
}
