import { useState } from "react";

interface Props {
  folders: string[];
  assignedFolders: string[];
  onSave: (folders: string[]) => void;
  onClose: () => void;
}

export default function AssignFoldersModal({ folders, assignedFolders, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>(assignedFolders || []);

  const toggleFolder = (folder: string) => {
    if (selected.includes(folder)) {
      setSelected(selected.filter((f) => f !== folder));
    } else {
      setSelected([...selected, folder]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">Assign Folders</h2>
        <div className="space-y-2">
          {folders.map((folder) => (
            <div key={folder} className="flex items-center">
              <input
                type="checkbox"
                checked={selected.includes(folder)}
                onChange={() => toggleFolder(folder)}
                className="mr-2"
              />
              <span>{folder}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end space-x-2">
          <button onClick={() => onSave(selected)} className="bg-blue-600 text-white px-4 py-2 rounded">
            Save
          </button>
          <button onClick={onClose} className="bg-gray-300 px-4 py-2 rounded">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
