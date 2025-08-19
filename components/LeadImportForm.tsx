// /components/leadimportform.tsx
import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";

interface FieldOption { label: string; value: string; }
interface DriveFile { id: string; name: string; modifiedTime?: string; owners?: { emailAddress?: string }[]; }
interface Tab { sheetId?: number | null; title?: string | null; index?: number | null; }

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
  { label: "Create Custom Field", value: "custom" },
];

export default function LeadImportForm() {
  // CSV flow
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [sampleRow, setSampleRow] = useState<Record<string, any>>({});
  const [fieldMapping, setFieldMapping] = useState<{ [key: string]: string }>({});
  const [skipFields, setSkipFields] = useState<{ [key: string]: boolean }>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Google Sheets state
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<DriveFile | null>(null);
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [tabErr, setTabErr] = useState<string | null>(null);

  const [selectedTabTitle, setSelectedTabTitle] = useState<string>("");
  const [selectedSheetId, setSelectedSheetId] = useState<number | null>(null);
  const [headerRow, setHeaderRow] = useState<number>(1);

  const [previewing, setPreviewing] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const [folderName, setFolderName] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<any>(null);

  // ===== CSV handlers =====
  const handleFileUpload = (file: File) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (result) => {
        if (!result.meta.fields) return;
        const data = result.data as Record<string, any>[];
        const headers = result.meta.fields.filter((h) => data.some((row) => String(row[h] ?? "").trim() !== ""));
        setCsvHeaders(headers);
        if (data && data.length > 0) setSampleRow(data[0]);
      },
    });
  };

  const handleFieldChange = (header: string, value: string) => {
    if (value === "custom") {
      const customValue = prompt(`Enter custom field name for "${header}"`);
      if (customValue && customValue.trim() !== "") {
        setFieldMapping((prev) => ({ ...prev, [header]: customValue.trim() }));
      }
    } else {
      setFieldMapping((prev) => ({ ...prev, [header]: value }));
    }
    setSkipFields((prev) => ({ ...prev, [header]: false }));
  };

  const handleCheckboxChange = (header: string) => {
    setSkipFields((prev) => {
      const newVal = !prev[header];
      if (newVal) setFieldMapping((map) => ({ ...map, [header]: "" }));
      return { ...prev, [header]: newVal };
    });
  };

  const handleClickUpload = () => fileInputRef.current?.click();

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  // 🔄 OAuth start
  const handleGoogleAuth = () => {
    window.location.href = "/api/connect/google-sheets";
  };

  // 🔎 Load spreadsheets (calls /api/sheets/list)
  const loadMySheets = async () => {
    setLoadingFiles(true);
    setFileErr(null);
    setImportSummary(null);
    try {
      const r = await fetch("/api/sheets/list");
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list spreadsheets");
      setFiles(j.files || []);
      // Reset downstream state
      setSelectedSpreadsheet(null);
      setTabs(null);
      setSelectedTabTitle("");
      setSelectedSheetId(null);
      setCsvHeaders([]);
      setSampleRow({});
      setFieldMapping({});
      setSkipFields({});
      setHeaderRow(1);
      setFolderName("");
    } catch (e: any) {
      setFileErr(e.message || "Failed to list spreadsheets");
      setFiles(null);
    } finally {
      setLoadingFiles(false);
    }
  };

  // 👇 Auto-load after returning from OAuth (callback adds ?connected=google-sheets)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("connected") === "google-sheets") {
        loadMySheets();
        // clean the URL so refreshes don’t keep reloading
        const url = new URL(window.location.href);
        url.searchParams.delete("connected");
        window.history.replaceState({}, "", url.toString());
      }
    } catch { /* no-op for SSR */ }
  }, []);

  const onSelectSpreadsheet = async (f: DriveFile) => {
    setSelectedSpreadsheet(f);
    setTabs(null);
    setTabErr(null);
    setImportSummary(null);
    setLoadingTabs(true);
    setSelectedTabTitle("");
    setSelectedSheetId(null);
    try {
      const r = await fetch(`/api/google/sheets/list-tabs?spreadsheetId=${encodeURIComponent(f.id)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list tabs");
      setTabs(j.tabs || []);
    } catch (e: any) {
      setTabErr(e.message || "Failed to list tabs");
      setTabs(null);
    } finally {
      setLoadingTabs(false);
    }
  };

  const previewColumns = async () => {
    if (!selectedSpreadsheet) return;
    if (!selectedTabTitle && selectedSheetId == null) {
      setPreviewErr("Choose a tab first"); return;
    }
    setPreviewErr(null);
    setPreviewing(true);
    try {
      const r = await fetch("/api/google/sheets/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: selectedSpreadsheet.id,
          title: selectedTabTitle || undefined,
          sheetId: selectedSheetId ?? undefined,
          headerRow: headerRow || 1,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Preview failed");
      setCsvHeaders(j.headers || []);
      setSampleRow(j.sampleRow || {});
      setFieldMapping({});
      setSkipFields({});
      setFolderName(`${selectedSpreadsheet.name} — ${selectedTabTitle || ""}`.trim());
    } catch (e: any) {
      setPreviewErr(e.message || "Preview failed");
      setCsvHeaders([]); setSampleRow({});
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!selectedSpreadsheet) return;
    if (!selectedTabTitle && selectedSheetId == null) {
      setImportErr("Choose a tab first"); return;
    }
    if (!csvHeaders.length) { setImportErr("Preview first so we can read headers"); return; }
    if (!folderName.trim()) { setImportErr("Enter a folder name"); return; }

    setImportErr(null);
    setImporting(true);
    setImportSummary(null);

    const cleanMapping: Record<string, string> = {};
    csvHeaders.forEach((h) => {
      const v = fieldMapping[h];
      if (v && !skipFields[h]) cleanMapping[h] = v;
    });

    try {
      const r = await fetch("/api/google/sheets/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetId: selectedSpreadsheet.id,
          title: selectedTabTitle || undefined,
          sheetId: selectedSheetId ?? undefined,
          headerRow: headerRow || 1,
          folderName: folderName.trim(),
          mapping: cleanMapping,
          skip: skipFields,
          createFolderIfMissing: true,
          moveExistingToFolder: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Import failed");
      setImportSummary(j);
    } catch (e: any) {
      setImportErr(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = () => {
    console.log("Final mapping:", fieldMapping);
    console.log("Skip fields:", skipFields);
    alert("Leads imported! (Simulation)");
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 p-6 rounded shadow"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <h2 className="text-xl font-bold mb-4">Import Leads</h2>

      <div className="flex flex-wrap gap-3 mb-4">
        <button onClick={handleClickUpload} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Upload CSV
        </button>
        <button onClick={handleGoogleAuth} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
          Connect Google Sheet
        </button>
        <button onClick={loadMySheets} className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800">
          Load My Spreadsheets
        </button>
      </div>

      {/* Sheets list */}
      <div className="mb-6 space-y-4">
        {loadingFiles && <div className="text-sm text-gray-500">Loading spreadsheets…</div>}
        {fileErr && <div className="text-sm text-red-600">{fileErr}</div>}

        {files && files.length > 0 && (
          <div className="space-y-2">
            <div className="font-semibold">Your Google Sheets:</div>
            <ul className="divide-y rounded border">
              {files.map((f) => (
                <li
                  key={f.id}
                  className={`p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedSpreadsheet?.id === f.id ? "bg-gray-50 dark:bg-gray-700" : ""}`}
                  onClick={() => onSelectSpreadsheet(f)}
                >
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs text-gray-500">
                    {f.owners?.[0]?.emailAddress} • {f.modifiedTime}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {selectedSpreadsheet && (
          <div className="mt-4 space-y-3">
            <div className="font-semibold">Tabs in: {selectedSpreadsheet.name}</div>
            {loadingTabs && <div className="text-sm text-gray-500">Loading tabs…</div>}
            {tabErr && <div className="text-sm text-red-600">{tabErr}</div>}

            {tabs && tabs.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-600">Choose tab</label>
                <select
                  className="border p-2 rounded"
                  value={selectedTabTitle}
                  onChange={(e) => {
                    setSelectedTabTitle(e.target.value);
                    const t = tabs.find((x) => x.title === e.target.value);
                    setSelectedSheetId((t?.sheetId as number) ?? null);
                  }}
                >
                  <option value="">-- Select a tab --</option>
                  {tabs.map((t) => (
                    <option key={`${t.sheetId}-${t.title}`} value={t.title || ""}>
                      {t.title}
                    </option>
                  ))}
                </select>

                <label className="text-sm text-gray-600">Header row</label>
                <input
                  type="number" min={1} value={headerRow}
                  onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value || "1")))}
                  className="border p-2 w-24 rounded"
                />

                <button
                  onClick={previewColumns}
                  disabled={previewing || (!selectedTabTitle && selectedSheetId == null)}
                  className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-60"
                >
                  {previewing ? "Previewing…" : "Preview Columns"}
                </button>

                {previewErr && <div className="text-sm text-red-600">{previewErr}</div>}
              </div>
            )}

            {/* Folder + Import */}
            {csvHeaders.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                <label className="text-sm text-gray-600">Folder name</label>
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Imported Leads"
                  className="border p-2 rounded min-w-[260px]"
                />
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="bg-emerald-600 text-white px-4 py-2 rounded hover:bg-emerald-700 disabled:opacity-60"
                >
                  {importing ? "Importing…" : "Import to Folder"}
                </button>
                {importErr && <div className="text-sm text-red-600">{importErr}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* CSV uploader UI (unchanged) */}
      <div className="border-2 border-dashed border-gray-400 rounded p-6 text-center mb-4">
        Drag and drop CSV file here
      </div>

      <input
        type="file" accept=".csv" ref={fileInputRef} style={{ display: "none" }}
        onChange={(e) => { if (e.target.files && e.target.files[0]) handleFileUpload(e.target.files[0]); }}
      />

      {/* Mapping UI */}
      {csvHeaders.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="text-lg font-semibold mb-2">Map your fields</h3>
          <div className="grid grid-cols-3 gap-4 font-medium text-gray-700 dark:text-gray-300">
            <div>Source Column</div><div>Mapped To</div><div>Do Not Import</div>
          </div>
          {csvHeaders.map((header) => {
            const isSkipped = skipFields[header];
            const isMapped = fieldMapping[header] && !isSkipped;
            return (
              <div key={header} className={`grid grid-cols-3 gap-4 items-center mb-2 border-b pb-2 ${isMapped ? "bg-green-100" : isSkipped ? "bg-red-100" : ""}`}>
                <div>
                  <div className="font-medium">{header}</div>
                  {sampleRow[header] && <div className="text-sm text-gray-500">Preview: {String(sampleRow[header])}</div>}
                </div>
                <select
                  value={fieldMapping[header] || ""}
                  onChange={(e) => handleFieldChange(header, e.target.value)}
                  disabled={isSkipped}
                  className="border p-2"
                >
                  <option value="">-- Select field --</option>
                  {defaultFields.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <input
                  type="checkbox"
                  checked={skipFields[header] || false}
                  onChange={() => handleCheckboxChange(header)}
                  className="h-5 w-5"
                />
              </div>
            );
          })}

          {importSummary && (
            <div className="mt-4 p-3 rounded border bg-gray-50 dark:bg-gray-700">
              <div className="font-semibold mb-1">Import complete</div>
              <div className="text-sm">
                Imported: {importSummary.imported} • Updated: {importSummary.updated} • Skipped (no key): {importSummary.skippedNoKey}
              </div>
              <div className="text-sm">
                Folder: {importSummary.folderName} (ID: {importSummary.folderId})
              </div>
              <div className="text-xs text-gray-500">Last Row Imported: {importSummary.lastRowImported}</div>
            </div>
          )}

          {/* Legacy CSV demo */}
          <button onClick={handleSubmit} className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            Import Leads (CSV simulation)
          </button>
        </div>
      )}
    </div>
  );
}
