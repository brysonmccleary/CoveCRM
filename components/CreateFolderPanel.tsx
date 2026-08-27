// components/CreateFolderPanel.tsx
import { useEffect, useState } from "react";
import { LEAD_TYPES } from "@/lib/leads/leadTypes";

interface DripSuggestion {
  suggestion: string;
  reason: string;
}

export default function CreateFolderPanel() {
  const [folderName, setFolderName] = useState("");
  const [loading, setLoading] = useState(false);
  const [dripSuggestion, setDripSuggestion] = useState<DripSuggestion | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  const [aiFirstCallEnabled, setAiFirstCallEnabled] = useState(false);
  const [aiFirstCallDelayMinutes, setAiFirstCallDelayMinutes] = useState(1);
  const [aiRealTimeOnly, setAiRealTimeOnly] = useState(true);
  const [aiScriptKey, setAiScriptKey] = useState("final_expense");
  const [leadType, setLeadType] = useState("");

  // Fetch AI drip suggestion whenever folder name changes (debounced)
  useEffect(() => {
    if (!folderName.trim() || folderName.trim().length < 4) {
      setDripSuggestion(null);
      return;
    }

    const timer = setTimeout(async () => {
      setLoadingSuggestion(true);
      setDripSuggestion(null);
      try {
        const res = await fetch("/api/ai/suggest-drip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderName: folderName.trim(), existingCampaigns: [] }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.suggestion) setDripSuggestion(data);
        }
      } catch {
        // silently ignore
      } finally {
        setLoadingSuggestion(false);
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [folderName]);

  const createFolder = async () => {
    if (!folderName.trim()) {
      alert("Please enter a folder name.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/create-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: folderName,
        aiFirstCallEnabled,
        aiFirstCallDelayMinutes,
        aiRealTimeOnly,
        aiScriptKey,
        aiEnabledAt: aiFirstCallEnabled ? new Date().toISOString() : null,
        leadType: leadType || undefined,
      }),
    });

    if (res.ok) {
      alert("Folder created successfully!");
      setFolderName("");
      setDripSuggestion(null);
      setAppliedSuggestion(null);
    } else {
      const data = await res.json();
      alert(`Failed to create folder: ${data.message}`);
    }

    setLoading(false);
  };

  return (
    <div className="border border-gray-600 p-4 rounded bg-[#1e293b] text-white mb-6">
      <h2 className="text-lg font-bold mb-2">Create New Folder</h2>
      <input
        value={folderName}
        onChange={(e) => {
          setFolderName(e.target.value);
          setAppliedSuggestion(null);
        }}
        placeholder="Folder name"
        className="border border-gray-600 p-2 rounded bg-[#0f172a] text-white w-full mb-2"
      />

      {/* AI drip suggestion */}
      {loadingSuggestion && (
        <p className="text-xs text-gray-500 mb-2">Suggesting a campaign…</p>
      )}
      {dripSuggestion && !loadingSuggestion && (
        <div className="border border-gray-700 rounded-lg p-3 bg-[#0f172a] mb-2 space-y-1">
          <p className="text-xs text-gray-400">
            <span className="text-blue-400 font-medium">Based on this folder name, we suggest: </span>
            <span className="text-white font-medium">{dripSuggestion.suggestion}</span>
            {" "}— {dripSuggestion.reason}
          </p>
          {appliedSuggestion === dripSuggestion.suggestion ? (
            <p className="text-xs text-green-400">Applied</p>
          ) : (
            <button
              onClick={() => setAppliedSuggestion(dripSuggestion.suggestion)}
              className="text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Apply
            </button>
          )}
        </div>
      )}

      {/* AI First-Call Settings */}
      <div style={{ borderTop: "1px solid #334155", marginTop: "12px", paddingTop: "12px" }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--cove-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          AI First-Call
        </p>

        <label style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={aiFirstCallEnabled}
            onChange={(e) => setAiFirstCallEnabled(e.target.checked)}
            style={{ width: "16px", height: "16px", accentColor: "var(--cove-info)" }}
          />
          <span style={{ fontSize: "14px", color: "var(--cove-text)" }}>Auto-call new leads in this folder</span>
        </label>

        {aiFirstCallEnabled && (
          <div style={{ marginLeft: "26px" }}>
            <div style={{ backgroundColor: "var(--cove-card)", border: "1px solid #f59e0b", borderRadius: "6px", padding: "10px 12px", marginBottom: "10px" }}>
              <p style={{ fontSize: "12px", color: "var(--cove-warning)", margin: 0, lineHeight: "1.5" }}>
                ⚠️ This will only call <strong>new leads added after you enable this</strong>. To call existing leads already in this folder, use the AI Dial Session.
              </p>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "13px", color: "var(--cove-text)" }}>
              <span>Call delay:</span>
              <select
                value={aiFirstCallDelayMinutes}
                onChange={(e) => setAiFirstCallDelayMinutes(Number(e.target.value))}
                style={{ backgroundColor: "var(--cove-surface-hover)", border: "1px solid #475569", borderRadius: "4px", color: "var(--cove-text)", padding: "4px 8px", fontSize: "13px" }}
              >
                <option value={0}>Immediately</option>
                <option value={1}>1 minute</option>
                <option value={2}>2 minutes</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
              </select>
            </label>

            <div style={{ marginBottom: "8px" }}>
              <label style={{ display: "block", fontSize: "13px", color: "var(--cove-text)", marginBottom: "4px", fontWeight: 500 }}>
                AI Script / Lead Type
              </label>
              <p style={{ fontSize: "11px", color: "var(--cove-muted)", marginBottom: "6px", marginTop: 0 }}>
                The AI will use this script for every lead in this folder.
              </p>
              <select
                value={aiScriptKey}
                onChange={(e) => setAiScriptKey(e.target.value)}
                style={{ backgroundColor: "var(--cove-card)", border: "1px solid #475569", borderRadius: "4px", color: "var(--cove-text)", padding: "6px 8px", fontSize: "13px", width: "100%" }}
              >
                <option value="mortgage_protection">Mortgage Protection</option>
                <option value="final_expense">Final Expense</option>
                <option value="iul_cash_value">IUL / Cash Value Life</option>
                <option value="veteran_leads">Veterans (Life Insurance)</option>
                <option value="veteran_iul">Veterans IUL</option>
                <option value="veteran_mortgage">Veterans Mortgage Protection</option>
                <option value="trucker_leads">Truckers (Life Insurance)</option>
                <option value="trucker_iul">Truckers IUL</option>
                <option value="trucker_mortgage">Truckers Mortgage Protection</option>
                <option value="spanish_final_expense">Español — Gastos Finales</option>
                <option value="spanish_mortgage">Español — Protección Hipotecaria</option>
                <option value="spanish_iul">Español — IUL / Valor en Efectivo</option>
                <option value="default">Default (Generic)</option>
              </select>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "var(--cove-text)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={aiRealTimeOnly}
                onChange={(e) => setAiRealTimeOnly(e.target.checked)}
                style={{ width: "14px", height: "14px", accentColor: "var(--cove-info)" }}
              />
              <span>Real-time leads only (skip CSV imports)</span>
            </label>
          </div>
        )}
      </div>

      {/* Tucked in below AI First-Call, styled to match — not a primary control */}
      <div style={{ borderTop: "1px solid #334155", marginTop: "12px", paddingTop: "12px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--cove-muted)" }}>
          <span>Default lead type for this folder</span>
          <select
            value={leadType}
            onChange={(e) => setLeadType(e.target.value)}
            style={{ backgroundColor: "var(--cove-card)", border: "1px solid #334155", borderRadius: "4px", color: "var(--cove-text)", fontSize: "12px", padding: "3px 6px" }}
          >
            <option value="">None (default: Final Expense)</option>
            {LEAD_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <p style={{ fontSize: "11px", color: "var(--cove-muted)", margin: "4px 0 0" }}>
          Applied to new leads imported into this folder that don't already have their own lead type.
        </p>
      </div>

      <button
        onClick={createFolder}
        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded w-full"
        disabled={loading}
        style={{ marginTop: "12px" }}
      >
        {loading ? "Creating..." : "Create Folder"}
      </button>
    </div>
  );
}
