// components/FoldersList.tsx
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/router";

interface Folder {
  _id: string;
  name: string;
  leadCount: number;
}

interface FoldersListProps {
  onRefetchReady?: (refreshFn: () => void) => void;
  /** Optional callback; if omitted we will navigate to /leads/folder/[id] ourselves */
  onFolderSelect?: (folderId: string) => void;
}

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

export default function FoldersList({ onRefetchReady, onFolderSelect }: FoldersListProps) {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<any>(null);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/get-folders", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch folders");
      const data = await res.json();
      setFolders(Array.isArray(data?.folders) ? data.folders : []);
    } catch (error) {
      console.error("Error fetching folders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

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
    // ✅ Navigate to the actual folder-scoped page
    const path = `/leads/folder/${folderId}`;
    router.push(path).catch((e) => console.error("FoldersList: router.push failed", e));
  };

  // Expose the refresh function to parent
  useEffect(() => {
    if (onRefetchReady) onRefetchReady(fetchFolders);
  }, [onRefetchReady, fetchFolders]);

  // Initial fetch
  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  // Subscribe to disposition events to keep counts fresh
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import("socket.io-client").catch(() => null as any);
        if (!mounted || !mod) return;
        const { io } = mod as any;

        // We don't need the user email here; server emits to the email room,
        // but most servers also broadcast to the socket. If your server requires
        // explicit room join, you can join after fetching /api/auth/session.
        const socket = io(undefined, {
          path: "/api/socket",
          transports: ["websocket"],
          withCredentials: false,
        });
        socketRef.current = socket;

        // If your server gates by user room, join here:
        try {
          const r = await fetch("/api/auth/session");
          const j = await r.json();
          const email = (j?.user?.email || "").toLowerCase();
          if (email) {
            socket.emit("join", email);
            socket.emit("room:join", email);
            socket.emit("user:join", email);
          }
        } catch {}

        socket.on("lead:disposition", () => {
          // Simply refetch — counts may change for multiple folders
          fetchFolders();
        });
      } catch (e) {
        console.warn("FoldersList: socket init failed (non-fatal)", e);
      }
    })();

    return () => {
      mounted = false;
      try {
        socketRef.current?.off?.("lead:disposition");
        socketRef.current?.disconnect?.();
      } catch {}
    };
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
                  onClick={() => handleDeleteFolder(folder._id, setFolders)}
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

/** Helper kept here to keep the component small */
async function handleDeleteFolder(folderId: string, setFolders: React.Dispatch<React.SetStateAction<Folder[]>>) {
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
}
