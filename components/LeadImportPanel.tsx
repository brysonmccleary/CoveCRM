import React, { useState, useRef, useEffect } from "react";
import Papa from "papaparse";

const systemFields = [
  "First Name",
  "Last Name",
  "Phone",
  "Email",
  "Address",
  "City",
  "State",
  "Zip",
  "DOB",
  "Age",
  "Coverage Amount",
  "Notes",
  "Add Custom Field",
];

export default function LeadImportPanel() {
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<{ [key: string]: string }>({});
  const [customFieldNames, setCustomFieldNames] = useState<{ [key: string]: string }>({});
  const [skipFields, setSkipFields] = useState<{ [key: string]: boolean }>({});
  const [csvData, setCsvData] = useState<any[]>([]);
  const [folderName, setFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const headers = results.meta.fields || [];
          const validHeaders = headers.filter((header) =>
            results.data.some((row: any) => row[header] && row[header].trim() !== "")
          );
          setCsvHeaders(validHeaders);
          setCsvData(results.data);
          setMapping({});
          setSkipFields({});
          setCustomFieldNames({});
        },
      });
    }
  };

  const handleMappingChange = (header: string, value: string) => {
    setMapping({ ...mapping, [header]: value });
    if (value !== "Add Custom Field") {
      setCustomFieldNames({ ...customFieldNames, [header]: "" });
    }
  };

  const handleCustomFieldNameChange = (header: string, value: string) => {
    setCustomFieldNames({ ...customFieldNames, [header]: value });
  };

  const handleSkipChange = (header: string, checked: boolean) => {
    setSkipFields({ ...skipFields, [header]: checked });
    if (checked) {
      setMapping({ ...mapping, [header]: "" });
      setCustomFieldNames({ ...customFieldNames, [header]: "" });
    }
  };

  const getAvailableFields = (currentHeader: string) => {
    const selectedFields = Object.values(mapping).filter(
      (field) => field !== "" && field !== mapping[currentHeader] && field !== "Add Custom Field"
    );
    return systemFields.filter(
      (field) => !selectedFields.includes(field) || field === mapping[currentHeader]
    );
  };

  const handleImport = async () => {
    if (!folderName.trim()) {
      alert("Please enter a folder name");
      return;
    }

    const leadsToImport = csvData.map((row) => {
      const mappedLead: { [key: string]: any } = {};
      Object.keys(mapping).forEach((header) => {
        if (!skipFields[header]) {
          let field = mapping[header];
          if (field === "Add Custom Field") {
            field = customFieldNames[header];
          }
          const value = row[header];
          if (field && value && value.trim() !== "") {
            mappedLead[field] = value;
          }
        }
      });
      return mappedLead;
    });

    const res = await fetch("/api/import-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderName, leads: leadsToImport }),
    });

    if (res.ok) {
      alert("Leads imported successfully!");
      setCsvHeaders([]);
      setCsvData([]);
      setMapping({});
      setSkipFields({});
      setCustomFieldNames({});
      setFolderName("");
    } else {
      alert("Failed to import leads");
    }
  };

  const handleTriggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="border border-black dark:border-white p-4 mt-4 rounded space-y-4">
      <h2 className="text-xl font-bold">Import Leads</h2>

      <button
        onClick={handleTriggerFilePicker}
        className="bg-[#6b5b95] text-white px-4 py-2 rounded hover:opacity-90"
      >
        Choose CSV File
      </button>
      <input
        type="file"
        accept=".csv"
        onChange={handleFileUpload}
        ref={fileInputRef}
        className="hidden"
      />

      {csvHeaders.length > 0 && (
        <>
          <div>
            <label className="block font-semibold mb-1">Folder Name</label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="e.g., Mortgage Leads 7/1"
              className="border p-1 rounded w-full"
            />
          </div>

          <div className="space-y-2 mt-4">
            {csvHeaders.map((header) => (
              <div
                key={header}
                className="flex flex-col md:flex-row md:items-center md:space-x-4 border border-black dark:border-white p-2 rounded"
              >
                <div className="font-semibold w-48">
                  {header}
                  <div className="text-gray-500 text-sm mt-1">
                    ({csvData[0]?.[header] || "No sample"})
                  </div>
                </div>
                <select
                  value={mapping[header] || ""}
                  onChange={(e) => handleMappingChange(header, e.target.value)}
                  className="border p-1 rounded flex-1"
                  disabled={skipFields[header]}
                >
                  <option value="">Select Field</option>
                  {getAvailableFields(header).map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>

                {mapping[header] === "Add Custom Field" && (
                  <input
                    type="text"
                    value={customFieldNames[header] || ""}
                    onChange={(e) => handleCustomFieldNameChange(header, e.target.value)}
                    placeholder="Custom field name"
                    className="border p-1 rounded flex-1 mt-2 md:mt-0"
                  />
                )}

                <div className="flex items-center space-x-1 mt-2 md:mt-0">
                  <input
                    type="checkbox"
                    checked={skipFields[header] || false}
                    onChange={(e) => handleSkipChange(header, e.target.checked)}
                  />
                  <label>Do Not Import</label>
                </div>
              </div>
            ))}

            <button
              onClick={handleImport}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded mt-2"
            >
              Save & Import
            </button>
          </div>
        </>
      )}
    </div>
  );
}

