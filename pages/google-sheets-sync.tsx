// /pages/google-sheets-sync.tsx
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import toast from "react-hot-toast";

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  owners?: { emailAddress?: string }[];
};

type Tab = {
  sheetId?: number | null;
  title?: string | null;
  index?: number | null;
};

type FieldOption = { label: string; value: string };

const defaultFields: FieldOption[] = [
  { label: "First Name", value: "firstName" },
  { label: "Last Name", value: "lastName" },
  { label: "Phone", value: "phone" },
  { label: "Email", value: "email" },
  { label: "Address", value: "address" },
  { label: "City", value: "city" },
  { label: "State", value: "state" },
  { label: "Zip", value: "zip" },
  { label: "Date of Birth", value: "dob" },
  { label: "Age", value: "age" },
  { label: "Notes", value: "notes" },
];

export default function GoogleSheetsSyncPage() {
  // files/tabs
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesErr, setFilesErr] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);

  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [tabsErr, setTabsErr] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>("");

  // preview + mapping
  const [headerRow, setHeaderRow] = useState<number>(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRow, setSampleRow] = useState<Record<string, any>>({});
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const [folderName, setFolderName] = useState<string>("");

  const [importing, setImporting] = useState(false);

  const handleGoogleAuth = () => {
    window.location.href = "/api/connect/google-sheets";
  };

  const loadMySheets = async () => {
    setLoadingFiles(true);
    setFilesErr(null);
    // reset everything else
    setTabs(null);
    setSelectedFile(null);
    setSelectedTab("");
    setHeaders([]);
    setSampleRow({});
    setMapping({});
    setSkip({});
    setFolderName("");

    try {
      const r = await fetch("/api/sheets/list");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list spreadsheets");
      setFiles(j.files || []);
    } catch (e: any) {
      setFiles(null);
      setFilesErr(e.message || "Failed to list spreadsheets");
    } finally {
      setLoadingFiles(false);
    }
  };

  const loadTabs = async (file: DriveFile) => {
    setSelectedFile(file);
    setTabs(null);
    setTabsErr(null);
    setSelectedTab("");
    setHeaders([]);
    setSampleRow({});
    setMapping({});
    setSkip({});
    setFolderName(`${file.name} — `);

    try {
      setLoadingTabs(true);
      const r = await fetch(
        `/api/google/sheets/list-tabs?spreadsheetId=${encodeURIComponent(
          file.id
        )}`
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list tabs");
      setTabs(j.tabs || []);
    } catch (e: any) {
      setTabsErr(e.message || "Failed to list tabs");
    } finally {
      setLoadingTabs(false);
    }
  };

  const loadPreview = async () => {
    if (!selectedFile || !selectedTab)
      return toast.error("Pick a spreadsheet and a tab.");

    try {
      const r = await fetch("/api/google/sheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: selectedFile.id,
          title: selectedTab,
          headerRow,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to preview");

      setHeaders(j.headers || []);
      setSampleRow(j.sampleRow || {});

      // quick mapping guesses
      const guess: Record<string, string> = {};
      (j.headers || []).forEach((h: string) => {
        const key = (h || "").toLowerCase();
        if (key.includes("phone")) guess[h] = "phone";
        else if (key.includes("email")) guess[h] = "email";
        else if (key.includes("first")) guess[h] = "firstName";
        else if (key.includes("last")) guess[h] = "lastName";
      });
      setMapping(guess);

      toast.success("Preview loaded");
    } catch (e: any) {
      toast.error(e.message || "Preview failed");
    }
  };

  const runImport = async () => {
    if (!selectedFile || !selectedTab)
      return toast.error("Choose a spreadsheet & tab first.");

    // require at least phone or email mapped
    const mappedFields = new Set(Object.values(mapping).filter(Boolean));
    if (!mappedFields.has("phone") && !mappedFields.has("email")) {
      return toast.error("Map at least Phone or Email");
    }

    setImporting(true);
    try {
      const r = await fetch("/api/google/sheets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: selectedFile.id,
          title: selectedTab,
          headerRow,
          mapping,
          skip,
          folderName:
            folderName || `${selectedFile.name} — ${selectedTab || "Sheet"}`,
          moveExistingToFolder: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Import failed");
      toast.success(`Imported ${j.imported}, updated ${j.updated}. Sync saved.`);
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("connected") === "google-sheets") {
        loadMySheets();
        const url = new URL(window.location.href);
        url.searchParams.delete("connected");
        window.history.replaceState({}, "", url.toString());
        return;
      }
      loadMySheets();
    } catch {
      // no-op
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ui helpers
  const inputBase =
    "w-full md:w-72 px-3 py-2 rounded-md border bg-white text-slate-900 " +
    "placeholder-slate-400 border-slate-300 " +
    "focus:outline-none focus:ring-2 focus:ring-indigo-500 " +
    "dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:placeholder-slate-400";

  const selectBase =
    "w-full md:w-72 px-3 py-2 rounded-md border bg-white text-slate-900 " +
    "border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 " +
    "dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600";

  const buttonPrimary =
    "inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 " +
    "text-white font-medium px-4 py-2 rounded-md shadow-sm " +
    "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 " +
    "dark:focus:ring-offset-slate-900";

  const buttonNeutral =
    "inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-800 " +
    "text-white font-medium px-4 py-2 rounded-md shadow-sm " +
    "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 " +
    "dark:focus:ring-offset-slate-900";

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
      <Sidebar />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Google Sheets Sync
        </h1>
        <p className="mt-1 mb-4 text-slate-600 dark:text-slate-300">
          Pick a spreadsheet, choose a tab, preview & map columns, then Save &
          Import. New rows will sync automatically.
        </p>

        {/* Actions row */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button onClick={handleGoogleAuth} className={buttonPrimary}>
            Connect Google Account
          </button>
          <button
            onClick={loadMySheets}
            className={buttonNeutral}
            disabled={loadingFiles}
          >
            {loadingFiles ? "Loading..." : "Load My Spreadsheets"}
          </button>
        </div>

        {filesErr && (
          <div className="text-sm text-red-600 dark:text-rose-400 mb-4">
            {filesErr}
          </div>
        )}

        {/* CONTROL PANEL (TOP) */}
        {selectedFile && (
          <div className="mb-5 rounded-lg border border-slate-200 bg-white shadow-sm p-4 dark:bg-slate-800 dark:border-slate-700">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Control Panel — <span className="text-indigo-600">{selectedFile.name}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Select a tab, set header row & folder name, then load preview.
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-200">
                  Tab
                </label>
                <select
                  value={selectedTab}
                  onChange={(e) => setSelectedTab(e.target.value)}
                  className={selectBase}
                >
                  <option value="">-- Select a tab --</option>
                  {(tabs || []).map((t) => (
                    <option
                      key={`${t.sheetId}-${t.title}`}
                      value={t.title || ""}
                    >
                      {t.title}
                    </option>
                  ))}
                </select>
                {tabsErr && (
                  <div className="text-xs text-red-600 dark:text-rose-400 mt-1">
                    {tabsErr}
                  </div>
                )}
                {loadingTabs && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Loading tabs…
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-200">
                  Header Row (1-based)
                </label>
                <input
                  type="number"
                  min={1}
                  value={headerRow}
                  onChange={(e) =>
                    setHeaderRow(parseInt(e.target.value || "1", 10))
                  }
                  className={inputBase}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-slate-700 dark:text-slate-200">
                  Folder Name (new or existing)
                </label>
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="e.g. Vet leads — Sheet1"
                  className={inputBase}
                />
              </div>
            </div>

            <div className="mt-3">
              <button onClick={loadPreview} className={buttonPrimary}>
                Load Preview
              </button>
            </div>
          </div>
        )}

        {/* FILES LIST */}
        {!loadingFiles && files && files.length > 0 && (
          <ul className="space-y-3 mb-6">
            {files.map((f) => (
              <li
                key={f.id}
                className={`border rounded-lg p-4 bg-white dark:bg-slate-800 dark:border-slate-700 shadow-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 ${
                  selectedFile?.id === f.id ? "ring-2 ring-indigo-500" : ""
                }`}
                onClick={() => loadTabs(f)}
              >
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {f.name}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {f.owners?.[0]?.emailAddress} • {f.modifiedTime}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* PREVIEW + MAPPING */}
        {headers.length > 0 && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:bg-slate-800 dark:border-slate-700">
            <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-slate-100">
              Map your fields
            </h3>

            <div className="grid grid-cols-3 gap-4 font-medium text-slate-700 dark:text-slate-300">
              <div>Sheet Column</div>
              <div>Mapped To</div>
              <div>Skip</div>
            </div>

            {headers.map((h) => {
              const isSkipped = !!skip[h];
              const isMapped = !!mapping[h] && !isSkipped;
              const value = sampleRow[h] ?? "";

              return (
                <div
                  key={h}
                  className={`grid grid-cols-3 gap-4 items-center mb-2 border-b pb-2 dark:border-slate-700 rounded ${
                    isMapped
                      ? "bg-emerald-50 dark:bg-emerald-900/20"
                      : isSkipped
                      ? "bg-rose-50 dark:bg-rose-900/20"
                      : "bg-transparent"
                  }`}
                >
                  <div className="py-2">
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {h || <em>(empty)</em>}
                    </div>
                    {value && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Preview: {String(value)}
                      </div>
                    )}
                  </div>

                  <div className="py-2">
                    <select
                      value={mapping[h] || ""}
                      disabled={isSkipped}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [h]: e.target.value }))
                      }
                      className={selectBase}
                    >
                      <option value="">-- Select field --</option>
                      {defaultFields.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="py-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-indigo-600"
                      checked={isSkipped}
                      onChange={() =>
                        setSkip((s) => ({ ...s, [h]: !s[h] }))
                      }
                    />
                  </div>
                </div>
              );
            })}

            <button
              onClick={runImport}
              disabled={importing}
              className={`${buttonPrimary} mt-4`}
            >
              {importing ? "Importing…" : "Save & Import"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
