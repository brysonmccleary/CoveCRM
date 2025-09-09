import { useState } from "react";
import Papa from "papaparse";
import toast from "react-hot-toast";
import ColumnMappingForm, { MappingSubmitPayload } from "./ColumnMappingForm";

export default function UploadCsvForm({ ownerId }: { ownerId: string }) {
  const [csvData, setCsvData] = useState<Record<string, any>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const [fileName, setFileName] = useState<string>("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data as Record<string, any>[]).filter(Boolean);
        const cols = (results.meta.fields || []).filter((h) =>
          rows.some((r) => r[h] && String(r[h]).trim() !== "")
        );

        if (!cols.length || !rows.length) {
          toast.error("❌ Could not detect columns or rows in this CSV.");
          return;
        }

        setCsvData(rows);
        setHeaders(cols);
        setShowMapping(true);
      },
      error: () => {
        toast.error("❌ Failed to read CSV");
      },
    });
  };

  const handleMappingSubmit = async (payload: MappingSubmitPayload) => {
    try {
      const { mapping, targetFolderId, folderName, skipExisting } = payload;

      if (!mapping.phone && !mapping.email) {
        toast.error("❌ Map at least Phone or Email so we can de-dupe.");
        return;
      }

      const body: any = {
        mapping,               // { firstName, lastName, phone, email, state, notes, source } -> CSV header names
        rows: csvData,         // raw rows from CSV; server will map & normalize
        skipExisting,          // default true on the UI
      };

      // Make intent explicit so server ignores any stale ids
      if (folderName && folderName.trim()) {
        body.folderName = folderName.trim();
        body.createNewFolder = true;
      } else if (targetFolderId) {
        body.targetFolderId = targetFolderId;
      }

      // JSON mode for /api/import-leads
      const res = await fetch("/api/import-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "Import failed");
      }

      const inserted = data?.counts?.inserted ?? 0;
      const updated = data?.counts?.updated ?? 0;
      const skipped = data?.counts?.skipped ?? 0;

      if (data?.counts) {
        toast.success(`✅ Import complete — ${inserted} new • ${updated} updated • ${skipped} skipped`);
      } else {
        toast.success(`✅ Imported ${data?.count ?? "leads"}`);
      }

      // reset state
      setCsvData([]);
      setHeaders([]);
      setShowMapping(false);
      setFileName("");
    } catch (e: any) {
      console.error(e);
      toast.error(`❌ ${e?.message || "Import failed"}`);
    }
  };

  return (
    <div className="border border-black dark:border-white p-4 rounded space-y-4">
      {!showMapping && (
        <>
          <div className="flex items-center gap-3">
            <input type="file" accept=".csv" onChange={handleFileChange} />
            {fileName && <span className="text-sm text-gray-500">{fileName}</span>}
          </div>
          <p className="text-sm text-gray-500">
            Upload a CSV to begin mapping columns to fields.
          </p>
        </>
      )}

      {showMapping && headers.length > 0 && (
        <ColumnMappingForm
          headers={headers}
          sampleRow={csvData[0] || {}}
          onSubmit={handleMappingSubmit}
          onBack={() => setShowMapping(false)}
        />
      )}
    </div>
  );
}
