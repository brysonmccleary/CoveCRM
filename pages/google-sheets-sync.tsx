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
type Tab = { sheetId?: number | null; title?: string | null; index?: number | null; };

type FieldOption = { label: string; value: string; };
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
  const [selectedTab, setSelectedTab] = useState<string>(""); // title

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
    setTabs(null);
    setSelectedFile(null);
    setHeaders([]); setSampleRow({}); setMapping({}); setSkip({});
    try {
      const r = await fetch("/api/sheets/list");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list spreadsheets");
      setFiles(j.files || []);
    } catch (e:any) {
      setFiles(null); setFilesErr(e.message || "Failed to list spreadsheets");
    } finally { setLoadingFiles(false); }
  };

  const loadTabs = async (file: DriveFile) => {
    setSelectedFile(file); setTabs(null); setTabsErr(null); setSelectedTab("");
    setHeaders([]); setSampleRow({}); setMapping({}); setSkip({});
    setFolderName(`${file.name} — `);
    try {
      setLoadingTabs(true);
      const r = await fetch(`/api/google/sheets/list-tabs?spreadsheetId=${encodeURIComponent(file.id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list tabs");
      setTabs(j.tabs || []);
    } catch (e:any) {
      setTabsErr(e.message || "Failed to list tabs");
    } finally {
      setLoadingTabs(false);
    }
  };

  const loadPreview = async () => {
    if (!selectedFile || !selectedTab) return toast.error("Pick a spreadsheet and a tab.");
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
      const guess: Record<string,string> = {};
      (j.headers || []).forEach((h: string) => {
        const key = h.toLowerCase();
        if (key.includes("phone")) guess[h] = "phone";
        else if (key.includes("email")) guess[h] = "email";
        else if (key.includes("first")) guess[h] = "firstName";
        else if (key.includes("last")) guess[h] = "lastName";
      });
      setMapping(guess);

      toast.success("Preview loaded");
    } catch (e:any) {
      toast.error(e.message || "Preview failed");
    }
  };

  const runImport = async () => {
    if (!selectedFile || !selectedTab) return toast.error("Choose a spreadsheet & tab first.");
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
          folderName: folderName || `${selectedFile.name} — ${selectedTab}`,
          moveExistingToFolder: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Import failed");
      toast.success(`Imported ${j.imported}, updated ${j.updated}. Sync saved.`);
    } catch (e:any) {
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
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-2">Google Sheets Sync</h1>
        <p className="mb-4 text-gray-600 dark:text-gray-300">
          Pick a spreadsheet, choose a tab, preview & map columns, then Save & Import. New rows will sync automatically.
        </p>

        <div className="flex flex-wrap gap-3 mb-6">
          <button onClick={handleGoogleAuth}
                  className="bg-[#34a853] text-white px-6 py-2 rounded hover:opacity-90">
            Connect Google Account
          </button>
          <button onClick={loadMySheets}
                  className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900"
                  disabled={loadingFiles}>
            {loadingFiles ? "Loading..." : "Load My Spreadsheets"}
          </button>
        </div>

        {filesErr && <div className="text-sm text-red-600 mb-4">{filesErr}</div>}

        {/* Files list */}
        {!loadingFiles && files && files.length > 0 && (
          <ul className="space-y-3 mb-6">
            {files.map((f) => (
              <li key={f.id}
                  className={`border rounded p-4 bg-white dark:bg-gray-800 shadow cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    selectedFile?.id === f.id ? "ring-2 ring-indigo-500" : ""
                  }`}
                  onClick={() => loadTabs(f)}>
                <div className="font-semibold">{f.name}</div>
                <div className="text-xs text-gray-500">
                  {f.owners?.[0]?.emailAddress} • {f.modifiedTime}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Tabs + mapping form */}
        {selectedFile && (
          <div className="mt-2">
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Tab</label>
              <select value={selectedTab}
                      onChange={(e) => setSelectedTab(e.target.value)}
                      className="border rounded px-3 py-2 w-full md:w-96 text-black">
                <option value="">-- Select a tab --</option>
                {(tabs || []).map((t) => (
                  <option key={`${t.sheetId}-${t.title}`} value={t.title || ""}>
                    {t.title}
                  </option>
                ))}
              </select>
              {tabsErr && <div className="text-sm text-red-600 mt-1">{tabsErr}</div>}
              {loadingTabs && <div className="text-sm text-gray-500 mt-1">Loading tabs…</div>}
            </div>

            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Header Row (1-based)</label>
                <input type="number" min={1} value={headerRow}
                       onChange={(e) => setHeaderRow(parseInt(e.target.value || "1", 10))}
                       className="border rounded px-3 py-2 w-40 text-black" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Folder Name (new or existing)</label>
                <input type="text" value={folderName} onChange={(e) => setFolderName(e.target.value)}
                       placeholder="e.g. Vet leads — Sheet1"
                       className="border rounded px-3 py-2 w-full text-black" />
              </div>
            </div>

            <div className="mt-3">
              <button onClick={loadPreview} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                Load Preview
              </button>
            </div>

            {headers.length > 0 && (
              <div className="mt-6">
                <h3 className="text-lg font-semibold mb-2">Map your fields</h3>
                <div className="grid grid-cols-3 gap-4 font-medium text-gray-700 dark:text-gray-300">
                  <div>Sheet Column</div><div>Mapped To</div><div>Skip</div>
                </div>

                {headers.map((h) => {
                  const isSkipped = !!skip[h];
                  const isMapped = mapping[h] && !isSkipped;
                  const value = sampleRow[h] ?? "";
                  return (
                    <div key={h}
                         className={`grid grid-cols-3 gap-4 items-center mb-2 border-b pb-2 ${
                           isMapped ? "bg-green-100" : isSkipped ? "bg-red-100" : ""
                         }`}>
                      <div>
                        <div className="font-medium">{h || <em>(empty)</em>}</div>
                        {value && <div className="text-xs text-gray-500">Preview: {String(value)}</div>}
                      </div>
                      <select value={mapping[h] || ""} disabled={isSkipped}
                              onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}
                              className="border p-2 text-black">
                        <option value="">-- Select field --</option>
                        {defaultFields.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      <input type="checkbox" className="h-5 w-5"
                             checked={isSkipped}
                             onChange={() => setSkip((s) => ({ ...s, [h]: !s[h] }))} />
                    </div>
                  );
                })}

                <button onClick={runImport}
                        disabled={importing}
                        className="mt-4 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">
                  {importing ? "Importing…" : "Save & Import"}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
