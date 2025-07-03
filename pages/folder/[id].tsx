import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import LeadPreviewPanel from "../../components/LeadPreviewPanel";

export default function FolderPage() {
  const router = useRouter();
  const { id } = router.query;

  const [leads, setLeads] = useState<any[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<any[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewLead, setPreviewLead] = useState<any | null>(null);

  useEffect(() => {
    const fetchLeads = async () => {
      if (!id) return;
      const res = await fetch(`/api/get-leads-by-folder?folderId=${id}`);
      const data = await res.json();
      setLeads(data);
      setFilteredLeads(data);
    };
    fetchLeads();
  }, [id]);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredLeads(leads);
      return;
    }
    const lower = searchQuery.toLowerCase();
    const filtered = leads.filter(
      (lead) =>
        (lead["First Name"] && lead["First Name"].toLowerCase().includes(lower)) ||
        (lead["Last Name"] && lead["Last Name"].toLowerCase().includes(lower)) ||
        (lead["Phone"] && lead["Phone"].toLowerCase().includes(lower))
    );
    setFilteredLeads(filtered);
  }, [searchQuery, leads]);

  const toggleLeadSelection = (id: string) => {
    if (selectedLeads.includes(id)) {
      setSelectedLeads(selectedLeads.filter((leadId) => leadId !== id));
    } else {
      setSelectedLeads([...selectedLeads, id]);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(filteredLeads.map((lead) => lead._id));
    }
    setSelectAll(!selectAll);
  };

  const startDialSession = () => {
    if (selectedLeads.length === 0) {
      alert("No leads selected");
      return;
    }
    alert("Starting dial session with leads: " + selectedLeads.join(", "));
  };

  const handleSaveNotes = async (notes: string) => {
    if (!previewLead) return;

    const res = await fetch(`/api/update-lead-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: previewLead._id, notes }),
    });

    if (res.ok) {
      alert("Notes saved!");
      setPreviewLead({ ...previewLead, Notes: notes });

      const updatedLeads = leads.map((l) => (l._id === previewLead._id ? { ...l, Notes: notes } : l));
      setLeads(updatedLeads);
      setFilteredLeads(updatedLeads);
    } else {
      alert("Failed to save notes");
    }
  };

  return (
    <div className="space-y-4 p-4 relative bg-[#0f172a] text-white min-h-screen">
      <button
        onClick={() => router.back()}
        className="bg-gray-300 hover:bg-gray-400 text-black px-4 py-2 rounded"
      >
        ← Back to Folders
      </button>

      <input
        type="text"
        placeholder="Search by name or number..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="border p-2 rounded w-full text-black"
      />

      <div className="border border-white p-4 rounded mt-4 overflow-auto">
        <div className="flex justify-between items-center mb-2">
          <button
            onClick={handleSelectAll}
            className="border border-white px-3 py-1 rounded hover:bg-[#6b5b95] hover:text-white"
          >
            {selectAll ? "Deselect All" : "Select All"}
          </button>
          <button
            onClick={startDialSession}
            className={`${
              selectedLeads.length > 0 ? "bg-green-600" : "bg-accent"
            } text-white px-4 py-2 rounded`}
          >
            Start Dial Session
          </button>
        </div>
        <table className="min-w-full text-base">
          <thead>
            <tr>
              <th></th>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Phone</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => (
              <tr
                key={lead._id}
                className="border-t border-white cursor-pointer hover:bg-[#6b5b95] hover:text-white"
                onClick={() => setPreviewLead(lead)}
              >
                <td>
                  <input
                    type="checkbox"
                    checked={selectedLeads.includes(lead._id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleLeadSelection(lead._id);
                    }}
                  />
                </td>
                <td>{lead["First Name"] || "-"}</td>
                <td>{lead["Last Name"] || "-"}</td>
                <td>{lead["Phone"] || "-"}</td>
                <td>{lead["Email"] || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewLead && (
        <LeadPreviewPanel
          lead={previewLead}
          onClose={() => setPreviewLead(null)}
          onSaveNotes={handleSaveNotes}
        />
      )}
    </div>
  );
}

