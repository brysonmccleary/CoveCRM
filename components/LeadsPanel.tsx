// /components/LeadsPanel.tsx
import React, { useState, useEffect } from "react";
import LeadImportPanel from "./LeadImportPanel";
import LeadPreviewPanel from "./LeadPreviewPanel";
import { useRouter } from "next/router";

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
}

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

// --- Inline, self-contained global search (no external import) ---
function LeadSearchInline() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<
    { _id: string; displayName: string; phone?: string; email?: string; state?: string; status?: string }[]
  >([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const router = useRouter();

  useEffect(() => {
    const handler = setTimeout(async () => {
      const term = q.trim();
      if (term.length < 2) {
        setResults([]);
        setOpen(false);
        setActive(-1);
        return;
      }
      setLoading(true);
      try {
        const r = await fetch(`/api/leads/search?q=${encodeURIComponent(term)}`);
        const data = await r.json();
        const rows = Array.isArray(data?.results) ? data.results : [];
        setResults(rows);
        setOpen(true);
        setActive(rows.length ? 0 : -1);
      } catch {
        setResults([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handler);
  }, [q]);

  const go = (id: string) => {
    setOpen(false);
    setResults([]);
    setActive(-1);
    router.push(`/dial/${id}`);
  };

  return (
    <div className="mb-3">
      <div className="relative flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const item = results[active];
              if (item) go(item._id);
            } else if (e.key === "Escape") {
              setOpen(false);
              setActive(-1);
            }
          }}
          placeholder="Search leads (name, phone, email)…"
          className="border p-2 rounded w-full pr-10"
        />
        {q && (
          <button
            onClick={() => {
              setQ("");
              setResults([]);
              setOpen(false);
              setActive(-1);
            }}
            className="absolute right-2 text-gray-500 hover:text-gray-700"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
        {loading && <span className="text-sm text-gray-500 ml-2">Searching…</span>}
      </div>

      {open && (
        <div className="mt-2 border rounded divide-y max-h-96 overflow-auto bg-white dark:bg-zinc-900">
          {results.length ? (
            results.map((r, idx) => (
              <button
                key={r._id}
                className={`w-full text-left p-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                  idx === active ? "bg-zinc-50 dark:bg-zinc-800" : ""
                }`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => go(r._id)}
                title="Open dial session"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {r.displayName || "(No name)"}{" "}
                    <span className="text-xs text-gray-500">• {r.status || "New"}</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {r.phone || r.email || "—"} {r.state ? `• ${r.state}` : ""}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="p-2 text-sm text-gray-500">
              {q.trim().length >= 2 && !loading ? "No results." : "Type to search…"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// -----------------------------------------------------------------

// Minimal type just for sorting by createdAt
type LeadRow = { _id: string; createdAt?: string | number | Date };

export default function LeadsPanel() {
  const [showImport, setShowImport] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showResumeOptions, setShowResumeOptions] = useState(false);
  const [previewLead, setPreviewLead] = useState<any | null>(null);
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string>("");

  const router = useRouter();

  const fetchFolders = async () => {
    try {
      const res = await fetch("/api/get-folders");
      const data = await res.json();
      const userFolders = Array.isArray(data.folders) ? data.folders : [];

      const foldersWithCounts = await Promise.all(
        userFolders.map(async (folder: any) => {
          if (!folder._id || typeof folder._id !== "string") folder._id = folder.name;
          const leadsRes = await fetch(`/api/get-leads-by-folder?folderId=${folder._id}`);
          const leadsData = await leadsRes.json();
          return {
            ...folder,
            leadCount: Array.isArray(leadsData.leads) ? leadsData.leads.length : 0,
          };
        })
      );

      SYSTEM_FOLDERS.forEach((name) => {
        if (!foldersWithCounts.find((f) => f.name === name)) {
          foldersWithCounts.push({ _id: name, name, leadCount: 0 });
        }
      });

      setFolders(foldersWithCounts);
    } catch (err) {
      console.error("Failed to fetch folders:", err);
      setFolders([]);
    }
  };

  const fetchNumbers = async () => {
    try {
      const res = await fetch("/api/getNumbers");
      const data = await res.json();
      setNumbers(data.numbers || []);
    } catch (error) {
      console.error("Error fetching numbers:", error);
      setNumbers([]);
    }
  };

  useEffect(() => {
    fetchFolders();
    fetchNumbers();
  }, []);

  useEffect(() => {
    if (!expandedFolder) return;
    const fetchLeads = async () => {
      try {
        const res = await fetch(`/api/get-leads-by-folder?folderId=${expandedFolder}`);
        const data = await res.json();
        const sortedLeads = (Array.isArray(data.leads) ? (data.leads as LeadRow[]) : []).sort(
          (a: LeadRow, b: LeadRow) =>
            new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
        ) as any[];
        setLeads(sortedLeads);
        setSelectedLeads([]);
        setSelectAll(false);
      } catch (err) {
        console.error("Failed to fetch leads:", err);
        setLeads([]);
      }
    };
    fetchLeads();
  }, [expandedFolder]);

  useEffect(() => {
    if (expandedFolder) {
      localStorage.setItem(`selectedLeads_${expandedFolder}`, JSON.stringify(selectedLeads));
    }
  }, [selectedLeads, expandedFolder]);

  const toggleFolder = (folderId: string) => {
    if (expandedFolder === folderId) {
      setExpandedFolder(null);
      setLeads([]);
      setSelectedLeads([]);
      setSelectAll(false);
      setShowResumeOptions(false);
    } else {
      const savedSelections = localStorage.getItem(`selectedLeads_${folderId}`);
      if (savedSelections) {
        setShowResumeOptions(true);
      } else {
        setSelectedLeads([]);
        setSelectAll(false);
        setShowResumeOptions(false);
      }
      setExpandedFolder(folderId);
    }
  };

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
      setSelectedLeads(leads.map((lead) => lead._id));
    }
    setSelectAll(!selectAll);
  };

  const startDialSession = async () => {
    if (selectedLeads.length === 0) {
      alert("Please select at least one lead.");
      return;
    }

    if (!selectedNumber) {
      alert("Please select a number to call from before starting the dial session.");
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Microphone access is required to start dialing!");
      return;
    }

    localStorage.setItem("selectedDialNumber", selectedNumber);
    router.push(`/dial-session?leads=${selectedLeads.join(",")}&fromNumber=${encodeURIComponent(selectedNumber)}`);
  };

  const handleDeleteFolder = async (folderId: string) => {
    const confirmed = confirm("Are you sure you want to delete this folder? This cannot be undone.");
    if (!confirmed) return;

    try {
      const res = await fetch("/api/delete-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });

      const data = await res.json();
      if (data.success) {
        setFolders(folders.filter((f) => f._id !== folderId));
        if (expandedFolder === folderId) {
          setExpandedFolder(null);
          setLeads([]);
        }
      } else {
        alert(data.message || "Failed to delete folder.");
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
      alert("An error occurred while deleting the folder.");
    }
  };

  // 🔄 Updated: hard-redirect to your OAuth start endpoint
  const handleConnectGoogleSheet = () => {
    window.location.href = "/api/connect/google-sheets";
  };

  const handleDisposition = async (leadId: string, disposition: string) => {
    if (disposition === "No Answer") return;

    try {
      const res = await fetch("/api/disposition-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, newFolderName: disposition }),
      });

      const data = await res.json();
      if (data.success) {
        setLeads(leads.filter((l) => l._id !== leadId));
        fetchFolders();
        setPreviewLead(null);
      } else {
        console.error("Disposition failed:", data.message);
      }
    } catch (err) {
      console.error("Error updating disposition:", err);
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Top actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setShowImport(!showImport)}
          className="bg-[#6b5b95] text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          {showImport ? "Close Import" : "Import Leads"}
        </button>
        <button
          onClick={handleConnectGoogleSheet}
          className="bg-green-600 text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          Connect Google Sheet
        </button>
      </div>

      {/* Global lead search (click → /dial/[leadId]) */}
      <LeadSearchInline />

      {showImport && <LeadImportPanel onImportSuccess={fetchFolders} />}

      <h3 className="font-bold text-lg">Lead Folders</h3>
      <div className="space-y-2">
        {folders.length === 0 && <p>No folders found.</p>}
        {folders.map((folder) => (
          <div key={folder._id}>
            <div className="flex items-center justify-between">
              <button
                onClick={() => toggleFolder(folder._id)}
                className={`block text-left p-2 border rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer w-full ${
                  expandedFolder === folder._id ? "bg-[#6b5b95] text-white" : ""
                }`}
              >
                {folder.name} — {folder.leadCount || 0} Leads
              </button>
              {!SYSTEM_FOLDERS.includes(folder.name) && (
                <button
                  onClick={() => handleDeleteFolder(folder._id)}
                  className="text-red-600 hover:text-red-800 px-2 cursor-pointer"
                  title="Delete Folder"
                >
                  🗑️
                </button>
              )}
            </div>

            {expandedFolder === folder._id && leads.length > 0 && (
              <div className="border p-4 rounded mt-2 overflow-auto bg-gray-100 dark:bg-gray-800">
                <div className="flex flex-col space-y-2 mb-2">
                  <label className="font-semibold">Select Number to Call From:</label>
                  <select
                    value={selectedNumber}
                    onChange={(e) => setSelectedNumber(e.target.value)}
                    className="border p-2 rounded w-full cursor-pointer"
                  >
                    <option value="">-- Choose a number --</option>
                    {numbers.map((num) => (
                      <option key={num.id} value={num.phoneNumber}>
                        {num.phoneNumber}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-between items-center mb-2">
                  <div className="flex space-x-2">
                    <button onClick={handleSelectAll} className="border px-3 py-1 rounded cursor-pointer">
                      {selectAll ? "Deselect All" : "Select All"}
                    </button>
                    <span className="text-sm">{selectedLeads.length} leads selected</span>
                  </div>

                  <button
                    onClick={startDialSession}
                    className={`${
                      selectedLeads.length > 0 ? "bg-green-600" : "bg-gray-400 cursor-not-allowed"
                    } text-white px-3 py-1 rounded cursor-pointer`}
                    disabled={selectedLeads.length === 0}
                  >
                    Start Dial Session
                  </button>
                </div>

                <table className="min-w-full text-base">
                  <thead>
                    <tr>
                      <th></th>
                      <th>#</th>
                      <th>First Name</th>
                      <th>Last Name</th>
                      <th>Phone</th>
                      <th>Email</th>
                      <th>State</th>
                      <th>Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, index) => (
                      <tr key={lead._id} className="border-t">
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedLeads.includes(lead._id)}
                            onChange={() => toggleLeadSelection(lead._id)}
                            className="cursor-pointer"
                          />
                        </td>
                        <td>{index + 1}</td>
                        <td>
                          <button
                            onClick={() => setPreviewLead(lead)}
                            className="text-blue-500 underline cursor-pointer"
                          >
                            {lead.firstName || lead["First Name"] || "-"}
                          </button>
                        </td>
                        <td>{lead.lastName || lead["Last Name"] || "-"}</td>
                        <td>{lead.phone || lead["Phone"] || "-"}</td>
                        <td>{lead.email || lead["Email"] || "-"}</td>
                        <td>{lead.state || lead["State"] || "-"}</td>
                        <td>{lead.age ?? lead["Age"] ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {previewLead && (
        <div className="bg-white dark:bg-gray-900 rounded shadow p-4">
          <LeadPreviewPanel
            lead={previewLead}
            onClose={() => setPreviewLead(null)}
            onSaveNotes={(notes: string) => {
              const updatedLeads = leads.map((l) =>
                l._id === previewLead._id ? { ...l, Notes: notes } : l
              );
              setLeads(updatedLeads);
              setPreviewLead({ ...previewLead, Notes: notes });
            }}
            onDispositionChange={(disposition) => handleDisposition(previewLead._id, disposition)}
          />

          {previewLead.hasAIAccess && Array.isArray(previewLead.callTranscripts) && (
            <div className="mt-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-2">🧠 AI Call Summary</h2>
                <div className="p-3 bg-yellow-50 border rounded shadow text-sm text-gray-800">
                  {previewLead.aiSummary || "No AI summary generated yet."}
                </div>
              </div>

              <div>
                <h2 className="text-lg font-semibold mb-2">📞 Full Call Transcript</h2>
                <div className="space-y-4 max-h-64 overflow-y-auto border rounded p-4 bg-gray-50">
                  {previewLead.callTranscripts.map((entry: any, index: number) => (
                    <div key={index} className="border-b pb-2">
                      <p className="text-sm text-gray-700 whitespace-pre-line">{entry.text}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(entry.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
