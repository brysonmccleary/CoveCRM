import dynamic from "next/dynamic";
import { useState } from "react";
import Papa from "papaparse";

const LeadImportPanel = dynamic(() => import("../components/LeadImportPanel"), { ssr: false });

export default function Dashboard() {
  const [csvData, setCsvData] = useState<any>({ headers: [], rows: [] });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields || [];
        setCsvData({ headers, rows: result.data });
      },
    });
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">CoveCRM Dashboard</h1>
      <input type="file" accept=".csv" onChange={handleFileUpload} className="mb-4" />
      {csvData.headers.length > 0 && <LeadImportPanel csvData={csvData} />}
    </div>
  );
}

