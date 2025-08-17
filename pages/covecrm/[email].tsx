// /pages/book/[email].tsx
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { GetServerSideProps } from "next";
import { format, parseISO } from "date-fns";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

interface BookingPageProps {
  email: string;
  googleEmail: string | null;
  calendarId: string | null;
  bookingSettings: any;
}

export default function BookingPage({ email, googleEmail, calendarId, bookingSettings }: BookingPageProps) {
  const [loading, setLoading] = useState(true);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const fetchSlots = async () => {
      const today = new Date().toISOString().split("T")[0];

      const res = await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, date: today }),
      });

      const data = await res.json();
      if (res.ok) {
        setAvailableSlots(data.slots);
      }

      setLoading(false);
    };

    fetchSlots();
  }, [email]);

  const handleBooking = async () => {
    if (!name || !guestEmail || !selectedSlot) {
      alert("Please fill out all required fields.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/book-slot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        slot: selectedSlot,
        name,
        guestEmail,
        phone,
      }),
    });

    const data = await res.json();
    setSubmitting(false);

    if (res.ok) {
      setSuccessMessage("Booking confirmed!");
      setSelectedSlot(null);
      setName("");
      setGuestEmail("");
      setPhone("");
    } else {
      alert("Error: " + data.message);
    }
  };

  if (!googleEmail || !calendarId) {
    return <div className="p-8 text-center">This user has not connected their calendar yet.</div>;
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Book with {email}</h1>
      <p className="mb-4 text-sm text-gray-500">Connected via {googleEmail}</p>

      {successMessage && (
        <div className="mb-6 text-green-600 font-semibold text-center">{successMessage}</div>
      )}

      {loading ? (
        <div>Loading available slots...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {availableSlots.length === 0 ? (
              <div className="col-span-2 text-center text-gray-400">No available slots</div>
            ) : (
              availableSlots.map((slot, index) => {
                const time = format(parseISO(slot), "h:mm a");
                return (
                  <button
                    key={index}
                    onClick={() => setSelectedSlot(slot)}
                    className={`px-4 py-2 rounded ${
                      selectedSlot === slot
                        ? "bg-green-600 text-white"
                        : "bg-blue-500 text-white hover:bg-blue-600"
                    }`}
                  >
                    {time}
                  </button>
                );
              })
            )}
          </div>

          {selectedSlot && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Confirm Booking</h2>

              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded"
              />

              <input
                type="email"
                placeholder="Your email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded"
              />

              <input
                type="tel"
                placeholder="Your phone (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border rounded"
              />

              <button
                onClick={handleBooking}
                disabled={submitting}
                className={`w-full py-2 rounded font-semibold ${
                  submitting ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"
                } text-white`}
              >
                {submitting ? "Booking..." : `Confirm Booking at ${format(parseISO(selectedSlot), "h:mm a")}`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  await dbConnect();

  const email = context.params?.email as string;
  const user = await User.findOne({ email });

  if (!user) {
    return {
      notFound: true,
    };
  }

  return {
    props: {
      email,
      googleEmail: user.googleSheets?.googleEmail || null,
      calendarId: user.calendarId || null,
      bookingSettings: user.bookingSettings || null,
    },
  };
};
