// pages/leads.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import LeadImportPanel from "@/components/LeadImportPanel";
import LeadPreviewPanel from "@/components/LeadPreviewPanel";

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

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

/** ───────────────────────── Global lead search ───────────────────────── **/
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
    router.push(`/dial/${id}`).catch(() => {});
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
          className="border p-2 rounded w-full pr-10 text-black"
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

/** ───────────────────────────── Page ───────────────────────────── **/
export default function LeadsPage() {
  const router = useRouter();
  const selectedFolderId = useMemo(
    () => (typeof router.query.folderId === "string" ? router.query.folderId : ""),
    [router.query.folderId]
  );

  // folders + leads + loading
  const [folders, setFolders] = useState<Folder[]>([]);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);

  // dial controls
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);

  // server resume pointer
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

  // preview panel
  const [previewLead, setPreviewLead] = useState<any | null>(null);

  /** fetch folders */
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        setLoading(true);
        setError(null);

        const resFolders = await fetch("/api/get-folders");
        if (!resFolders.ok) throw new Error("Failed to fetch folders");
        const dataFolders = await resFolders.json();

        setFolders(dataFolders.folders || []);
      } catch (err: any) {
        console.error("Error fetching folders:", err);
        setError(err?.message || "Failed to load folders");
      } finally {
        setLoading(false);
      }
    };

    fetchFolders();
  }, []);

  /** fetch numbers to call from */
  useEffect(() => {
    const fetchNumbers = async () => {
      try {
        const res = await fetch("/api/getNumbers");
        const data = await res.json();
        setNumbers(data.numbers || []);
        const saved = localStorage.getItem("selectedDialNumber");
        if (saved) setSelectedNumber(saved);
      } catch (error) {
        console.error("Error fetching numbers:", error);
        setNumbers([]);
      }
    };
    fetchNumbers();
  }, []);

  /** load leads for folder + server resume pointer */
  useEffect(() => {
    const loadLeads = async () => {
      if (!selectedFolderId) {
        setLeads(null);
        setLeadError(null);
        setSelectedLeadIds([]);
        setSelectAll(false);
        setResumeInfo(null);
        return;
      }
      try {
        setLoadingLeads(true);
        setLeadError(null);
        const r = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(selectedFolderId)}`);
        if (!r.ok) throw new Error("Failed to fetch leads in folder");
        const j = await r.json();
        const rows: Lead[] = Array.isArray(j?.leads) ? j.leads : [];
        setLeads(rows);

        // restore per-folder selection
        try {
          const saved = localStorage.getItem(`selectedLeads_${selectedFolderId}`);
          setSelectedLeadIds(saved ? (JSON.parse(saved) as string[]) : []);
          setSelectAll(false);
        } catch {
          setSelectedLeadIds([]);
          setSelectAll(false);
        }
      } catch (e: any) {
        console.error(e);
        setLeadError(e?.message || "Failed to load leads");
        setLeads([]);
      } finally {
        setLoadingLeads(false);
      }

      // server pointer
      try {
        const key = `folder:${selectedFolderId}`;
        const r2 = await fetch(`/api/dial/progress?key=${encodeURIComponent(key)}`);
        if (!r2.ok) setResumeInfo(null);
        else {
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
    loadLeads();
  }, [selectedFolderId]);

  /** persist selected ids per-folder */
  useEffect(() => {
    if (selectedFolderId) {
      try {
        localStorage.setItem(`selectedLeads_${selectedFolderId}`, JSON.stringify(selectedLeadIds));
      } catch {}
    }
  }, [selectedLeadIds, selectedFolderId]);

  /** nav helpers */
  const handleFolderClick = (folderId: string) => {
    router.push({ pathname: "/leads", query: { folderId } }).catch(() => {});
  };
  const clearSelection = () => {
    router.push("/leads").catch(() => {});
  };
  const selectedFolderName =
    (selectedFolderId && folders.find((f) => f._id === selectedFolderId)?.name) || "";

  /** progress keys */
  const buildLocalProgressKey = () => {
    const folder = selectedFolderId || "no-folder";
    const ids = selectedLeadIds.join(",");
    return `dialProgress:${folder}:${ids}`;
  };
  const buildServerProgressKey = () => {
    const folder = selectedFolderId || "no-folder";
    return `folder:${folder}`;
  };

  /** selection toggles */
  const toggleLeadSelection = (id: string) => {
    if (selectedLeadIds.includes(id)) {
      setSelectedLeadIds(selectedLeadIds.filter((x) => x !== id));
    } else {
      setSelectedLeadIds([...selectedLeadIds, id]);
    }
  };
  const handleSelectAll = () => {
    if (!leads) return;
    if (selectAll) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(leads.map((l) => l._id));
    }
    setSelectAll(!selectAll);
  };

  /** Start Dial Session — ALWAYS fresh: clear local pointer + reset server pointer, then start at 0 */
  const startDialSession = async () => {
    if (!leads || leads.length === 0) return;
    if (selectedLeadIds.length === 0) {
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

    const progressKey = buildLocalProgressKey();
    try {
      localStorage.removeItem(progressKey); // start fresh: clear local resume
    } catch {}

    localStorage.setItem("selectedDialNumber", selectedNumber);

    // Reset server resume pointer to -1 for this folder BEFORE starting
    const serverKey = buildServerProgressKey();
    try {
      await fetch("/api/dial/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: serverKey, lastIndex: -1, total: selectedLeadIds.length }),
      });
      setResumeInfo(null);
    } catch {
      /* ignore and proceed */
    }

    const params = new URLSearchParams({
      leads: selectedLeadIds.join(","),
      fromNumber: selectedNumber,
      startIndex: "0",
      progressKey,
      serverProgressKey: serverKey,
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  /** Quick Resume button beside Start Dial Session (server-backed) */
  const handleResumeQuickButton = async () => {
    const hasLeads = !!leads && leads.length > 0;
    const hasResume =
      !!selectedFolderId &&
      hasLeads &&
      !!resumeInfo &&
      resumeInfo.lastIndex != null &&
      resumeInfo.lastIndex >= 0;

    if (!hasResume) return;
    if (!selectedNumber) {
      alert("Please select a number to call from before resuming.");
      return;
    }
    localStorage.setItem("selectedDialNumber", selectedNumber);

    const serverKey = buildServerProgressKey();
    const ids = selectedLeadIds.length ? selectedLeadIds : (leads as Lead[]).map((l) => l._id);
    const startAt = Math.max(0, (resumeInfo?.lastIndex ?? -1) + 1);

    const params = new URLSearchParams({
      leads: ids.join(","),
      fromNumber: selectedNumber,
      startIndex: String(startAt),
      progressKey: buildLocalProgressKey(),
      serverProgressKey: serverKey,
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  /** delete folder (unchanged behavior) */
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
        if (selectedFolderId === folderId) {
          clearSelection();
        }
      } else {
        alert(data.message || "Failed to delete folder.");
      }
    } catch (error) {
      console.error("Error deleting folder:", error);
      alert("An error occurred while deleting the folder.");
    }
  };

  /** OAuth start */
  const handleConnectGoogleSheet = () => {
    window.location.href = "/api/connect/google-sheets";
  };

  /** Move lead to disposition folder (same as your component) */
  const handleDisposition = async (leadId: string, disposition: string) => {
    if (disposition === "No Answer") return;

    try {
      // 🔍 One-line log so we can verify outgoing payload during QA
      console.log("UI disposition payload →", { leadId, newFolderName: disposition });

      const res = await fetch("/api/disposition-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, newFolderName: disposition }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        console.error("Disposition failed:", data?.message || res.statusText);
        return;
      }

      setLeads((prev) => (Array.isArray(prev) ? prev.filter((l) => l._id !== leadId) : prev));

      // refresh folder counts + reload leads in current folder
      await Promise.all([
        fetch("/api/get-folders")
          .then((r) => r.json())
          .then((j) => setFolders(Array.isArray(j?.folders) ? j.folders : []))
          .catch(() => {}),
        selectedFolderId
          ? fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(selectedFolderId)}`)
              .then((r) => r.json())
              .then((j) => setLeads(Array.isArray(j?.leads) ? j.leads : []))
              .catch(() => {})
          : Promise.resolve(),
      ]);

      setPreviewLead(null);
    } catch (err) {
      console.error("Error updating disposition:", err);
    }
  };

  /** derived */
  const hasResume =
    !!selectedFolderId &&
    !!leads &&
    leads.length > 0 &&
    !!resumeInfo &&
    resumeInfo.lastIndex != null &&
    resumeInfo.lastIndex >= 0;

  const canStart = selectedLeadIds.length > 0;
  const canResume = hasResume && !!selectedNumber && !!leads && leads.length > 0;

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />
      <div className="flex-1 p-6">
        {/* Top actions */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={handleConnectGoogleSheet}
            className="bg-green-600 text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
          >
            Connect Google Sheet
          </button>
        </div>

        {/* Global search */}
        <LeadSearchInline />

        {!selectedFolderId ? (
          <>
            <h2 className="text-2xl font-bold mb-4">Lead Folders</h2>
            {loading ? (
              <p>Loading folders…</p>
            ) : error ? (
              <p className="text-red-400">{error}</p>
            ) : folders.length === 0 ? (
              <p className="text-gray-400">No folders yet.</p>
            ) : (
              <div className="space-y-2">
                {folders.map((folder) => (
                  <div key={folder._id} className="flex items-center justify-between">
                    <button
                      onClick={() => handleFolderClick(folder._id)}
                      className="w-full text-left border p-3 rounded cursor-pointer hover:bg-gray-700"
                      title={`Open ${folder.name}`}
                    >
                      {folder.name} — {folder.leadCount ?? 0} Leads
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
                ))}
              </div>
            )}

            {/* Import panel lives here when no folder is opened */}
            <div className="mt-6">
              <LeadImportPanel
                onImportSuccess={async () => {
                  try {
                    const r = await fetch("/api/get-folders");
                    const j = await r.json();
                    setFolders(Array.isArray(j?.folders) ? j.folders : []);
                  } catch {}
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Folder: {selectedFolderName || selectedFolderId}</h2>
              <button
                onClick={clearSelection}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
                title="Back to all folders"
              >
                ← All Folders
              </button>
            </div>

            {/* Dial controls */}
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-col">
                <label className="font-semibold">Select Number to Call From:</label>
                <select
                  value={selectedNumber}
                  onChange={(e) => setSelectedNumber(e.target.value)}
                  className="border p-2 rounded w-full cursor-pointer text-black"
                >
                  <option value="">-- Choose a number --</option>
                  {numbers.map((n) => (
                    <option key={n.id} value={n.phoneNumber}>
                      {n.phoneNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={handleSelectAll} className="border px-3 py-1 rounded cursor-pointer">
                    {selectAll ? "Deselect All" : "Select All"}
                  </button>
                  <span className="text-sm text-gray-300">{selectedLeadIds.length} selected</span>
                </div>

                {/* Right-side actions: Start + Resume */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={startDialSession}
                    className={`${
                      canStart ? "bg-green-600 hover:bg-green-700" : "bg-gray-500 cursor-not-allowed"
                    } text-white px-3 py-1 rounded`}
                    disabled={!canStart}
                    title="Start from the beginning (fresh)"
                  >
                    Start Dial Session
                  </button>

                  <button
                    onClick={handleResumeQuickButton}
                    className={`${
                      canResume ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-500 cursor-not-allowed"
                    } text-white px-3 py-1 rounded`}
                    disabled={!canResume}
                    title={hasResume ? "Resume where you left off" : "No server resume available for this folder yet"}
                  >
                    Resume
                  </button>
                </div>
              </div>
            </div>

            {loadingLeads ? (
              <p>Loading leads…</p>
            ) : leadError ? (
              <p className="text-red-400">{leadError}</p>
            ) : !leads || leads.length === 0 ? (
              <p className="text-gray-400">No leads in this folder.</p>
            ) : (
              <div className="border p-4 rounded mt-2 overflow-auto bg-gray-100 dark:bg-gray-800">
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
                    {leads.map((lead, index) => {
                      const checked = selectedLeadIds.includes(lead._id);
                      return (
                        <tr key={lead._id} className={`border-t ${checked ? "bg-gray-700 text-white" : ""}`}>
                          <td className="px-2">
                            <input
                              type="checkbox"
                              className="cursor-pointer"
                              checked={checked}
                              onChange={() => toggleLeadSelection(lead._id)}
                            />
                          </td>
                          <td className="px-2">{index + 1}</td>
                          <td className="px-2">
                            <button
                              onClick={() => setPreviewLead(lead)}
                              className="text-blue-500 underline cursor-pointer"
                            >
                              {lead.firstName || (lead as any)["First Name"] || "-"}
                            </button>
                          </td>
                          <td className="px-2">{lead.lastName || (lead as any)["Last Name"] || "-"}</td>
                          <td className="px-2">{lead.phone || (lead as any)["Phone"] || "-"}</td>
                          <td className="px-2">{lead.email || (lead as any)["Email"] || "-"}</td>
                          <td className="px-2">{lead.state || (lead as any)["State"] || "-"}</td>
                          <td className="px-2">{(lead as any).age ?? (lead as any)["Age"] ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Preview panel with AI bits (kept) */}
            {previewLead && (
              <div className="bg-white text-black dark:bg-gray-900 dark:text-white rounded shadow p-4 mt-4">
                <LeadPreviewPanel
                  lead={previewLead}
                  onClose={() => setPreviewLead(null)}
                  onSaveNotes={(notes: string) => {
                    if (!leads) return;
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
          </>
        )}
      </div>
    </div>
  );
}
