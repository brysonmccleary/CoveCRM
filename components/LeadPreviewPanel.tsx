// components/LeadPreviewPanel.tsx
import React, { useEffect, useState } from "react";

interface LeadPreviewPanelProps {
  lead: any;
  onClose: () => void;
  onSaveNotes: (notes: string) => void | Promise<void>;
  onDispositionChange?: (disposition: string) => void | Promise<void>;
}

/**
 * DEFAULT (active) behavior: redirect to full lead page and render nothing.
 * This removes the right-side preview UX entirely and matches your search flow.
 */
export default function LeadPreviewPanel({
  lead,
  onClose,
}: LeadPreviewPanelProps) {
  useEffect(() => {
    const id = lead?._id || lead?.id;
    if (id) {
      window.location.href = `/lead/${encodeURIComponent(id)}`;
    } else {
      onClose?.();
    }
  }, [lead, onClose]);

  return null;
}

/**
 * Legacy preview panel UI (kept for reference/use later).
 * If you ever want the slide-out back, import and render this instead of the default export:
 *   import LeadPreviewPanel, { LegacyLeadPreviewPanel } from "@/components/LeadPreviewPanel";
 *   // ...use <LegacyLeadPreviewPanel .../> in place of the default
 */
export function LegacyLeadPreviewPanel({
  lead,
  onClose,
  onSaveNotes,
  onDispositionChange,
}: LeadPreviewPanelProps) {
  const [notes, setNotes] = useState<string>(lead?.Notes || "");
  const [disposition, setDisposition] = useState<string>("");

  const handleSave = async () => {
    await onSaveNotes(notes);
  };

  const handleDisposition = async (value: string) => {
    setDisposition(value);
    if (onDispositionChange) await onDispositionChange(value);
  };

  const leadName = `${lead?.["First Name"] || ""} ${lead?.["Last Name"] || ""}`.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-end">
      {/* overlay */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close preview"
      />

      {/* panel */}
      <div className="relative w-full md:w-1/3 h-full overflow-y-auto bg-[#0f172a] text-white shadow-xl border-l border-white/10">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-xl font-bold">{leadName || "Lead"}</h2>
          <button onClick={onClose} className="text-red-300 hover:text-red-400 font-semibold">
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {(lead?._id || lead?.id) && (
            <div>
              <button
                className="text-blue-300 underline underline-offset-2"
                onClick={() => {
                  const id = lead?._id || lead?.id;
                  if (id) window.location.href = `/lead/${id}`;
                }}
              >
                Open full lead page →
              </button>
            </div>
          )}

          {/* Key/Value fields */}
          <div className="space-y-2">
            {Object.entries(lead || {}).map(([key, value]) => {
              if (["_id", "id", "folderId", "createdAt", "__v", "Notes"].includes(key)) return null;
              const displayValue =
                typeof value === "string" ? value : value == null ? "-" : JSON.stringify(value);
              return (
                <div key={key} className="text-sm">
                  <span className="text-gray-300 font-semibold">{key}:</span>{" "}
                  <span className="text-gray-100">{displayValue || "-"}</span>
                </div>
              );
            })}
          </div>

          {/* Notes */}
          <div className="mt-4">
            <label className="block text-sm text-gray-300 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={5}
              className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2"
            />
            <button
              onClick={handleSave}
              className="mt-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
            >
              Save Notes
            </button>
          </div>

          {/* Disposition */}
          <div className="mt-4">
            <label className="block text-sm text-gray-300 mb-1">Disposition</label>
            <select
              value={disposition}
              onChange={(e) => handleDisposition(e.target.value)}
              className="w-full bg-[#1e293b] text-white border border-white/10 rounded p-2"
            >
              <option value="">-- Select Disposition --</option>
              <option value="Sold">Sold</option>
              <option value="Booked Appointment">Booked Appointment</option>
              <option value="Not Interested">Not Interested</option>
              <option value="No Answer">No Answer</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
