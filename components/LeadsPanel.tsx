// components/LeadsPanel.tsx
import React, { useState, useEffect, useRef } from "react";
import LeadImportPanel from "./LeadImportPanel";
import LeadPreviewPanel from "./LeadPreviewPanel";
import { useRouter } from "next/router";

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
}

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

/* =========================
   Google Sheets Wizard Utils
========================= */
function parseGoogleSheetUrl(input: string): {
  spreadsheetId?: string;
  gid?: string;
  error?: string;
} {
  const raw = String(input || "").trim();
  if (!raw) return { error: "Paste a Google Sheets URL." };

  try {
    const u = new URL(raw);
    // Accept a few common hostnames
    const host = u.hostname.toLowerCase();
    const ok =
      host.includes("docs.google.com") ||
      host.includes("drive.google.com") ||
      host.includes("google.com");
    if (!ok) return { error: "That doesn’t look like a Google Sheets URL." };

    // Typical: https://docs.google.com/spreadsheets/d/{ID}/edit#gid=0
    const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = m?.[1];

    // gid usually in hash (#gid=0) or query (?gid=0)
    const hash = (u.hash || "").replace(/^#/, "");
    const gidFromHash = hash.includes("gid=")
      ? new URLSearchParams(hash).get("gid") || undefined
      : undefined;
    const gidFromQuery = u.searchParams.get("gid") || undefined;
    const gid = gidFromHash || gidFromQuery;

    if (!spreadsheetId) return { error: "Could not detect spreadsheetId in that URL." };

    return { spreadsheetId, gid: gid || undefined };
  } catch {
    return { error: "Invalid URL. Make sure you paste the full Google Sheet link." };
  }
}

/* =========================
   Inline, self-contained global search (no external import)
========================= */
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

/* =========================
   Types
========================= */
type LeadRow = { _id: string; createdAt?: string | number | Date };
type ResumeInfo = { lastIndex: number | null; total: number | null };

/* =========================
   Main
========================= */
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
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

  // ✅ NEW: Wizard state
  const [showSheetsWizard, setShowSheetsWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetParsed, setSheetParsed] = useState<{ spreadsheetId?: string; gid?: string; error?: string }>({});
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // ✅ NEW: folder selection + Apps Script display
  const [wizardFolderName, setWizardFolderName] = useState<string>("");
  const [wizardCreateNewFolder, setWizardCreateNewFolder] = useState<boolean>(false);
  const [wizardNewFolderName, setWizardNewFolderName] = useState<string>("");

  const [connectOk, setConnectOk] = useState(false);
  const [appsScriptText, setAppsScriptText] = useState<string>("");
  const [webhookUrl, setWebhookUrl] = useState<string>("");

  const router = useRouter();

  // ✅ NEW: modal refs for “click outside to close”
  const modalCardRef = useRef<HTMLDivElement | null>(null);

  const fetchFolders = async () => {
    try {
      const res = await fetch("/api/get-folders");
      const data = await res.json();
      const userFolders = Array.isArray(data.folders) ? data.folders : [];
      setFolders(userFolders);
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
        const res = await fetch(
          `/api/get-leads-by-folder?folderId=${encodeURIComponent(expandedFolder)}`
        );
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

      try {
        const key = `folder:${expandedFolder}`;
        const r = await fetch(`/api/dial/progress?key=${encodeURIComponent(key)}`);
        if (!r.ok) {
          setResumeInfo(null);
          return;
        }
        const j = await r.json();
        setResumeInfo({ lastIndex: j?.lastIndex ?? null, total: j?.total ?? null });
      } catch {
        setResumeInfo(null);
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
      setResumeInfo(null);
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

  const buildProgressKey = () => {
    const folder = expandedFolder || "no-folder";
    const ids = selectedLeads.join(",");
    return `dialProgress:${folder}:${ids}`;
  };

  const buildServerProgressKey = () => {
    const folder = expandedFolder || "no-folder";
    return `folder:${folder}`;
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

    const progressKey = buildProgressKey();
    const savedRaw = localStorage.getItem(progressKey);
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

    const serverKey = buildServerProgressKey();

    const q = new URLSearchParams({
      leads: selectedLeads.join(","),
      fromNumber: selectedNumber,
      startIndex: String(startIndex),
      progressKey: progressKey,
      serverProgressKey: serverKey,
    }).toString();

    router.push(`/dial-session?${q}`);
  };

  const hasResume =
    !!resumeInfo && resumeInfo.lastIndex != null && resumeInfo.lastIndex >= 0 && leads.length > 0;

  const canResume = hasResume && !!selectedNumber && leads.length > 0;

  const handleResumeQuickButton = async () => {
    if (!canResume) return;
    localStorage.setItem("selectedDialNumber", selectedNumber);

    const serverKey = buildServerProgressKey();
    const ids = selectedLeads.length ? selectedLeads : leads.map((l) => l._id);
    const startAt = Math.max(0, (resumeInfo?.lastIndex ?? -1) + 1);

    const params = new URLSearchParams({
      leads: ids.join(","),
      fromNumber: selectedNumber,
      startIndex: String(startAt),
      progressKey: buildProgressKey(),
      serverProgressKey: serverKey,
    });
    router.push(`/dial-session?${params.toString()}`);
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

  // ✅ NEW: Wizard open (replaces redirect)
  const handleConnectGoogleSheet = () => {
    setShowSheetsWizard(true);
    setWizardStep(1);
    setSheetUrl("");
    setSheetParsed({});
    setConnectError(null);
    setConnectOk(false);
    setAppsScriptText("");
    setWebhookUrl("");

    // default folder selection to first non-system folder
    const nonSystem = folders
      .map((f) => f?.name)
      .filter((n) => n && !SYSTEM_FOLDERS.includes(String(n)));
    setWizardFolderName(nonSystem[0] || "");
    setWizardCreateNewFolder(false);
    setWizardNewFolderName("");
  };

  const closeWizard = () => {
    // don’t allow closing mid-connect to prevent partial UI states
    if (connectLoading) return;
    setShowSheetsWizard(false);
  };

  const prevStep = () => {
    setConnectError(null);
    setWizardStep((s) => Math.max(1, s - 1));
  };

  const validateUrlAndContinue = () => {
    const parsed = parseGoogleSheetUrl(sheetUrl);
    setSheetParsed(parsed);
    if (parsed.error) {
      setConnectError(parsed.error);
      return;
    }
    setConnectError(null);
    setWizardStep(3);
  };

  const resolvedFolderName = () => {
    const name = wizardCreateNewFolder ? wizardNewFolderName : wizardFolderName;
    return String(name || "").trim();
  };

  const connectSheetNow = async () => {
    const parsed = parseGoogleSheetUrl(sheetUrl);
    setSheetParsed(parsed);
    if (parsed.error) {
      setConnectError(parsed.error);
      return;
    }

    const folderName = resolvedFolderName();
    if (!folderName) {
      setConnectError("Please choose a folder (or type a new folder name).");
      return;
    }
    if (SYSTEM_FOLDERS.includes(folderName)) {
      setConnectError("You can’t connect a sheet to a system folder.");
      return;
    }

    setConnectLoading(true);
    setConnectError(null);
    setConnectOk(false);
    setAppsScriptText("");
    setWebhookUrl("");

    try {
      const r = await fetch("/api/sheets-sync/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId: parsed.spreadsheetId,
          folderName,
          gid: parsed.gid || "",
          tabName: "",
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setConnectError(j?.error || j?.message || "Failed to connect sheet.");
        return;
      }

      setConnectOk(true);
      setAppsScriptText(String(j?.appsScript || ""));
      setWebhookUrl(String(j?.webhookUrl || ""));

      await fetchFolders();
      setWizardStep(5);
    } catch (e: any) {
      setConnectError(e?.message || "Failed to connect sheet.");
    } finally {
      setConnectLoading(false);
    }
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
      if (!res.ok || !data?.success) {
        console.error("Disposition failed:", data?.message || res.statusText);
        return;
      }

      setLeads((prev) => prev.filter((l) => l._id !== leadId));

      await Promise.all([
        fetchFolders(),
        expandedFolder
          ? fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(expandedFolder)}`)
              .then((r) => r.json())
              .then((j) => {
                const sorted = (Array.isArray(j?.leads) ? j.leads : []).sort(
                  (a: any, b: any) =>
                    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
                );
                setLeads(sorted);
              })
              .catch(() => {})
          : Promise.resolve(),
      ]);

      setPreviewLead(null);
    } catch (err) {
      console.error("Error updating disposition:", err);
    }
  };

  const goToAIDialSession = () => {
    router.push("/ai-dial-session").catch(() => {});
  };

  /* =========================
     ✅ MODAL SAFETY: ESC close + body scroll lock
  ========================= */
  useEffect(() => {
    if (!showSheetsWizard) return;

    // lock background scroll while modal open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeWizard();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSheetsWizard, connectLoading]);

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

        <button
          onClick={goToAIDialSession}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          AI Dial Session
        </button>
      </div>

      {/* Global lead search */}
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
                    <button onClick={() => {}} className="border px-3 py-1 rounded cursor-pointer">
                      {selectAll ? "Deselect All" : "Select All"}
                    </button>
                    <span className="text-sm">{selectedLeads.length} leads selected</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={startDialSession}
                      className={`${
                        selectedLeads.length > 0
                          ? "bg-green-600 hover:bg-green-700"
                          : "bg-gray-400 cursor-not-allowed"
                      } text-white px-3 py-1 rounded cursor-pointer`}
                      disabled={selectedLeads.length === 0}
                    >
                      Start Dial Session
                    </button>

                    <button
                      onClick={handleResumeQuickButton}
                      className={`${
                        hasResume && !!selectedNumber && leads.length > 0
                          ? "bg-blue-600 hover:bg-blue-700"
                          : "bg-gray-400 cursor-not-allowed"
                      } text-white px-3 py-1 rounded cursor-pointer`}
                      disabled={!(hasResume && !!selectedNumber && leads.length > 0)}
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
        </div>
      )}

      {/* =========================
          Google Sheets Connect Wizard Modal
         ========================= */}
      {showSheetsWizard && (
        <div
          className="fixed inset-0 z-50 bg-black/50 p-4 overflow-y-auto"
          onMouseDown={(e) => {
            // click outside modal closes (unless connecting)
            if (connectLoading) return;
            if (!modalCardRef.current) return;
            if (e.target instanceof Node && !modalCardRef.current.contains(e.target)) {
              closeWizard();
            }
          }}
        >
          <div className="min-h-full flex items-center justify-center">
            <div
              ref={modalCardRef}
              className="w-full max-w-2xl rounded-lg bg-white dark:bg-zinc-900 shadow-lg border flex flex-col max-h-[90vh]"
            >
              {/* Header (fixed) */}
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <div>
                  <div className="font-semibold text-lg">Connect Google Sheet</div>
                  <div className="text-sm text-gray-500">
                    Automatic lead imports when new rows are added.
                  </div>
                </div>
                <button
                  onClick={closeWizard}
                  className="text-gray-500 hover:text-gray-700 px-2"
                  disabled={connectLoading}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Body (scrollable) */}
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                <div className="text-sm text-gray-500">Step {wizardStep} of 5</div>

                {wizardStep === 1 && (
                  <div className="space-y-3">
                    <div className="text-base font-semibold">Step 1 — Open the Google Sheet you want to connect</div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Open Google Sheets in another tab and click the sheet you want to sync into CoveCRM.
                    </div>
                    <a
                      href="https://docs.google.com/spreadsheets/u/0/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block bg-zinc-800 text-white px-4 py-2 rounded hover:opacity-90"
                    >
                      Open Google Sheets
                    </a>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="space-y-3">
                    <div className="text-base font-semibold">Step 2 — Paste the entire Google Sheet URL</div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Copy the full URL from your browser address bar and paste it here.
                    </div>

                    <input
                      value={sheetUrl}
                      onChange={(e) => {
                        setSheetUrl(e.target.value);
                        setConnectError(null);
                        setConnectOk(false);
                        setAppsScriptText("");
                        setWebhookUrl("");
                      }}
                      placeholder="https://docs.google.com/spreadsheets/d/.../edit#gid=0"
                      className="border p-2 rounded w-full"
                    />

                    <div className="text-xs text-gray-500">Tip: Paste the full URL (not just the sheet name).</div>

                    {connectError && <div className="text-sm text-red-600">{connectError}</div>}
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="space-y-3">
                    <div className="text-base font-semibold">Step 3 — Confirm what we detected</div>

                    <div className="rounded border p-3 bg-gray-50 dark:bg-zinc-800 text-sm">
                      <div>
                        <span className="font-semibold">Spreadsheet ID:</span> {sheetParsed.spreadsheetId || "—"}
                      </div>
                      <div>
                        <span className="font-semibold">Tab GID:</span>{" "}
                        {sheetParsed.gid || "(not detected — that’s okay)"}
                      </div>
                    </div>

                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      Next, choose which CoveCRM folder these sheet rows should import into.
                    </div>
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="space-y-3">
                    <div className="text-base font-semibold">Step 4 — Choose the CoveCRM folder</div>

                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      New sheet rows will import into this folder automatically (and will auto-enroll in the folder’s drip if
                      a drip is attached).
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={wizardCreateNewFolder}
                          onChange={(e) => {
                            setWizardCreateNewFolder(e.target.checked);
                            setConnectError(null);
                          }}
                        />
                        Create a new folder name
                      </label>

                      {!wizardCreateNewFolder ? (
                        <select
                          value={wizardFolderName}
                          onChange={(e) => setWizardFolderName(e.target.value)}
                          className="border p-2 rounded w-full"
                        >
                          <option value="">-- Choose a folder --</option>
                          {folders
                            .map((f) => String(f?.name || ""))
                            .filter((n) => n && !SYSTEM_FOLDERS.includes(n))
                            .map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <input
                          value={wizardNewFolderName}
                          onChange={(e) => setWizardNewFolderName(e.target.value)}
                          placeholder="New folder name (e.g., Facebook Leads)"
                          className="border p-2 rounded w-full"
                        />
                      )}
                    </div>

                    {connectError && <div className="text-sm text-red-600">{connectError}</div>}

                    <button
                      onClick={connectSheetNow}
                      disabled={connectLoading}
                      className={`${
                        connectLoading ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
                      } text-white px-4 py-2 rounded`}
                    >
                      {connectLoading ? "Connecting…" : "Connect Sheet"}
                    </button>

                    <div className="text-xs text-gray-500">
                      This will generate your Apps Script. You paste it once into the sheet and run install once.
                    </div>
                  </div>
                )}

                {wizardStep === 5 && (
                  <div className="space-y-3">
                    <div className="text-base font-semibold">Step 5 — One-time setup inside Google Sheets</div>

                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <b>All new rows added to this sheet will automatically import into CoveCRM.</b>
                    </div>

                    {connectOk ? (
                      <div className="text-sm text-green-600">✅ Connected. Follow these steps exactly one time:</div>
                    ) : (
                      <div className="text-sm text-gray-600">Finish setup:</div>
                    )}

                    <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-2">
                      <li>
                        In your Google Sheet: <b>Extensions → Apps Script</b>
                      </li>

                      <li>
                        In Apps Script, click <b>Code.gs</b> on the left, then{" "}
                        <b>select everything</b> and paste our code so it <b>replaces everything</b>.
                        <div className="text-xs text-gray-500 mt-1">
                          This removes any default Google code like <span className="font-mono">function myFunction()</span>.
                        </div>
                      </li>

                      <li>
                        <b>Save</b> your Apps Script project:
                        <div className="mt-1 text-xs text-gray-500 space-y-1">
                          <div>• Mac: <b>⌘ Command + S</b></div>
                          <div>• Windows: <b>Ctrl + S</b></div>
                          <div>
                            • OR click the <b>floppy disk “Save”</b> icon in the <b>top toolbar</b>
                            (tooltip says <b>“Save project to Drive”</b>)
                          </div>
                        </div>
                      </li>

                      <li>
                        After you paste + save, near the top you will see a <b>function dropdown</b>.
                        Select <b>covecrmInstall</b>.
                        <div className="text-xs text-gray-500 mt-1">
                          You don’t need to do anything else with the dropdown.
                        </div>
                      </li>

                      <li>
                        Click <b>Run</b> (▶) in the <b>top toolbar</b> (it’s right next to <b>Debug</b>, above the editor),
                        and approve permissions.
                      </li>

                      <li className="text-red-600">
                        <b>DO NOT CLICK DEPLOY.</b> “Deploy” is not used. This is <b>not</b> a web app deploy. You only Save + Run once.
                      </li>
                    </ol>

                    <div className="rounded border p-3 bg-gray-50 dark:bg-zinc-800 text-sm text-gray-700 dark:text-gray-200">
                      <div className="font-semibold mb-1">If you see “Google hasn’t verified this app”</div>
                      <div className="text-sm">
                        Click <b>Advanced</b> → <b>Go to (unsafe)</b> → <b>Allow</b>.
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        This is normal — you are authorizing your own Apps Script inside your own Google Sheet.
                      </div>
                    </div>

                    <div className="rounded border p-3 bg-white dark:bg-zinc-900">
                      <div className="font-semibold text-sm mb-2">FAQ</div>
                      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <div>
                          <b>Why do I see “Google hasn’t verified this app”?</b>
                          <div className="text-xs text-gray-500">
                            Because this is a script you’re running in your own Google account. It’s not CoveCRM OAuth. You can proceed via Advanced.
                          </div>
                        </div>
                        <div>
                          <b>Do I need to click Deploy?</b>
                          <div className="text-xs text-gray-500">
                            No. Do not Deploy. You only Save + Run <b>covecrmInstall</b> one time.
                          </div>
                        </div>
                        <div>
                          <b>Does this work without Google OAuth / CASA?</b>
                          <div className="text-xs text-gray-500">
                            Yes. This method does not use CoveCRM OAuth and does not require Google Cloud verification/CASA.
                            You authorize your own Apps Script inside your own sheet.
                          </div>
                        </div>
                        <div>
                          <b>What permissions does it request and why?</b>
                          <div className="text-xs text-gray-500">
                            It needs permission to read the sheet (to read new rows) and to make a secure HTTPS request to CoveCRM (to import the row).
                          </div>
                        </div>
                      </div>
                    </div>

                    {webhookUrl && (
                      <div className="text-xs text-gray-500">
                        Webhook: <span className="font-mono">{webhookUrl}</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Apps Script (copy/paste)</div>
                        <button
                          className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(appsScriptText || "");
                              alert("Copied Apps Script to clipboard.");
                            } catch {
                              alert("Could not copy automatically. Please select and copy manually.");
                            }
                          }}
                          disabled={!appsScriptText}
                        >
                          Copy
                        </button>
                      </div>

                      <textarea
                        value={appsScriptText}
                        readOnly
                        className="w-full h-64 border rounded p-2 font-mono text-xs"
                        placeholder="Apps Script will appear here after connecting…"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer (fixed) */}
              <div className="flex items-center justify-between px-4 py-3 border-t shrink-0">
                <button
                  onClick={prevStep}
                  className={`px-4 py-2 rounded border ${
                    wizardStep === 1 ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-100 dark:hover:bg-zinc-800"
                  }`}
                  disabled={wizardStep === 1 || connectLoading}
                >
                  Back
                </button>

                <div className="flex gap-2">
                  {wizardStep === 1 && (
                    <button
                      onClick={() => setWizardStep(2)}
                      className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                      disabled={connectLoading}
                    >
                      Continue
                    </button>
                  )}

                  {wizardStep === 2 && (
                    <>
                      <button
                        onClick={validateUrlAndContinue}
                        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                        disabled={connectLoading}
                      >
                        Validate URL
                      </button>
                      <button
                        onClick={() => {
                          const parsed = parseGoogleSheetUrl(sheetUrl);
                          setSheetParsed(parsed);
                          if (parsed.error) {
                            setConnectError(parsed.error);
                            return;
                          }
                          setWizardStep(3);
                        }}
                        className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                        disabled={connectLoading}
                      >
                        Next
                      </button>
                    </>
                  )}

                  {wizardStep === 3 && (
                    <button
                      onClick={() => setWizardStep(4)}
                      className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                      disabled={connectLoading}
                    >
                      Continue
                    </button>
                  )}

                  {wizardStep === 4 && (
                    <button
                      onClick={connectSheetNow}
                      className={`px-4 py-2 rounded text-white ${
                        connectLoading ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"
                      }`}
                      disabled={connectLoading}
                    >
                      {connectLoading ? "Connecting…" : "Connect"}
                    </button>
                  )}

                  {wizardStep === 5 && (
                    <button
                      className="px-4 py-2 rounded bg-zinc-800 text-white hover:opacity-90"
                      onClick={closeWizard}
                      disabled={connectLoading}
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
