// pages/facebook-ads/index.tsx
// Facebook Ads Manager — Full AI-powered ads management dashboard
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import DashboardLayout from "@/components/DashboardLayout";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
  _id: string;
  campaignName: string;
  leadType: string;
  status: string;
  dailyBudget: number;
  totalSpend: number;
  totalLeads: number;
  cpl: number;
  performanceScore: number | null;
  performanceClass: string | null;
  lastScoredAt: string | null;
  lastActionReport: string | null;
  autoModeOn: boolean;
  frequency: number;
  optOutRate: number;
  badNumberRate: number;
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

interface CompleteAdPackage {
  hook: string;
  primaryText: string;
  headline: string;
  leadFormQuestions: string[];
  thankYouPageText: string;
  smsFollowUpScript: string;
  callScript: string;
  imagePrompt: string;
  targeting: {
    ageRange: string;
    interests: string[];
    behaviors: string[];
    incomeLevel: string;
    locations: string;
  };
  estimatedCpl: string;
  reasoning: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAD_TYPE_LABELS: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
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

// ── Complete Ad Generator ─────────────────────────────────────────────────────

function CompleteAdGenerator() {
  const [leadType, setLeadType] = useState("final_expense");
  const [agentName, setAgentName] = useState("");
  const [agentState, setAgentState] = useState("");
  const [tone, setTone] = useState("empathetic");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompleteAdPackage | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("ad");

  const generate = async () => {
    if (!agentName || !agentState) {
      setError("Agent name and state are required.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/ai/generate-fb-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadType, agentName, agentState, tone, mode: "complete" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Generation failed");
      setResult(j as CompleteAdPackage);
      setActiveTab("ad");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: "ad", label: "Ad Copy" },
    { id: "form", label: "Lead Form" },
    { id: "followup", label: "Follow-Up" },
    { id: "image", label: "Image Prompt" },
    { id: "targeting", label: "Targeting" },
  ];

  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Complete Ad Package Generator</h2>
      <p className="text-xs text-gray-400 mb-5">
        Generate a full ad system — hook, copy, lead form, SMS follow-up, call script, and image prompt.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Lead Type</label>
          <select
            value={leadType}
            onChange={(e) => setLeadType(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          >
            {Object.entries(LEAD_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v} className="bg-[#0f172a]">{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Your Name</label>
          <input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="e.g. John Smith"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">State</label>
          <input
            value={agentState}
            onChange={(e) => setAgentState(e.target.value)}
            placeholder="e.g. Texas"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Tone</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="empathetic" className="bg-[#0f172a]">Empathetic</option>
            <option value="urgent" className="bg-[#0f172a]">Urgent</option>
            <option value="conversational" className="bg-[#0f172a]">Conversational</option>
            <option value="authoritative" className="bg-[#0f172a]">Authoritative</option>
          </select>
        </div>
      </div>

      {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}

      <button
        onClick={generate}
        disabled={loading}
        className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 mb-5"
      >
        {loading ? "Generating with GPT-4o…" : "Generate Complete Ad Package"}
      </button>

      {result && (
        <div>
          {/* Reasoning */}
          {result.reasoning && (
            <div className="bg-indigo-900/20 border border-indigo-500/20 rounded-lg px-4 py-3 mb-4">
              <p className="text-xs text-indigo-300 font-semibold mb-1">Strategy Reasoning</p>
              <p className="text-sm text-indigo-100">{result.reasoning}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 mb-4 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeTab === t.id
                    ? "bg-indigo-600 text-white"
                    : "bg-white/5 text-gray-400 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="bg-white/5 rounded-lg p-4 text-sm text-gray-200">
            {activeTab === "ad" && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 font-semibold mb-1">HOOK</p>
                  <p className="text-white font-medium">{result.hook}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-semibold mb-1">HEADLINE</p>
                  <p className="text-white">{result.headline}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-semibold mb-1">PRIMARY TEXT</p>
                  <p className="text-gray-200 whitespace-pre-line">{result.primaryText}</p>
                </div>
                <div className="text-xs text-gray-500">Est. CPL: {result.estimatedCpl}</div>
              </div>
            )}

            {activeTab === "form" && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 font-semibold mb-2">LEAD FORM QUESTIONS</p>
                  <ol className="list-decimal list-inside space-y-2">
                    {(result.leadFormQuestions || []).map((q, i) => (
                      <li key={i} className="text-gray-200">{q}</li>
                    ))}
                  </ol>
                </div>
                <div className="mt-4">
                  <p className="text-xs text-gray-400 font-semibold mb-1">THANK YOU PAGE TEXT</p>
                  <p className="text-gray-200">{result.thankYouPageText}</p>
                </div>
              </div>
            )}

            {activeTab === "followup" && (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 font-semibold mb-1">SMS FOLLOW-UP (send within 5 min)</p>
                  <div className="bg-green-900/20 border border-green-700/30 rounded-lg px-3 py-2">
                    <p className="text-green-200">{result.smsFollowUpScript}</p>
                    <p className="text-xs text-gray-500 mt-1">{result.smsFollowUpScript?.length || 0} chars</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-semibold mb-1">CALL SCRIPT OPENER</p>
                  <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-3 py-2">
                    <p className="text-blue-200">{result.callScript}</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "image" && (
              <div>
                <p className="text-xs text-gray-400 font-semibold mb-2">IMAGE GENERATION PROMPT</p>
                <div className="bg-purple-900/20 border border-purple-700/30 rounded-lg px-3 py-2">
                  <p className="text-purple-200">{result.imagePrompt}</p>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Use this prompt in Midjourney, DALL-E 3, or Adobe Firefly.
                </p>
              </div>
            )}

            {activeTab === "targeting" && (
              <div className="space-y-2">
                {[
                  { label: "Age Range", val: result.targeting?.ageRange },
                  { label: "Income Level", val: result.targeting?.incomeLevel },
                  { label: "Locations", val: result.targeting?.locations },
                ].map(({ label, val }) => (
                  <div key={label}>
                    <span className="text-xs text-gray-400">{label}: </span>
                    <span className="text-gray-200">{val}</span>
                  </div>
                ))}
                <div>
                  <p className="text-xs text-gray-400 mb-1">Interests:</p>
                  <div className="flex flex-wrap gap-1">
                    {(result.targeting?.interests || []).map((i) => (
                      <span key={i} className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-gray-300">{i}</span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Behaviors:</p>
                  <div className="flex flex-wrap gap-1">
                    {(result.targeting?.behaviors || []).map((b) => (
                      <span key={b} className="text-xs bg-white/10 px-2 py-0.5 rounded-full text-gray-300">{b}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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

// ── Main Page ─────────────────────────────────────────────────────────────────

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
  const [activeSection, setActiveSection] = useState<"performance" | "market" | "generator" | "automode">("performance");

  // Header metric totals
  const totalSpend = campaigns.reduce((s, c) => s + (c.totalSpend || 0), 0);
  const totalLeads = campaigns.reduce((s, c) => s + (c.totalLeads || 0), 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;

  const loadCampaigns = useCallback(async () => {
    try {
      const r = await fetch("/api/facebook/campaigns");
      const j = await r.json();
      if (r.ok) setCampaigns(j.campaigns || []);
    } catch {}
    setLoading(false);
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

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
      return;
    }
    if (status === "authenticated") {
      checkSub();
      loadCampaigns();
    }
  }, [status, router, checkSub, loadCampaigns]);

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

        {/* Section Nav */}
        <div className="flex gap-2 flex-wrap">
          {[
            { id: "performance", label: "Campaign Performance" },
            { id: "market", label: "Market Intelligence" },
            { id: "generator", label: "Ad Generator" },
            { id: "automode", label: "Auto Mode" },
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
              <div className="flex items-center justify-between p-4 border-b border-white/5">
                <h2 className="text-base font-semibold text-white">Campaigns</h2>
                <p className="text-xs text-gray-500">{campaigns.length} total</p>
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
                        <th className="text-left p-3">Score</th>
                        <th className="text-left p-3">Class</th>
                        <th className="text-right p-3">Spend</th>
                        <th className="text-right p-3">Leads</th>
                        <th className="text-right p-3">CPL</th>
                        <th className="text-right p-3 pr-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {campaigns.map((c) => (
                        <tr key={c._id} className="hover:bg-white/3">
                          <td className="p-3 pl-4">
                            <p className="text-white font-medium truncate max-w-[180px]">{c.campaignName}</p>
                            <p className="text-xs text-gray-500">{LEAD_TYPE_LABELS[c.leadType] || c.leadType}</p>
                          </td>
                          <td className="p-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${
                              c.status === "active"
                                ? "bg-emerald-900/40 text-emerald-300 border-emerald-700/40"
                                : "bg-white/5 text-gray-400 border-white/10"
                            }`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="p-3">
                            <ScoreBar score={c.performanceScore} />
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
                            <button
                              onClick={() => setMetricsTarget(c)}
                              className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 px-2 py-1 rounded"
                            >
                              + Metrics
                            </button>
                          </td>
                        </tr>
                      ))}
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
        {activeSection === "generator" && <CompleteAdGenerator />}

        {/* ── Auto Mode ───────────────────────────────────────────────────── */}
        {activeSection === "automode" && (
          <AutoModePanel campaigns={campaigns} onUpdate={loadCampaigns} />
        )}

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
    </DashboardLayout>
  );
}
