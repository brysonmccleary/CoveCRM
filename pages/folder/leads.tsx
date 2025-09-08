// pages/folder/leads.tsx
import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import LeadPreviewPanel from "../../components/LeadPreviewPanel";

/** ───────────────────────── Types ───────────────────────── */
interface Folder {
  _id: string;
  name: string;
  leadCount?: number;
}

interface Lead {
  _id: string;
  [key: string]: any;
}

type NumberEntry = { id: string; phoneNumber: string; sid: string };
type ResumeInfo = { lastIndex: number | null; total: number | null; updatedAt?: string | null };

/** ───────────────────────── Page ───────────────────────── */
export default function LeadsPage() {
  const router = useRouter();

  // Folders & active folder
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState<Folder | null>(null);

  // Leads & filtering
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<Lead[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Selection
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  // Dial controls
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string>("");

  // Resume (server-backed)
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

  // Preview
  const [previewLead, setPreviewLead] = useState<Lead | null>(null);

  /** Load folders */
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        const res = await fetch("/api/get-folders");
        const j = await res.json();
        const rows: Folder[] = Array.isArray(j?.folders) ? j.folders : Array.isArray(j) ? j : [];
        setFolders(rows);
      } catch {
        setFolders([]);
      }
    };
    fetchFolders();
  }, []);

  /** Load numbers and restore last used */
  useEffect(() => {
    const run = async () => {
      try {
        const r = await fetch("/api/getNumbers");
        const j = await r.json();
        setNumbers(Array.isArray(j?.numbers) ? j.numbers : []);
      } catch {
        setNumbers([]);
      }
      try {
        const saved = localStorage.getItem("selectedDialNumber");
        if (saved) setSelectedNumber(saved);
      } catch {
        // ignore
      }
    };
    run();
  }, []);

  /** Load leads when active folder changes; also fetch server resume pointer */
  useEffect(() => {
    const fetchLeads = async () => {
      if (!activeFolder?._id) {
        setLeads([]);
        setFilteredLeads([]);
        setSelectedLeads([]);
        setSelectAll(false);
        setResumeInfo(null);
        return;
      }

      try {
        const res = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(activeFolder._id)}`);
        const j = await res.json();
        const rows: Lead[] = Array.isArray(j?.leads) ? j.leads : Array.isArray(j) ? j : [];
        setLeads(rows);
        setFilteredLeads(rows);
        setSelectedLeads([]);
        setSelectAll(false);
      } catch {
        setLeads([]);
        setFilteredLeads([]);
      }

      // Server-backed resume pointer
      try {
        const key = `folder:${activeFolder._id}`;
        const r2 = await fetch(`/api/dial/progress?key=${encodeURIComponent(key)}`);
        if (!r2.ok) {
          setResumeInfo(null);
        } else {
          const j2 = await r2.json();
          setResumeInfo({
            lastIndex: j2?.lastIndex ?? null,
            total: j2?.total ?? null,
            updatedAt: j2?.updatedAt ?? null,
          });
        }
      } catch {
        setResumeInfo(null);
      }
    };
    fetchLeads();
  }, [activeFolder?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Search filter */
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredLeads(leads);
      return;
    }
    const lower = searchQuery.toLowerCase();
    const filtered = leads.filter((lead) => {
      const fn = String(lead["First Name"] ?? lead.firstName ?? "").toLowerCase();
      const ln = String(lead["Last Name"] ?? lead.lastName ?? "").toLowerCase();
      const ph = String(lead["Phone"] ?? lead.phone ?? "").toLowerCase();
      const em = String(lead["Email"] ?? lead.email ?? "").toLowerCase();
      return fn.includes(lower) || ln.includes(lower) || ph.includes(lower) || em.includes(lower);
    });
    setFilteredLeads(filtered);
  }, [searchQuery, leads]);

  /** Helpers */
  const toggleLeadSelection = (id: string) => {
    setSelectedLeads((prev) => (prev.includes(id) ? prev.filter((leadId) => leadId !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedLeads([]);
    } else {
      setSelectedLeads(filteredLeads.map((lead) => String(lead._id)));
    }
    setSelectAll(!selectAll);
  };

  /** Progress keys */
  const buildLocalProgressKey = () => {
    const folder = activeFolder?._id ?? "no-folder";
    const ids = selectedLeads.join(",");
    return `dialProgress:${folder}:${ids}`;
  };
  const buildServerProgressKey = () => {
    const folder = activeFolder?._id ?? "no-folder";
    return `folder:${folder}`;
  };

  /** Start Dial Session (keeps existing local resume prompt behavior) */
  const startDialSession = async () => {
    if (selectedLeads.length === 0) {
      alert("No leads selected");
      return;
    }
    if (!selectedNumber) {
      alert("Please select a number to call from.");
      return;
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Microphone access is required to start dialing!");
      return;
    }

    const progressKey = buildLocalProgressKey();
    const savedRaw = typeof window !== "undefined" ? localStorage.getItem(progressKey) : null;
    const saved = savedRaw ? (JSON.parse(savedRaw) as { index: number }) : null;
    const maxIndex = selectedLeads.length - 1;

    let startIndex = 0;
    if (saved && typeof saved.index === "number" && saved.index >= 0 && saved.index <= maxIndex) {
      const resume = window.confirm(
        `Resume where you left off?\n\nSaved position: ${saved.index + 1} of ${selectedLeads.length}.\n\nOK = Resume • Cancel = Start Fresh`
      );
      startIndex = resume ? saved.index : 0;
      if (!resume) localStorage.removeItem(progressKey);
    }

    localStorage.setItem("selectedDialNumber", selectedNumber);

    const params = new URLSearchParams({
      leads: selectedLeads.join(","),
      fromNumber: selectedNumber,
      startIndex: String(startIndex),
      progressKey,
      serverProgressKey: buildServerProgressKey(),
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  /** Quick blue Resume (server-backed) */
  const quickResume = async () => {
    const hasResume =
      !!resumeInfo && resumeInfo.lastIndex != null && resumeInfo.lastIndex >= 0 && filteredLeads.length > 0;
    if (!hasResume) return;
    if (!selectedNumber) {
      alert("Please select a number to call from before resuming.");
      return;
    }

    localStorage.setItem("selectedDialNumber", selectedNumber);

    // If no manual selection, use all leads currently filtered/shown
    const ids = selectedLeads.length ? selectedLeads : filteredLeads.map((l) => String(l._id));
    const startAt = Math.max(0, (resumeInfo!.lastIndex ?? -1) + 1);

    const params = new URLSearchParams({
      leads: ids.join(","),
      fromNumber: selectedNumber,
      startIndex: String(startAt),
      progressKey: buildLocalProgressKey(),
      serverProgressKey: buildServerProgressKey(),
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  /** Reset server pointer (Start Fresh from banner) */
  const resetServerPointerAndStart = async () => {
    if (!selectedNumber) {
      alert("Please select a number to call from before starting.");
      return;
    }
    const key = buildServerProgressKey();
    try {
      await fetch("/api/dial/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, lastIndex: -1, total: filteredLeads.length }),
      });
      setResumeInfo(null);
    } catch {
      // ignore; proceed anyway
    }

    localStorage.setItem("selectedDialNumber", selectedNumber);
    const ids = selectedLeads.length ? selectedLeads : filteredLeads.map((l) => String(l._id));
    const params = new URLSearchParams({
      leads: ids.join(","),
      fromNumber: selectedNumber,
      startIndex: "0",
      progressKey: buildLocalProgressKey(),
      serverProgressKey: key,
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  /** Derived booleans */
  const hasResume =
    !!resumeInfo && resumeInfo.lastIndex != null && resumeInfo.lastIndex >= 0 && filteredLeads.length > 0;
  const canStart = selectedLeads.length > 0;
  const canResume = hasResume && !!selectedNumber && filteredLeads.length > 0;

  /** Render */
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
            {folder.name} {typeof folder.leadCount === "number" ? `— ${folder.leadCount} Leads` : ""}
          </button>
        ))}
      </div>

      {/* Leads panel */}
      <div className="flex-1 bg-[#1f2937] text-white p-4 overflow-auto">
        {activeFolder ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold">{activeFolder.name} Leads</h2>
              <div className="text-sm text-gray-300">
                Selected: {selectedLeads.length}/{filteredLeads.length}
              </div>
            </div>

            {/* Server-backed Resume banner */}
            {hasResume && (
              <div className="mb-3 p-3 rounded bg-amber-50 text-amber-900 border border-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    You last called{" "}
                    <strong>{(resumeInfo!.lastIndex ?? -1) + 1}</strong> of{" "}
                    <strong>{resumeInfo!.total ?? filteredLeads.length}</strong> in this list.
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={quickResume}
                      className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                      Resume
                    </button>
                    <button
                      onClick={resetServerPointerAndStart}
                      className="px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800"
                    >
                      Start Fresh
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Search */}
            <input
              type="text"
              placeholder="Search by name, email, or number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border p-2 rounded w-full text-black mb-4"
            />

            {/* Number selector */}
            <div className="mb-3">
              <label className="font-semibold block mb-1">Select Number to Call From:</label>
              <select
                value={selectedNumber}
                onChange={(e) => setSelectedNumber(e.target.value)}
                className="border p-2 rounded w-full text-black"
              >
                <option value="">-- Choose a number --</option>
                {numbers.map((n) => (
                  <option key={n.id} value={n.phoneNumber}>
                    {n.phoneNumber}
                  </option>
                ))}
              </select>
            </div>

            <div className="border border-white p-4 rounded overflow-auto">
              <div className="flex justify-between items-center mb-2">
                <button
                  onClick={handleSelectAll}
                  className="border border-white px-3 py-1 rounded hover:bg-[#6b5b95] hover:text-white"
                >
                  {selectAll ? "Deselect All" : "Select All"}
                </button>

                {/* Right-side actions: Start + blue Resume */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={startDialSession}
                    disabled={!canStart}
                    className={`${
                      canStart ? "bg-green-600 hover:bg-green-700" : "bg-gray-600 cursor-not-allowed"
                    } text-white px-4 py-2 rounded disabled:opacity-60`}
                  >
                    Start Dial Session
                  </button>
                  <button
                    onClick={quickResume}
                    disabled={!canResume}
                    className={`${
                      canResume ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-600 cursor-not-allowed"
                    } text-white px-4 py-2 rounded disabled:opacity-60`}
                    title={hasResume ? "Resume where you left off" : "No server resume available yet"}
                  >
                    Resume
                  </button>
                </div>
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
                      key={String(lead._id)}
                      className="border-t border-white cursor-pointer hover:bg-[#6b5b95] hover:text-white"
                      onClick={() => setPreviewLead(lead)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedLeads.includes(String(lead._id))}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleLeadSelection(String(lead._id));
                          }}
                        />
                      </td>
                      <td>{lead["First Name"] ?? lead.firstName ?? "-"}</td>
                      <td>{lead["Last Name"] ?? lead.lastName ?? "-"}</td>
                      <td>{lead["Phone"] ?? lead.phone ?? "-"}</td>
                      <td>{lead["Email"] ?? lead.email ?? "-"}</td>
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
            onSaveNotes={async (notes: string) => {
              if (!previewLead?._id) return;
              const res = await fetch(`/api/leads/add-note`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId: String(previewLead._id), text: notes }),
              });
              if (res.ok) {
                setPreviewLead({ ...previewLead, Notes: notes, notes });
                const updated = leads.map((l) =>
                  String(l._id) === String(previewLead._id) ? { ...l, Notes: notes, notes } : l
                );
                setLeads(updated);
                setFilteredLeads(updated);
              } else {
                const j = await res.json().catch(() => ({}));
                alert(j?.message || "Failed to save notes");
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Note:
 * Next.js will route /leads to this file (`pages/leads/index.tsx`) instead of `pages/leads.tsx`.
 * That’s why the blue Resume button didn’t appear earlier. This file now includes:
 * - Blue “Resume” button next to “Start Dial Session”
 * - Server-backed banner (Resume / Start Fresh)
 * - Local resume prompt preserved on Start
 * - Number selector persisted via localStorage (`selectedDialNumber`)
 */
