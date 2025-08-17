import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import { ObjectId } from "mongodb";

interface Folder {
  _id: string;
  name: string;
}

export default function LeadsPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const router = useRouter();

  useEffect(() => {
    const fetchFoldersAndCounts = async () => {
      try {
        // Get folders
        const res = await fetch("/api/get-folders");
        const data = await res.json();
        setFolders(data.folders);

        // Get counts
        const countRes = await fetch("/api/get-folder-counts");
        const countData = await countRes.json();
        setFolderCounts(countData.counts);
      } catch (err) {
        console.error("Error fetching folders or counts:", err);
      }
    };

    fetchFoldersAndCounts();
  }, []);

  const handleFolderClick = (folderId: string) => {
    router.push(`/leads/folder/${folderId}`);
  };

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />
      <div className="flex-1 p-6">
        <h2 className="text-2xl font-bold mb-4">Lead Folders</h2>
        {folders.map((folder) => (
          <div
            key={folder._id}
            onClick={() => handleFolderClick(folder._id)}
            className="border p-3 rounded cursor-pointer mb-2 hover:bg-gray-700"
          >
            {folder.name} — {folderCounts[folder._id] || 0} Leads
          </div>
        ))}
      </div>
    </div>
  );
}
