// pages/facebook-ads/index.tsx
// Facebook Ads Manager — Full AI-powered ads management dashboard
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import DashboardLayout from "@/components/DashboardLayout";
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
  totalSpend: number;
  totalLeads: number;
  cpl: number;
  performanceScore: number | null;
  performanceClass: string | null;
  lastScoredAt: string | null;
  lastActionReport: string | null;
  autoModeOn: boolean;
  automationEnabled?: boolean;
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

interface CampaignActionRow {
  campaignId: string;
  actionType: "PAUSE" | "SCALE" | "FIX" | "DUPLICATE_TEST" | string;
  createdAt: string;
}

interface VariantDraft {
  id: string;
  creativeArchetype: string;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  imagePrompt: string;
  imageUrl: string | null;
  overlayTemplate: string;
  overlayData: {
    headline: string;
    subheadline: string;
    buttonLabels: string[];
    ctaStrip: string;
    benefitBullets: string[];
  };
  buttonStyle: string;
  ageButtons?: string[] | null;
  coverageButtons?: string[] | null;
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
  imageUrl?: string | null;
  imageError?: string | null;
  copySource?: "ai_generated" | "template_fallback";
  creativeArchetype?: string;
  overlayTemplate?: string;
  overlayData?: {
    headline: string;
    subheadline: string;
    buttonLabels: string[];
    ctaStrip: string;
    benefitBullets: string[];
  };
  variants?: VariantDraft[];
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

// ── Complete Ad Generator ─────────────────────────────────────────────────────

function CompleteAdGenerator() {
  const [leadType, setLeadType] = useState("final_expense");
  const [agentName, setAgentName] = useState("");
  const [agentState, setAgentState] = useState("");
  const [tone, setTone] = useState("empathetic");
  const [dailyBudget, setDailyBudget] = useState("25");
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<{ ok: boolean; folderName?: string; campaignName?: string; message?: string; error?: string } | null>(null);
  const [result, setResult] = useState<CompleteAdPackage | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("ad");

  const handlePost = async () => {
    if (!result) return;
    setPosting(true);
    setPostResult(null);
    try {
      const labelMap: Record<string, string> = {
        final_expense: "Final Expense",
        iul: "IUL",
        mortgage_protection: "Mortgage Protection",
        veteran: "Veteran",
        trucker: "Trucker",
      };
      const campaignName = `${labelMap[leadType] || leadType} - ${agentState || "US"} Campaign`;
      const r = await fetch("/api/facebook/publish-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          campaignName,
          dailyBudgetCents: Math.round((parseFloat(dailyBudget) || 25) * 100),
          headline: result.headline ?? "",
          primaryText: result.primaryText ?? "",
          description: "",
          cta: "LEARN_MORE",
          imagePrompt: result.imagePrompt ?? "",
          imageUrl: result.imageUrl ?? "",
          creativeArchetype: result.creativeArchetype ?? "",
        }),
      });
      const j = await r.json();
      setPostResult({ ok: !!j.ok, folderName: j.folderName, campaignName: j.campaignName, message: j.message, error: j.error });
    } catch (e: any) {
      setPostResult({ ok: false, error: e.message || "Request failed" });
    } finally {
      setPosting(false);
    }
  };

  const generate = async () => {
    if (!agentName || !agentState) {
      setError("Agent name and state are required.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/facebook/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadType, agentName, agentState, tone, mode: "complete" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Generation failed");
      setResult((j?.draft || j) as CompleteAdPackage);
      setActiveTab("ad");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: "ad", label: "Ad Copy" },
    { id: "creative", label: "Creative Layout" },
    { id: "form", label: "Lead Form" },
    { id: "followup", label: "Follow-Up" },
    { id: "image", label: "Image Prompt" },
    { id: "targeting", label: "Targeting" },
  ];

  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-white mb-4">Complete Ad Package Generator</h2>
      <p className="text-xs text-gray-400 mb-5">
        Generate a full ad system with native CoveCRM routing, Facebook Instant Form setup, and system-provided creative direction.
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

      {/* Daily Budget */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 block mb-1">Daily Budget ($)</label>
        <input
          type="number"
          min="5"
          value={dailyBudget}
          onChange={(e) => setDailyBudget(e.target.value)}
          className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
        />
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
                {result.imageUrl && (
                  <div>
                    <p className="text-xs text-gray-400 font-semibold mb-2">SYSTEM-PROVIDED CREATIVE ASSET</p>
                    <img src={result.imageUrl} alt="Generated ad image" className="rounded-lg max-w-xs w-full object-cover" />
                  </div>
                )}
                {result.imageError && (
                  <p className="text-xs text-yellow-500">Image generation failed: {result.imageError}</p>
                )}
                {result.creativeArchetype && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Layout:</span>
                    <span className="text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-700/30 px-2 py-0.5 rounded-full">
                      {result.creativeArchetype.replace(/_/g, " ")}
                    </span>
                    {result.copySource && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${result.copySource === "ai_generated" ? "bg-emerald-900/30 text-emerald-400 border border-emerald-700/30" : "bg-gray-800 text-gray-500 border border-gray-700"}`}>
                        {result.copySource === "ai_generated" ? "AI Enhanced" : "Template"}
                      </span>
                    )}
                  </div>
                )}
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
                <p className="text-xs text-gray-400">CoveCRM provides the creative asset or creative direction for this package. Manual image upload is not part of the normal flow.</p>
              </div>
            )}

            {activeTab === "creative" && (
              <div className="space-y-5">
                {/* Overlay layout for primary variant */}
                {result.overlayData && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-400 font-semibold">PRIMARY LAYOUT — {result.creativeArchetype?.replace(/_/g, " ") ?? "Auto"}</p>
                    <div className="bg-[#0f172a] border border-white/10 rounded-lg p-3 space-y-2">
                      <p className="text-white font-semibold text-sm">{result.overlayData.headline}</p>
                      <p className="text-gray-400 text-xs">{result.overlayData.subheadline}</p>
                      {result.overlayData.buttonLabels.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {result.overlayData.buttonLabels.map((label: string) => (
                            <span key={label} className="text-xs bg-indigo-700/60 text-indigo-200 px-2.5 py-1 rounded-full">{label}</span>
                          ))}
                        </div>
                      )}
                      {result.overlayData.benefitBullets.length > 0 && (
                        <ul className="space-y-0.5 mt-1">
                          {result.overlayData.benefitBullets.map((b: string) => (
                            <li key={b} className="text-xs text-gray-400 flex items-start gap-1"><span className="text-green-500 shrink-0">✓</span>{b}</li>
                          ))}
                        </ul>
                      )}
                      <p className="text-xs text-indigo-400 font-medium mt-1">{result.overlayData.ctaStrip}</p>
                    </div>
                  </div>
                )}

                {/* 3 variants */}
                {result.variants && result.variants.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-400 font-semibold">CREATIVE VARIANTS ({result.variants.length})</p>
                    {result.variants.map((v: VariantDraft, i: number) => (
                      <div key={v.id} className="bg-[#0f172a] border border-white/10 rounded-lg p-3 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500">Variant {i + 1}</span>
                          <span className="text-xs bg-indigo-900/30 text-indigo-400 border border-indigo-700/20 px-2 py-0.5 rounded-full">
                            {v.creativeArchetype.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="text-white text-sm font-medium">{v.headline}</p>
                        <p className="text-gray-400 text-xs leading-relaxed line-clamp-3">{v.primaryText}</p>
                        {v.overlayData.buttonLabels.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {v.overlayData.buttonLabels.map((label: string) => (
                              <span key={label} className="text-[10px] bg-white/10 text-gray-300 px-2 py-0.5 rounded-full">{label}</span>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-indigo-400">{v.overlayData.ctaStrip}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "form" && (
              <div className="space-y-3">
                <div className="bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-2">
                  <p className="text-xs text-blue-200">Facebook Instant Form Setup: copy these fields directly into your Meta lead form.</p>
                </div>
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

          {/* Post Ad Button — inside result div */}
          <div className="mt-5 pt-4 border-t border-white/10">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handlePost}
                disabled={posting}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 transition"
              >
                {posting ? "Creating Campaign…" : "Post Ad & Create CRM Folder"}
              </button>
              <p className="text-xs text-gray-500">Creates a campaign record + CRM folder for lead routing. Incoming leads route into <span className="font-mono">FB: {`${LEAD_TYPE_LABELS[leadType] || leadType} - ${agentState || "US"} Campaign`}</span>.</p>
            </div>
            {postResult && (
              <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${postResult.ok ? "bg-emerald-900/30 border border-emerald-700/40 text-emerald-200" : "bg-rose-900/30 border border-rose-700/40 text-rose-300"}`}>
                {postResult.ok ? (
                  <>
                    <p className="font-semibold">Campaign created!</p>
                    <p className="text-xs mt-1 opacity-80">CRM Folder: <span className="font-mono">{postResult.folderName}</span></p>
                    <p className="text-xs opacity-70 mt-0.5 leading-relaxed">{postResult.message}</p>
                    <p className="text-xs text-yellow-400/80 mt-1.5">Note: Meta live publishing is pending — connect your Facebook Page in the Leads tab to route incoming leads automatically.</p>
                  </>
                ) : (
                  <p>{postResult.error || "Failed to create campaign."}</p>
                )}
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
  const [actionModal, setActionModal] = useState<{ campaign: Campaign; actionType: "PAUSE" | "SCALE" | "FIX" | "DUPLICATE_TEST" } | null>(null);
  const [duplicateBudget, setDuplicateBudget] = useState("");
  const [pauseOriginalAfterDuplicate, setPauseOriginalAfterDuplicate] = useState(false);
  const [executingAction, setExecutingAction] = useState(false);
  const [savingAutomationId, setSavingAutomationId] = useState<string | null>(null);

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

  useEffect(() => {
    loadLatestActions(campaigns.map((c) => c._id));
  }, [campaigns, loadLatestActions]);

  const openActionModal = (campaign: Campaign, actionType: "PAUSE" | "SCALE" | "FIX" | "DUPLICATE_TEST") => {
    setActionModal({ campaign, actionType });
    setDuplicateBudget(String(campaign.dailyBudget || ""));
    setPauseOriginalAfterDuplicate(false);
  };

  const executeCampaignAction = async () => {
    if (!actionModal) return;
    setExecutingAction(true);
    try {
      const body: Record<string, any> = {
        campaignId: actionModal.campaign._id,
        actionType: actionModal.actionType,
      };

      if (actionModal.actionType === "FIX" || actionModal.actionType === "DUPLICATE_TEST") {
        body.duplicateBudget = Number(duplicateBudget) || actionModal.campaign.dailyBudget || 0;
        body.pauseOriginalAfterDuplicate = pauseOriginalAfterDuplicate;
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

      setActionModal(null);
    } catch (e: any) {
      alert(e.message || "Failed to execute action");
    } finally {
      setExecutingAction(false);
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
                            <div className="flex items-center justify-end gap-2 flex-wrap">
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
                              <button
                                onClick={() => setMetricsTarget(c)}
                                className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 px-2 py-1 rounded"
                              >
                                + Metrics
                              </button>
                            </div>
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

            <div className="flex gap-2">
              <button
                onClick={() => setActionModal(null)}
                className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={executeCampaignAction}
                disabled={executingAction}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white disabled:opacity-50"
              >
                {executingAction ? "Applying…" : "Confirm"}
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
