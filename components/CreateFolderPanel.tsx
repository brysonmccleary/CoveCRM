import { useEffect, useState } from "react";

interface DripSuggestion {
  suggestion: string;
  reason: string;
}

export default function CreateFolderPanel() {
  const [folderName, setFolderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [dripSuggestion, setDripSuggestion] = useState<DripSuggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);

  // Fetch AI drip suggestion whenever folder name changes (debounced)
  useEffect(() => {
    if (!folderName.trim() || folderName.trim().length < 4) {
      setDripSuggestion(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestion(true);
      setDripSuggestion(null);
      try {
        const res = await fetch("/api/ai/suggest-drip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderName: folderName.trim(), existingCampaigns: [] }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.suggestion) setDripSuggestion(data);
        }
      } catch {
        // silently ignore
      } finally {
        setLoadingSuggestion(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [folderName]);

  const createFolder = async () => {
    if (!folderName.trim()) {
      alert("Please enter a folder name.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/create-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: folderName }),
    });

    if (res.ok) {
      alert("Folder created successfully!");
      setFolderName("");
      setDripSuggestion(null);
      setAppliedSuggestion(null);
    } else {
      const data = await res.json();
      alert(`Failed to create folder: ${data.message}`);
    }

    setLoading(false);
  };

  return (
    <div className="border border-gray-600 p-4 rounded bg-[#1e293b] text-white mb-6">
      <h2 className="text-lg font-bold mb-2">Create New Folder</h2>
      <input
        value={folderName}
        onChange={(e) => {
          setFolderName(e.target.value);
          setAppliedSuggestion(null);
        }}
        placeholder="Folder name"
        className="border border-gray-600 p-2 rounded bg-[#0f172a] text-white w-full mb-2"
      />

      {/* AI drip suggestion */}
      {loadingSuggestion && (
        <p className="text-xs text-gray-500 mb-2">Suggesting a campaign…</p>
      )}
      {dripSuggestion && !loadingSuggestion && (
        <div className="border border-gray-700 rounded-lg p-3 bg-[#0f172a] mb-2 space-y-1">
          <p className="text-xs text-gray-400">
            <span className="text-blue-400 font-medium">Based on this folder name, we suggest: </span>
            <span className="text-white font-medium">{dripSuggestion.suggestion}</span>
            {" "}— {dripSuggestion.reason}
          </p>
          {appliedSuggestion === dripSuggestion.suggestion ? (
            <p className="text-xs text-green-400">Applied</p>
          ) : (
            <button
              onClick={() => setAppliedSuggestion(dripSuggestion.suggestion)}
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Apply
            </button>
          )}
        </div>
      )}

      <button
        onClick={createFolder}
        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded w-full"
        disabled={loading}
      >
        {loading ? "Creating..." : "Create Folder"}
      </button>
    </div>
  );
}
