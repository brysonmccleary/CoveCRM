// pages/facebook-ads/index.tsx
// Facebook Ads Manager — Full AI-powered ads management dashboard
import { useEffect, useState, useCallback, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import DashboardLayout from "@/components/DashboardLayout";
import AdWizard from "@/components/FacebookAds/AdWizard";
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
  _id: string;
  campaignName: string;
  leadType: string;
  status: string;
  dailyBudget: number;
  accountBudgetCap?: number;
  totalSpend: number;
  totalLeads: number;
  cpl: number;
  appointments?: number;
  sales?: number;
  costPerAppointment?: number;
  costPerSale?: number;
  appointmentRate?: number;
  closeRate?: number;
  contactRate?: number;
  performanceScore: number | null;
  leadQualityScore?: number | null;
  creativeFatigue?: boolean;
  lastDuplicatedAt?: string | null;
  duplicatedFromCampaignId?: string | null;
  autoPaused?: boolean;
  creativeRefreshNeeded?: boolean;
  recommendNewAd?: boolean;
  recommendReplaceAd?: boolean;
  lastRecommendationEmailAt?: string | null;
  performanceClass: string | null;
  lastScoredAt: string | null;
  lastActionReport: string | null;
  autoModeOn: boolean;
  automationEnabled?: boolean;
  frequency: number;
  optOutRate: number;
  badNumberRate: number;
  metaObjectHealth?: string | null;
  metaSyncStatus?: string | null;
  metaPublishStatus?: string | null;
  metaLastSyncedAt?: string | null;
}

interface MetricsEntry {
  date: string;
  spend: number;
  leads: number;
  clicks: number;
  appointmentsBooked: number;
  sales: number;
  revenue: number;
}



interface RecommendationRow {
  campaignName?: string;
  recommendations?: string[];
}

interface DashboardStatRow {
  spend?: number;
  leads?: number;
  appointments?: number;
  appointmentsBooked?: number;
  revenue?: number;
  campaignName?: string;
  cpl?: number;
  clicks?: number;
  impressions?: number;
  roi?: number;
}

interface GlobalPatternSummary {
  leadType: string;
  patternLabel: string;
  status: string;
  performanceScore: number;
  confidenceScore: number;
  bestHookSummary: string;
  bestCtaSummary: string;
  bestImageStyleSummary: string;
  antiPatternSummaries?: string[];
  sampleSizeBucket: string;
}

interface CampaignActionRow {
  campaignId: string;
  actionType: "PAUSE" | "RESUME" | "SCALE" | "DECREASE" | "FIX" | "DUPLICATE_TEST" | "SET_BUDGET" | string;
  createdAt: string;
}

interface BudgetReallocationMove {
  fromCampaignId: string;
  toCampaignId: string;
  amount: number;
}

interface ActionHistoryEntry {
  action: string;
  reasoning?: string;
  dryRun?: boolean;
  oldBudget?: number;
  newBudget?: number;
  createdAt: string;
  metaResponseSummary?: string;
}

interface AutoPreviewSummary {
  processed: number;
  scaled: number;
  paused: number;
  fixed: number;
  duplicated: number;
  decreased?: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  totalDailyBudget?: number;
  accountBudgetCap?: number;
  capReached?: boolean;
  reallocationMovesProposed?: number;
  reallocationMovesApplied?: number;
  fatiguedCampaigns?: number;
}

type ActionHistoryState = Record<
  string,
  {
    open: boolean;
    loading: boolean;
    rows: ActionHistoryEntry[];
  }
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAD_TYPE_LABELS: Record<string, string> = {
  final_expense: "Final Expense",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
};

const CLASS_COLORS: Record<string, string> = {
  SCALE: "bg-emerald-900/40 text-emerald-300 border-emerald-700/40",
  DUPLICATE_TEST: "bg-sky-900/40 text-sky-300 border-sky-700/40",
  MONITOR: "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
  FIX: "bg-orange-900/40 text-orange-300 border-orange-700/40",
  PAUSE: "bg-rose-900/40 text-rose-300 border-rose-700/40",
};

const PERFORMANCE_REASONING: Record<string, string> = {
  SCALE: "Reason: CPL is below target and campaign is performing well.",
  FIX: "Reason: CPL is above target or lead quality needs improvement.",
  PAUSE: "Reason: Campaign is underperforming and should stop spending.",
  DUPLICATE_TEST: "Reason: Campaign is strong enough to test a new variation.",
};

function ClassBadge({ cls }: { cls: string | null }) {
  if (!cls) return <span className="text-gray-500 text-xs">—</span>;
  const color = CLASS_COLORS[cls] || "bg-white/10 text-gray-300 border-white/10";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${color}`}>
      {cls.replace("_", " ")}
    </span>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-500 text-xs">—</span>;
  const pct = Math.max(0, Math.min(100, score));
  const color =
    pct >= 90
      ? "bg-emerald-500"
      : pct >= 70
      ? "bg-sky-500"
      : pct >= 50
      ? "bg-yellow-500"
      : pct >= 30
      ? "bg-orange-500"
      : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-300">{score}</span>
    </div>
  );
}

// ── Metrics Input Modal ───────────────────────────────────────────────────────

function MetricsModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: Campaign;
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);

  const [stats, setStats] = useState<DashboardStatRow[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [dailyActions, setDailyActions] = useState<any[]>([]);
  const [marketIntel, setMarketIntel] = useState<any>(null);
  const [generatedAd, setGeneratedAd] = useState<any>(null);

  useEffect(() => {
    fetch("/api/facebook/stats").then(res => res.json()).then(setStats);
    fetch("/api/facebook/recommendations").then(res => res.json()).then(setRecommendations);
    fetch("/api/facebook/daily-actions").then(res => res.json()).then(setDailyActions);
    fetch("/api/facebook/market-intel").then(res => res.json()).then(setMarketIntel);
  }, []);

  const generateAd = async () => {
    const res = await fetch("/api/facebook/generate-ad");
    const data = await res.json();
    setGeneratedAd(data?.draft || data);
  };

  const runAutoOptimize = async () => {
    await fetch("/api/facebook/auto-optimize");
    alert("Auto optimizer ran");
  };

  const [spend, setSpend] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [leads, setLeads] = useState("");
  const [frequency, setFrequency] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const r = await fetch("/api/facebook/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign._id,
          date,
          spend: parseFloat(spend) || 0,
          impressions: parseInt(impressions) || 0,
          clicks: parseInt(clicks) || 0,
          leads: parseInt(leads) || 0,
          frequency: parseFloat(frequency) || 0,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || "Failed to save");
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Enter Daily Metrics</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg">×</button>
        </div>
        <p className="text-xs text-gray-400 mb-4">{campaign.campaignName}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          {[
            { label: "Spend ($)", val: spend, set: setSpend, type: "number", placeholder: "0.00" },
            { label: "Impressions", val: impressions, set: setImpressions, type: "number", placeholder: "0" },
            { label: "Clicks", val: clicks, set: setClicks, type: "number", placeholder: "0" },
            { label: "Leads", val: leads, set: setLeads, type: "number", placeholder: "0" },
            { label: "Frequency", val: frequency, set: setFrequency, type: "number", placeholder: "1.0" },
          ].map(({ label, val, set, type, placeholder }) => (
            <div key={label}>
              <label className="text-xs text-gray-400 block mb-1">{label}</label>
              <input
                type={type}
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
              />
            </div>
          ))}
        </div>

        {err && <p className="text-rose-400 text-xs mt-3">{err}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Metrics"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Auto Mode Settings Panel ──────────────────────────────────────────────────

function AutoModePanel({ campaigns, onUpdate }: { campaigns: Campaign[]; onUpdate: () => void }) {
  const [saving, setSaving] = useState<string | null>(null);

  const toggleAutoMode = async (campaign: Campaign) => {
    setSaving(campaign._id);
    try {
      await fetch(`/api/facebook/campaigns/${campaign._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoModeOn: !campaign.autoModeOn }),
      });
      onUpdate();
    } catch {}
    setSaving(null);
  };

  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">⚡</span>
        <h2 className="text-lg font-semibold text-white">Auto Mode</h2>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        When enabled, Auto Mode monitors your campaign scores and sends you action nudges when
        campaigns need to be paused, scaled, or tested. No Meta API required.
      </p>

      {campaigns.length === 0 ? (
        <p className="text-gray-500 text-sm">No campaigns found.</p>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div
              key={c._id}
              className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5"
            >
              <div>
                <p className="text-sm text-white font-medium">{c.campaignName}</p>
                <p className="text-xs text-gray-500">{LEAD_TYPE_LABELS[c.leadType] || c.leadType}</p>
              </div>
              <button
                onClick={() => toggleAutoMode(c)}
                disabled={saving === c._id}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  c.autoModeOn ? "bg-indigo-600" : "bg-white/10"
                } ${saving === c._id ? "opacity-50" : ""}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    c.autoModeOn ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Attribution Report ─────────────────────────────────────────────────────────

interface AttributionRow {
  campaignId: string;
  campaignName: string;
  leadType: string;
  spend: number;
  leads: number;
  contacted: number;
  booked: number;
  sales: number;
  cpl: number;
  costPerBooked: number;
  costPerSale: number;
  contactRate: number;
  bookingRate: number;
}

function AttributionSection() {
  const [rows, setRows] = useState<AttributionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");

  const load = async (d = days) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/facebook/attribution?days=${d}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
      } else {
        setError(data.error || "Failed to load attribution data.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const fmt$ = (n: number) => n > 0 ? `$${n.toFixed(2)}` : "—";
  const fmtPct = (n: number) => n > 0 ? `${(n * 100).toFixed(1)}%` : "—";

  const contactRateColor = (r: number) =>
    r >= 0.5 ? "text-emerald-400" : r >= 0.3 ? "text-yellow-400" : r > 0 ? "text-rose-400" : "text-gray-500";
  const bookingRateColor = (r: number) =>
    r >= 0.2 ? "text-emerald-400" : r >= 0.1 ? "text-yellow-400" : r > 0 ? "text-rose-400" : "text-gray-500";
  const cplColor = (cpl: number) =>
    cpl > 0 && cpl <= 12 ? "text-emerald-400" : cpl <= 25 ? "text-yellow-400" : cpl > 25 ? "text-rose-400" : "text-gray-500";

  return (
    <div className="space-y-4">
      <div className="bg-[#0f172a] border border-white/10 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/5 flex-wrap gap-3">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span>📊</span> Attribution Report
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Spend → leads → contacts → bookings → sales by campaign</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => { const d = Number(e.target.value); setDays(d); load(d); }}
              className="bg-[#1e293b] border border-white/10 text-white text-xs rounded px-3 py-1.5"
            >
              {[7, 14, 30, 90].map((d) => (
                <option key={d} value={d}>Last {d} days</option>
              ))}
            </select>
            <button
              onClick={() => load()}
              className="text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8 text-gray-400 text-sm">Loading attribution data…</div>
        ) : error ? (
          <div className="p-6 text-rose-400 text-sm">{error}</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-gray-500 text-sm">
            No attribution data yet. Connect Meta to start receiving lead data, or manually enter metrics on campaigns.
          </div>
        ) : (
          <>
            {/* Summary totals */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 border-b border-white/5">
              {[
                { label: "Total Spend", value: `$${rows.reduce((s, r) => s + r.spend, 0).toFixed(2)}` },
                { label: "Total Leads", value: rows.reduce((s, r) => s + r.leads, 0).toLocaleString() },
                { label: "Total Booked", value: rows.reduce((s, r) => s + r.booked, 0).toLocaleString() },
                { label: "Total Sales", value: rows.reduce((s, r) => s + r.sales, 0).toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="p-4 border-r border-white/5 last:border-r-0">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="text-lg font-bold text-white">{value}</p>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-gray-500 uppercase">
                    <th className="text-left p-3 pl-4">Campaign</th>
                    <th className="text-right p-3">Spend</th>
                    <th className="text-right p-3">Leads</th>
                    <th className="text-right p-3">Contacted</th>
                    <th className="text-right p-3">Booked</th>
                    <th className="text-right p-3">Sales</th>
                    <th className="text-right p-3">CPL</th>
                    <th className="text-right p-3">$/Booked</th>
                    <th className="text-right p-3">$/Sale</th>
                    <th className="text-right p-3">Contact%</th>
                    <th className="text-right p-3 pr-4">Book%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map((r) => (
                    <tr key={r.campaignId} className="hover:bg-white/3">
                      <td className="p-3 pl-4">
                        <p className="text-white font-medium truncate max-w-[160px]">{r.campaignName}</p>
                        <p className="text-gray-600 text-[10px]">{LEAD_TYPE_LABELS[r.leadType] || r.leadType}</p>
                      </td>
                      <td className="p-3 text-right text-gray-300">{fmt$(r.spend)}</td>
                      <td className="p-3 text-right text-gray-300">{r.leads || "—"}</td>
                      <td className="p-3 text-right text-gray-300">{r.contacted || "—"}</td>
                      <td className="p-3 text-right text-gray-300">{r.booked || "—"}</td>
                      <td className="p-3 text-right text-gray-300">{r.sales || "—"}</td>
                      <td className={`p-3 text-right font-medium ${cplColor(r.cpl)}`}>{fmt$(r.cpl)}</td>
                      <td className="p-3 text-right text-gray-300">{fmt$(r.costPerBooked)}</td>
                      <td className="p-3 text-right text-gray-300">{fmt$(r.costPerSale)}</td>
                      <td className={`p-3 text-right font-medium ${contactRateColor(r.contactRate)}`}>{fmtPct(r.contactRate)}</td>
                      <td className={`p-3 pr-4 text-right font-medium ${bookingRateColor(r.bookingRate)}`}>{fmtPct(r.bookingRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="p-3 border-t border-white/5 flex items-center gap-4 flex-wrap text-[10px] text-gray-600">
              <span className="text-emerald-400">Green</span> = strong
              <span className="text-yellow-400">Yellow</span> = average
              <span className="text-rose-400">Red</span> = needs attention
              <span className="ml-2">CPL: &lt;$12 great, &lt;$25 avg, &gt;$25 high</span>
              <span>Contact%: &gt;50% great, &gt;30% avg</span>
              <span>Book%: &gt;20% great, &gt;10% avg</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


function AICommandCenter() {
  const [dailyActions, setDailyActions] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [marketIntel, setMarketIntel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, rRes, mRes] = await Promise.all([
        fetch("/api/facebook/daily-actions"),
        fetch("/api/facebook/recommendations"),
        fetch("/api/facebook/market-intel"),
      ]);

      const [aJson, rJson, mJson] = await Promise.all([
        aRes.json(),
        rRes.json(),
        mRes.json(),
      ]);

      setDailyActions(Array.isArray(aJson) ? aJson : aJson?.actions || []);
      setRecommendations(Array.isArray(rJson) ? rJson : rJson?.campaigns || []);
      setMarketIntel(mJson || null);
    } catch (e) {
      console.error("AICommandCenter load error:", e);
      setDailyActions([]);
      setRecommendations([]);
      setMarketIntel(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>⚡</span> AI Daily Actions
          </h3>
          <button
            onClick={load}
            className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="text-xs text-gray-500">Loading actions…</p>
        ) : dailyActions.length === 0 ? (
          <p className="text-xs text-gray-500">No actions yet.</p>
        ) : (
          <div className="space-y-2">
            {dailyActions.map((a, i) => (
              <div key={i} className="bg-white/5 border border-white/5 rounded-lg p-3">
                <p className="text-sm text-white">{a.action || a.message || "Action"}</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {a.campaign ? `Campaign: ${a.campaign}` : a.type ? `Type: ${a.type}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <span>🧠</span> AI Recommendations
        </h3>

        {loading ? (
          <p className="text-xs text-gray-500">Loading recommendations…</p>
        ) : recommendations.length === 0 ? (
          <p className="text-xs text-gray-500">No recommendations yet.</p>
        ) : (
          <div className="space-y-2">
            {recommendations.map((r, i) => {
              const text =
                r?.message ||
                (Array.isArray(r?.recommendations) ? r.recommendations.join(" • ") : null) ||
                r?.campaignName ||
                "Recommendation";
              return (
                <div key={i} className="bg-white/5 border border-white/5 rounded-lg p-3">
                  <p className="text-sm text-white">{text}</p>
                  {r?.type ? <p className="text-[11px] text-gray-500 mt-1">Type: {r.type}</p> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <span>🌐</span> Market Intel
        </h3>

        {loading ? (
          <p className="text-xs text-gray-500">Loading market intel…</p>
        ) : !marketIntel ? (
          <p className="text-xs text-gray-500">No market intel yet.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Trending Hooks</p>
              <div className="flex flex-wrap gap-1">
                {(marketIntel.trendingHooks || []).map((hook: string) => (
                  <span
                    key={hook}
                    className="text-[11px] bg-indigo-600/20 text-indigo-200 border border-indigo-500/20 px-2 py-1 rounded-full"
                  >
                    {hook}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Best Age Range</p>
                <p className="text-sm text-white">{marketIntel.bestPerformerAgeRange || "—"}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Best Time</p>
                <p className="text-sm text-white">{marketIntel.bestTimeOfDay || "—"}</p>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Suggested Budget</p>
                <p className="text-sm text-white">
                  {marketIntel.suggestedBudget ? `$${marketIntel.suggestedBudget}` : "—"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────



// ===== FACEBOOK ADS DASHBOARD TABS =====


function AdsDashboardTabs() {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState<DashboardStatRow[]>([]);
  const [recs, setRecs] = useState<RecommendationRow[]>([]);

  useEffect(() => {
    fetch("/api/facebook/stats")
      .then(res => res.json())
      .then(d => setStats(d.campaigns || []));

    fetch("/api/facebook/recommendations")
      .then(res => res.json())
      .then(d => setRecs(d.campaigns || []));
  }, []);

  const totalSpend = stats.reduce((a, c) => a + (c.spend || 0), 0);
  const totalLeads = stats.reduce((a, c) => a + (c.leads || 0), 0);
  const totalAppts = stats.reduce((a, c) => a + (c.appointments || 0), 0);
  const totalRevenue = stats.reduce((a, c) => a + (c.revenue || 0), 0);
  const avgCPL = totalLeads ? totalSpend / totalLeads : 0;
  const roi = totalSpend ? (totalRevenue - totalSpend) / totalSpend : 0;

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setTab("overview")}>Overview</button>
        <button onClick={() => setTab("campaigns")}>Campaigns</button>
        <button onClick={() => setTab("recommendations")}>Recommendations</button>
        <button onClick={() => setTab("roi")}>ROI</button>
        <button onClick={() => setTab("create")}>Create Ad</button>
      </div>

      {tab === "overview" && (
        <div>
          <h2>Overview</h2>
          <p>Total Spend: ${totalSpend.toFixed(2)}</p>
          <p>Total Leads: {totalLeads}</p>
          <p>Avg CPL: ${avgCPL.toFixed(2)}</p>
          <p>Appointments: {totalAppts}</p>
          <p>Revenue: ${totalRevenue.toFixed(2)}</p>
          <p>ROI: {(roi * 100).toFixed(1)}%</p>
        </div>
      )}

      {tab === "campaigns" && (
        <div>
          <h2>Campaigns</h2>
          {stats.map((c, i) => (
            <div key={i} style={{ border: "1px solid #333", padding: 15, marginTop: 10 }}>
              <h3>{c.campaignName}</h3>
              <p>Spend: ${c.spend?.toFixed(2)}</p>
              <p>Leads: {c.leads}</p>
              <p>CPL: ${c.cpl?.toFixed(2)}</p>
              <p>Appointments: {c.appointments}</p>
              <p>ROI: {((c.roi || 0) * 100).toFixed(1)}%</p>
            </div>
          ))}
        </div>
      )}

      {tab === "recommendations" && (
        <div>
          <h2>AI Recommendations</h2>
          {recs.map((c, i) => (
            <div key={i} style={{ border: "1px solid #333", padding: 15, marginTop: 10 }}>
              <h3>{c.campaignName}</h3>
              <ul>
                {(c.recommendations || []).map((r: string, idx: number) => (
                  <li key={idx}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab === "roi" && (
        <div>
          <h2>ROI</h2>
          {stats.map((c, i) => (
            <div key={i} style={{ border: "1px solid #333", padding: 15, marginTop: 10 }}>
              <h3>{c.campaignName}</h3>
              <p>Spend: ${c.spend?.toFixed(2)}</p>
              <p>Revenue: ${c.revenue?.toFixed(2)}</p>
              <p>ROI: {((c.roi || 0) * 100).toFixed(1)}%</p>
            </div>
          ))}
        </div>
      )}

      {tab === "create" && (
        <div>
          <h2>Create Ad</h2>
          <p>Use the Generate Ad tab above to create new ads.</p>
        </div>
      )}
    </div>
  );
}

// ===== INSERT DASHBOARD INTO PAGE =====

export default function FacebookAdsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [dailyReport, setDailyReport] = useState<string>("");
  const [weeklyReport, setWeeklyReport] = useState<string>("");
  const [reportLoading, setReportLoading] = useState(false);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [metricsTarget, setMetricsTarget] = useState<Campaign | null>(null);
  const [hasSub, setHasSub] = useState<boolean | null>(null);
  const [activeSection, setActiveSection] = useState<"performance" | "market" | "generator" | "automode" | "attribution">("performance");
  const [latestActions, setLatestActions] = useState<Record<string, CampaignActionRow>>({});
  const [actionModal, setActionModal] = useState<{ campaign: Campaign; actionType: "PAUSE" | "RESUME" | "SCALE" | "DECREASE" | "FIX" | "DUPLICATE_TEST" | "SET_BUDGET" } | null>(null);
  const [duplicateBudget, setDuplicateBudget] = useState("");
  const [pauseOriginalAfterDuplicate, setPauseOriginalAfterDuplicate] = useState(false);
  const [executingAction, setExecutingAction] = useState<null | "dry" | "real">(null);
  const [actionResult, setActionResult] = useState<{ message: string; reasoning?: string } | null>(null);
  const [savingAutomationId, setSavingAutomationId] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<ActionHistoryState>({});
  const [autoPreviewSummary, setAutoPreviewSummary] = useState<AutoPreviewSummary | null>(null);
  const [autoPreviewLoading, setAutoPreviewLoading] = useState(false);
  const [reallocationPlan, setReallocationPlan] = useState<BudgetReallocationMove[]>([]);
  const [reallocationModalOpen, setReallocationModalOpen] = useState(false);
  const [reallocationLoading, setReallocationLoading] = useState(false);
  const [reallocationApplying, setReallocationApplying] = useState(false);
  const [accountCapInput, setAccountCapInput] = useState("");
  const [savingAccountCap, setSavingAccountCap] = useState(false);
  const [generatingCreativeId, setGeneratingCreativeId] = useState<string | null>(null);
  const [globalPatterns, setGlobalPatterns] = useState<GlobalPatternSummary[]>([]);

  // Header metric totals
  const totalSpend = campaigns.reduce((s, c) => s + (c.totalSpend || 0), 0);
  const totalLeads = campaigns.reduce((s, c) => s + (c.totalLeads || 0), 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;
  const currentTotalBudget = campaigns.reduce((sum, c) => sum + (c.dailyBudget || 0), 0);
  const currentAccountCap =
    campaigns.reduce((cap, c) => (cap > 0 ? cap : Number(c.accountBudgetCap || 0)), 0) || 0;
  const previewTotalBudget = autoPreviewSummary?.totalDailyBudget ?? currentTotalBudget;
  const previewAccountCap = autoPreviewSummary?.accountBudgetCap ?? currentAccountCap;
  const previewCapReached =
    autoPreviewSummary?.capReached ??
    (previewAccountCap > 0 && previewTotalBudget >= previewAccountCap);
  const reallocationProposed = autoPreviewSummary?.reallocationMovesProposed ?? 0;
  const reallocationApplied = autoPreviewSummary?.reallocationMovesApplied ?? 0;
  const capStatusLabel = !previewAccountCap
    ? "No cap set"
    : previewCapReached
    ? "Cap reached"
    : "Under cap";
  const capStatusAccent = !previewAccountCap
    ? "text-gray-300"
    : previewCapReached
    ? "text-rose-300"
    : "text-emerald-300";
  const decreasedCount = autoPreviewSummary?.decreased ?? reallocationApplied;
  const fatiguedCount = autoPreviewSummary?.fatiguedCampaigns ?? 0;

  const loadCampaigns = useCallback(async () => {
    try {
      const r = await fetch("/api/facebook/campaigns");
      const j = await r.json();
      if (r.ok) setCampaigns(j.campaigns || []);
    } catch {}
    setLoading(false);
  }, []);

  const loadLatestActions = useCallback(async (campaignIds: string[]) => {
    if (!campaignIds.length) {
      setLatestActions({});
      return;
    }
    try {
      const r = await fetch(`/api/facebook/execute-action?campaignIds=${encodeURIComponent(campaignIds.join(","))}`);
      const j = await r.json();
      setLatestActions(j.latestActions || {});
    } catch {
      setLatestActions({});
    }
  }, []);

  const checkSub = useCallback(async () => {
    try {
      const r = await fetch("/api/facebook/subscription/status");
      const j = await r.json();
      setHasSub(j.active === true);
    } catch {
      setHasSub(false);
    }
  }, []);

  const loadGlobalPatterns = useCallback(async () => {
    try {
      const r = await fetch("/api/facebook/global-intelligence?limit=6");
      const j = await r.json();
      if (r.ok) setGlobalPatterns(j.patterns || []);
    } catch {
      setGlobalPatterns([]);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }
    if (status === "authenticated") {
      checkSub();
      loadCampaigns();
      loadGlobalPatterns();
    }
  }, [status, router, checkSub, loadCampaigns, loadGlobalPatterns]);

  useEffect(() => {
    loadLatestActions(campaigns.map((c) => c._id));
  }, [campaigns, loadLatestActions]);

  useEffect(() => {
    if (savingAccountCap) return;
    if (currentAccountCap > 0) {
      setAccountCapInput(String(currentAccountCap));
    } else {
      setAccountCapInput("");
    }
  }, [currentAccountCap, savingAccountCap]);

  const openActionModal = (
    campaign: Campaign,
    actionType: "PAUSE" | "RESUME" | "SCALE" | "DECREASE" | "FIX" | "DUPLICATE_TEST" | "SET_BUDGET"
  ) => {
    setActionModal({ campaign, actionType });
    setDuplicateBudget(String(campaign.dailyBudget || ""));
    setPauseOriginalAfterDuplicate(false);
  };

  const handleActionHistoryToggle = async (campaignId: string) => {
    const current = historyState[campaignId];
    const willOpen = !(current?.open);
    setHistoryState((prev) => ({
      ...prev,
      [campaignId]: {
        open: willOpen,
        loading: willOpen ? current?.loading || false : false,
        rows: current?.rows || [],
      },
    }));

    if (!willOpen) return;
    if (current?.rows?.length) return;

    setHistoryState((prev) => ({
      ...prev,
      [campaignId]: { ...(prev[campaignId] || { rows: [] }), open: true, loading: true },
    }));

    try {
      const r = await fetch(`/api/facebook/action-history?campaignId=${encodeURIComponent(campaignId)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load action history");
      setHistoryState((prev) => ({
        ...prev,
        [campaignId]: {
          open: true,
          loading: false,
          rows: Array.isArray(j.history) ? j.history : [],
        },
      }));
    } catch (e: any) {
      alert(e.message || "Failed to load action history");
      setHistoryState((prev) => ({
        ...prev,
        [campaignId]: {
          ...(prev[campaignId] || { rows: [] }),
          open: true,
          loading: false,
        },
      }));
    }
  };

  const executeCampaignAction = async (dryRun: boolean) => {
    if (!actionModal) return;
    setExecutingAction(dryRun ? "dry" : "real");
    setActionResult(null);
    try {
      const body: Record<string, any> = {
        campaignId: actionModal.campaign._id,
        actionType: actionModal.actionType,
        dryRun,
      };

      if (actionModal.actionType === "FIX" || actionModal.actionType === "DUPLICATE_TEST") {
        body.duplicateBudget = Number(duplicateBudget) || actionModal.campaign.dailyBudget || 0;
        body.pauseOriginalAfterDuplicate = pauseOriginalAfterDuplicate;
      }
      if (actionModal.actionType === "SET_BUDGET") {
        body.customBudget = Number(duplicateBudget) || actionModal.campaign.dailyBudget || 0;
      }

      const r = await fetch("/api/facebook/execute-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to execute action");

      if (j.log?.campaignId) {
        setLatestActions((prev) => ({
          ...prev,
          [j.log.campaignId]: j.log,
        }));
      }

      if (j.message) {
        setActionResult({ message: j.message, reasoning: j.reasoning });
      }

      setActionModal(null);
    } catch (e: any) {
      alert(e.message || "Failed to execute action");
    } finally {
      setExecutingAction(null);
    }
  };

  const toggleAutomation = async (campaign: Campaign) => {
    setSavingAutomationId(campaign._id);
    try {
      const r = await fetch("/api/facebook/auto-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign._id,
          automationEnabled: !campaign.automationEnabled,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to update automation");
      setCampaigns((prev) =>
        prev.map((item) =>
          item._id === campaign._id
            ? { ...item, automationEnabled: !!j.automationEnabled }
            : item
        )
      );
    } catch (e: any) {
      alert(e.message || "Failed to update automation");
    } finally {
      setSavingAutomationId(null);
    }
  };

  const saveAccountCap = async () => {
    const numericCap =
      accountCapInput.trim() === "" ? 0 : Number(accountCapInput);
    if (!Number.isFinite(numericCap) || numericCap < 0) {
      alert("Enter a valid non-negative number for the account cap.");
      return;
    }
    setSavingAccountCap(true);
    try {
      const r = await fetch("/api/facebook/auto-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountBudgetCap: Number(numericCap.toFixed(2)) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to save cap");
      setAccountCapInput(j.accountBudgetCap > 0 ? String(j.accountBudgetCap) : "");
      loadCampaigns();
    } catch (e: any) {
      alert(e.message || "Failed to save cap");
    } finally {
      setSavingAccountCap(false);
    }
  };

  const runAutoPreview = async () => {
    setAutoPreviewLoading(true);
    try {
      const r = await fetch("/api/facebook/auto-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to run preview");
      setAutoPreviewSummary(j);
    } catch (e: any) {
      alert(e.message || "Failed to run preview");
    } finally {
      setAutoPreviewLoading(false);
    }
  };

  const openReallocationPreview = async () => {
    setReallocationLoading(true);
    try {
      const r = await fetch("/api/facebook/auto-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewReallocation: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to load reallocation preview");
      setReallocationPlan(Array.isArray(j.plan) ? j.plan : []);
      setReallocationModalOpen(true);
    } catch (e: any) {
      alert(e.message || "Failed to load reallocation preview");
    } finally {
      setReallocationLoading(false);
    }
  };

  const applyReallocationPlan = async () => {
    setReallocationApplying(true);
    try {
      const r = await fetch("/api/facebook/auto-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyReallocation: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to apply reallocation");
      setActionResult({ message: j.message || "Budget reallocation applied." });
      setReallocationModalOpen(false);
      setReallocationPlan([]);
      loadCampaigns();
    } catch (e: any) {
      alert(e.message || "Failed to apply reallocation");
    } finally {
      setReallocationApplying(false);
    }
  };

  const handleGenerateCreative = async (
    campaign: Campaign,
    mode: "refresh" | "new" | "replace" = "refresh"
  ) => {
    setGeneratingCreativeId(campaign._id);
    try {
      const r = await fetch("/api/facebook/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType: campaign.leadType,
          location: (campaign as any).location || "",
          mode,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed to generate creative");
      setActionResult({
        message:
          mode === "new"
            ? `Started a new ad concept for ${campaign.campaignName}.`
            : mode === "replace"
            ? `Replacement creative ideas generated for ${campaign.campaignName}.`
            : `New creative ideas generated for ${campaign.campaignName}.`,
      });
      setCampaigns((prev) =>
        prev.map((item) =>
          item._id === campaign._id
            ? {
                ...item,
                creativeRefreshNeeded: mode === "refresh" ? false : item.creativeRefreshNeeded,
                recommendNewAd: mode === "new" ? false : item.recommendNewAd,
                recommendReplaceAd: mode === "replace" ? false : item.recommendReplaceAd,
              }
            : item
        )
      );
    } catch (e: any) {
      alert(e.message || "Failed to generate creative");
    } finally {
      setGeneratingCreativeId(null);
    }
  };

  const generateDailyReport = async (force = false) => {
    setReportLoading(true);
    try {
      const r = await fetch("/api/facebook/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (r.ok) setDailyReport(j.report || "");
    } catch {}
    setReportLoading(false);
  };

  const generateWeeklyReport = async (force = false) => {
    setWeeklyLoading(true);
    try {
      const r = await fetch("/api/facebook/generate-weekly-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const j = await r.json();
      if (r.ok) setWeeklyReport(j.report || "");
    } catch {}
    setWeeklyLoading(false);
  };

  if (status === "loading" || hasSub === null) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </DashboardLayout>
    );
  }

  if (hasSub === false) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-white text-lg font-semibold">FB Ads Manager</p>
          <p className="text-gray-400 text-sm text-center max-w-sm">
            An active Facebook Ads Manager subscription is required to access this page.
          </p>
          <button
            onClick={() => router.push("/facebook-leads")}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm"
          >
            Manage Subscription
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 pb-10">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">FB Ads Manager</h1>
            <p className="text-xs text-gray-400 mt-0.5">AI-powered campaign intelligence</p>
          </div>
          <button
            onClick={() => router.push("/facebook-leads")}
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg"
          >
            ← FB Leads
          </button>
        </div>

        {/* Header Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Spend", value: `$${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: "Total Leads", value: totalLeads.toLocaleString() },
            { label: "Avg CPL", value: avgCpl > 0 ? `$${avgCpl.toFixed(2)}` : "—" },
            { label: "Active Campaigns", value: String(activeCampaigns) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#0f172a] border border-white/10 rounded-xl p-4 text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-xl font-bold text-white">{value}</p>
            </div>
          ))}
        </div>

        {globalPatterns.length > 0 && (
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">Global Winners This Week</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Anonymized aggregate patterns CoveCRM is seeing across active Facebook campaigns.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {globalPatterns.slice(0, 3).map((pattern, index) => (
                <div key={`${pattern.leadType}-${pattern.patternLabel}-${index}`} className="bg-white/5 rounded-lg p-4 border border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs uppercase text-gray-400">{pattern.leadType.replace(/_/g, " ")}</p>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-200 border border-emerald-400/20">
                      {pattern.status}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white mt-2">{pattern.patternLabel}</p>
                  <p className="text-xs text-gray-300 mt-2">Hook: {pattern.bestHookSummary || "Direct benefit"}</p>
                  <p className="text-xs text-gray-400 mt-1">Image: {pattern.bestImageStyleSummary || "Native lead-gen creative"}</p>
                  <div className="flex items-center gap-2 mt-3 text-[11px] text-gray-400">
                    <span>Score {Math.round(pattern.performanceScore || 0)}</span>
                    <span>Confidence {Math.round(pattern.confidenceScore || 0)}</span>
                    <span>{pattern.sampleSizeBucket}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {actionResult && (
          <div className="bg-emerald-900/40 border border-emerald-500/30 text-emerald-100 text-sm rounded-xl px-4 py-3 flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{actionResult.message}</p>
              {actionResult.reasoning && (
                <p className="text-xs text-emerald-200 mt-1">{actionResult.reasoning}</p>
              )}
            </div>
            <button
              onClick={() => setActionResult(null)}
              className="text-emerald-200 text-xs hover:text-white"
            >
              ×
            </button>
          </div>
        )}

        <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">AI Automation Preview</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Simulate Auto-Optimize before the cron runs to see what actions would fire.
              </p>
            </div>
            <button
              onClick={runAutoPreview}
              disabled={autoPreviewLoading}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm disabled:opacity-50"
            >
              {autoPreviewLoading ? "Running Preview…" : "Run Auto-Optimize Preview"}
            </button>
          </div>
          {autoPreviewSummary ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "Processed", value: autoPreviewSummary.processed },
                  { label: "Scaled", value: autoPreviewSummary.scaled },
                  { label: "Paused", value: autoPreviewSummary.paused },
                  { label: "Fixed", value: autoPreviewSummary.fixed },
                  { label: "Duplicated", value: autoPreviewSummary.duplicated },
                  { label: "Skipped", value: autoPreviewSummary.skipped },
                ].map((item) => (
                  <div key={item.label} className="bg-white/5 rounded-lg p-3 text-center">
                    <p className="text-xs uppercase text-gray-400">{item.label}</p>
                    <p className="text-lg font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs uppercase text-gray-400">Total Daily Budget</p>
                  <p className="text-lg font-semibold text-white">${previewTotalBudget.toFixed(2)}</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs uppercase text-gray-400">Account Budget Cap</p>
                  <p className="text-lg font-semibold text-white">
                    {previewAccountCap ? `$${previewAccountCap.toFixed(2)}` : "—"}
                  </p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs uppercase text-gray-400">Cap Status</p>
                  <p className={`text-lg font-semibold ${capStatusAccent}`}>{capStatusLabel}</p>
                </div>
                {(reallocationProposed > 0 || reallocationApplied > 0) && (
                  <div className="bg-white/5 rounded-lg p-3">
                    <p className="text-xs uppercase text-gray-400">Reallocation Moves</p>
                    <p className="text-lg font-semibold text-white">
                      {reallocationProposed} proposed · {reallocationApplied} applied
                    </p>
                  </div>
                )}
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-xs uppercase text-gray-400">Fatigued Campaigns</p>
                  <p className="text-lg font-semibold text-white">{fatiguedCount}</p>
                </div>
              </div>
              {Object.keys(autoPreviewSummary.skippedReasons || {}).length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Skipped reasons</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(autoPreviewSummary.skippedReasons).map(([reason, count]) => (
                      <span
                        key={reason}
                        className="text-xs px-2 py-1 rounded-full bg-white/10 text-gray-200 border border-white/10"
                      >
                        {reason}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">
              Click “Run Auto-Optimize Preview” to see how many campaigns would be scaled, fixed, paused, or duplicated.
            </p>
          )}
        </div>

        <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Today's AI Summary</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Snapshot of the latest automation preview including guardrails and spend posture.
              </p>
            </div>
          </div>
          {autoPreviewSummary ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-9 gap-3">
              {[
                { label: "Processed", value: autoPreviewSummary.processed },
                { label: "Scaled", value: autoPreviewSummary.scaled },
                { label: "Decreased", value: decreasedCount },
                { label: "Paused", value: autoPreviewSummary.paused },
                { label: "Fixed", value: autoPreviewSummary.fixed },
                { label: "Duplicated", value: autoPreviewSummary.duplicated },
                { label: "Skipped", value: autoPreviewSummary.skipped },
                { label: "Fatigued", value: fatiguedCount },
                { label: "Current Total Budget", value: `$${previewTotalBudget.toFixed(2)}` },
              ].map((item) => (
                <div key={item.label} className="bg-white/5 rounded-lg p-3 text-center">
                  <p className="text-[11px] uppercase text-gray-400">{item.label}</p>
                  <p className="text-base font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">
              Run the Auto-Optimize preview to populate today's AI summary.
            </p>
          )}
        </div>

        {/* Section Nav */}
        <div className="flex gap-2 flex-wrap">
          {[
            { id: "performance", label: "Campaign Performance" },
            { id: "market", label: "Market Intelligence" },
            { id: "generator", label: "Ad Generator" },
            { id: "automode", label: "Auto Mode" },
            { id: "attribution", label: "Attribution" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                activeSection === s.id
                  ? "bg-indigo-600 text-white"
                  : "bg-white/5 text-gray-400 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* ── Campaign Performance ─────────────────────────────────────────── */}
        {activeSection === "performance" && (
          <div className="flex flex-col gap-4">
            <AICommandCenter />
            {/* Today's Action Report */}
            <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <span>📋</span> Today's Action Report
                </h2>
                <button
                  onClick={() => generateDailyReport(false)}
                  disabled={reportLoading}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs disabled:opacity-50"
                >
                  {reportLoading ? "Generating…" : "Generate Report"}
                </button>
              </div>

              {dailyReport ? (
                <div className="bg-white/5 rounded-lg p-4">
                  <p className="text-sm text-gray-200 whitespace-pre-line leading-relaxed">{dailyReport}</p>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">
                  Click "Generate Report" for AI-powered campaign analysis and action recommendations.
                </p>
              )}
            </div>

            {/* Campaign Table */}
            <div className="bg-[#0f172a] border border-white/10 rounded-xl overflow-hidden">
              <div className="flex flex-col gap-3 p-4 border-b border-white/5 md:flex-row md:items-center md:justify-between">
                <h2 className="text-base font-semibold text-white">Campaigns</h2>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Daily Account Cap ($)</p>
                    <input
                      type="number"
                      min="0"
                      value={accountCapInput}
                      onChange={(e) => setAccountCapInput(e.target.value)}
                      className="w-28 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                      placeholder="0"
                    />
                    <button
                      onClick={saveAccountCap}
                      disabled={savingAccountCap}
                      className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-300 hover:text-white disabled:opacity-50"
                    >
                      {savingAccountCap ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-gray-500">{campaigns.length} total</p>
                    <button
                      onClick={openReallocationPreview}
                      disabled={reallocationLoading}
                      className="text-xs px-3 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-300 hover:text-white disabled:opacity-50"
                    >
                      {reallocationLoading ? "Loading…" : "Reallocate Budget"}
                    </button>
                  </div>
                </div>
              </div>

              {loading ? (
                <p className="p-4 text-gray-400 text-sm">Loading campaigns…</p>
              ) : campaigns.length === 0 ? (
                <p className="p-4 text-gray-500 text-sm">No campaigns yet. Add them in FB Leads.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5 text-xs text-gray-500 uppercase">
                        <th className="text-left p-3 pl-4">Campaign</th>
                        <th className="text-left p-3">Status</th>
                        <th className="text-left p-3">Perf. Score</th>
                        <th className="text-left p-3">Lead Quality</th>
                        <th className="text-left p-3">Cost / Appt</th>
                        <th className="text-left p-3">Cost / Sale</th>
                        <th className="text-left p-3">Appt Rate</th>
                        <th className="text-left p-3">Close Rate</th>
                        <th className="text-left p-3">Class</th>
                        <th className="text-right p-3">Spend</th>
                        <th className="text-right p-3">Leads</th>
                        <th className="text-right p-3">CPL</th>
                        <th className="text-right p-3 pr-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {campaigns.map((c) => {
                        const reasonText = c.performanceClass ? PERFORMANCE_REASONING[c.performanceClass] : "";
                        return (
                          <Fragment key={c._id}>
                          <tr className="hover:bg-white/3">
                          <td className="p-3 pl-4">
                            <p className="text-white font-medium truncate max-w-[180px]">{c.campaignName}</p>
                            <p className="text-xs text-gray-500">{LEAD_TYPE_LABELS[c.leadType] || c.leadType}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {/* Meta connection health badge */}
                              {c.metaSyncStatus === "token_expired" || c.metaObjectHealth === "token_expired" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 border border-red-600/30">
                                  Token Expired
                                </span>
                              ) : c.metaPublishStatus === "failed" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/30 text-red-300 border border-red-700/30">
                                  Publish Failed
                                </span>
                              ) : c.metaPublishStatus === "skipped_missing_meta_connection" || c.metaObjectHealth === "disconnected" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-300 border border-yellow-700/30">
                                  Needs Meta Connect
                                </span>
                              ) : c.metaObjectHealth === "healthy" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/30 text-emerald-300 border border-emerald-700/30">
                                  Meta Connected
                                </span>
                              ) : c.metaSyncStatus === "sync_failed" || c.metaObjectHealth === "sync_failed" || c.metaObjectHealth === "stale" ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-900/30 text-orange-300 border border-orange-700/30">
                                  Needs Sync
                                </span>
                              ) : null}
                              {c.autoPaused && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-gray-200 border border-white/20">
                                  Auto Paused
                                </span>
                              )}
                              {c.creativeRefreshNeeded && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-900/40 text-orange-200 border border-orange-500/20">
                                  Creative Refresh Needed
                                </span>
                              )}
                              {(c.duplicatedFromCampaignId || c.lastDuplicatedAt) && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-200 border border-emerald-600/30">
                                  Duplicated Winner
                                </span>
                              )}
                              {c.recommendNewAd && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-900/40 text-sky-200 border border-sky-600/30">
                                  New Ad Recommended
                                </span>
                              )}
                              {c.recommendReplaceAd && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-900/40 text-rose-200 border border-rose-600/30">
                                  Replace Ad Recommended
                                </span>
                              )}
                            </div>
                            {latestActions[c._id] && (
                              <p className="text-[11px] text-gray-500 mt-1">
                                Last Action: {latestActions[c._id].actionType}{" "}
                                {new Date(latestActions[c._id].createdAt).toLocaleDateString()}
                              </p>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="space-y-2">
                              <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${
                                c.status === "active"
                                  ? "bg-emerald-900/40 text-emerald-300 border-emerald-700/40"
                                  : "bg-white/5 text-gray-400 border-white/10"
                              }`}>
                                {c.status}
                              </span>
                              <button
                                onClick={() => toggleAutomation(c)}
                                disabled={savingAutomationId === c._id}
                                className={`block text-[11px] px-2 py-1 rounded border ${
                                  c.automationEnabled
                                    ? "bg-indigo-900/30 text-indigo-300 border-indigo-700/30"
                                    : "bg-white/5 text-gray-400 border-white/10"
                                } disabled:opacity-50`}
                              >
                                Automation: {c.automationEnabled ? "ON" : "OFF"}
                              </button>
                            </div>
                          </td>
                          <td className="p-3">
                            <ScoreBar score={c.performanceScore} />
                          </td>
                          <td className="p-3 text-left text-gray-300">
                            {typeof c.leadQualityScore === "number"
                              ? c.leadQualityScore.toFixed(2)
                              : "—"}
                          </td>
                          <td className="p-3 text-left text-gray-300">
                            {c.costPerAppointment && c.costPerAppointment > 0
                              ? `$${c.costPerAppointment.toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="p-3 text-left text-gray-300">
                            {c.costPerSale && c.costPerSale > 0
                              ? `$${c.costPerSale.toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="p-3 text-left text-gray-300">
                            {typeof c.appointmentRate === "number" && c.appointmentRate > 0
                              ? `${(c.appointmentRate * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="p-3 text-left text-gray-300">
                            {typeof c.closeRate === "number" && c.closeRate > 0
                              ? `${(c.closeRate * 100).toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="p-3">
                            <ClassBadge cls={c.performanceClass} />
                          </td>
                          <td className="p-3 text-right text-gray-300">
                            ${(c.totalSpend || 0).toFixed(2)}
                          </td>
                          <td className="p-3 text-right text-gray-300">
                            {(c.totalLeads || 0).toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-gray-300">
                            {c.cpl > 0 ? `$${c.cpl.toFixed(2)}` : "—"}
                          </td>
                          <td className="p-3 pr-4 text-right">
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex items-center justify-end gap-2 flex-wrap w-full">
                              {c.performanceClass === "SCALE" && (
                                <button
                                  onClick={() => openActionModal(c, "SCALE")}
                                  className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-500/20 px-2 py-1 rounded"
                                >
                                  Increase Budget
                                </button>
                              )}
                              {c.performanceClass === "FIX" && (
                                <button
                                  onClick={() => openActionModal(c, "FIX")}
                                  className="text-xs text-orange-300 hover:text-orange-200 border border-orange-500/20 px-2 py-1 rounded"
                                >
                                  Fix Targeting
                                </button>
                              )}
                              {c.performanceClass === "PAUSE" && (
                                <button
                                  onClick={() => openActionModal(c, "PAUSE")}
                                  className="text-xs text-rose-300 hover:text-rose-200 border border-rose-500/20 px-2 py-1 rounded"
                                >
                                  Pause Campaign
                                </button>
                              )}
                              {c.performanceClass === "DUPLICATE_TEST" && (
                                <button
                                  onClick={() => openActionModal(c, "DUPLICATE_TEST")}
                                  className="text-xs text-sky-300 hover:text-sky-200 border border-sky-500/20 px-2 py-1 rounded"
                                >
                                  Duplicate & Test
                                </button>
                              )}
                              {c.status === "paused" && (
                                <button
                                  onClick={() => openActionModal(c, "RESUME")}
                                  className="text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-500/20 px-2 py-1 rounded"
                                >
                                  Resume Campaign
                                </button>
                              )}
                              {c.status === "active" && (
                                <button
                                  onClick={() => openActionModal(c, "DECREASE")}
                                  className="text-xs text-yellow-300 hover:text-yellow-200 border border-yellow-500/20 px-2 py-1 rounded"
                                >
                                  Decrease Budget
                                </button>
                              )}
                              </div>
                              {reasonText && (
                                <p className="text-[11px] text-gray-400 max-w-[220px] text-right">{reasonText}</p>
                              )}
                              {(c.autoPaused || c.creativeRefreshNeeded || c.recommendNewAd || c.recommendReplaceAd) && (
                                <div className="flex items-center gap-2 flex-wrap justify-end w-full">
                                  {c.autoPaused && (
                                    <button
                                      onClick={() => openActionModal(c, "RESUME")}
                                      className="text-xs text-gray-200 hover:text-white border border-white/20 px-2 py-1 rounded"
                                    >
                                      Resume Campaign
                                    </button>
                                  )}
                                  {c.creativeRefreshNeeded && (
                                    <button
                                      onClick={() => handleGenerateCreative(c)}
                                      disabled={generatingCreativeId === c._id}
                                      className="text-xs text-orange-200 hover:text-white border border-orange-500/30 px-2 py-1 rounded disabled:opacity-50"
                                    >
                                      {generatingCreativeId === c._id ? "Generating…" : "Generate New Creative"}
                                    </button>
                                  )}
                                  {c.recommendNewAd && (
                                    <button
                                      onClick={() => handleGenerateCreative(c, "new")}
                                      disabled={generatingCreativeId === c._id}
                                      className="text-xs text-sky-200 hover:text-white border border-sky-500/30 px-2 py-1 rounded disabled:opacity-50"
                                    >
                                      {generatingCreativeId === c._id ? "Starting…" : "Start New Ad"}
                                    </button>
                                  )}
                                  {c.recommendReplaceAd && (
                                    <button
                                      onClick={() => handleGenerateCreative(c, "replace")}
                                      disabled={generatingCreativeId === c._id}
                                      className="text-xs text-rose-200 hover:text-white border border-rose-500/30 px-2 py-1 rounded disabled:opacity-50"
                                    >
                                      {generatingCreativeId === c._id ? "Preparing…" : "Replace Ad"}
                                    </button>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-2 flex-wrap justify-end">
                                <button
                                  onClick={() => setMetricsTarget(c)}
                                  className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 px-2 py-1 rounded"
                                >
                                  + Metrics
                                </button>
                                <button
                                  onClick={() => openActionModal(c, "SET_BUDGET")}
                                  className="text-xs text-blue-300 hover:text-blue-200 border border-blue-500/20 px-2 py-1 rounded"
                                >
                                  Edit Budget
                                </button>
                                <button
                                  onClick={() => handleActionHistoryToggle(c._id)}
                                  className="text-xs text-gray-300 hover:text-white border border-white/10 px-2 py-1 rounded"
                                >
                                  {historyState[c._id]?.open ? "Hide History" : "Action History"}
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {historyState[c._id]?.open && (
                          <tr key={`${c._id}-history`} className="bg-[#050d1d]">
                            <td colSpan={13} className="p-4">
                              <div className="flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-white font-semibold">Action History</p>
                                  {historyState[c._id]?.loading && (
                                    <p className="text-xs text-gray-400">Loading…</p>
                                  )}
                                </div>
                                {historyState[c._id]?.rows?.length ? (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-gray-300">
                                      <thead>
                                        <tr className="text-gray-500 border-b border-white/5">
                                          <th className="text-left py-2 pr-2">Date</th>
                                          <th className="text-left py-2 pr-2">Action</th>
                                          <th className="text-left py-2 pr-2">Reason</th>
                                          <th className="text-right py-2 pr-2">Old Budget</th>
                                          <th className="text-right py-2 pr-2">New Budget</th>
                                          <th className="text-left py-2 pr-2">Mode</th>
                                          <th className="text-left py-2">Result</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {historyState[c._id]?.rows.map((row, idx) => (
                                          <tr key={`${c._id}-history-${idx}`} className="border-b border-white/5 last:border-0">
                                            <td className="py-2 pr-2">{new Date(row.createdAt).toLocaleString()}</td>
                                            <td className="py-2 pr-2">{row.action}</td>
                                            <td className="py-2 pr-2 text-gray-400">{row.reasoning || "—"}</td>
                                            <td className="py-2 pr-2 text-right">${Number(row.oldBudget || 0).toFixed(2)}</td>
                                            <td className="py-2 pr-2 text-right">${Number(row.newBudget || 0).toFixed(2)}</td>
                                            <td className="py-2 pr-2">{row.dryRun ? "Dry Run" : "Live"}</td>
                                            <td className="py-2 text-gray-300">{row.metaResponseSummary || "—"}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : historyState[c._id]?.loading ? null : (
                                  <p className="text-xs text-gray-400">No actions logged yet.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Market Intelligence ──────────────────────────────────────────── */}
        {activeSection === "market" && (
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <span>🌐</span> Market Intelligence
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Weekly competitive analysis using competitor ad data and your performance trends.
                </p>
              </div>
              <button
                onClick={() => generateWeeklyReport(false)}
                disabled={weeklyLoading}
                className="px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs disabled:opacity-50"
              >
                {weeklyLoading ? "Generating…" : "Generate Weekly Report"}
              </button>
            </div>

            {weeklyReport ? (
              <div className="bg-white/5 rounded-lg p-4">
                <p className="text-sm text-gray-200 whitespace-pre-line leading-relaxed">{weeklyReport}</p>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">
                Generate your weekly market intelligence report to see competitor insights, trending angles,
                and recommended changes.
              </p>
            )}
          </div>
        )}

        {/* ── Complete Ad Generator ────────────────────────────────────────── */}
        {activeSection === "generator" && <AdWizard />}

        {/* ── Auto Mode ───────────────────────────────────────────────────── */}
        {activeSection === "automode" && (
          <AutoModePanel campaigns={campaigns} onUpdate={loadCampaigns} />
        )}

        {/* ── Attribution ──────────────────────────────────────────────── */}
        {activeSection === "attribution" && <AttributionSection />}

      </div>

      {/* Metrics Modal */}
      {metricsTarget && (
        <MetricsModal
          campaign={metricsTarget}
          onClose={() => setMetricsTarget(null)}
          onSaved={() => {
            setMetricsTarget(null);
            loadCampaigns();
          }}
        />
      )}

      {actionModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Confirm Action</h3>
              <button onClick={() => setActionModal(null)} className="text-gray-400 hover:text-white text-lg">×</button>
            </div>
            <p className="text-xs text-gray-400 mb-4">{actionModal.campaign.campaignName}</p>

            {actionModal.actionType === "PAUSE" && (
              <p className="text-sm text-gray-200 mb-4">
                This will pause the campaign in Meta.
              </p>
            )}

            {actionModal.actionType === "SCALE" && (
              <div className="space-y-2 mb-4">
                <p className="text-sm text-gray-200">This will increase the ad set daily budget by 20%.</p>
                <p className="text-sm text-gray-400">Current daily budget: ${Number(actionModal.campaign.dailyBudget || 0).toFixed(2)}</p>
                <p className="text-sm text-emerald-300">New daily budget: ${(Number(actionModal.campaign.dailyBudget || 0) * 1.2).toFixed(2)}</p>
              </div>
            )}

            {actionModal.actionType === "FIX" && (
              <div className="space-y-3 mb-4">
                <p className="text-sm text-gray-200">This will create a NEW ad set in Meta.</p>
                <p className="text-sm text-gray-400">The duplicate will have its own daily budget.</p>
                <p className="text-sm text-yellow-300">Your total daily spend may increase.</p>
                <p className="text-sm text-gray-400">The original ad set will remain active unless you choose to pause it.</p>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Duplicate daily budget</label>
                  <input
                    type="number"
                    min="1"
                    value={duplicateBudget}
                    onChange={(e) => setDuplicateBudget(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={pauseOriginalAfterDuplicate}
                    onChange={(e) => setPauseOriginalAfterDuplicate(e.target.checked)}
                  />
                  Pause original ad set after duplicate is created
                </label>
              </div>
            )}

            {actionModal.actionType === "DUPLICATE_TEST" && (
              <div className="space-y-3 mb-4">
                <p className="text-sm text-gray-200">This will create a NEW campaign in Meta.</p>
                <p className="text-sm text-gray-400">The duplicate will have its own daily budget.</p>
                <p className="text-sm text-yellow-300">Your total daily spend may increase.</p>
                <p className="text-sm text-gray-400">The original campaign will remain active unless you choose to pause it.</p>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Duplicate daily budget</label>
                  <input
                    type="number"
                    min="1"
                    value={duplicateBudget}
                    onChange={(e) => setDuplicateBudget(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={pauseOriginalAfterDuplicate}
                    onChange={(e) => setPauseOriginalAfterDuplicate(e.target.checked)}
                  />
                  Pause original campaign after duplicate is created
                </label>
              </div>
            )}

            {actionModal.actionType === "SET_BUDGET" && (
              <div className="space-y-3 mb-4">
                <p className="text-sm text-gray-200">Update the Meta ad set daily budget manually.</p>
                <p className="text-sm text-gray-400">
                  Current budget: ${Number(actionModal.campaign.dailyBudget || 0).toFixed(2)}
                </p>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">New daily budget</label>
                  <input
                    type="number"
                    min="1"
                    value={duplicateBudget}
                    onChange={(e) => setDuplicateBudget(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <p className="text-xs text-yellow-300">
                  Warning: This immediately changes the Meta ad set budget.
                </p>
              </div>
            )}

            {actionModal.actionType === "RESUME" && (
              <div className="space-y-2 mb-4">
                <p className="text-sm text-gray-200">This will resume the campaign inside Meta.</p>
                <p className="text-xs text-gray-400">
                  Status will change to ACTIVE and spend will continue.
                </p>
              </div>
            )}

            {actionModal.actionType === "DECREASE" && (
              <div className="space-y-2 mb-4">
                <p className="text-sm text-gray-200">This will reduce the daily budget by 20%.</p>
                <p className="text-sm text-gray-400">
                  Current daily budget: ${Number(actionModal.campaign.dailyBudget || 0).toFixed(2)}
                </p>
                <p className="text-sm text-yellow-300">
                  New daily budget: ${Number((Number(actionModal.campaign.dailyBudget || 0) * 0.8)).toFixed(2)}
                </p>
                <p className="text-xs text-gray-400">Budget cannot go below $10 per guardrails.</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => executeCampaignAction(true)}
                  disabled={executingAction !== null}
                  className="flex-1 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-gray-100 border border-white/20 disabled:opacity-50"
                >
                  {executingAction === "dry" ? "Testing…" : "Test Run"}
                </button>
                <button
                  onClick={() => executeCampaignAction(false)}
                  disabled={executingAction !== null}
                  className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50"
                >
                  {executingAction === "real" ? "Applying…" : "Apply For Real"}
                </button>
              </div>
              <button
                onClick={() => setActionModal(null)}
                disabled={executingAction !== null}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {reallocationModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white">Budget Reallocation Preview</h3>
              <button onClick={() => setReallocationModalOpen(false)} className="text-gray-400 hover:text-white text-lg">
                ×
              </button>
            </div>
            {reallocationPlan.length ? (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
                {reallocationPlan.map((move, idx) => {
                  const fromCampaign = campaigns.find((c) => c._id === move.fromCampaignId);
                  const toCampaign = campaigns.find((c) => c._id === move.toCampaignId);
                  return (
                    <div key={`${move.fromCampaignId}-${move.toCampaignId}-${idx}`} className="text-sm text-gray-200">
                      Move ${move.amount.toFixed(2)} from{" "}
                      <span className="text-rose-300">{fromCampaign?.campaignName || "Campaign"}</span> →{" "}
                      <span className="text-emerald-300">{toCampaign?.campaignName || "Campaign"}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No reallocation opportunities were found right now.</p>
            )}
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setReallocationModalOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={applyReallocationPlan}
                disabled={reallocationApplying || reallocationPlan.length === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50"
              >
                {reallocationApplying ? "Applying…" : "Apply Reallocation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

// Admin-only: gate this page to experimental admin access
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return { notFound: true };
  return { props: {} };
};
