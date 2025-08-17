import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import toast from "react-hot-toast";

export default function GoogleSheetsSyncPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sheets, setSheets] = useState<any[]>([]);
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingSheets, setFetchingSheets] = useState(false);

  // ✅ Start Google OAuth
  const handleGoogleAuth = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/google/auth");
      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error("Failed to initiate Google authentication.");
      }
    } catch (err) {
      console.error("Auth error:", err);
      toast.error("Google authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Check if already connected
  const checkGoogleStatus = async () => {
    try {
      const res = await fetch("/api/google/status");
      const data = await res.json();
      if (data.connected) {
        setIsAuthenticated(true);
      }
    } catch (err) {
      console.error("Status error:", err);
    }
  };

  // ✅ Fetch Sheets from Google
  const fetchSheets = async () => {
    setFetchingSheets(true);
    try {
      const res = await fetch("/api/google/list-sheets");
      const data = await res.json();

      const enhanced = (data.sheets || []).map((sheet: any) => ({
        ...sheet,
        folderId: "",
      }));
      setSheets(enhanced);
    } catch (err) {
      console.error("Fetch Sheets error:", err);
      toast.error("Could not load your Google Sheets.");
    } finally {
      setFetchingSheets(false);
    }
  };

  // ✅ Fetch user's folders from DB
  const fetchFolders = async () => {
    try {
      const res = await fetch("/api/folders/list");
      const data = await res.json();
      if (res.ok) setFolders(data.folders || []);
      else throw new Error(data.message);
    } catch (err) {
      console.error("Fetch Folders error:", err);
      toast.error("Could not load folders.");
    }
  };

  // ✅ Save Sync Setting
  const saveSheetLink = async (sheet: any) => {
    if (!sheet.folderId) return toast.error("Please select a folder first.");

    try {
      const res = await fetch("/api/google/save-sheet-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId: sheet.id,
          sheetName: sheet.name,
          folderId: sheet.folderId,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success("Sheet linked to folder!");
      } else {
        toast.error(data.message || "Failed to save sync.");
      }
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Save failed.");
    }
  };

  useEffect(() => {
    checkGoogleStatus();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSheets();
      fetchFolders();
    }
  }, [isAuthenticated]);

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold mb-4">Google Sheets Sync</h1>
        <p className="mb-4 text-gray-600 dark:text-gray-300">
          Automatically sync leads from your Google Sheets into CRM folders.
        </p>

        {!isAuthenticated ? (
          <button
            onClick={handleGoogleAuth}
            className="bg-[#34a853] text-white px-6 py-2 rounded hover:opacity-90"
            disabled={loading}
          >
            {loading ? "Connecting..." : "Connect Google Account"}
          </button>
        ) : (
          <>
            {fetchingSheets ? (
              <p className="text-gray-500">Loading your Google Sheets...</p>
            ) : sheets.length === 0 ? (
              <p className="text-gray-500">No Google Sheets found.</p>
            ) : (
              <div className="space-y-4">
                {sheets.map((sheet) => (
                  <div
                    key={sheet.id}
                    className="border rounded p-4 bg-white dark:bg-gray-800 shadow"
                  >
                    <h2 className="text-lg font-semibold">{sheet.name}</h2>
                    <p className="text-sm text-gray-500">ID: {sheet.id}</p>

                    <div className="mt-3">
                      <label className="text-sm block mb-1">Assign to Folder:</label>
                      <select
                        className="w-full border px-2 py-1 rounded text-black"
                        value={sheet.folderId || ""}
                        onChange={(e) => {
                          const updated = sheets.map((s) =>
                            s.id === sheet.id ? { ...s, folderId: e.target.value } : s
                          );
                          setSheets(updated);
                        }}
                      >
                        <option value="">-- Select Folder --</option>
                        {folders.map((folder) => (
                          <option key={folder._id} value={folder._id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      className="mt-3 bg-blue-600 text-white px-4 py-1 rounded hover:opacity-90"
                      onClick={() => saveSheetLink(sheet)}
                    >
                      Save Sync
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
