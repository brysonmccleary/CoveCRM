import React, { useState } from "react";

interface LeadPreviewPanelProps {
  lead: any;
  onClose: () => void;
  onSaveNotes: (notes: string) => void;
}

export default function LeadPreviewPanel({ lead, onClose, onSaveNotes }: LeadPreviewPanelProps) {
  const [notes, setNotes] = useState(lead.Notes || "");

  const handleSave = () => {
    onSaveNotes(notes);
  };

  return (
    <div className="fixed top-0 right-0 w-full md:w-1/3 h-full bg-white dark:bg-[#1f1f1f] p-6 overflow-y-auto shadow-lg border-l border-gray-300 dark:border-gray-700">
      <button
        onClick={onClose}
        className="text-red-600 hover:text-red-800 font-bold mb-4"
      >
        Close
      </button>

      <h2 className="text-2xl font-bold mb-4">
        {lead["First Name"]} {lead["Last Name"]}
      </h2>

      <div className="space-y-2">
        {Object.entries(lead).map(([key, value]) => {
          if (["_id", "folderId", "createdAt", "__v"].includes(key)) return null;
          if (key === "Notes") return null;
          return (
            <div key={key} className="text-base">
              <strong>{key}:</strong> {value || "-"}
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <label className="block font-semibold mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          className="border p-2 rounded w-full dark:bg-gray-800 dark:text-white"
        />
        <button
          onClick={handleSave}
          className="mt-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
        >
          Save Notes
        </button>
      </div>
    </div>
  );
}

