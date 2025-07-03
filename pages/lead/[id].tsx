import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";

interface Lead {
  id: string;
  [key: string]: any;
}

export default function LeadProfileDial() {
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    const fetchLead = async () => {
      try {
        if (!id) return;

        const res = await fetch(`/api/get-lead?id=${id}`);
        const data = await res.json();

        if (!res.ok) {
          console.error("Error fetching lead:", data.message);
          return;
        }

        setLead({ id: data.lead._id, ...data.lead });
      } catch (error) {
        console.error("Fetch error:", error);
      }
    };

    fetchLead();
  }, [id]);

  const formatPhone = (phone: string) => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length === 10) {
      return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    } else if (clean.length === 11 && clean.startsWith("1")) {
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    }
    return phone;
  };

  const handleSaveNote = () => {
    if (notes.trim()) {
      setHistory((prev) => [`Note: ${notes}`, ...prev]);
      setNotes("");
    }
  };

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />

      {/* Lead Info */}
      <div className="w-1/4 p-4 border-r border-gray-600 bg-[#1e293b] flex flex-col justify-between">
        <div>
          <h2 className="text-xl font-bold mb-2">{`${lead?.["First Name"] || ""} ${lead?.["Last Name"] || ""}`.trim()}</h2>

          {Object.entries(lead || {})
            .filter(([key]) => 
              !["_id", "id", "Notes", "First Name", "Last Name", "folderId", "createdAt", "ownerId"].includes(key)
            )
            .map(([key, value]) => {
              if (key === "Phone" || key.toLowerCase() === "phone") {
                value = formatPhone(value);
              }
              return (
                <div key={key}>
                  <p>
                    <strong>{key.replace(/_/g, " ")}:</strong> {value}
                  </p>
                  <hr className="border-gray-700 my-1" />
                </div>
              );
            })}

          {/* Move Notes always to bottom */}
          {lead?.Notes && (
            <div className="mt-2">
              <p>
                <strong>Notes:</strong>
              </p>
              <textarea
                value={lead.Notes}
                onChange={() => {}}
                readOnly
                className="bg-transparent border border-gray-500 rounded p-1 w-full mt-1"
                rows={3}
              />
              <hr className="border-gray-700 my-1" />
            </div>
          )}

          <p className="text-gray-400 mt-2 text-sm">Click fields to edit live.</p>
        </div>
      </div>

      {/* Interaction Panel */}
      <div className="flex-1 p-6 bg-[#1e293b] flex flex-col justify-between">
        <div>
          <h3 className="text-lg font-bold mb-2">Notes</h3>
          <div className="border border-gray-500 rounded p-2 mb-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-2 text-white rounded bg-transparent border-none focus:outline-none"
              rows={3}
              placeholder="Type notes here..."
            />
          </div>
          <button
            onClick={handleSaveNote}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded mb-4 cursor-pointer"
          >
            Save Note
          </button>

          <h3 className="text-lg font-bold mb-2">AI Call Summary</h3>
          <div className="bg-gray-800 p-3 rounded mb-4">
            No summary available yet.
          </div>

          <h3 className="text-lg font-bold mb-2">Interaction History</h3>
          <div className="bg-gray-800 p-3 rounded max-h-60 overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-gray-400">No interactions yet.</p>
            ) : (
              history.map((item, idx) => (
                <p key={idx} className="border-b border-gray-700 py-1">
                  {item}
                </p>
              ))
            )}
          </div>
        </div>

        {/* Disposition Buttons and End Session */}
        <div className="flex flex-col items-center mt-6 space-y-4">
          <div className="flex justify-center flex-wrap space-x-2">
            <button className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded cursor-pointer">Call</button>
            <button className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer">Sold</button>
            <button className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer">Hang Up</button>
            <button className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer">Booked Appointment</button>
            <button className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded cursor-pointer">Not Interested</button>
          </div>

          <button className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded cursor-pointer">
            End Dial Session
          </button>
        </div>
      </div>
    </div>
  );
}

