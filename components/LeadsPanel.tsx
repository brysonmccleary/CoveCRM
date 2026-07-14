// components/LeadsPanel.tsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import LeadImportPanel from "./LeadImportPanel";
import LeadPreviewPanel from "./LeadPreviewPanel";
import SaleModal from "./SaleModal";
import toast from "react-hot-toast";
import FolderLeadsTable from "./FolderLeadsTable";
import { getNumberState } from "@/lib/twilio/localPresence";
import { SYSTEM_FOLDERS, isSystemFolderName } from "@/lib/systemFolders";
import ImportLeadsChooser from "./ImportLeadsChooser";
import { LEAD_TYPES } from "@/lib/leads/leadTypes";

function formatPhoneNumber(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone || "";
}

function formatLeadCount(count: number): string {
  return `${count} ${count === 1 ? "lead" : "leads"}`;
}

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
}

const SCRIPT_OPTIONS = [
  { key: "mortgage_protection", label: "Mortgage Protection" },
  { key: "final_expense", label: "Final Expense" },
  { key: "iul_cash_value", label: "IUL / Cash Value Life" },
  { key: "veteran_leads", label: "Veterans (Life Insurance)" },
  { key: "veteran_iul", label: "Veterans IUL" },
  { key: "veteran_mortgage", label: "Veterans Mortgage Protection" },
  { key: "trucker_leads", label: "Truckers (Life Insurance)" },
  { key: "trucker_iul", label: "Truckers IUL" },
  { key: "trucker_mortgage", label: "Truckers Mortgage Protection" },
  { key: "default", label: "Default (Generic)" },
];

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
    window.location.href = `/dial/${id}`;
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
  const [showImportChooser, setShowImportChooser] = useState(false);
  const [folders, setFolders] = useState<any[]>([]);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLeads, setSelectedLeads] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showResumeOptions, setShowResumeOptions] = useState(false);
  const [previewLead, setPreviewLead] = useState<any | null>(null);
  const [saleModalLead, setSaleModalLead] = useState<any | null>(null);
  const [defaultComp, setDefaultComp] = useState(100);
  const [agingFilter, setAgingFilter] = useState<"all" | "fresh" | "warm" | "stale" | "cold">("all");
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string>("");
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);
  const [showQuickDial, setShowQuickDial] = useState(false);
  const [quickDialPhone, setQuickDialPhone] = useState("");
  const [quickDialName, setQuickDialName] = useState("");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<any | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [openFolderMenu, setOpenFolderMenu] = useState<string | null>(null);
  const [aiToggleErrors, setAiToggleErrors] = useState<Record<string, boolean>>({});
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFolderErrors, setRenameFolderErrors] = useState<Record<string, string>>({});
  const [savingRenameFolderId, setSavingRenameFolderId] = useState<string | null>(null);

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

  // ✅ NEW: user acknowledgement for "unverified app" warning
  const [ackUnverifiedWarning, setAckUnverifiedWarning] = useState<boolean>(false);
  const [ackSheetLeadConsent, setAckSheetLeadConsent] = useState<boolean>(false);

  const [folderScriptKey, setFolderScriptKey] = useState<string>("final_expense");
  const [savingScript, setSavingScript] = useState(false);
  const [savingLeadTypeFolderId, setSavingLeadTypeFolderId] = useState<string | null>(null);

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
    fetch("/api/settings/profile")
      .then((r) => r.json())
      .then((d) => { if (d?.defaultCompPercentage) setDefaultComp(Number(d.defaultCompPercentage)); })
      .catch(() => {});
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
      const selectedFolder = folders.find(f => f._id === folderId);
      setFolderScriptKey(selectedFolder?.aiScriptKey || "final_expense");
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

  // ✅ Keep the Select All button label/state correct even if selection changes manually
  useEffect(() => {
    if (!leads.length) {
      if (selectAll) setSelectAll(false);
      return;
    }
    const allSelected = leads.every((l) => selectedLeads.includes(l._id));
    if (allSelected !== selectAll) setSelectAll(allSelected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, selectedLeads]);

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

    window.location.href = `/dial-session?${q}`;
  };

  const startQuickDial = () => {
    const phone = quickDialPhone.trim();
    if (!phone) {
      alert("Enter a phone number to call.");
      return;
    }

    const q = new URLSearchParams({
      quickPhone: phone,
    });
    const name = quickDialName.trim();
    if (name) q.set("quickName", name);
    if (selectedNumber) q.set("fromNumber", selectedNumber);

    setShowQuickDial(false);
    setQuickDialPhone("");
    setQuickDialName("");
    window.location.href = `/dial-session?${q.toString()}`;
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
    window.location.href = `/dial-session?${params.toString()}`;
  };

  const handleDeleteFolder = async (folderId: string) => {
    setDeleteLoading(true);
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
        setDeleteFolderTarget(null);
      } else {
        alert(data.message || "Failed to delete folder.");
      }
    } catch (error) {
      console.error("Error deleting the folder:", error);
      alert("An error occurred while deleting the folder.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const startRenameFolder = (folder: any) => {
    const folderId = String(folder?._id || "");
    if (!folderId || isSystemFolderName(folder?.name)) return;
    setOpenFolderMenu(null);
    setRenameFolderErrors((prev) => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });
    setRenamingFolderId(folderId);
    setRenameFolderName(String(folder?.name || ""));
  };

  const cancelRenameFolder = () => {
    setRenamingFolderId(null);
    setRenameFolderName("");
  };

  const saveRenameFolder = async (folder: any) => {
    const folderId = String(folder?._id || "");
    const previousName = String(folder?.name || "");
    const nextName = renameFolderName.trim();
    if (!folderId || !nextName || nextName === previousName) {
      cancelRenameFolder();
      return;
    }
    const duplicate = folders.some(
      (f) =>
        String(f?._id) !== folderId &&
        String(f?.name || "").trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicate) {
      setRenameFolderErrors((prev) => ({ ...prev, [folderId]: "A folder with that name already exists." }));
      return;
    }

    setSavingRenameFolderId(folderId);
    setRenameFolderErrors((prev) => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });
    setFolders((prev) =>
      prev.map((f) => (String(f._id) === folderId ? { ...f, name: nextName } : f))
    );
    setRenamingFolderId(null);
    setRenameFolderName("");

    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(folderId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Failed to rename folder.");
      }
      if (data?.name) {
        setFolders((prev) =>
          prev.map((f) => (String(f._id) === folderId ? { ...f, name: data.name } : f))
        );
      }
    } catch (err: any) {
      setFolders((prev) =>
        prev.map((f) => (String(f._id) === folderId ? { ...f, name: previousName } : f))
      );
      setRenameFolderErrors((prev) => ({
        ...prev,
        [folderId]: err?.message || "Failed to rename folder.",
      }));
    } finally {
      setSavingRenameFolderId(null);
    }
  };

  const handleExportCSV = async (folderId: string, folderName: string) => {
    const confirmed = window.confirm(
      `Export all leads from "${folderName}" to CSV?\n\nThe file will download to your computer.`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(
        `/api/leads/export-csv?folderId=${encodeURIComponent(folderId)}`
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.message || "Export failed. Please try again.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = folderName.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      a.download = `${safeName}_leads.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
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
    setAckUnverifiedWarning(false);

    // default folder selection to first non-system folder
    const nonSystem = folders
      .map((f) => f?.name)
      .filter((n) => n && !isSystemFolderName(String(n)));
    setWizardFolderName(nonSystem[0] || "");

    // ✅ CHANGE: default is "Create a new folder" (input shown first)
    setWizardCreateNewFolder(true);
    setWizardNewFolderName("");
  };

  const closeWizard = () => {
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
    if (isSystemFolderName(folderName)) {
      setConnectError("You can’t connect a sheet to a system folder.");
      return;
    }

    // If user tries to connect without acknowledging, fail fast with a clear message.
    if (!ackUnverifiedWarning) {
      setConnectError("Please confirm you understand the 'App not verified' warning is expected.");
      return;
    }
    if (!ackSheetLeadConsent) {
      setConnectError("Please confirm these Google Sheet leads have consent for outreach.");
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

    // Intercept Sold → show SaleModal
    if (disposition === "Sold") {
      const lead = previewLead?._id === leadId ? previewLead : { _id: leadId };
      setSaleModalLead(lead);
      return;
    }

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
    window.location.href = "/ai-dial-session";
  };

  /* =========================
     ✅ MODAL SAFETY: ESC close + body scroll lock
  ========================= */
  useEffect(() => {
    if (!showSheetsWizard) return;

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

  const UnverifiedAppNotice = ({ compact }: { compact?: boolean }) => {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900 p-4">
        <div className="flex items-start gap-3">
          <div className="text-xl leading-none">⚠️</div>
          <div className="space-y-2">
            <div className={`font-bold ${compact ? "text-base" : "text-lg"} text-yellow-900 dark:text-yellow-100`}>
              Google will show “App not verified” — this is expected.
            </div>

            <div className="text-sm text-yellow-900/90 dark:text-yellow-100/90 space-y-1">
              <div>
                CoveCRM is verified for <b>Google Calendar</b> only.
              </div>
              <div>
                Google Sheets Sync uses a <b>third-party Google Apps Script</b> that you install inside{" "}
                <b>your own Google account</b>.
              </div>
              <div>
                Google shows the warning because the script requests access to <b>Google Sheets</b> and permission to{" "}
                <b>send data to CoveCRM</b> (HTTPS/webhook + triggers).
              </div>
              <div>
                CoveCRM <b>does not</b> read your Google Drive directly and <b>never</b> stores your Google password.
              </div>
              <div className="pt-1">
                <b>Note:</b> This will show <b>YOUR email</b> at the top because you are authorizing from your Google
                account.
              </div>
            </div>

            {!compact && (
              <div className="text-sm text-yellow-900/90 dark:text-yellow-100/90">
                <div className="font-semibold mt-2">Security reassurance</div>
                <ul className="list-disc pl-5 space-y-1 mt-1">
                  <li>The script only accesses the sheet you paste it into.</li>
                  <li>It only sends new rows/updates to CoveCRM through a secure HTTPS webhook.</li>
                  <li>
                    You can revoke permissions anytime in{" "}
                    <b>Google Account → Security → Third-party access</b> (or Apps Script access), and you can delete the
                    script project.
                  </li>
                </ul>

                <div className="font-semibold mt-3">Exactly what to click on Google’s warning screen</div>
                <ol className="list-decimal pl-5 space-y-1 mt-1">
                  <li>Click <b>Continue</b></li>
                  <li>If you see “Google hasn’t verified this app”, click <b>Advanced</b></li>
                  <li>
                    Click <b>“Go to [your script project name] (unsafe)”</b>
                    <div className="text-xs opacity-80 mt-1">
                      (It may say something like <b>“Untitled project (unsafe)”</b> — that’s normal.)
                    </div>
                  </li>
                  <li>Click <b>Allow</b></li>
                  <li>Return to CoveCRM and continue setup</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleScriptKeyChange = async (nextKey: string, folderId = expandedFolder) => {
    if (!folderId) return;
    if (String(folderId) === String(expandedFolder)) {
      setFolderScriptKey(nextKey);
    }
    setSavingScript(true);
    try {
      const res = await fetch("/api/folders/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, aiScriptKey: nextKey }),
      });
      if (!res.ok) throw new Error("Failed to save script");
      const data = await res.json().catch(() => ({}));
      setFolders((prev) =>
        prev.map((f) =>
          String(f._id) === String(folderId)
            ? {
                ...f,
                aiScriptKey: data?.aiScriptKey || nextKey,
                aiFirstCallEnabled: data?.aiFirstCallEnabled ?? f.aiFirstCallEnabled,
                aiFirstCallDelayMinutes: data?.aiFirstCallDelayMinutes ?? f.aiFirstCallDelayMinutes,
                aiRealTimeOnly: data?.aiRealTimeOnly ?? f.aiRealTimeOnly,
                aiEnabledAt: data?.aiEnabledAt ?? f.aiEnabledAt,
              }
            : f
        )
      );
    } catch {
      alert("Failed to save script. Please try again.");
    } finally {
      setSavingScript(false);
    }
  };

  const handleLeadTypeChange = async (folder: any, nextLeadType: string) => {
    const folderId = String(folder._id);
    const previousLeadType = String(folder.leadType || "");
    setSavingLeadTypeFolderId(folderId);
    setFolders((prev) =>
      prev.map((item) => String(item._id) === folderId ? { ...item, leadType: nextLeadType } : item),
    );

    try {
      const res = await fetch("/api/folders/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, leadType: nextLeadType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to save lead type");
      setFolders((prev) =>
        prev.map((item) =>
          String(item._id) === folderId ? { ...item, leadType: data?.leadType ?? nextLeadType } : item,
        ),
      );
      toast.success("Lead type saved");
    } catch (error: any) {
      setFolders((prev) =>
        prev.map((item) => String(item._id) === folderId ? { ...item, leadType: previousLeadType } : item),
      );
      toast.error(error?.message || "Failed to save lead type");
    } finally {
      setSavingLeadTypeFolderId(null);
    }
  };

  const handleAIFirstCallToggle = async (folder: any) => {
    const folderId = String(folder._id);
    const nextEnabled = !folder.aiFirstCallEnabled;
    const previousFolder = folder;

    setAiToggleErrors((prev) => {
      const next = { ...prev };
      delete next[folderId];
      return next;
    });
    setFolders((prev) =>
      prev.map((f) =>
        String(f._id) === folderId
          ? {
              ...f,
              aiFirstCallEnabled: nextEnabled,
              aiEnabledAt: nextEnabled ? f.aiEnabledAt || new Date().toISOString() : null,
            }
          : f
      )
    );

    try {
      const res = await fetch("/api/folders/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, aiFirstCallEnabled: nextEnabled }),
      });
      if (!res.ok) throw new Error("Failed to save AI setting");
      const data = await res.json().catch(() => ({}));
      setFolders((prev) =>
        prev.map((f) =>
          String(f._id) === folderId
            ? {
                ...f,
                aiFirstCallEnabled: data?.aiFirstCallEnabled ?? nextEnabled,
                aiFirstCallDelayMinutes: data?.aiFirstCallDelayMinutes ?? f.aiFirstCallDelayMinutes,
                aiRealTimeOnly: data?.aiRealTimeOnly ?? f.aiRealTimeOnly,
                aiScriptKey: data?.aiScriptKey ?? f.aiScriptKey,
                aiEnabledAt: data?.aiEnabledAt ?? f.aiEnabledAt,
              }
            : f
        )
      );
    } catch {
      setFolders((prev) =>
        prev.map((f) =>
          String(f._id) === folderId
            ? {
                ...f,
                aiFirstCallEnabled: previousFolder.aiFirstCallEnabled,
                aiEnabledAt: previousFolder.aiEnabledAt,
              }
            : f
        )
      );
      setAiToggleErrors((prev) => ({ ...prev, [folderId]: true }));
    }
  };

  const customFolders = useMemo(() => {
    return folders
      .filter((folder) => !isSystemFolderName(folder.name))
      .sort((a, b) => {
        const aEmpty = (a.leadCount ?? 0) === 0;
        const bEmpty = (b.leadCount ?? 0) === 0;
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        return 0;
      });
  }, [folders]);

  const systemFolders = useMemo(() => {
    return SYSTEM_FOLDERS.map((name) =>
      folders.find((folder) => String(folder.name || "").trim().toLowerCase() === name.toLowerCase())
    ).filter(Boolean) as any[];
  }, [folders]);

  const renderExpandedFolderTable = (folder: any, isSystemFolder: boolean) => (
    expandedFolder === folder._id && (
      <FolderLeadsTable
        folder={folder}
        isSystemFolder={isSystemFolder}
        leads={leads}
        selectedLeads={selectedLeads}
        toggleLeadSelection={toggleLeadSelection}
        selectAll={selectAll}
        onSelectAll={handleSelectAll}
        agingFilter={agingFilter}
        setAgingFilter={setAgingFilter}
        numbers={numbers}
        selectedNumber={selectedNumber}
        setSelectedNumber={setSelectedNumber}
        folderScriptKey={folderScriptKey}
        onScriptKeyChange={handleScriptKeyChange}
        savingScript={savingScript}
        hideScriptSelector
        hasResume={hasResume}
        canResume={canResume}
        onStartDialSession={startDialSession}
        onResume={handleResumeQuickButton}
        onPreviewLead={setPreviewLead}
      />
    )
  );

  return (
    <div className="space-y-4 p-4">
      {/* Top actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setShowImportChooser(true)}
          className="bg-[#6b5b95] text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          Import Leads
        </button>

        <button
          onClick={() => setShowQuickDial(true)}
          className="bg-cyan-600 text-white px-4 py-2 rounded hover:bg-cyan-500 cursor-pointer"
        >
          Quick Dial
        </button>

        <button
          onClick={goToAIDialSession}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:opacity-90 cursor-pointer"
        >
          AI Dial Session
        </button>
      </div>

      {showQuickDial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Quick Dial</h3>
              <button
                onClick={() => setShowQuickDial(false)}
                className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                aria-label="Close Quick Dial"
              >
                x
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Phone number
                </label>
                <input
                  value={quickDialPhone}
                  onChange={(e) => setQuickDialPhone(e.target.value)}
                  placeholder="(555) 555-1234"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Name / contact <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  value={quickDialName}
                  onChange={(e) => setQuickDialName(e.target.value)}
                  placeholder="Contact name"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              {selectedNumber ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Calling from {selectedNumber}
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  CoveCRM will use your current default calling number.
                </p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowQuickDial(false)}
                className="rounded border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={startQuickDial}
                className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
              >
                Call Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global lead search */}
      <LeadSearchInline />

      {showImport && <LeadImportPanel onImportSuccess={fetchFolders} />}

      {showImportChooser && (
        <ImportLeadsChooser
          onClose={() => setShowImportChooser(false)}
          onCsv={() => {
            setShowImportChooser(false);
            setShowImport(true);
          }}
          onGoogleSheets={() => {
            setShowImportChooser(false);
            handleConnectGoogleSheet();
          }}
          onVendorConnectionCreated={fetchFolders}
        />
      )}

      <section className="space-y-3">
        <h3 className="font-bold text-lg">Lead Folders</h3>
        {customFolders.length === 0 && <p>No folders found.</p>}
        <div className="space-y-2">
          {customFolders.map((folder) => {
            const leadCount = folder.leadCount ?? 0;
            const isEmpty = leadCount === 0;

            return (
              <div key={folder._id} className={isEmpty ? "opacity-60" : ""}>
                <div
                  className={`relative flex min-h-[56px] flex-col gap-3 rounded-xl border bg-[#1e293b] px-3 py-2 text-left transition hover:bg-slate-700/60 lg:flex-row lg:items-center ${
                    expandedFolder === folder._id ? "bg-[#6b5b95] text-white" : ""
                  }`}
                  style={{ borderColor: "rgba(255,255,255,0.09)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFolder(folder._id)}
                    onKeyDown={(e) => {
                      if (renamingFolderId === String(folder._id)) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleFolder(folder._id);
                      }
                    }}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
                  >
                    {renamingFolderId === String(folder._id) ? (
                      <input
                        value={renameFolderName}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRenameFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveRenameFolder(folder);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRenameFolder();
                          }
                        }}
                        onBlur={() => cancelRenameFolder()}
                        style={{
                          minWidth: "160px",
                          maxWidth: "260px",
                          width: "min(260px, 100%)",
                          borderRadius: "6px",
                          border: "1px solid rgba(255,255,255,0.18)",
                          background: "rgba(15,23,42,0.65)",
                          color: "inherit",
                          fontSize: "14px",
                          fontWeight: 600,
                          padding: "2px 6px",
                          outline: "none",
                        }}
                      />
                    ) : (
                      <span className="truncate text-sm font-semibold text-white">{folder.name}</span>
                    )}
                    {renamingFolderId !== String(folder._id) && (
                      <span
                        role="button"
                        tabIndex={0}
                        title="Rename folder"
                        aria-label={`Rename ${folder.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          startRenameFolder(folder);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            startRenameFolder(folder);
                          }
                        }}
                        style={{
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: "6px",
                          background: "rgba(15,23,42,0.45)",
                          color: "inherit",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          lineHeight: 1,
                          minHeight: "24px",
                          minWidth: "24px",
                        }}
                      >
                        ✎
                      </span>
                    )}
                    <span className="rounded-full border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-xs font-semibold text-gray-300">
                      {formatLeadCount(leadCount)}
                    </span>
                    {savingRenameFolderId === String(folder._id) && (
                      <span className="text-xs font-semibold text-gray-300">Saving...</span>
                    )}
                    {renameFolderErrors[folder._id] && (
                      <span className="text-xs font-semibold text-red-400">{renameFolderErrors[folder._id]}</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={folder.aiScriptKey || "default"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleScriptKeyChange(e.target.value, folder._id)}
                      className="rounded-full border border-slate-600 bg-slate-900/60 px-2 py-1 text-xs font-semibold text-gray-200 outline-none transition focus:border-indigo-400"
                      title="AI calling script"
                    >
                      {SCRIPT_OPTIONS.map((script) => (
                        <option key={script.key} value={script.key}>
                          Script: {script.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={folder.leadType || ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleLeadTypeChange(folder, e.target.value)}
                      disabled={savingLeadTypeFolderId === String(folder._id)}
                      className="rounded-full border border-slate-600 bg-slate-900/60 px-2 py-1 text-xs font-semibold text-gray-200 outline-none transition focus:border-indigo-400 disabled:opacity-60"
                      title="Lead type used for this folder and new imported leads"
                    >
                      <option value="">Lead type: Not set</option>
                      {LEAD_TYPES.map((leadType) => (
                        <option key={leadType} value={leadType}>
                          Lead type: {leadType}
                        </option>
                      ))}
                    </select>

                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-xs font-semibold text-gray-300">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!folder.aiFirstCallEnabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAIFirstCallToggle(folder);
                        }}
                        className={`relative h-5 w-9 rounded-full transition ${
                          folder.aiFirstCallEnabled ? "bg-green-600" : "bg-gray-600"
                        }`}
                        title={folder.aiFirstCallEnabled ? "Disable AI first-call" : "Enable AI first-call"}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
                            folder.aiFirstCallEnabled ? "left-4" : "left-0.5"
                          }`}
                        />
                      </button>
                      <span
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAIFirstCallToggle(folder);
                        }}
                      >
                        {folder.aiFirstCallEnabled ? "AI on" : "AI off"}
                      </span>
                    </span>
                    {aiToggleErrors[folder._id] && (
                      <span className="text-xs font-semibold text-red-400">Save failed</span>
                    )}

                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenFolderMenu(openFolderMenu === folder._id ? null : folder._id);
                        }}
                        className="rounded px-2 py-1 text-sm font-semibold text-gray-300 hover:bg-slate-900/70"
                        title="Folder actions"
                      >
                        ...
                      </button>
                      {openFolderMenu === folder._id && (
                        <div
                          className="absolute right-0 z-10 mt-2 w-36 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setOpenFolderMenu(null);
                              handleExportCSV(folder._id, folder.name);
                            }}
                            className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-gray-200 hover:bg-slate-800"
                          >
                            Export CSV
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenFolderMenu(null);
                              setDeleteFolderTarget(folder);
                            }}
                            className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-400 hover:bg-slate-800"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {renderExpandedFolderTable(folder, false)}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {systemFolders.map((folder) => (
            <div key={folder._id} className="w-[150px]">
              <div
                className={`flex h-[72px] items-start justify-between gap-1.5 rounded-xl border bg-[#1e293b] px-2.5 py-2 transition hover:bg-slate-700/60 ${
                  expandedFolder === folder._id ? "bg-[#6b5b95] text-white" : ""
                }`}
                style={{ borderColor: "rgba(255,255,255,0.09)" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
              >
                <button
                  type="button"
                  onClick={() => toggleFolder(folder._id)}
                  className="flex h-full min-w-0 flex-1 flex-col justify-between text-left"
                >
                  <span className="min-h-[32px] overflow-hidden text-xs font-semibold leading-4 text-gray-400">
                    {folder.name === "Booked Appointment" ? "Booked" : folder.name}
                  </span>
                  <span className="w-fit rounded-full border border-slate-600 bg-slate-900/60 px-2 py-0.5 text-xs font-semibold text-gray-300">
                    {formatLeadCount(folder.leadCount ?? 0)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExportCSV(folder._id, folder.name);
                  }}
                  className="rounded px-2 py-0.5 text-sm font-semibold text-gray-300 hover:bg-slate-900/70"
                  title="Export CSV"
                >
                  ...
                </button>
              </div>
            </div>
          ))}
        </div>
        {systemFolders.map((folder) => (
          <div key={`${folder._id}-expanded`}>
            {renderExpandedFolderTable(folder, true)}
          </div>
        ))}
      </section>

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

      {deleteFolderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow">
            <h3 className="text-lg font-semibold text-white">Delete Folder</h3>
            <p className="mt-2 text-sm text-gray-300">
              Delete &quot;{deleteFolderTarget.name}&quot; and its {formatLeadCount(deleteFolderTarget.leadCount ?? 0)} permanently? This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteFolderTarget(null)}
                disabled={deleteLoading}
                className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteFolder(deleteFolderTarget._id)}
                disabled={deleteLoading}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-600"
              >
                {deleteLoading ? "Deleting..." : "Delete Folder"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          Google Sheets Connect Wizard Modal
         ========================= */}
      {showSheetsWizard && (
        <div
          className="fixed inset-0 z-50 bg-black/50 p-4 overflow-y-auto"
          onMouseDown={(e) => {
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
                    <div className="text-base font-semibold">
                      Step 1 — Make sure you are logged into the SAME Google account you use for CoveCRM
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      This setup installs a small script inside <b>your Google account</b> so it can watch your lead
                      sheet.
                      <div className="mt-2 text-xs text-gray-500">
                        Important: Your lead vendor usually <b>owns the sheet</b>. That’s normal. You just need to be
                        added to it (preferably as <b>Editor</b>) so the script can read new rows.
                      </div>
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
                      Open the vendor sheet, then copy the full URL from your browser address bar and paste it here.
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
                      {/* ✅ CHANGE: default is "Create a new folder" input first */}
                      {!wizardCreateNewFolder ? (
                        <select
                          value={wizardFolderName}
                          onChange={(e) => setWizardFolderName(e.target.value)}
                          className="border p-2 rounded w-full"
                        >
                          <option value="">-- Choose a folder --</option>
                          {folders
                            .map((f) => String(f?.name || ""))
                            .filter((n) => n && !isSystemFolderName(n))
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

                      {/* ✅ CHANGE: checkbox now means "Import into existing folder" */}
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!wizardCreateNewFolder}
                          onChange={(e) => {
                            const importExisting = e.target.checked;
                            setWizardCreateNewFolder(!importExisting);
                            setConnectError(null);
                          }}
                        />
                        Import into an existing folder
                      </label>
                    </div>

                    {/* ✅ REQUIRED: Big notice directly above the Connect action */}
                    <UnverifiedAppNotice />

                    {/* ✅ OPTIONAL helper: checkbox acknowledgement (keeps it idiot-proof) */}
                    <label className="flex items-start gap-2 text-sm rounded border bg-white dark:bg-zinc-900 p-3">
                      <input
                        type="checkbox"
                        checked={ackUnverifiedWarning}
                        onChange={(e) => {
                          setAckUnverifiedWarning(e.target.checked);
                          setConnectError(null);
                        }}
                        className="mt-1"
                      />
                      <span className="text-gray-700 dark:text-gray-200">
                        I understand the <b>“Google hasn’t verified this app”</b> warning is expected during setup, and I
                        will click <b>Advanced → Go to (unsafe) → Allow</b>.
                      </span>
                    </label>

                    <label className="flex items-start gap-2 text-sm rounded border bg-white dark:bg-zinc-900 p-3">
                      <input
                        type="checkbox"
                        checked={ackSheetLeadConsent}
                        onChange={(e) => {
                          setAckSheetLeadConsent(e.target.checked);
                          setConnectError(null);
                        }}
                        className="mt-1"
                      />
                      <span className="text-gray-700 dark:text-gray-200">
                        I confirm that the leads in this Google Sheet have given consent to receive calls, texts, emails, and AI-assisted or virtual assistant outreach.
                      </span>
                    </label>

                    {connectError && <div className="text-sm text-red-600">{connectError}</div>}

                    <button
                      onClick={connectSheetNow}
                      disabled={connectLoading || !ackUnverifiedWarning || !ackSheetLeadConsent}
                      className={`${
                        connectLoading || !ackUnverifiedWarning || !ackSheetLeadConsent
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-green-600 hover:bg-green-700"
                      } text-white px-4 py-2 rounded`}
                      title={
                        !ackUnverifiedWarning
                          ? "Please confirm the unverified warning acknowledgement."
                          : !ackSheetLeadConsent
                            ? "Please confirm the Google Sheet lead consent acknowledgement."
                            : ""
                      }
                    >
                      {connectLoading ? "Connecting…" : "Connect Sheet"}
                    </button>

                    <div className="text-xs text-gray-500">
                      This generates your Apps Script. You paste it once and run install once.
                    </div>
                  </div>
                )}

                {wizardStep === 5 && (
                  <div className="space-y-3">
                    <div className="text-base font-semibold">Step 5 — One-time setup (IMPORTANT: do it this exact way)</div>

                    {/* ✅ REQUIRED: Also place notice on the Apps Script instructions step */}
                    <UnverifiedAppNotice />

                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <b>Goal:</b> Your Google account must own the script. Your lead vendor can still own the sheet — that’s normal.
                      <div className="mt-2 text-xs text-gray-500">
                        If you do this wrong, you may see an error like: <b>“This script is owned by a service account”</b>.
                        That happens when you accidentally opened the vendor’s script. The steps below prevent that.
                      </div>
                    </div>

                    {connectOk ? (
                      <div className="text-sm text-green-600">✅ Connected. Follow these steps exactly one time:</div>
                    ) : (
                      <div className="text-sm text-gray-600">Finish setup:</div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <a
                        href="https://script.google.com/home/projects/create"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                      >
                        Open Apps Script (New Project)
                      </a>
                      <a
                        href="https://docs.google.com/spreadsheets/u/0/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block bg-zinc-800 text-white px-4 py-2 rounded hover:opacity-90"
                      >
                        Open Google Sheets
                      </a>
                    </div>

                    <ol className="list-decimal pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-2">
                      <li>
                        Click <b>Open Apps Script (New Project)</b> above.
                        <div className="text-xs text-gray-500 mt-1">
                          This is required because vendors often attach scripts owned by “robot accounts”. A brand new project ensures you own it.
                        </div>
                      </li>

                      <li>
                        In the new Apps Script project, click <b>Code.gs</b> on the left, then{" "}
                        <b>select everything</b> and paste our code so it <b>replaces everything</b>.
                        <div className="text-xs text-gray-500 mt-1">
                          Do not paste into a vendor-owned script project.
                        </div>

                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold text-sm">Apps Script code (copy/paste)</div>
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
                      </li>

                      <li>
                        <b>Save</b> the Apps Script project:
                        <div className="mt-1 text-xs text-gray-500 space-y-1">
                          <div>• Mac: <b>⌘ Command + S</b></div>
                          <div>• Windows: <b>Ctrl + S</b></div>
                          <div>
                            • OR click the <b>floppy disk “Save”</b> icon in the toolbar
                          </div>
                        </div>
                      </li>

                      <li>
                        After saving, use the function dropdown near the top and select <b>covecrmInstall</b>, then click <b>Run</b> (▶).
                        <div className="text-xs text-gray-500 mt-1">
                          If it says “No functions”, you didn’t save yet.
                        </div>
                      </li>

                      <li>
                        Approve permissions when prompted.
                        <div className="text-xs text-gray-500 mt-1">
                          This is normal: you are approving <b>your own script</b> to read the sheet and send new rows to CoveCRM.
                        </div>
                      </li>

                      <li className="text-red-600">
                        <b>DO NOT CLICK DEPLOY.</b>
                      </li>

                      <li>
                        Finally, go back to the vendor sheet and leave it open.
                        <div className="text-xs text-gray-500 mt-1">
                          New rows added by your lead vendor will now import into your CoveCRM folder automatically.
                        </div>
                      </li>
                    </ol>

                    <div className="rounded border p-3 bg-gray-50 dark:bg-zinc-800 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                      <div className="font-semibold text-sm text-gray-700 dark:text-gray-200">Troubleshooting (fast)</div>
                      <div>
                        <b>If you see:</b> “The script cannot be run because it is owned by a service account”
                        <div className="ml-3">→ You opened the vendor’s script. Close it and use <b>Open Apps Script (New Project)</b> above.</div>
                      </div>
                      <div>
                        <b>If nothing imports:</b>
                        <div className="ml-3">→ Make sure you have <b>Edit</b> access to the vendor sheet (Viewer/Commenter often won’t work).</div>
                      </div>
                    </div>

                    {webhookUrl && (
                      <div className="text-xs text-gray-500">
                        Webhook: <span className="font-mono">{webhookUrl}</span>
                      </div>
                    )}
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
                        connectLoading || !ackUnverifiedWarning
                          ? "bg-gray-400 cursor-not-allowed"
                          : "bg-green-600 hover:bg-green-700"
                      }`}
                      disabled={connectLoading || !ackUnverifiedWarning}
                      title={!ackUnverifiedWarning ? "Please confirm the unverified warning acknowledgement." : ""}
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

      {saleModalLead && (
        <SaleModal
          leadId={String(saleModalLead._id || "")}
          defaultComp={defaultComp}
          onSave={async (result) => {
            const leadId = String(saleModalLead._id || "");
            setSaleModalLead(null);
            try {
              const saleRes = await fetch("/api/leads/record-sale", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, ...result }),
              });
              if (!saleRes.ok) {
                const d = await saleRes.json().catch(() => ({}));
                toast.error((d as any)?.error || "Failed to record sale");
                return;
              }
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, newFolderName: "Sold" }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (data?.success) {
                setLeads((prev) => prev.filter((l) => l._id !== leadId));
                setPreviewLead(null);
                await fetchFolders();
              }
            } catch {}
          }}
          onMarkPending={async () => {
            const leadId = String(saleModalLead._id || "");
            setSaleModalLead(null);
            try {
              const res = await fetch("/api/disposition-lead", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId, newFolderName: "Sold", premiumPending: true }),
              });
              const data = await res.json().catch(() => ({} as any));
              if (data?.success) {
                setLeads((prev) => prev.filter((l) => l._id !== leadId));
                setPreviewLead(null);
                await fetchFolders();
              } else {
                toast.error(data?.message || "Failed to mark lead as Sold");
              }
            } catch {}
          }}
          onCancel={() => setSaleModalLead(null)}
        />
      )}
    </div>
  );
}
