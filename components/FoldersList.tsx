import { useEffect, useState, useCallback } from "react";

interface Folder {
  _id: string;
  name: string;
  leadCount: number;
}

interface FoldersListProps {
  onRefetchReady?: (refreshFn: () => void) => void;
  onFolderSelect?: (folderId: string) => void;
}

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

export default function FoldersList({ onRefetchReady, onFolderSelect }: FoldersListProps) {
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
              <span
                className="cursor-pointer w-full"
                onClick={() => {
                  if (onFolderSelect) onFolderSelect(folder._id);
                }}
              >
                {folder.name} — {folder.leadCount} Lead{folder.leadCount !== 1 ? "s" : ""}
              </span>
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
