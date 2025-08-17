import { useState } from "react";

export default function CreateFolderPanel() {
  const [folderName, setFolderName] = useState("");
  const [loading, setLoading] = useState(false);

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
      // Optionally refresh folder list here
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
        onChange={(e) => setFolderName(e.target.value)}
        placeholder="Folder name"
        className="border border-gray-600 p-2 rounded bg-[#0f172a] text-white w-full mb-2"
      />
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
