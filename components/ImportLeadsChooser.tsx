import { useEffect, useState } from "react";
import toast from "react-hot-toast";

type KeyRecord = {
  _id: string;
  name: string;
  folderName?: string;
  keyPrefix: string;
  lastUsedAt?: string | null;
  createdAt: string;
  revokedAt?: string | null;
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  background: "rgba(0,0,0,0.65)",
};
const panel: React.CSSProperties = {
  width: "min(900px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "#0f172a",
  color: "white",
  padding: 24,
  boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
};
const card: React.CSSProperties = {
  flex: "1 1 220px",
  minHeight: 155,
  textAlign: "left",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "#1e293b",
  color: "white",
  padding: 20,
  cursor: "pointer",
};
const primary: React.CSSProperties = {
  border: 0,
  borderRadius: 7,
  background: "#6b5b95",
  color: "white",
  padding: "10px 16px",
  cursor: "pointer",
};
const secondary: React.CSSProperties = {
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "transparent",
  color: "white",
  padding: "9px 14px",
  cursor: "pointer",
};

function displayDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function ApiKeysPanel({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/developer/api-keys");
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to load API keys");
      setKeys(Array.isArray(data.keys) ? data.keys : []);
    } catch (error: any) {
      toast.error(error.message || "Failed to load API keys");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const createKey = async () => {
    if (!name.trim()) return toast.error("Enter the vendor name");
    if (!folderName.trim()) return toast.error("Enter the folder name");
    setCreating(true);
    try {
      const response = await fetch("/api/developer/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), folderName: folderName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed to create API key");
      setNewKey(data.key);
      setName("");
      setFolderName("");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (key: KeyRecord) => {
    if (!window.confirm(`Revoke “${key.name}”? Requests using it will immediately stop working.`)) return;
    const response = await fetch(`/api/developer/api-keys/${key._id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast.error(data.message || "Failed to revoke API key");
    await load();
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <button style={{ ...secondary, marginBottom: 12 }} onClick={onBack}>← Back</button>
          <h2 style={{ margin: 0, fontSize: 24 }}>API for Vendors</h2>
          <p style={{ margin: "7px 0 0", color: "#94a3b8" }}>Choose the vendor and the folder where their leads should go.</p>
        </div>
        <button style={secondary} onClick={onClose}>Close</button>
      </div>

      {newKey && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 8, border: "1px solid #6b5b95", background: "#1e293b" }}>
          <strong>Your key is ready. Copy it now—you won’t see it again.</strong>
          <p style={{ color: "#94a3b8", margin: "8px 0 0" }}>Send this key to your lead vendor. Their new leads will automatically appear in the folder you chose.</p>
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <code style={{ flex: 1, minWidth: 260, padding: 10, borderRadius: 6, background: "#020617", overflowWrap: "anywhere" }}>{newKey}</code>
            <button style={primary} onClick={async () => { await navigator.clipboard.writeText(newKey); toast.success("API key copied"); }}>Copy</button>
          </div>
          <button style={{ ...secondary, marginTop: 10 }} onClick={() => setNewKey("")}>I saved it</button>
        </div>
      )}

      <div style={{ marginTop: 22, padding: 18, borderRadius: 9, background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ fontWeight: 700, marginBottom: 14 }}>Create a vendor key</div>
        <label style={{ display: "block", marginBottom: 6 }}>1. Who is sending you leads?</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Example: ABC Lead Company"
          maxLength={80}
          style={{ width: "100%", boxSizing: "border-box", borderRadius: 7, border: "1px solid rgba(255,255,255,0.2)", background: "#0f172a", color: "white", padding: "10px 12px", marginBottom: 14 }}
        />
        <label style={{ display: "block", marginBottom: 6 }}>2. What should their CoveCRM folder be called?</label>
        <input
          value={folderName}
          onChange={(event) => setFolderName(event.target.value)}
          placeholder="Example: ABC Vendor Leads"
          maxLength={120}
          style={{ width: "100%", boxSizing: "border-box", borderRadius: 7, border: "1px solid rgba(255,255,255,0.2)", background: "#0f172a", color: "white", padding: "10px 12px", marginBottom: 14 }}
        />
        <button style={primary} onClick={createKey} disabled={creating}>{creating ? "Creating…" : "Create API Key"}</button>
      </div>

      <div style={{ marginTop: 20 }}>
        {loading ? <p style={{ color: "#94a3b8" }}>Loading keys…</p> : keys.length === 0 ? <p style={{ color: "#94a3b8" }}>No API keys yet.</p> : keys.map((key) => (
          <div key={key._id} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.1)", flexWrap: "wrap" }}>
            <div>
              <strong>{key.name}</strong>
              <div style={{ color: "#94a3b8", marginTop: 4 }}><code>{key.keyPrefix}…</code>{key.revokedAt ? " · Revoked" : ""}</div>
              <div style={{ color: "#94a3b8", marginTop: 4 }}>Leads go to: <strong>{key.folderName || "Chosen by vendor"}</strong></div>
              <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>Created {displayDate(key.createdAt)} · Last used {displayDate(key.lastUsedAt)}</div>
            </div>
            {!key.revokedAt && <button style={secondary} onClick={() => void revoke(key)}>Revoke</button>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 26, padding: 18, borderRadius: 9, background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)" }}>
        <h3 style={{ marginTop: 0 }}>What happens next?</h3>
        <ol style={{ margin: 0, paddingLeft: 22, color: "#cbd5e1", lineHeight: 1.8 }}>
          <li>Create the key above.</li>
          <li>Copy the key and send it to your lead vendor.</li>
          <li>Your folder is created automatically when the first lead arrives.</li>
          <li>New leads appear in that folder in CoveCRM.</li>
        </ol>
      </div>
    </>
  );
}

export default function ImportLeadsChooser({ onClose, onCsv, onGoogleSheets }: { onClose: () => void; onCsv: () => void; onGoogleSheets: () => void }) {
  const [showApiKeys, setShowApiKeys] = useState(false);
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Import leads">
      <div style={panel}>
        {showApiKeys ? <ApiKeysPanel onBack={() => setShowApiKeys(false)} onClose={onClose} /> : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div><h2 style={{ margin: 0, fontSize: 24 }}>Import Leads</h2><p style={{ color: "#94a3b8", marginBottom: 0 }}>Choose how leads should enter CoveCRM.</p></div>
              <button style={secondary} onClick={onClose}>Close</button>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 24 }}>
              <button style={card} onClick={onCsv}><span style={{ display: "block", fontSize: 20, fontWeight: 700 }}>Import CSV</span><span style={{ display: "block", marginTop: 10, color: "#94a3b8", lineHeight: 1.5 }}>Upload a file, map its columns, and choose a destination folder.</span></button>
              <button style={card} onClick={onGoogleSheets}><span style={{ display: "block", fontSize: 20, fontWeight: 700 }}>Connect Google Sheet</span><span style={{ display: "block", marginTop: 10, color: "#94a3b8", lineHeight: 1.5 }}>Send new spreadsheet rows to CoveCRM automatically.</span></button>
              <button style={card} onClick={() => setShowApiKeys(true)}><span style={{ display: "block", fontSize: 20, fontWeight: 700 }}>API for Vendors</span><span style={{ display: "block", marginTop: 10, color: "#94a3b8", lineHeight: 1.5 }}>Create an API key for a lead vendor or custom integration.</span></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
