// pages/leads/folder/[id].tsx
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type Lead = {
  _id: string;
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
};

export default function FolderPage() {
  const router = useRouter();
  const { id } = router.query;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || typeof id !== "string") return;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`Failed to fetch leads for folder ${id}`);
        const data = await res.json();
        setLeads(data?.leads ?? []);
      } catch (e: any) {
        console.error("FolderPage: fetch error", e);
        setError(e?.message || "Failed to load leads");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [id]);

  if (!id || typeof id !== "string") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Folder</h1>
        <p className="text-red-400 mt-3">Invalid folder id.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Folder: {id}</h1>
        <button
          onClick={() => router.push("/dashboard")}
          className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
          title="Back to dashboard"
        >
          ← Back
        </button>
      </div>

      {loading ? (
        <p>Loading leads…</p>
      ) : error ? (
        <p className="text-red-400">{error}</p>
      ) : leads.length === 0 ? (
        <p className="text-gray-400">No leads in this folder.</p>
      ) : (
        <ul className="space-y-2">
          {leads.map((lead) => (
            <li
              key={lead._id}
              className="p-3 border border-gray-600 rounded hover:bg-gray-700"
            >
              <div className="font-medium">{lead.name || "(no name)"}</div>
              <div className="text-sm text-gray-300">
                {lead.phone || ""} {lead.email ? `• ${lead.email}` : ""}
              </div>
              {lead.status && <div className="text-xs opacity-70">Status: {lead.status}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
