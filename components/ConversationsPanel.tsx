import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { format } from "date-fns";

interface Lead {
  _id: string;
  "First Name": string;
  Phone: string;
  updatedAt: string;
  interactionHistory: {
    type: "inbound" | "outbound" | "ai" | "system";
    text: string;
    date: string;
  }[];
}

export default function ConversationsPanel() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [reply, setReply] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingForMessageIndex, setBookingForMessageIndex] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = async () => {
    const res = await axios.get("/api/leads/messages");
    setLeads(res.data.leads || []);
  };

  const handleReply = async () => {
    if (!selectedLead || !reply) return;

    await axios.post("/api/twilio/send-sms", {
      to: selectedLead.Phone,
      from: selectedLead.Phone, // keep existing routing; backend decides actual sender
      body: reply,
      leadId: selectedLead._id,
    });

    setReply("");
    await loadLeads();
    setSelectedLead((prev) => (prev ? leads.find((l) => l._id === prev._id) || prev : null));
  };

  const handleBookClick = (idx: number) => setBookingForMessageIndex(idx);

  const handleConfirmBooking = async () => {
    if (!selectedLead || !bookingTime || bookingForMessageIndex === null) return;

    try {
      await axios.post("/api/google/calendar/book-appointment", {
        leadId: selectedLead._id,
        time: bookingTime,
        phone: selectedLead.Phone,
        name: selectedLead["First Name"],
      });

      alert("✅ Appointment booked");
      setBookingTime("");
      setBookingForMessageIndex(null);
    } catch (err) {
      console.error("❌ Booking failed", err);
      alert("❌ Booking failed");
    }
  };

  // keep auto-scroll to bottom when thread changes
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [selectedLead?.interactionHistory?.length]);

  return (
    <div className="flex flex-col md:flex-row gap-4 p-4">
      {/* Sidebar */}
      <div className="w-full md:w-1/3 border rounded p-3 h-[80vh] overflow-y-auto">
        <h3 className="font-semibold text-lg mb-3">Conversations</h3>
        {leads.map((lead) => {
          const lastMsg = lead.interactionHistory?.slice(-1)[0];
          return (
            <div
              key={lead._id}
              className={`border p-2 rounded mb-2 cursor-pointer ${
                selectedLead?._id === lead._id ? "bg-blue-100" : ""
              }`}
              onClick={() => setSelectedLead(lead)}
            >
              <p className="font-bold">{lead["First Name"]}</p>
              <p className="text-sm text-gray-600 truncate">{lastMsg?.text}</p>
              <p className="text-xs text-gray-400">
                {format(new Date(lead.updatedAt), "MM/dd @ h:mma")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Chat Window */}
      <div className="w-full md:w-2/3 border rounded p-3 flex flex-col h-[80vh]">
        {selectedLead ? (
          <>
            <h3 className="font-semibold text-lg mb-2">
              {selectedLead["First Name"]} ({selectedLead.Phone})
            </h3>

            <div
              ref={chatRef}
              className="flex-1 overflow-y-auto border rounded p-3 bg-gray-50 space-y-2"
            >
              {selectedLead.interactionHistory.map((msg, idx) => {
                const isSystem = msg.type === "system";
                const isSent = msg.type === "outbound" || msg.type === "ai"; // ✅ treat AI as sent
                const isReceived = msg.type === "inbound";
                const showBooking = bookingForMessageIndex === idx;

                // bubble alignment + colors:
                // - Sent (outbound/ai): RIGHT in GREEN
                // - Received (inbound): LEFT neutral
                // - System: centered gray
                const containerAlign = isSystem
                  ? "items-center"
                  : isSent
                  ? "items-end"
                  : "items-start";

                const bubbleClasses = isSystem
                  ? "bg-gray-300 text-xs text-black text-center self-center"
                  : isSent
                  ? "bg-green-500 text-white self-end"
                  : "bg-white text-black self-start";

                return (
                  <div key={idx} className={`flex flex-col gap-1 ${containerAlign}`}>
                    <div className={`p-2 rounded-2xl max-w-[75%] ${bubbleClasses}`}>
                      <p className="text-sm whitespace-pre-line">{msg.text}</p>
                      <p className="text-[10px] mt-1 text-right">
                        {format(new Date(msg.date), "MM/dd h:mma")}
                      </p>
                    </div>

                    {(isReceived || msg.type === "ai") && (
                      <>
                        <button
                          onClick={() => handleBookClick(idx)}
                          className={`text-xs underline ml-2 ${
                            isReceived ? "self-start text-blue-600" : "self-end text-blue-100"
                          }`}
                        >
                          📅 Book
                        </button>

                        {showBooking && (
                          <div className={`flex flex-col gap-2 mt-1 ${isReceived ? "ml-2" : "mr-2"}`}>
                            <input
                              type="datetime-local"
                              value={bookingTime}
                              onChange={(e) => setBookingTime(e.target.value)}
                              className="text-sm border rounded px-2 py-1"
                            />
                            <button
                              onClick={handleConfirmBooking}
                              className="bg-green-600 text-white text-xs px-3 py-1 rounded w-fit"
                            >
                              Confirm Booking
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <textarea
              className="border rounded mt-3 p-2 h-24 resize-none"
              placeholder="Type your message..."
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <button
              onClick={handleReply}
              className="mt-2 self-end bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
            >
              Send Reply
            </button>
          </>
        ) : (
          <p>Select a conversation to view messages.</p>
        )}
      </div>
    </div>
  );
}
