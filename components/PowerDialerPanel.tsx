import React, { useState } from "react";
import { useCallStore } from "../store/useCallStore";

export default function PowerDialerPanel() {
  const { activeLeads, currentIndex, nextLead } = useCallStore();
  const currentLead = activeLeads[currentIndex] || {};

  const [notes, setNotes] = useState(currentLead["Notes"] || "");
  const [doubleDialNumber, setDoubleDialNumber] = useState(currentLead["Phone"] || "");

  const handleSaveNotes = () => {
    alert("Notes saved (would update in DB in real app).");
  };

  if (!currentLead || Object.keys(currentLead).length === 0) {
    return <div className="text-white">No active lead selected. Start a dial session from leads screen.</div>;
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
          onClick={nextLead}
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
