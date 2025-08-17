import React, { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

interface Folder {
  _id: string;
  name: string;
  leadCount?: number;
}

interface AssignDripModalProps {
  dripId: string;
  onClose: () => void;
  isOpen: boolean;
}

export default function AssignDripModal({
  dripId,
  onClose,
  isOpen,
}: AssignDripModalProps) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const fetchFolders = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/get-folders");
        if (!res.ok) throw new Error("Failed to fetch folders");
        const data = await res.json();
        // ✅ API returns { folders: [...] }
        setFolders(Array.isArray(data?.folders) ? data.folders : []);
      } catch (err: any) {
        setError(err.message || "Error fetching folders");
      } finally {
        setLoading(false);
      }
    };

    fetchFolders();
  }, [isOpen]);

  const handleAssign = async (folderId: string) => {
    setAssigning(true);
    try {
      // ✅ Use the correct API route name
      const res = await fetch("/api/assign-drip-to-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dripId, folderId }),
      });

      if (res.ok) {
        toast.success("✅ Drip assigned to folder. New leads will auto-enroll.");
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(`❌ ${data.message || "Failed to assign drip."}`);
      }
    } catch (error) {
      console.error("Assign error:", error);
      toast.error("❌ Error assigning the drip.");
    } finally {
      setAssigning(false);
    }
  };

  const dripName =
    prebuiltDrips.find((d) => d.id === dripId)?.name || dripId || "Unknown";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
      <div className="bg-[#1e293b] text-white p-6 rounded-lg shadow-lg w-full max-w-md space-y-4">
        <h2 className="text-xl font-bold">Assign Drip to Folder</h2>
        <p className="text-sm text-gray-300">
          Drip: <strong>{dripName}</strong>
        </p>

        {loading && <p className="text-sm">Loading folders...</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && folders.length === 0 && (
          <p className="text-sm text-gray-400">
            No folders found. Please create one first.
          </p>
        )}

        {!loading && folders.length > 0 && (
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {folders.map((folder) => (
              <li key={folder._id}>
                <button
                  disabled={assigning}
                  onClick={() => handleAssign(folder._id)}
                  className="w-full text-left px-4 py-2 border border-gray-600 rounded hover:bg-gray-700"
                >
                  <div className="flex items-center justify-between">
                    <span>{folder.name}</span>
                    {typeof folder.leadCount === "number" && (
                      <span className="text-xs text-gray-400">
                        {folder.leadCount} lead{folder.leadCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded"
        >
          Close
        </button>
      </div>
    </div>
  );
}
