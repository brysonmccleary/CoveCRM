// components/FoldersList.tsx
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/router";

interface Folder {
  _id: string;
  name: string;
  leadCount: number;
  aiFirstCallEnabled?: boolean;
}

interface FoldersListProps {
  onRefetchReady?: (refreshFn: () => void) => void;
  /** Optional callback; if omitted we will navigate to /leads/folder/[id] ourselves */
  onFolderSelect?: (folderId: string) => void;
}

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold", "Bad Number"];

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

  const toggleAIFirstCall = async (folderId: string, currentValue: boolean) => {
    const res = await fetch("/api/folders/ai-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folderId,
        aiFirstCallEnabled: !currentValue,
        aiEnabledAt: !currentValue ? new Date().toISOString() : null,
      }),
    });
    if (res.ok) fetchFolders();
  };

  // Expose the refresh function to parent
  useEffect(() => {
    if (onRefetchReady) onRefetchReady(fetchFolders);
  }, [onRefetchReady, fetchFolders]);

  // Initial fetch
  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  // Subscribe to disposition updates to keep counts fresh (now listening to lead:updated)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import("socket.io-client").catch(() => null as any);
        if (!mounted || !mod) return;
        const { io } = mod as any;

        const socket = io(undefined, {
          path: "/api/socket/",
          transports: ["websocket"],
          withCredentials: false,
        });
        socketRef.current = socket;

        // Join the user's room so we receive lead:updated
        try {
          const r = await fetch("/api/auth/session");
          const j = await r.json();
          const email = (j?.user?.email || "").toLowerCase();
          if (email) {
            socket.emit("join", email);
            socket.emit("room:join", email);
            socket.emit("user:join", email);
          }
        } catch {
          // non-fatal
        }

        const onUpdated = () => fetchFolders();

        // Primary event your server emits on disposition/move:
        socket.on("lead:updated", onUpdated);

        // If you still emit this legacy event anywhere, keep it harmlessly:
        socket.on("lead:disposition", onUpdated);
      } catch (e) {
        console.warn("FoldersList: socket init failed (non-fatal)", e);
      }
    })();

    return () => {
      mounted = false;
      try {
        socketRef.current?.off?.("lead:updated");
        socketRef.current?.off?.("lead:disposition");
        socketRef.current?.disconnect?.();
      } catch {}
    };
  }, [fetchFolders]);

  if (loading) return <p className="text-slate-400">Loading folders...</p>;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4 text-slate-100">Your Folders</h2>
      {folders.length === 0 ? (
        <p className="text-slate-500">No folders yet.</p>
      ) : (
        <ul>
          {folders.map((folder) => {
            const isSystem = SYSTEM_FOLDERS.includes(folder.name);
            return (
              <li
                key={folder._id}
                className={`mb-2 border border-white/10 p-2 rounded flex flex-wrap justify-between items-center gap-2 hover:bg-[#0f172a] transition-colors${isSystem ? " border-l-2 border-l-blue-500/40" : ""}`}
              >
                <button
                  type="button"
                  className="cursor-pointer text-left text-slate-100 flex-1 min-w-0"
                  onClick={() => goToFolder(folder._id)}
                  title={`Open ${folder.name}`}
                >
                  {folder.name}{" "}
                  <span className="text-slate-400">
                    — {folder.leadCount} Lead{folder.leadCount !== 1 ? "s" : ""}
                  </span>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  {!isSystem && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAIFirstCall(folder._id, !!folder.aiFirstCallEnabled);
                      }}
                      title={folder.aiFirstCallEnabled ? "Disable AI First-Call" : "Enable AI First-Call"}
                      style={
                        folder.aiFirstCallEnabled
                          ? {
                              backgroundColor: "rgba(59,130,246,0.15)",
                              border: "1px solid rgba(59,130,246,0.4)",
                              color: "#60a5fa",
                              borderRadius: "999px",
                              fontSize: "11px",
                              padding: "2px 10px",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                            }
                          : {
                              backgroundColor: "rgba(255,255,255,0.05)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              color: "#94a3b8",
                              borderRadius: "999px",
                              fontSize: "11px",
                              padding: "2px 10px",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                            }
                      }
                    >
                      {folder.aiFirstCallEnabled ? "🤖 AI: ON" : "🤖 AI: OFF"}
                    </button>
                  )}

                  {!isSystem && (
                    <button
                      onClick={() => handleDeleteFolder(folder._id, setFolders)}
                      title="Delete Folder"
                      className="text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Helper kept here to keep the component small */
async function handleDeleteFolder(
  folderId: string,
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>
) {
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
