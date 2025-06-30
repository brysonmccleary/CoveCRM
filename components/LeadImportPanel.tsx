import { useState } from "react";
import { matchColumnToField, STANDARD_FIELDS, saveMappingToLocal, getSavedMappings } from "../utils";

const LeadImportPanel = ({ csvData }) => {
  const [mapping, setMapping] = useState(() => getSavedMappings() || {});

  const handleMappingChange = (column: string, field: string) => {
    const updated = { ...mapping, [column]: field };
    setMapping(updated);
    saveMappingToLocal(updated);
  };

  return (
    <div>
      <h2>Lead Import Mapping</h2>
      {csvData && csvData.length > 0 ? (
        <table className="w-full border my-2">
          <thead>
            <tr>
              <th className="border p-2">CSV Column</th>
              <th className="border p-2">Map To Field</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(csvData[0]).map((column) => (
              <tr key={column}>
                <td className="border p-2">{column}</td>
                <td className="border p-2">
                  <select
                    value={mapping[column] || matchColumnToField(column)}
                    onChange={(e) => handleMappingChange(column, e.target.value)}
                    className="border p-1"
                  >
                    {STANDARD_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No CSV data loaded yet.</p>
      )}
    </div>
  );
};

export default LeadImportPanel;

