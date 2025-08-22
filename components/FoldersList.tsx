// components/folderslist.tsx
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";

interface Folder {
  _id: string;
  name: string;
  leadCount: number;
}

interface FoldersListProps {
  onRefetchReady?: (refreshFn: () => void) => void;
  /** Optional callback; if omitted we will navigate to /leads?folderId=... ourselves */
  onFolderSelect?: (folderId: string) => void;
}

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

export default function FoldersList({ onRefetchReady, onFolderSelect }: FoldersListProps) {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/get-folders");
      if (!res.ok) throw new Error("Failed to fetch folders");
      const data = await res.json();
      setFolders(data.folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeleteFolder = async (folderId: string) => {
    const confirmed = confirm("Are you sure you want to delete this folder?");
    if (!confirmed) return;

    try {
      const res = await fetch("/api/delete-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });
      const data = await res.json();
      if (data.success) {
        setFolders((prev) => prev.filter((f) => f._id !== folderId));
      } else {
        alert(data.message || "Failed to delete folder.");
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Error deleting folder.");
    }
  };

  // default behavior if parent doesn't supply a handler
  const goToFolder = (folderId?: string) => {
    if (!folderId || typeof folderId !== "string" || folderId.trim() === "") {
      console.warn("FoldersList.goToFolder: invalid folderId", { folderId });
      return;
    }
    if (onFolderSelect) {
      onFolderSelect(folderId);
      return;
    }
    // Stay on the Leads page; pass selection via query param
    const path = { pathname: "/leads", query: { folderId } };
    console.log("FoldersList: navigating to", path);
    router
      .push(path)
      .catch((e) => console.error("FoldersList: router.push failed", e));
  };

  // Expose the refresh function to parent
  useEffect(() => {
    if (onRefetchReady) onRefetchReady(fetchFolders);
  }, [onRefetchReady, fetchFolders]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  if (loading) return <p>Loading folders...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Your Folders</h2>
      {folders.length === 0 ? (
        <p className="text-gray-400">No folders yet.</p>
      ) : (
        <ul>
          {folders.map((folder) => (
            <li
              key={folder._id}
              className="mb-2 border border-gray-600 p-2 rounded flex justify-between items-center hover:bg-gray-700"
            >
              <button
                type="button"
                className="cursor-pointer w-full text-left"
                onClick={() => goToFolder(folder._id)}
                title={`Open ${folder.name}`}
              >
                {folder.name} — {folder.leadCount} Lead{folder.leadCount !== 1 ? "s" : ""}
              </button>

              {!SYSTEM_FOLDERS.includes(folder.name) && (
                <button
                  onClick={() => handleDeleteFolder(folder._id)}
                  title="Delete Folder"
                  className="ml-4 text-red-500 hover:text-red-700 cursor-pointer"
                >
                  🗑️
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
