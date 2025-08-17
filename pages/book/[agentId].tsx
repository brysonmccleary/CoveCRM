import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import axios from "axios";

export default function PublicBookingPage() {
  const router = useRouter();
  const { agentId } = router.query;

  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    time: "",
  });
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (agentId) {
      axios
        .get(`/api/calendar/get-available-slots?email=${agentId}`)
        .then((res) => setSlots(res.data.slots || []))
        .catch((err) => console.error("Slot fetch error:", err));
    }
  }, [agentId]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.post("/api/calendar/book-appointment", {
        ...form,
        agentEmail: agentId,
      });
      setSubmitted(true);
    } catch (err) {
      console.error("Booking error:", err);
      alert("There was a problem booking your appointment.");
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center">
        <h2 className="text-2xl font-bold mb-4">✅ You're Booked!</h2>
        <p>Thanks! Your agent will reach out at the time you selected.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto mt-10">
      <h1 className="text-2xl font-bold mb-4">📅 Book with Agent</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          required
          type="text"
          placeholder="Your Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full border p-2 rounded"
        />
        <input
          required
          type="tel"
          placeholder="Phone Number"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="w-full border p-2 rounded"
        />
        <input
          type="email"
          placeholder="Email (optional)"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="w-full border p-2 rounded"
        />
        <select
          required
          value={form.time}
          onChange={(e) => setForm({ ...form, time: e.target.value })}
          className="w-full border p-2 rounded"
        >
          <option value="">Select a time</option>
          {slots.map((slot, i) => (
            <option key={i} value={slot}>
              {new Date(slot).toLocaleString()}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700"
        >
          {loading ? "Booking..." : "Confirm Appointment"}
        </button>
      </form>
    </div>
  );
}
