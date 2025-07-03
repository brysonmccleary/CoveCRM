import React, { useState, useEffect } from "react";
import LeadPreviewPanel from "../../components/LeadPreviewPanel";

export default function LeadsPage() {
  const [folders, setFolders] = useState<any[]>([]);
  const [activeFolder, setActiveFolder] = useState<any | null>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<any[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewLead, setPreviewLead] = useState<any | null>(null);

  // Fetch folders
  useEffect(() => {
    const fetchFolders = async () => {
      const res = await fetch("/api/get-folders");
      const data = await res.json();
      setFolders(data);
    };
    fetchFolders();
  }, []);

  // Fetch leads when active folder changes
  useEffect(() => {
    const fetchLeads = async () => {
      if (!activeFolder) {
        setLeads([]);
        setFilteredLeads([]);
        return;
      }
      const res = await fetch(`/api/get-leads-by-folder?folderId=${activeFolder._id}`);
      const data = await res.json();
      setLeads(data);
      setFilteredLeads(data);
      setSelectedLeads([]);
      setSelectAll(false);
    };
    fetchLeads();
  }, [activeFolder]);

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
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-1/4 bg-[#0f172a] text-white p-4 overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">Folders</h3>
        {folders.map((folder) => (
          <button
            key={folder._id}
            onClick={() => setActiveFolder(folder)}
            className={`block w-full text-left p-2 rounded mb-2 ${
              activeFolder?._id === folder._id ? "bg-[#6b5b95] text-white" : "hover:bg-gray-700"
            }`}
          >
            {folder.name}
          </button>
        ))}
      </div>

      {/* Leads panel */}
      <div className="flex-1 bg-[#1f2937] text-white p-4 overflow-auto">
        {activeFolder ? (
          <>
            <h2 className="text-xl font-bold mb-2">{activeFolder.name} Leads</h2>
            <input
              type="text"
              placeholder="Search by name or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border p-2 rounded w-full text-black mb-4"
            />

            <div className="border border-white p-4 rounded overflow-auto">
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
          </>
        ) : (
          <p className="text-gray-300">Select a folder to view leads.</p>
        )}

        {previewLead && (
          <LeadPreviewPanel
            lead={previewLead}
            onClose={() => setPreviewLead(null)}
            onSaveNotes={handleSaveNotes}
          />
        )}
      </div>
    </div>
  );
}

