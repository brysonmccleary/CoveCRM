// pages/leads/folder/[id].tsx
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";

type Lead = {
  _id: string;
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
  folderId?: string | null;
};

export default function FolderPage() {
  const router = useRouter();
  const { id } = router.query;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<any>(null);
  const currentFolderIdRef = useRef<string | null>(null);

  async function fetchFolder(folderId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(folderId)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to fetch leads for folder ${folderId}`);
      const data = await res.json();

      // Canonical redirect
      if (data?.resolvedFolderId && data.resolvedFolderId !== folderId) {
        currentFolderIdRef.current = data.resolvedFolderId;
        router.replace(`/leads/folder/${data.resolvedFolderId}`);
        return;
      }

      currentFolderIdRef.current = folderId;
      setLeads(Array.isArray(data?.leads) ? data.leads : []);
    } catch (e: any) {
      console.error("FolderPage: fetch error", e);
      setError(e?.message || "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }

  // Initial fetch + when id changes
  useEffect(() => {
    if (!id || typeof id !== "string") return;
    fetchFolder(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Subscribe to lead updates and refetch this folder when anything changes
  useEffect(() => {
    let unmounted = false;
    (async () => {
      try {
        const mod = await import("socket.io-client").catch(() => null as any);
        if (!mod) return;
        const { io } = mod as any;

        const s = io(undefined, {
          path: "/api/socket",
          transports: ["websocket"],
          withCredentials: false,
        });
        socketRef.current = s;

        // join the user's room so we get events
        try {
          const r = await fetch("/api/auth/session");
          const j = await r.json();
          const email = (j?.user?.email || "").toLowerCase();
          if (email) s.emit("join", email);
        } catch {}

        const refetch = () => {
          const fid = currentFolderIdRef.current;
          if (fid) fetchFolder(fid);
        };

        s.on("lead:updated", refetch);
      } catch (e) {
        console.warn("FolderPage: socket init failed (non-fatal)", e);
      }
    })();

    return () => {
      unmounted = true;
      try {
        socketRef.current?.off?.("lead:updated");
        socketRef.current?.disconnect?.();
      } catch {}
    };
  }, []);

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
            <li key={lead._id} className="p-3 border border-gray-600 rounded hover:bg-gray-700">
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
