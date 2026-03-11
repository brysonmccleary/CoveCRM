from pathlib import Path
import sys

path = Path("components/ConversationsPanel.tsx")
src = path.read_text(encoding="utf-8")

old_import = 'import { useEffect, useState, useRef, useMemo } from "react";'
new_import = 'import { useEffect, useState, useRef, useMemo } from "react";'

old_state = '  const [bookingTime, setBookingTime] = useState("");\n  const [bookingForMessageIndex, setBookingForMessageIndex] = useState<number | null>(null);\n  const chatRef = useRef<HTMLDivElement>(null);\n'
new_state = '''  const [bookingTime, setBookingTime] = useState("");
  const [bookingForMessageIndex, setBookingForMessageIndex] = useState<number | null>(null);
  const [resumingDrip, setResumingDrip] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
'''

if old_state not in src:
    print("[refuse] state anchor not found")
    sys.exit(1)

src = src.replace(old_state, new_state, 1)

anchor = '''  const handleConfirmBooking = async () => {
    if (!selectedLead || !bookingTime || bookingForMessageIndex === null) return;

    try {
      const res = await axios.post("/api/calendar/create-event", {
        leadId: selectedLead._id,
        time: bookingTime,
        phone: selectedLead.Phone,
        name: selectedLead["First Name"],
      });

      if (res.status === 200) {
        alert("✅ Appointment booked");
        setBookingTime("");
        setBookingForMessageIndex(null);
      } else {
        alert("❌ Booking failed");
      }
    } catch (err: any) {
      console.error("❌ Booking failed", err);
      const msg = err?.response?.data?.message || "❌ Booking failed";
      alert(msg);
    }
  };
'''
insert = '''  const handleConfirmBooking = async () => {
    if (!selectedLead || !bookingTime || bookingForMessageIndex === null) return;

    try {
      const res = await axios.post("/api/calendar/create-event", {
        leadId: selectedLead._id,
        time: bookingTime,
        phone: selectedLead.Phone,
        name: selectedLead["First Name"],
      });

      if (res.status === 200) {
        alert("✅ Appointment booked");
        setBookingTime("");
        setBookingForMessageIndex(null);
      } else {
        alert("❌ Booking failed");
      }
    } catch (err: any) {
      console.error("❌ Booking failed", err);
      const msg = err?.response?.data?.message || "❌ Booking failed";
      alert(msg);
    }
  };

  const handleContinueDrip = async () => {
    if (!selectedLead?._id || resumingDrip) return;

    try {
      setResumingDrip(true);
      const res = await axios.post("/api/drips/resume-lead", {
        leadId: selectedLead._id,
      });

      const campaignName = res?.data?.campaignName || "drip campaign";
      alert(`✅ Continued ${campaignName}`);
      await loadLeads();
    } catch (err: any) {
      console.error("❌ Continue drip failed", err);
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.detail ||
        "❌ Could not continue drip";
      alert(msg);
    } finally {
      setResumingDrip(false);
    }
  };
'''

if anchor not in src:
    print("[refuse] booking anchor not found")
    sys.exit(1)

src = src.replace(anchor, insert, 1)

old_header = '''            <h3 className="font-semibold text-lg mb-2">
              {selectedLead["First Name"]} ({selectedLead.Phone})
            </h3>
'''
new_header = '''            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-lg">
                {selectedLead["First Name"]} ({selectedLead.Phone})
              </h3>

              <button
                onClick={handleContinueDrip}
                disabled={resumingDrip}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-3 py-1 rounded text-sm"
              >
                {resumingDrip ? "Continuing..." : "Continue Drip"}
              </button>
            </div>
'''

if old_header not in src:
    print("[refuse] header anchor not found")
    sys.exit(1)

src = src.replace(old_header, new_header, 1)

path.write_text(src, encoding="utf-8")
print("[patch] Added Continue Drip button and handler to ConversationsPanel.tsx")
