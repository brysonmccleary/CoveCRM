import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import toast from "react-hot-toast";

// Types for convenience
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

export default function GoogleSheetsSyncPage() {
  // Sheets
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesErr, setFilesErr] = useState<string | null>(null);

  // Tabs
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [tabs, setTabs] = useState<Tab[] | null>(null);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [tabsErr, setTabsErr] = useState<string | null>(null);

  // ---- OAuth start ----
  const handleGoogleAuth = () => {
    // use your working OAuth start route
    window.location.href = "/api/connect/google-sheets";
  };

  // ---- List spreadsheets ----
  const loadMySheets = async () => {
    setLoadingFiles(true);
    setFilesErr(null);
    setTabs(null);
    setSelectedFile(null);

    try {
      const r = await fetch("/api/sheets/list");
      const j = await r.json();

      if (!r.ok) {
        // Common case if not connected yet:
        // { error: "Google Sheets not connected" }
        throw new Error(j?.error || "Failed to list spreadsheets");
      }

      setFiles(j.files || []);
      if ((j.files || []).length === 0) {
        toast("No Google Sheets found in Drive.", { icon: "ℹ️" });
      }
    } catch (e: any) {
      setFiles(null);
      setFilesErr(e.message || "Failed to list spreadsheets");
    } finally {
      setLoadingFiles(false);
    }
  };

  // ---- List tabs for a selected spreadsheet ----
  const loadTabs = async (file: DriveFile) => {
    setSelectedFile(file);
    setTabs(null);
    setTabsErr(null);
    setLoadingTabs(true);

    try {
      const r = await fetch(
        `/api/google/sheets/list-tabs?spreadsheetId=${encodeURIComponent(file.id)}`
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Failed to list tabs");
      setTabs(j.tabs || []);
    } catch (e: any) {
      setTabsErr(e.message || "Failed to list tabs");
      setTabs(null);
    } finally {
      setLoadingTabs(false);
    }
  };

  // ---- Autoload after OAuth callback ----
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);

      // If we came back from OAuth, fetch immediately
      if (params.get("connected") === "google-sheets") {
        loadMySheets();

        // Clean the URL so refreshes don't keep reloading
        const url = new URL(window.location.href);
        url.searchParams.delete("connected");
        window.history.replaceState({}, "", url.toString());
        return;
      }

      // Otherwise, we can still try loading (if already connected it will work)
      loadMySheets();
    } catch {
      // no-op (SSR path guards)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-2">Google Sheets Sync</h1>
        <p className="mb-4 text-gray-600 dark:text-gray-300">
          Connect your Google account, pick a spreadsheet, and view its tabs. (Import happens on the Leads page.)
        </p>

        <div className="flex flex-wrap gap-3 mb-6">
          <button
            onClick={handleGoogleAuth}
            className="bg-[#34a853] text-white px-6 py-2 rounded hover:opacity-90"
          >
            Connect Google Account
          </button>

          <button
            onClick={loadMySheets}
            className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-900"
            disabled={loadingFiles}
          >
            {loadingFiles ? "Loading..." : "Load My Spreadsheets"}
          </button>
        </div>

        {/* Sheets list */}
        {filesErr && (
          <div className="text-sm text-red-600 mb-4">{filesErr}</div>
        )}

        {loadingFiles && <div className="text-sm text-gray-500">Loading spreadsheets…</div>}

        {!loadingFiles && files && files.length > 0 && (
          <ul className="space-y-3">
            {files.map((f) => (
              <li
                key={f.id}
                className={`border rounded p-4 bg-white dark:bg-gray-800 shadow cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  selectedFile?.id === f.id ? "ring-2 ring-indigo-500" : ""
                }`}
                onClick={() => loadTabs(f)}
              >
                <div className="font-semibold">{f.name}</div>
                <div className="text-xs text-gray-500">
                  {f.owners?.[0]?.emailAddress} • {f.modifiedTime}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Tabs for the selected spreadsheet */}
        {selectedFile && (
          <div className="mt-6">
            <div className="font-semibold mb-2">
              Tabs in: <span className="text-indigo-600">{selectedFile.name}</span>
            </div>

            {loadingTabs && (
              <div className="text-sm text-gray-500">Loading tabs…</div>
            )}
            {tabsErr && <div className="text-sm text-red-600">{tabsErr}</div>}

            {tabs && tabs.length > 0 && (
              <ul className="divide-y rounded border">
                {tabs.map((t) => (
                  <li key={`${t.sheetId}-${t.title}`} className="p-3">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-gray-500">Sheet ID: {t.sheetId}</div>
                  </li>
                ))}
              </ul>
            )}
            {tabs && tabs.length === 0 && !loadingTabs && (
              <div className="text-sm text-gray-500">No tabs found.</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
