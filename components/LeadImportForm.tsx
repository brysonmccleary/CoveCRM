import { useState, useRef } from "react";
import Papa from "papaparse";

interface FieldOption {
  label: string;
  value: string;
}

const defaultFields: FieldOption[] = [
  { label: "First Name", value: "firstName" },
  { label: "Last Name", value: "lastName" },
  { label: "Phone", value: "phone" },
  { label: "Email", value: "email" },
  { label: "Address", value: "address" },
  { label: "City", value: "city" },
  { label: "State", value: "state" },
  { label: "Zip", value: "zip" },
  { label: "Date of Birth", value: "dob" },
  { label: "Age", value: "age" },
  { label: "Notes", value: "notes" },
  { label: "Create Custom Field", value: "custom" },
];

export default function LeadImportForm() {
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [sampleRow, setSampleRow] = useState<Record<string, any>>({});
  const [fieldMapping, setFieldMapping] = useState<{ [key: string]: string }>({});
  const [skipFields, setSkipFields] = useState<{ [key: string]: boolean }>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileUpload = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (!result.meta.fields) return;

        const data = result.data as Record<string, any>[];

        const headers = result.meta.fields.filter((header) =>
          data.some((row) => row[header]?.trim() !== "")
        );

        setCsvHeaders(headers);
        if (data && data.length > 0) {
          setSampleRow(data[0]);
        }
      },
    });
  };

  const handleFieldChange = (header: string, value: string) => {
    if (value === "custom") {
      const customValue = prompt(`Enter custom field name for "${header}"`);
      if (customValue && customValue.trim() !== "") {
        setFieldMapping((prev) => ({ ...prev, [header]: customValue.trim() }));
      }
    } else {
      setFieldMapping((prev) => ({ ...prev, [header]: value }));
    }
    setSkipFields((prev) => ({ ...prev, [header]: false }));
  };

  const handleCheckboxChange = (header: string) => {
    setSkipFields((prev) => {
      const newVal = !prev[header];
      if (newVal) {
        setFieldMapping((map) => ({ ...map, [header]: "" }));
      }
      return { ...prev, [header]: newVal };
    });
  };

  const handleClickUpload = () => {
    fileInputRef.current?.click();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
      e.dataTransfer.clearData();
    }
  };

  const handleSubmit = () => {
    console.log("Final mapping:", fieldMapping);
    console.log("Skip fields:", skipFields);
    alert("Leads imported! (Simulation)");
  };

  const handleGoogleAuth = async () => {
    try {
      const response = await fetch("/api/google/auth");
      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      } else {
        alert("Google auth URL not returned.");
      }
    } catch (error) {
      console.error("Google Auth error:", error);
      alert("Failed to connect Google Sheets.");
    }
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 p-6 rounded shadow"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <h2 className="text-xl font-bold mb-4">Import Leads</h2>

      <div className="flex space-x-4 mb-4">
        <button
          onClick={handleClickUpload}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Upload CSV
        </button>
        <button
          onClick={handleGoogleAuth}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
        >
          Connect Google Sheet
        </button>
      </div>

      <div className="border-2 border-dashed border-gray-400 rounded p-6 text-center mb-4">
        Drag and drop CSV file here
      </div>

      <input
        type="file"
        accept=".csv"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
          }
        }}
      />

      {csvHeaders.length > 0 && (
        <div className="mt-6 border-t pt-4">
          <h3 className="text-lg font-semibold mb-2">Map your fields</h3>
          <div className="grid grid-cols-3 gap-4 font-medium text-gray-700 dark:text-gray-300">
            <div>CSV Column</div>
            <div>Mapped To</div>
            <div>Do Not Import</div>
          </div>
          {csvHeaders.map((header) => {
            const isSkipped = skipFields[header];
            const isMapped = fieldMapping[header] && !isSkipped;
            return (
              <div
                key={header}
                className={`grid grid-cols-3 gap-4 items-center mb-2 border-b pb-2 ${
                  isMapped ? "bg-green-100" : isSkipped ? "bg-red-100" : ""
                }`}
              >
                <div>
                  <div className="font-medium">{header}</div>
                  {sampleRow[header] && (
                    <div className="text-sm text-gray-500">Preview: {sampleRow[header]}</div>
                  )}
                </div>
                <select
                  value={fieldMapping[header] || ""}
                  onChange={(e) => handleFieldChange(header, e.target.value)}
                  disabled={isSkipped}
                  className="border p-2"
                >
                  <option value="">-- Select field --</option>
                  {defaultFields.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  type="checkbox"
                  checked={skipFields[header] || false}
                  onChange={() => handleCheckboxChange(header)}
                  className="h-5 w-5"
                />
              </div>
            );
          })}
          <button
            onClick={handleSubmit}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Import Leads
          </button>
        </div>
      )}
    </div>
  );
}
