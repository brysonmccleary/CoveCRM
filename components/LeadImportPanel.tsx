import { matchColumnToField, STANDARD_FIELDS, saveMappingToLocal, getSavedMappings } from "../utils";

const LeadImportPanel = ({ csvData }) => {
  const [columnMappings, setColumnMappings] = useState(() =>
    csvData.headers.map((header) => {
      const matched = matchColumnToField(header);
      return {
        original: header,
        mappedTo: matched || "",
        doNotImport: false,
        isCustom: !matched,
      };
    })
  );

  const [savedMappings, setSavedMappings] = useState(getSavedMappings());
  const [selectedMapping, setSelectedMapping] = useState("");

  const handleMappingChange = (index, value) => {
    setColumnMappings((prev) =>
      prev.map((col, i) =>
        i === index ? { ...col, mappedTo: value, isCustom: !STANDARD_FIELDS.includes(value) } : col
      )
    );
  };

  const toggleDoNotImport = (index) => {
    setColumnMappings((prev) =>
      prev.map((col, i) =>
        i === index ? { ...col, doNotImport: !col.doNotImport } : col
      )
    );
  };

  const handleImport = () => {
    const importableColumns = columnMappings.filter((col) => !col.doNotImport && col.mappedTo !== "");
    console.log("Importing columns:", importableColumns);
    // Add actual import logic here
  };

  const handleSaveMapping = () => {
    const mappingName = prompt("Enter a name for this mapping:");
    if (!mappingName) return;
    saveMappingToLocal(mappingName, columnMappings);
    setSavedMappings(getSavedMappings());
    alert("Mapping saved!");
  };

  const handleLoadMapping = (e) => {
    const name = e.target.value;
    setSelectedMapping(name);
    const mapping = savedMappings.find((m) => m.name === name);
    if (!mapping) return;

    const newMappings = csvData.headers.map((header) => {
      const savedField = mapping.fields.find((f) => f.original.toLowerCase() === header.toLowerCase());
      if (savedField) {
        return {
          original: header,
          mappedTo: savedField.mappedTo,
          doNotImport: savedField.doNotImport,
          isCustom: !STANDARD_FIELDS.includes(savedField.mappedTo),
        };
      } else {
        const matched = matchColumnToField(header);
        return {
          original: header,
          mappedTo: matched || "",
          doNotImport: false,
          isCustom: !matched,
        };
      }
    });
    setColumnMappings(newMappings);
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Map Your CSV Columns</h2>

      {savedMappings.length > 0 && (
        <div className="mb-4">
          <label className="mr-2">Load Saved Mapping:</label>
          <select value={selectedMapping} onChange={handleLoadMapping} className="border p-1">
            <option value="">-- Select --</option>
            {savedMappings.map((m, idx) => (
              <option key={idx} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
      )}

      <table className="w-full text-sm border">
        <thead>
          <tr>
            <th className="border p-2">Original Header</th>
            <th className="border p-2">Map To Field</th>
            <th className="border p-2">Do Not Import</th>
          </tr>
        </thead>
        <tbody>
          {columnMappings
            .filter((col, idx) => csvData.rows.every((row) => row[idx]?.trim() === "") === false)
            .map((col, index) => (
              <tr key={index} className={col.doNotImport ? "bg-red-100" : "bg-green-100"}>
                <td className="border p-2">{col.original}</td>
                <td className="border p-2">
                  <input
                    className="border p-1 w-full"
                    type="text"
                    value={col.mappedTo}
                    onChange={(e) => handleMappingChange(index, e.target.value)}
                    placeholder="Enter custom field or choose"
                    list={`field-options-${index}`}
                  />
                  <datalist id={`field-options-${index}`}>
                    {STANDARD_FIELDS.map((field, i) => (
                      <option key={i} value={field} />
                    ))}
                  </datalist>
                </td>
                <td className="border p-2 text-center">
                  <input
                    type="checkbox"
                    checked={col.doNotImport}
                    onChange={() => toggleDoNotImport(index)}
                  />
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <div className="mt-4 flex gap-4">
        <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={handleImport}>Import Leads</button>
        <button className="bg-green-600 text-white px-4 py-2 rounded" onClick={handleSaveMapping}>Save Mapping</button>
      </div>
    </div>
  );
};

export default LeadImportPanel;

