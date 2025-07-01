import { useState } from "react";

interface Props {
  columns: string[];
  onSave: (mapping: { [key: string]: string }) => void;
}

const standardFields = ["name", "email", "phone", "dob", "age", "address", "notes"];

export default function ColumnMapper({ columns, onSave }: Props) {
  const [mapping, setMapping] = useState<{ [key: string]: string }>({});

  const handleChange = (column: string, value: string) => {
    setMapping((prev) => ({ ...prev, [column]: value }));
  };

  const handleSave = () => {
    localStorage.setItem("columnMapping", JSON.stringify(mapping));
    onSave(mapping);
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded shadow mt-4">
      <h3 className="text-lg font-bold mb-2">Map Your Columns</h3>
      {columns.map((col) => (
        <div key={col} className="flex items-center mb-2">
          <span className="w-1/3">{col}</span>
          <select
            value={mapping[col] || ""}
            onChange={(e) => handleChange(col, e.target.value)}
            className="border p-2 flex-1"
          >
            <option value="">-- Select field --</option>
            {standardFields.map((field) => (
              <option key={field} value={field}>{field}</option>
            ))}
          </select>
        </div>
      ))}

      <button
        onClick={handleSave}
        className="bg-blue-600 text-white px-4 py-2 mt-4 rounded hover:bg-blue-700"
      >
        Save Mapping
      </button>
    </div>
  );
}

