// pages/leads/folder/[id].tsx
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

type Lead = {
  _id: string;
  name?: string;
  phone?: string;
  email?: string;
  status?: string;
};

type FolderPayload = {
  leadId: string;
  fromFolderId: string | null;
  toFolderId: string;
  status?: string;
  userEmail?: string;
  ts?: number;
};

export default function FolderPage() {
  const router = useRouter();
  const { id } = router.query;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [resolvedFolderId, setResolvedFolderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<any>(null);
  const userRoomRef = useRef<string>("");

  const fetchSessionEmail = useCallback(async (): Promise<string> => {
    try {
      const r = await fetch("/api/auth/session");
      const j = await r.json();
      const e = (j?.user?.email || "").toLowerCase();
      return typeof e === "string" ? e : "";
    } catch {
      return "";
    }
  }, []);

  const refetch = useCallback(async (folderQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/get-leads-by-folder?folderId=${encodeURIComponent(folderQuery)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to fetch leads for folder ${folderQuery}`);
      const data = await res.json();
      // Normalize
      setLeads(Array.isArray(data?.leads) ? data.leads : []);
      setFolderName(typeof data?.folderName === "string" ? data.folderName : null);
      setResolvedFolderId(typeof data?.resolvedFolderId === "string" ? data.resolvedFolderId : String(folderQuery));
    } catch (e: any) {
      console.error("FolderPage: fetch error", e);
      setError(e?.message || "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load & on id change
  useEffect(() => {
    if (!id || typeof id !== "string") return;
    refetch(id);
  }, [id, refetch]);

  // Socket setup for live updates
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Load user email for room join
        const email = await fetchSessionEmail();
        userRoomRef.current = email;

        const mod = await import("socket.io-client").catch(() => null as any);
        if (!mounted || !mod) return;
        const { io } = mod as any;

        const socket = io(undefined, {
          path: "/api/socket",
          transports: ["websocket"],
          withCredentials: false,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          if (email) {
            socket.emit("join", email);
            socket.emit("room:join", email);
            socket.emit("user:join", email);
          }
        });

        // When any disposition occurs for this user, update this view if relevant
        socket.on("lead:disposition", (payload: FolderPayload) => {
          const current = resolvedFolderId || (typeof id === "string" ? id : null);
          if (!current) return;

          const fromMatches = payload.fromFolderId && payload.fromFolderId === current;
          const toMatches = payload.toFolderId === current;

          // If this lead left the current folder, drop it from the list immediately for snappy UX
          if (fromMatches) {
            setLeads((prev) => prev.filter((l) => String(l._id) !== String(payload.leadId)));
          }

          // If a lead moved into this folder, or left (to keep counts/ordering true), refetch
          if (fromMatches || toMatches) {
            // Small debounce to let DB settle
            setTimeout(() => {
              if (typeof id === "string") refetch(id);
            }, 150);
          }
        });
      } catch (e) {
        console.warn("FolderPage: socket init failed (non-fatal)", e);
      }
    })();

    return () => {
      mounted = false;
      try {
        socketRef.current?.off?.("lead:disposition");
        socketRef.current?.disconnect?.();
      } catch {}
    };
  }, [id, resolvedFolderId, fetchSessionEmail, refetch]);

  if (!id || typeof id !== "string") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Folder</h1>
        <p className="text-red-400 mt-3">Invalid folder id.</p>
      </div>
    );
  }

  return (
    <div className="p-6 text-white">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          Folder: {folderName || id}
        </h1>
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
              onClick={() => router.push(`/lead/${lead._id}`)}
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
