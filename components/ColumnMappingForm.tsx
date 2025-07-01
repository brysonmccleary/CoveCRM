import { useState } from "react";

interface Props {
  headers: string[];
  onSubmit: (mapping: Record<string, string>) => void;
}

export default function ColumnMappingForm({ headers, onSubmit }: Props) {
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const handleChange = (crmField: string, csvColumn: string) => {
    setMapping((prev) => ({ ...prev, [crmField]: csvColumn }));
  };

  const crmFields = ["name", "email", "phone", "dob", "age", "state"];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(mapping);
      }}
      className="space-y-4"
    >
      {crmFields.map((field) => (
        <div key={field}>
          <label className="block font-medium capitalize">{field}</label>
          <select
            value={mapping[field] || ""}
            onChange={(e) => handleChange(field, e.target.value)}
            className="border p-2 w-full"
          >
            <option value="">-- Select column --</option>
            {headers.map((header) => (
              <option key={header} value={header}>
                {header}
              </option>
            ))}
          </select>
        </div>
      ))}
      <button
        type="submit"
        className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
      >
        Save Mapping & Import
      </button>
    </form>
  );
}

