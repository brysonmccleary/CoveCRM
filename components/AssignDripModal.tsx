// /components/AssignDripModal.tsx
import { useEffect, useState } from "react";

export interface Folder {
  _id: string;
  name: string;
}

export interface AssignDripModalProps {
  dripId: string;
  onClose: () => void;
  /** Optional: pass folders in; if omitted, component will fetch them. */
  folders?: Folder[];
  /**
   * Called with the selected folderId. If not provided,
   * the component will POST to /api/assign-drip-to-folder itself.
   */
  onAssign?: (folderId: string) => Promise<void> | void;
}

export default function AssignDripModal({
  dripId,
  onClose,
  folders: foldersProp,
  onAssign,
}: AssignDripModalProps) {
  const [folders, setFolders] = useState<Folder[]>(foldersProp || []);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string>("");

  // If folders not provided, fetch them
  useEffect(() => {
    if (foldersProp?.length) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/get-folders");
        const j = await r.json();
        if (!cancelled) {
          setFolders(j?.folders || []);
        }
      } catch {
        // noop
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [foldersProp]);

  const handleAssign = async () => {
    if (!selected) return;
    try {
      if (onAssign) {
        await onAssign(selected);
      } else {
        // Default behavior: call the API directly
        const r = await fetch("/api/assign-drip-to-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dripId, folderId: selected }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.message || "Failed to assign drip");
        }
        alert("Drip assigned successfully!");
      }
      onClose();
    } catch (e: any) {
      alert(e?.message || "Error assigning drip");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg bg-[#0b1220] border border-white/10 p-4 text-white">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Assign Drip</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-gray-300">Folder</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full bg-[#0f172a] border border-white/10 rounded p-2"
            disabled={loading || !folders.length}
          >
            <option value="" disabled>
              {loading ? "Loading folders…" : "Select a folder"}
            </option>
            {folders.map((f) => (
              <option key={f._id} value={f._id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={!selected || loading}
            className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-60"
          >
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
