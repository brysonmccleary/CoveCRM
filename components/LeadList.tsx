import { useState, useEffect } from "react";

interface Lead {
  _id: string;
  name: string;
  email: string;
  phone: string;
  dob?: string;
  age?: number;
  folderName: string;
}

interface Props {
  ownerId: string;
  setSelectedFolder: (folder: string) => void;
}

export default function LeadList({ ownerId, setSelectedFolder }: Props) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, internalSetSelectedFolder] = useState("");

  useEffect(() => {
    const savedFolders = JSON.parse(localStorage.getItem("folders") || "[]");
    setFolders(savedFolders.map((f: any) => f.value));
  }, []);

  useEffect(() => {
    if (ownerId && selectedFolder) {
      fetch(`/api/leads?ownerId=${ownerId}&folderName=${selectedFolder}`)
        .then((res) => res.json())
        .then((data) => setLeads(data));
      setSelectedFolder(selectedFolder);
    }
  }, [ownerId, selectedFolder]);

  return (
    <div className="mt-6">
      <h3 className="font-bold mb-2">View leads by folder</h3>
      <select
        value={selectedFolder}
        onChange={(e) => internalSetSelectedFolder(e.target.value)}
        className="border p-2 w-full mb-4"
      >
        <option value="">-- Select a folder --</option>
        {folders.map((folder) => (
          <option key={folder} value={folder}>
            {folder}
          </option>
        ))}
      </select>

      {selectedFolder && (
        <div>
          {leads.length > 0 ? (
            <ul>
              {leads.map((lead) => (
                <li key={lead._id} className="border p-2 mb-2">
                  <strong>{lead.name}</strong> - {lead.email} - {lead.phone} -{" "}
                  {lead.dob ? `DOB: ${lead.dob}` : ""} {lead.age ? `Age: ${lead.age}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No leads found for this folder.</p>
          )}
        </div>
      )}
    </div>
  );
}

