// components/FolderLeadsTable.tsx
import { useMemo, useState } from "react";
import {
  getLeadDisplayName,
  getLeadValue,
  isEffectivelyEmpty,
  matchesLeadSearch,
} from "@/lib/leads/displayHelpers";
import { getNumberState } from "@/lib/twilio/localPresence";

function formatPhoneNumber(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone || "";
}

interface NumberEntry {
  id: string;
  phoneNumber: string;
  sid: string;
}

type AgingFilter = "all" | "fresh" | "warm" | "stale" | "cold";
type SortDir = "asc" | "desc";

interface Props {
  folder: { _id: string; name: string; leadCount?: number; aiScriptKey?: string };
  isSystemFolder: boolean;
  leads: any[];
  selectedLeads: string[];
  toggleLeadSelection: (id: string) => void;
  selectAll: boolean;
  onSelectAll: () => void;
  agingFilter: AgingFilter;
  setAgingFilter: (v: AgingFilter) => void;
  numbers: NumberEntry[];
  selectedNumber: string;
  setSelectedNumber: (v: string) => void;
  folderScriptKey: string;
  onScriptKeyChange: (key: string) => void;
  savingScript: boolean;
  hasResume: boolean;
  canResume: boolean;
  onStartDialSession: () => void;
  onResume: () => void;
  onPreviewLead: (lead: any) => void;
}

type SortKey =
  | "name"
  | "lastName"
  | "phone"
  | "email"
  | "state"
  | "age"
  | "score"
  | "created";

function ageDays(lead: any): number {
  const ageMs = Date.now() - new Date(lead.createdAt ?? 0).getTime();
  return ageMs / (1000 * 60 * 60 * 24);
}

function formatCreated(lead: any): string {
  const days = ageDays(lead);
  if (days < 1) return `${Math.round(days * 24)}h ago`;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return lead.createdAt ? new Date(lead.createdAt).toLocaleDateString() : "—";
}

const COL_BORDER = "1px solid rgba(63,63,70,0.7)";

const selectStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #475569",
  borderRadius: 6,
  color: "#e2e8f0",
  padding: "8px 10px",
  fontSize: 14,
  height: 40,
  width: 200,
  minWidth: 140,
};

export default function FolderLeadsTable({
  folder,
  isSystemFolder,
  leads,
  selectedLeads,
  toggleLeadSelection,
  selectAll,
  onSelectAll,
  agingFilter,
  setAgingFilter,
  numbers,
  selectedNumber,
  setSelectedNumber,
  folderScriptKey,
  onScriptKeyChange,
  savingScript,
  hasResume,
  canResume,
  onStartDialSession,
  onResume,
  onPreviewLead,
}: Props) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const showColFirstName = useMemo(() => leads.some((l) => !isEffectivelyEmpty(getLeadDisplayName(l))), [leads]);
  const showColLastName = useMemo(() => leads.some((l) => !isEffectivelyEmpty(getLeadValue(l, "lastName"))), [leads]);
  const showColPhone = useMemo(() => leads.some((l) => !isEffectivelyEmpty(getLeadValue(l, "phone"))), [leads]);
  const showColEmail = useMemo(() => leads.some((l) => !isEffectivelyEmpty(getLeadValue(l, "email"))), [leads]);
  const showColState = useMemo(() => leads.some((l) => !isEffectivelyEmpty(getLeadValue(l, "state"))), [leads]);
  const showColAge = useMemo(() => leads.some((l) => !isEffectivelyEmpty(getLeadValue(l, "age"))), [leads]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return <span style={{ marginLeft: 5, fontSize: 11 }}>{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  const displayedLeads = useMemo(() => {
    let result = leads.filter((lead) => {
      if (agingFilter === "all") return true;
      const days = ageDays(lead);
      if (agingFilter === "fresh") return days < 1;
      if (agingFilter === "warm") return days >= 1 && days < 3;
      if (agingFilter === "stale") return days >= 3 && days < 7;
      if (agingFilter === "cold") return days >= 7;
      return true;
    });

    result = result.filter((lead) => matchesLeadSearch(lead, search));

    if (sortKey) {
      result = [...result].sort((a, b) => {
        let va: any;
        let vb: any;
        switch (sortKey) {
          case "name":
            va = getLeadDisplayName(a);
            vb = getLeadDisplayName(b);
            return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          case "lastName":
            va = String(getLeadValue(a, "lastName") || "");
            vb = String(getLeadValue(b, "lastName") || "");
            return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          case "phone":
            va = String(getLeadValue(a, "phone") || "");
            vb = String(getLeadValue(b, "phone") || "");
            return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          case "email":
            va = String(getLeadValue(a, "email") || "");
            vb = String(getLeadValue(b, "email") || "");
            return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          case "state":
            va = String(getLeadValue(a, "state") || "");
            vb = String(getLeadValue(b, "state") || "");
            return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
          case "age":
            va = Number(getLeadValue(a, "age") ?? -1);
            vb = Number(getLeadValue(b, "age") ?? -1);
            return sortDir === "asc" ? va - vb : vb - va;
          case "score":
            va = typeof (a as any).score === "number" ? (a as any).score : -1;
            vb = typeof (b as any).score === "number" ? (b as any).score : -1;
            return sortDir === "asc" ? va - vb : vb - va;
          case "created":
            va = new Date(a.createdAt ?? 0).getTime();
            vb = new Date(b.createdAt ?? 0).getTime();
            return sortDir === "asc" ? va - vb : vb - va;
          default:
            return 0;
        }
      });
    }

    return result;
  }, [leads, agingFilter, search, sortKey, sortDir]);

  const thStyle: React.CSSProperties = {
    padding: "12px 16px",
    textAlign: "left",
    fontSize: 14,
    fontWeight: 600,
    color: "#94a3b8",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    borderRight: COL_BORDER,
    borderBottom: COL_BORDER,
  };

  const tdStyle: React.CSSProperties = {
    padding: "12px 16px",
    fontSize: 14,
    borderRight: COL_BORDER,
  };

  return (
    <div className="rounded-lg border border-zinc-700/60 mt-2 overflow-hidden bg-gray-900">
      {/* Row 1: Lead count badge · search · aging filter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: COL_BORDER,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 10,
            border: "1px solid currentColor",
            color: "#a78bfa",
            whiteSpace: "nowrap",
            lineHeight: "22px",
          }}
        >
          {leads.length} Leads
        </span>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email…"
          style={{
            flex: 1,
            minWidth: 180,
            maxWidth: 320,
            height: 40,
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#e2e8f0",
            padding: "0 12px",
            fontSize: 14,
          }}
        />

        <select
          value={agingFilter}
          onChange={(e) => setAgingFilter(e.target.value as AgingFilter)}
          style={{
            height: 40,
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#e2e8f0",
            padding: "0 10px",
            fontSize: 14,
          }}
        >
          <option value="all">All ages</option>
          <option value="fresh">Fresh (&lt; 1 day)</option>
          <option value="warm">Warm (1–3 days)</option>
          <option value="stale">Stale (3–7 days)</option>
          <option value="cold">Cold (&gt; 7 days)</option>
        </select>
      </div>

      {/* Row 2: Selected count · number selector · script selector · Start · Resume — always visible */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: COL_BORDER,
          flexWrap: "wrap",
          background: "rgba(107,91,149,0.08)",
        }}
      >
        <span style={{ fontSize: 14, color: "#c4b5fd", whiteSpace: "nowrap", minWidth: 88 }}>
          {selectedLeads.length} selected
        </span>

        <select
          value={selectedNumber}
          onChange={(e) => setSelectedNumber(e.target.value)}
          style={selectStyle}
          title="Select number to call from"
        >
          <option value="">-- Choose a number --</option>
          <option value="LOCAL_PRESENCE">🎯 Local Presence (Auto-Match)</option>
          {numbers.map((num) => (
            <option key={num.id} value={num.phoneNumber}>
              {formatPhoneNumber(num.phoneNumber)}
              {getNumberState(num.phoneNumber) ? ` · ${getNumberState(num.phoneNumber)}` : ""}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            value={folderScriptKey}
            onChange={(e) => onScriptKeyChange(e.target.value)}
            style={selectStyle}
            title="AI Script / Lead Type"
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
            <option value="default">Default (Generic)</option>
          </select>
          {savingScript && <span style={{ fontSize: 12, color: "#64748b" }}>Saving...</span>}
        </div>

        <button
          onClick={onStartDialSession}
          disabled={selectedLeads.length === 0}
          className={`${
            selectedLeads.length > 0 ? "bg-green-600 hover:bg-green-700" : "bg-gray-600 cursor-not-allowed"
          } text-white rounded transition-colors`}
          style={{ fontSize: 14, whiteSpace: "nowrap", padding: "0 18px", height: 40 }}
        >
          Start Dial Session
        </button>

        <button
          onClick={onResume}
          disabled={!canResume}
          className={`${
            canResume ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-600 cursor-not-allowed"
          } text-white rounded transition-colors`}
          style={{ fontSize: 14, padding: "0 18px", height: 40 }}
          title={hasResume ? "Resume where you left off" : "No server resume available yet"}
        >
          Resume
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ minWidth: "100%", fontSize: 14, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.3)" }}>
              <th style={{ ...thStyle, cursor: "default", whiteSpace: "nowrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 600, color: "#94a3b8", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={onSelectAll}
                    style={{ cursor: "pointer", width: 15, height: 15 }}
                  />
                  Select all
                </label>
              </th>
              <th style={thStyle}>#</th>
              {showColFirstName && (
                <th style={thStyle} onClick={() => handleSort("name")}>
                  First Name {sortIndicator("name")}
                </th>
              )}
              {showColLastName && (
                <th style={thStyle} onClick={() => handleSort("lastName")}>
                  Last Name {sortIndicator("lastName")}
                </th>
              )}
              {showColPhone && (
                <th style={thStyle} onClick={() => handleSort("phone")}>
                  Phone {sortIndicator("phone")}
                </th>
              )}
              {showColEmail && (
                <th style={thStyle} onClick={() => handleSort("email")}>
                  Email {sortIndicator("email")}
                </th>
              )}
              {showColState && (
                <th style={thStyle} onClick={() => handleSort("state")}>
                  State {sortIndicator("state")}
                </th>
              )}
              {showColAge && (
                <th style={thStyle} onClick={() => handleSort("age")}>
                  Age {sortIndicator("age")}
                </th>
              )}
              <th style={thStyle} onClick={() => handleSort("score")} title="Lead score">
                Score {sortIndicator("score")}
              </th>
              <th style={{ ...thStyle, borderRight: "none" }} onClick={() => handleSort("created")}>
                Created {sortIndicator("created")}
              </th>
            </tr>
          </thead>
          <tbody>
            {displayedLeads.map((lead, index) => {
              const days = ageDays(lead);
              const borderColor =
                days >= 7 ? "#ef4444" :
                days >= 3 ? "#f97316" :
                days >= 1 ? "#eab308" :
                undefined;

              return (
                <tr
                  key={lead._id}
                  className="hover:bg-zinc-800/40 transition-colors"
                  style={{
                    borderTop: COL_BORDER,
                    borderLeft: borderColor ? `3px solid ${borderColor}` : "3px solid transparent",
                  }}
                >
                  <td style={{ ...tdStyle, padding: "12px 16px" }}>
                    <input
                      type="checkbox"
                      checked={selectedLeads.includes(lead._id)}
                      onChange={() => toggleLeadSelection(lead._id)}
                      style={{ cursor: "pointer", width: 15, height: 15 }}
                    />
                  </td>
                  <td style={{ ...tdStyle, color: "#64748b" }}>{index + 1}</td>

                  {showColFirstName && (
                    <td style={tdStyle}>
                      <button
                        onClick={() => onPreviewLead({ ...lead, folderId: folder._id })}
                        className="text-blue-400 hover:text-blue-300 underline cursor-pointer transition-colors"
                        style={{ fontSize: 14 }}
                      >
                        {getLeadDisplayName(lead)}
                      </button>
                    </td>
                  )}

                  {showColLastName && (
                    <td style={{ ...tdStyle, color: "#cbd5e1" }}>
                      {getLeadValue(lead, "lastName") || "-"}
                    </td>
                  )}
                  {showColPhone && (
                    <td style={{ ...tdStyle, color: "#cbd5e1" }}>
                      {getLeadValue(lead, "phone") || "-"}
                    </td>
                  )}
                  {showColEmail && (
                    <td style={{ ...tdStyle, color: "#cbd5e1" }}>
                      {getLeadValue(lead, "email") || "-"}
                    </td>
                  )}
                  {showColState && (
                    <td style={{ ...tdStyle, color: "#cbd5e1" }}>
                      {getLeadValue(lead, "state") || "-"}
                    </td>
                  )}
                  {showColAge && (
                    <td style={{ ...tdStyle, color: "#cbd5e1" }}>
                      {getLeadValue(lead, "age") ?? "-"}
                    </td>
                  )}

                  <td style={tdStyle}>
                    {typeof (lead as any).score === "number" ? (
                      <span
                        className={`text-sm font-bold px-2 py-1 rounded ${
                          (lead as any).score >= 70
                            ? "bg-green-900 text-green-300"
                            : (lead as any).score >= 40
                            ? "bg-yellow-900 text-yellow-300"
                            : "bg-red-900 text-red-300"
                        }`}
                      >
                        {(lead as any).score}
                      </span>
                    ) : (
                      <span className="text-gray-500 text-sm">—</span>
                    )}
                  </td>

                  <td style={{ ...tdStyle, color: "#64748b", whiteSpace: "nowrap", borderRight: "none" }}>
                    {formatCreated(lead)}
                  </td>
                </tr>
              );
            })}
            {displayedLeads.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  style={{ padding: "24px 16px", textAlign: "center", color: "#64748b", fontSize: 14 }}
                >
                  {search || agingFilter !== "all" ? "No leads match the current filters." : "No leads."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
