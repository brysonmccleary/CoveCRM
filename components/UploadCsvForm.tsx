import { useState } from "react";
import Papa from "papaparse";
import ColumnMappingForm from "./ColumnMappingForm";

export default function UploadCsvForm({ ownerId }: { ownerId: string }) {
  const [csvData, setCsvData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [showMapping, setShowMapping] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setCsvData(results.data);
        setHeaders(results.meta.fields || []);
        setShowMapping(true);
      },
    });
  };

  const handleMappingSubmit = async (mapping: Record<string, string>) => {
    const mappedLeads = csvData.map((row) => {
      const newLead: any = { ownerId };
      for (const [crmField, csvColumn] of Object.entries(mapping)) {
        newLead[crmField] = row[csvColumn] || "";
      }
      return newLead;
    });

    const res = await fetch("/api/import-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mappedLeads),
    });

    if (res.ok) {
      setMessage("✅ Leads imported successfully!");
      setShowMapping(false);
    } else {
      setMessage("❌ Error importing leads.");
    }
  };

  return (
    <div className="mb-6">
      {!showMapping && (
        <>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="mb-4"
          />
          {message && <p>{message}</p>}
        </>
      )}

      {showMapping && headers.length > 0 && (
        <ColumnMappingForm headers={headers} onSubmit={handleMappingSubmit} />
      )}
    </div>
  );
}

