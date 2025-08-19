// /components/BookingForm.tsx
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";

export default function BookingForm() {
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(""); // optional
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [agentEmail, setAgentEmail] = useState("");

  useEffect(() => {
    if (session?.user?.email) {
      setAgentEmail(session.user.email);
    }
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agentEmail || !name || !phone || !date || !time) {
      toast.error("Please fill out all required fields.");
      return;
    }

    const fullDateTime = new Date(`${date}T${time}:00`);

    try {
      // ✅ Step 1: (light) conflict check – your API currently always allows
      const conflictRes = await fetch("/api/calendar/check-conflict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentEmail,
          time: fullDateTime.toISOString(),
        }),
      });

      const conflictData = await conflictRes.json();
      if (!conflictRes.ok || conflictData.conflict) {
        toast.error(conflictData.message || "That time is already booked.");
        return;
      }

      // ✅ Step 2: Create the calendar event (overlaps allowed by API)
      const res = await fetch("/api/calendar/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentEmail,
          name,
          phone,
          email,
          start: fullDateTime.toISOString(),
          // default 30 min duration; adjust if you pass explicit end
          end: new Date(fullDateTime.getTime() + 30 * 60000).toISOString(),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("Appointment booked!");
        setName("");
        setPhone("");
        setEmail("");
        setDate("");
        setTime("");
      } else {
        toast.error(data.message || "Booking failed.");
      }
    } catch (err: any) {
      console.error("Booking error:", err);
      toast.error("Booking failed. Please try again.");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4 max-w-md mx-auto text-white">
      <h2 className="text-lg font-semibold">Book a New Appointment</h2>

      <input
        type="text"
        placeholder="Client Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full border rounded px-3 py-2 bg-gray-900 border-gray-700"
      />

      <input
        type="tel"
        placeholder="Phone Number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        className="w-full border rounded px-3 py-2 bg-gray-900 border-gray-700"
      />

      <input
        type="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full border rounded px-3 py-2 bg-gray-900 border-gray-700"
      />

      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
        className="w-full border rounded px-3 py-2 bg-gray-900 border-gray-700"
      />

      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        required
        className="w-full border rounded px-3 py-2 bg-gray-900 border-gray-700"
      />

      <button
        type="submit"
        className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded"
      >
        Book Appointment
      </button>
    </form>
  );
}
