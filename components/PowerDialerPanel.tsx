// components/PowerDialerPanel.tsx
import React, { useEffect, useState } from "react";
import { useCallStore } from "../store/useCallStore";
import { useSession } from "next-auth/react";
import axios from "axios";
import toast from "react-hot-toast";

export default function PowerDialerPanel() {
  const { activeLeads, currentIndex, nextLead } = useCallStore();
  const currentLead = activeLeads[currentIndex] || {};
  const { data: session } = useSession();

  const [notes, setNotes] = useState<string>(currentLead["Notes"] || "");
  const [doubleDialNumber, setDoubleDialNumber] = useState<string>(currentLead["Phone"] || "");

  // Keep local state in sync when the active lead changes
  useEffect(() => {
    setNotes(currentLead["Notes"] || "");
    setDoubleDialNumber(currentLead["Phone"] || "");
  }, [currentLead?._id, currentIndex]);

  const handleSaveNotes = async () => {
    const leadId = currentLead.id || currentLead._id;
    const text = (notes || "").trim();

    if (!leadId) {
      toast.error("No active lead to attach the note to.");
      return;
    }
    if (!text) {
      toast.error("❌ Cannot save an empty note");
      return;
    }

    try {
      const res = await fetch("/api/leads/add-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, text }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || "Failed to save note");
      }
      toast.success("✅ Note saved!");
      // Optional: clear after save
      setNotes("");
    } catch (err: any) {
      console.error("add-note error:", err);
      toast.error(err?.message || "Failed to save note");
    }
  };

  const handleNextLead = async () => {
    if (!session?.user?.email || !currentLead["Phone"]) {
      console.warn("Missing user or phone for call log.");
      nextLead();
      return;
    }

    try {
      await axios.post("/api/log-call", {
        userId: session.user.email,
        leadId: currentLead._id || currentLead.id || undefined,
        phoneNumber: currentLead["Phone"],
        status: "connected", // TODO: replace with real outcome from dropdown
        durationSeconds: undefined, // TODO: track with timer or Twilio webhook
      });
    } catch (err) {
      console.error("❌ Failed to log call:", err);
    }

    nextLead();
  };

  if (!currentLead || Object.keys(currentLead).length === 0) {
    return (
      <div className="text-white">
        No active lead selected. Start a dial session from leads screen.
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row bg-[#1e293b] text-white border border-white rounded p-4 space-y-4 md:space-y-0 md:space-x-4">
      {/* Lead details */}
      <div className="flex-1 space-y-2 border border-white p-3 rounded overflow-y-auto">
        <h2 className="text-xl font-bold mb-2">Lead Information</h2>

        <div className="flex items-center space-x-2 mb-2">
          <span className="text-lg font-bold">{currentLead["Phone"]}</span>
          <input
            type="text"
            value={doubleDialNumber}
            onChange={(e) => setDoubleDialNumber(e.target.value)}
            className="border p-1 rounded w-48 text-black"
            placeholder="Paste again to double dial"
          />
        </div>

        {Object.entries(currentLead).map(([key, value]) => {
          if (key === "Notes" || key === "Phone") return null;

          const displayValue = typeof value === "string" ? value : JSON.stringify(value);

          return (
            <div key={key}>
              <strong>{key}:</strong> {displayValue || "-"}
            </div>
          );
        })}
      </div>

      {/* Notes panel */}
      <div className="w-full md:w-1/3 flex flex-col space-y-2 border border-white p-3 rounded">
        <h2 className="text-lg font-bold">Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="border p-2 rounded flex-1 min-h-[150px] text-black"
        />
        <button
          onClick={handleSaveNotes}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
        >
          Save Notes
        </button>

        <button
          onClick={handleNextLead}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded mt-2"
        >
          Next Lead
        </button>

        <div className="mt-4 p-2 border border-white rounded bg-gray-700">
          <strong>Call Summary AI (coming soon)</strong>
        </div>
      </div>
    </div>
  );
}
