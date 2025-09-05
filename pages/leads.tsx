import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";

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
type ResumeInfo = { lastIndex: number | null; total: number | null };

export default function LeadsPage() {
  const router = useRouter();
  const selectedFolderId = useMemo(
    () => (typeof router.query.folderId === "string" ? router.query.folderId : ""),
    [router.query.folderId]
  );

  const [folders, setFolders] = useState<Folder[]>([]);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);

  // Additions for dialing from this page
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

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

  // numbers list for “call from”
  useEffect(() => {
    const fetchNumbers = async () => {
      try {
        const res = await fetch("/api/getNumbers");
        const data = await res.json();
        setNumbers(data.numbers || []);
        // pick last used number if available
        const saved = localStorage.getItem("selectedDialNumber");
        if (saved) setSelectedNumber(saved);
      } catch (error) {
        console.error("Error fetching numbers:", error);
        setNumbers([]);
      }
    };
    fetchNumbers();
  }, []);

  // If a folderId is present in the query, load its leads and render on this page.
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

        // restore any selection for this folder (your prior pattern)
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

      // Fetch server-backed resume pointer for this folder
      try {
        const key = `folder:${selectedFolderId}`;
        const r2 = await fetch(`/api/dial/progress?key=${encodeURIComponent(key)}`);
        if (!r2.ok) {
          setResumeInfo(null);
        } else {
          const j2 = await r2.json();
          setResumeInfo({ lastIndex: j2?.lastIndex ?? null, total: j2?.total ?? null });
        }
      } catch {
        setResumeInfo(null);
      }
    };
    loadLeads();
  }, [selectedFolderId]);

  // persist selected ids per-folder
  useEffect(() => {
    if (selectedFolderId) {
      try {
        localStorage.setItem(`selectedLeads_${selectedFolderId}`, JSON.stringify(selectedLeadIds));
      } catch {}
    }
  }, [selectedLeadIds, selectedFolderId]);

  const handleFolderClick = (folderId: string) => {
    router.push({ pathname: "/leads", query: { folderId } }).catch(() => {});
  };

  const clearSelection = () => {
    router.push("/leads").catch(() => {});
  };

  const selectedFolderName =
    (selectedFolderId && folders.find((f) => f._id === selectedFolderId)?.name) || "";

  // helpers for progress keys (keep your original localStorage behavior)
  const buildLocalProgressKey = () => {
    const folder = selectedFolderId || "no-folder";
    const ids = selectedLeadIds.join(",");
    return `dialProgress:${folder}:${ids}`;
  };
  const buildServerProgressKey = () => {
    const folder = selectedFolderId || "no-folder";
    return `folder:${folder}`;
  };

  // selection toggles
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

  // start dial session (same flow you had in LeadsPanel)
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
    const savedRaw = localStorage.getItem(progressKey);
    const saved = savedRaw ? (JSON.parse(savedRaw) as { index: number }) : null;
    const maxIndex = selectedLeadIds.length - 1;

    let startIndex = 0;
    if (saved && typeof saved.index === "number" && saved.index >= 0 && saved.index <= maxIndex) {
      const resume = window.confirm(
        `Resume where you left off?\n\nSaved position: ${saved.index + 1} of ${selectedLeadIds.length}.\n\nOK = Resume • Cancel = Start Fresh`
      );
      startIndex = resume ? saved.index : 0;
      if (!resume) localStorage.removeItem(progressKey);
    }

    localStorage.setItem("selectedDialNumber", selectedNumber);

    const serverKey = buildServerProgressKey();
    const params = new URLSearchParams({
      leads: selectedLeadIds.join(","),
      fromNumber: selectedNumber,
      startIndex: String(startIndex),
      progressKey,
      serverProgressKey: serverKey,
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  // Resume banner actions
  const handleResumeBannerResume = async () => {
    if (!leads || leads.length === 0) return;
    const ids = selectedLeadIds.length ? selectedLeadIds : leads.map((l) => l._id);
    if (!selectedNumber) return alert("Please select a number to call from before resuming.");
    localStorage.setItem("selectedDialNumber", selectedNumber);

    const serverKey = buildServerProgressKey();
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

  const handleResumeBannerFresh = async () => {
    if (!leads || leads.length === 0) return;
    const ids = selectedLeadIds.length ? selectedLeadIds : leads.map((l) => l._id);
    if (!selectedNumber) return alert("Please select a number to call from before starting.");
    localStorage.setItem("selectedDialNumber", selectedNumber);

    const serverKey = buildServerProgressKey();
    try {
      await fetch("/api/dial/progress", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: serverKey }),
      });
    } catch {}

    const params = new URLSearchParams({
      leads: ids.join(","),
      fromNumber: selectedNumber,
      startIndex: "0",
      progressKey: buildLocalProgressKey(),
      serverProgressKey: serverKey,
    });
    router.push(`/dial-session?${params.toString()}`);
  };

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />
      <div className="flex-1 p-6">
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
                  <button
                    key={folder._id}
                    onClick={() => handleFolderClick(folder._id)}
                    className="w-full text-left border p-3 rounded cursor-pointer hover:bg-gray-700"
                    title={`Open ${folder.name}`}
                  >
                    {folder.name} — {folder.leadCount ?? 0} Leads
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold">
                Folder: {selectedFolderName || selectedFolderId}
              </h2>
              <button
                onClick={clearSelection}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
                title="Back to all folders"
              >
                ← All Folders
              </button>
            </div>

            {/* Resume / Start Fresh (server-backed) */}
            {resumeInfo?.lastIndex !== null && (
              <div className="mb-4 p-3 rounded bg-amber-50 text-amber-900 border border-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    You last called <strong>{(resumeInfo.lastIndex ?? -1) + 1}</strong> of{" "}
                    <strong>{resumeInfo.total ?? (leads?.length ?? 0)}</strong> in this list.
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleResumeBannerResume}
                      className="px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700"
                    >
                      Resume
                    </button>
                    <button
                      onClick={handleResumeBannerFresh}
                      className="px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800"
                    >
                      Start Fresh
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                <button
                  onClick={startDialSession}
                  className={`${
                    selectedLeadIds.length > 0 ? "bg-green-600" : "bg-gray-500 cursor-not-allowed"
                  } text-white px-3 py-1 rounded`}
                  disabled={selectedLeadIds.length === 0}
                >
                  Start Dial Session
                </button>
              </div>
            </div>

            {loadingLeads ? (
              <p>Loading leads…</p>
            ) : leadError ? (
              <p className="text-red-400">{leadError}</p>
            ) : !leads || leads.length === 0 ? (
              <p className="text-gray-400">No leads in this folder.</p>
            ) : (
              <ul className="space-y-2">
                {leads.map((lead, idx) => {
                  const checked = selectedLeadIds.includes(lead._id);
                  return (
                    <li
                      key={lead._id}
                      className={`p-3 border border-gray-600 rounded hover:bg-gray-700 flex items-start gap-3 ${
                        checked ? "bg-gray-700" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 cursor-pointer"
                        checked={checked}
                        onChange={() => toggleLeadSelection(lead._id)}
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          {lead.name || lead["First Name"] || lead["firstName"] || "(no name)"}{" "}
                          <span className="text-xs text-gray-400">• #{idx + 1}</span>
                        </div>
                        <div className="text-sm text-gray-300">
                          {(lead.phone || lead["Phone"] || lead["phone"] || "")}
                          {lead.email ? ` • ${lead.email}` : ""}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
