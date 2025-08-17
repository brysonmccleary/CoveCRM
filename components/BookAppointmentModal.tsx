// /components/BookAppointmentModal.tsx
import { useEffect, useMemo, useState } from "react";
import Modal from "react-modal";
import { format } from "date-fns";

if (typeof window !== "undefined") {
  Modal.setAppElement("#__next");
}

type LeadLite = {
  id: string; // stringified _id
  ["First Name"]?: string;
  ["Last Name"]?: string;
  Phone?: string;
  Email?: string;
  Notes?: string;
  [key: string]: any;
};

interface BookAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: LeadLite;
  onBooked?: (info: { eventId: string; startISO: string; endISO: string }) => void;
}

function nextHalfHour(now = new Date()) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  const add = m % 30 === 0 ? 30 : 30 - (m % 30);
  d.setMinutes(m + add);
  return d;
}

function toDateInputValue(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeInputValue(d: Date) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function BookAppointmentModal({
  isOpen,
  onClose,
  lead,
  onBooked,
}: BookAppointmentModalProps) {
  const initial = useMemo(() => nextHalfHour(), [isOpen]);
  const [selectedDate, setSelectedDate] = useState<string>(toDateInputValue(initial));
  const [selectedTime, setSelectedTime] = useState<string>(toTimeInputValue(initial));
  const [durationMin, setDurationMin] = useState<number>(30);
  const [note, setNote] = useState<string>(lead?.Notes || "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const n = nextHalfHour();
      setSelectedDate(toDateInputValue(n));
      setSelectedTime(toTimeInputValue(n));
      setDurationMin(30);
      setNote(lead?.Notes || "");
    }
  }, [isOpen, lead?.Notes]);

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const handleSubmit = async () => {
    if (!selectedDate || !selectedTime) {
      alert("Please select a date and time.");
      return;
    }

    // Local selections → absolute instants (UTC ISO)
    const startLocal = new Date(`${selectedDate}T${selectedTime}`);
    const endLocal = new Date(startLocal.getTime() + durationMin * 60 * 1000);

    setSubmitting(true);

    const payload = {
      leadId: lead.id,
      title:
        `Call with ${(lead["First Name"] || "").trim()} ${(lead["Last Name"] || "").trim()}`.trim() ||
        "Sales Call",
      description: (note || "").trim(),
      location: lead.Phone ? `Phone: ${lead.Phone}` : "",
      attendee: lead.Email || "", // optional attendee (lead) — server also adds the owner
      start: startLocal.toISOString(), // server will set timeZone = tz
      end: endLocal.toISOString(),
    };

    try {
      const res = await fetch("/api/calendar/create-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-TZ": tz, // so server knows the user's local TZ
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to create calendar event");

      onBooked?.({
        eventId: data?.eventId || "",
        startISO: payload.start,
        endISO: payload.end,
      });

      alert(
        `✅ Appointment booked for ${format(startLocal, "PPP p")} (${durationMin}m). Timezone: ${tz}`
      );
      onClose();
    } catch (err: any) {
      alert(`Error booking appointment: ${err?.message || "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={() => (!submitting ? onClose() : undefined)}
      shouldCloseOnOverlayClick={!submitting}
      className="bg-[#1e293b] text-white max-w-md mx-auto mt-20 p-6 rounded-lg shadow-lg border border-gray-600 outline-none"
      overlayClassName="fixed inset-0 bg-black/60 flex justify-center items-start z-[1000]"
    >
      <h2 className="text-xl font-bold mb-4">Book Appointment</h2>

      <p className="text-sm mb-3 text-gray-300">
        {(lead["First Name"] || "")} {(lead["Last Name"] || "")} — {lead.Phone || "No phone"} —{" "}
        {lead.Email || "No email"}
      </p>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="block text-sm mb-1">Date</label>
          <input
            type="date"
            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Time</label>
          <input
            type="time"
            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">Timezone: {tz}</p>
        </div>

        <div>
          <label className="block text-sm mb-1">Duration</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white cursor-pointer"
            value={durationMin}
            onChange={(e) => setDurationMin(parseInt(e.target.value, 10))}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Optional Note</label>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
            rows={3}
            placeholder="e.g., Prefers afternoon calls"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-between items-center mt-5">
        <button
          onClick={onClose}
          disabled={submitting}
          className="text-gray-400 hover:text-white text-sm disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className={`px-4 py-2 rounded text-white ${
            submitting ? "bg-gray-600" : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {submitting ? "Booking..." : "Book Appointment"}
        </button>
      </div>
    </Modal>
  );
}
