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

  // If a folderId is present in the query, load its leads and render on this page.
  useEffect(() => {
    const loadLeads = async () => {
      if (!selectedFolderId) {
        setLeads(null);
        setLeadError(null);
        return;
      }
      try {
        setLoadingLeads(true);
        setLeadError(null);
        const r = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(selectedFolderId)}`);
        if (!r.ok) throw new Error("Failed to fetch leads in folder");
        const j = await r.json();
        setLeads(j?.leads || []);
      } catch (e: any) {
        console.error(e);
        setLeadError(e?.message || "Failed to load leads");
        setLeads([]);
      } finally {
        setLoadingLeads(false);
      }
    };
    loadLeads();
  }, [selectedFolderId]);

  const handleFolderClick = (folderId: string) => {
    router.push({ pathname: "/leads", query: { folderId } }).catch(() => {});
  };

  const clearSelection = () => {
    router.push("/leads").catch(() => {});
  };

  const selectedFolderName =
    (selectedFolderId && folders.find((f) => f._id === selectedFolderId)?.name) || "";

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

            {loadingLeads ? (
              <p>Loading leads…</p>
            ) : leadError ? (
              <p className="text-red-400">{leadError}</p>
            ) : !leads || leads.length === 0 ? (
              <p className="text-gray-400">No leads in this folder.</p>
            ) : (
              <ul className="space-y-2">
                {leads.map((lead) => (
                  <li key={lead._id} className="p-3 border border-gray-600 rounded hover:bg-gray-700">
                    <div className="font-medium">
                      {lead.name || lead["First Name"] || lead["firstName"] || "(no name)"}
                    </div>
                    <div className="text-sm text-gray-300">
                      {(lead.phone || lead["Phone"] || lead["phone"] || "")}
                      {lead.email ? ` • ${lead.email}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
