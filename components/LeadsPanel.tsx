import React, { useState, useEffect } from "react";
import LeadImportPanel from "./LeadImportPanel";
import LeadPreviewPanel from "./LeadPreviewPanel";
import { useRouter } from "next/router";

export default function LeadsPanel() {
  const [showImport, setShowImport] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showResumeOptions, setShowResumeOptions] = useState(false);
  const [previewLead, setPreviewLead] = useState<any | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchFolders = async () => {
      const res = await fetch("/api/get-folders");
      const data = await res.json();
      const foldersWithCounts = await Promise.all(
        data.folders.map(async (folder: any) => {
          const leadsRes = await fetch(`/api/get-leads-by-folder?folderId=${folder._id}`);
          const leadsData = await leadsRes.json();
          return { ...folder, leadCount: Array.isArray(leadsData.leads) ? leadsData.leads.length : 0 };
        })
      );
      setFolders(foldersWithCounts);
    };
    fetchFolders();
  }, []);

  useEffect(() => {
    if (!expandedFolder) return;
    const fetchLeads = async () => {
      const res = await fetch(`/api/get-leads-by-folder?folderId=${expandedFolder}`);
      const data = await res.json();
      setLeads(Array.isArray(data.leads) ? data.leads : []);
      setSelectedLeads([]);
      setSelectAll(false);
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

  const startDialSession = () => {
    if (selectedLeads.length === 0) {
      alert("Please select at least one lead.");
      return;
    }
    router.push(`/dial-session?leads=${selectedLeads.join(",")}`);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex space-x-2">
        <button
          onClick={() => setShowImport(!showImport)}
          className="bg-[#6b5b95] text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          {showImport ? "Close Import" : "Import Leads"}
        </button>
        <button
          onClick={() => alert("Google Sheets connect flow coming soon!")}
          className="bg-green-600 text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          Connect Google Sheet
        </button>
      </div>

      {showImport && <LeadImportPanel />}

      <h3 className="font-bold text-lg">Lead Folders</h3>
      <div className="space-y-2">
        {(Array.isArray(folders) ? folders : []).map((folder) => (
          <div key={folder._id}>
            <button
              onClick={() => toggleFolder(folder._id)}
              className={`block w-full text-left p-2 border rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer ${
                expandedFolder === folder._id ? "bg-[#6b5b95] text-white" : ""
              }`}
            >
              {folder.name} — {folder.leadCount || 0} Leads
            </button>

            {expandedFolder === folder._id && leads.length > 0 && (
              <div className="border p-4 rounded mt-2 overflow-auto bg-gray-100 dark:bg-gray-800">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex space-x-2">
                    <button
                      onClick={handleSelectAll}
                      className="border px-3 py-1 rounded cursor-pointer"
                    >
                      {selectAll ? "Deselect All" : "Select All"}
                    </button>
                    <span className="text-sm">{selectedLeads.length} leads selected</span>
                  </div>

                  {showResumeOptions ? (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          const saved = JSON.parse(localStorage.getItem(`selectedLeads_${folder._id}`) || "[]");
                          setSelectedLeads(saved);
                          setShowResumeOptions(false);
                          setTimeout(() => startDialSession(), 100);
                        }}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded cursor-pointer"
                      >
                        Continue Calling
                      </button>
                      <button
                        onClick={() => {
                          localStorage.removeItem(`selectedLeads_${folder._id}`);
                          setSelectedLeads(leads.map((lead) => lead._id));
                          setSelectAll(true);
                          setShowResumeOptions(false);
                          setTimeout(() => startDialSession(), 100);
                        }}
                        className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded cursor-pointer"
                      >
                        Start From Scratch
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={startDialSession}
                      className={`${
                        selectedLeads.length > 0 ? "bg-green-600 cursor-pointer" : "bg-gray-400 cursor-not-allowed"
                      } text-white px-3 py-1 rounded`}
                      disabled={selectedLeads.length === 0}
                    >
                      Start Dial Session
                    </button>
                  )}
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
                          />
                        </td>
                        <td>{index + 1}</td>
                        <td>
                          <button
                            onClick={() => setPreviewLead(lead)}
                            className="text-blue-500 underline cursor-pointer"
                          >
                            {lead["First Name"]}
                          </button>
                        </td>
                        <td>{lead["Last Name"]}</td>
                        <td>{lead["Phone"]}</td>
                        <td>{lead["Email"]}</td>
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
        />
      )}
    </div>
  );
}
