// pages/facebook-leads/index.tsx
// Facebook Lead Manager — generate and manage insurance leads from Facebook Ads
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import DashboardLayout from "@/components/DashboardLayout";
import MetaConnectPanel from "@/components/MetaConnectPanel";
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FBCampaign {
  _id: string;
  campaignName: string;
  leadType: string;
  status: string;
  dailyBudget: number;
  totalSpend: number;
  totalLeads: number;
  totalClicks: number;
  cpl: number;
  plan: string;
  createdAt: string;
  googleSheetUrl?: string;
  appsScriptUrl?: string;
}

interface FBLeadEntryRow {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  leadType: string;
  source: string;
  importedToCrm: boolean;
  createdAt: string;
  campaignId: string;
}

interface AdCard {
  _id: string;
  headline: string;
  primaryText: string;
  description: string;
  ctaButton: string;
  targetingNotes: string;
  performanceRating: number;
}

interface GeneratedAd {
  headlines: string[];
  primaryTexts: string[];
  cta: string;
  targeting: {
    ageRange: string;
    interests: string[];
    behaviors: string[];
    incomeLevel: string;
    locations: string;
  };
}

interface OptimizeResult {
  recommendation: string;
  action: "scale" | "pause" | "test" | "stop";
  reasoning: string;
  suggestedBudgetChange?: number | null;
}

interface GeneratedImages {
  aiImages: { url: string; revised_prompt: string }[];
  stockPhotos: { url: string; downloadUrl: string; photographer: string; unsplashLink: string }[];
  recommendedSize: string;
}

const DEFAULT_SHEET_HEADERS = [
  "date",
  "campaign_name",
  "lead_type",
  "first_name",
  "last_name",
  "phone",
  "email",
  "city",
  "state",
  "zip",
  "birthdate",
  "homeowner",
  "coverage_amount",
  "source",
  "status",
  "assigned_to",
  "notes",
];

// ── Constants ─────────────────────────────────────────────────────────────────

type LeadTypeOption = {
  id: string;
  label: string;
  icon: string;
  desc: string;
  disabled?: boolean;
};

const LEAD_TYPES: readonly LeadTypeOption[] = [
  { id: "final_expense", label: "Final Expense", icon: "🕊️", desc: "Seniors age 50–80" },
  { id: "iul", label: "IUL", icon: "📈", desc: "Indexed Universal Life" },
  { id: "mortgage_protection", label: "Mortgage Protection", icon: "🏠", desc: "New homeowners" },
  { id: "veteran", label: "Veteran Leads", icon: "🎖️", desc: "US military veterans" },
  { id: "trucker", label: "Trucker Leads", icon: "🚚", desc: "CDL commercial drivers" },
  { id: "custom", label: "Custom", icon: "⚙️", desc: "Coming soon", disabled: true },
] as const;

const LEAD_TYPE_LABEL: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
};

const ACTION_COLORS: Record<string, string> = {
  scale: "bg-green-700 text-green-200",
  pause: "bg-yellow-700 text-yellow-200",
  test: "bg-blue-700 text-blue-200",
  stop: "bg-red-700 text-red-200",
};

const CREATIVE_TIPS: Record<string, string> = {
  final_expense:
    "Use a photo of a smiling senior couple or multigenerational family. Real-looking lifestyle photos outperform graphics 3:1. Avoid anything that looks like a stock photo.",
  veteran:
    "Use an American flag or a veteran in civilian clothes — avoid military uniforms, Facebook restricts military imagery. Warm, authentic family photos convert best.",
  mortgage_protection:
    "Use a happy couple in front of a home or a family with house keys. Always include people — houses without faces underperform.",
  iul: "Use a professional or family photo. Financial ads perform significantly better with human faces in the creative.",
  trucker:
    "Use a semi truck on an open highway or a trucker with family. Authentic beats stock every time.",
};

const SETUP_STEPS = [
  "What is Facebook Ads Manager?",
  "Create Your Business Account",
  "What to Expect — Read This First",
  "Set Up Your Ad Account",
  "Your AI-Generated Ad Copy",
  "Winning Ad Examples",
  "Targeting Setup",
  "Connect Your Leads",
  "You're All Set!",
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-400 text-sm">
      {"★".repeat(Math.round(rating))}{"☆".repeat(5 - Math.round(rating))}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLORS[action] ?? "bg-gray-700 text-gray-300";
  return (
    <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide ${cls}`}>
      {action}
    </span>
  );
}

// ── Upgrade Modal ──────────────────────────────────────────────────────────────

const UPGRADE_EXPECTATIONS = [
  "Facebook's algorithm needs 3–7 days to exit its Learning Phase — don't change anything during this time.",
  "Expect your first leads in days 3–14 once the algorithm stabilizes.",
  "Typical CPL (cost per lead) for insurance is $8–$25. Start with $20/day budget.",
  "Results compound over time. Most agents see consistent leads by day 30–45.",
  "You'll get AI-optimized ad copy, targeting guidance, and performance recommendations.",
  "Leads are delivered directly into CoveCRM in real time (native webhook).",
];

function UpgradeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setStep(0);
      setAgreed(false);
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const handleSubscribe = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/facebook/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: "manager_pro" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (data.url) window.location.href = data.url;
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const ALL_FEATURES = [
    "AI-generated ad copy — hook, headline, primary text, image prompt",
    "Lead form question generator — ready for Facebook Instant Form",
    "Real-time lead delivery directly into CoveCRM",
    "CRM folder auto-created and named per campaign",
    "AI SMS + AI call support on every incoming lead",
    "Google Sheets backup — every lead saved automatically",
    "Campaign performance dashboard — CPL, spend, leads",
    "AI optimization recommendations — scale, pause, or test",
    "Daily action reports + market intelligence",
    "Auto Mode — AI flags when to scale or pause",
    "Setup guide for your lead type",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[#0f172a] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-y-auto max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            {(["Overview", "Expectations", "Payment"] as const).map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold transition ${
                    i <= step ? "bg-indigo-600 text-white" : "bg-white/10 text-gray-500"
                  }`}
                >
                  {i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${i <= step ? "text-white" : "text-gray-500"}`}>
                  {label}
                </span>
                {i < 2 && <span className="text-gray-700 text-xs">›</span>}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        {/* Step 0: Plan Overview */}
        {step === 0 && (
          <div className="p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white">Facebook Lead System</h2>
              <p className="text-indigo-400 font-bold text-2xl mt-1">$249<span className="text-sm text-gray-400 font-normal">/month</span></p>
              <p className="text-xs text-gray-500 mt-0.5">Everything included. Cancel anytime.</p>
            </div>
            <ul className="space-y-1.5">
              {ALL_FEATURES.map((f) => (
                <li key={f} className="text-xs text-gray-300 flex items-start gap-1.5">
                  <span className="text-green-400 shrink-0 mt-0.5">✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setStep(1)}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition"
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 1: Expectations */}
        {step === 1 && (
          <div className="p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Read This Before You Start</h2>
            <p className="text-gray-400 text-sm">Facebook Ads rewards patience. Here&apos;s what to expect in your first 90 days:</p>
            <ul className="space-y-2">
              {UPGRADE_EXPECTATIONS.map((e, i) => (
                <li key={i} className="flex items-start gap-2 bg-[#1e293b] rounded-lg p-3">
                  <span className="text-indigo-400 font-bold text-sm shrink-0">{i + 1}</span>
                  <p className="text-sm text-gray-300">{e}</p>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="accent-indigo-500 w-4 h-4"
              />
              <span className="text-sm text-gray-300">I understand and I&apos;m ready to commit at least 90 days to this.</span>
            </label>
            <div className="flex gap-3">
              <button onClick={() => setStep(0)} className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm transition">
                ← Back
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!agreed}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Payment */}
        {step === 2 && (
          <div className="p-6 space-y-5">
            <h2 className="text-xl font-bold text-white">Activate Facebook Lead System</h2>
            <div className="bg-[#1e293b] rounded-xl p-4 space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Facebook Lead System</span>
                <span className="text-white font-bold">$249/mo</span>
              </div>
              <p className="text-xs text-gray-500">Billed monthly. Cancel anytime.</p>
            </div>
            {error && (
              <div className="bg-red-900/20 border border-red-600/40 rounded-lg p-3 text-red-300 text-sm">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm transition">
                ← Back
              </button>
              <button
                onClick={handleSubscribe}
                disabled={loading}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl transition disabled:opacity-50"
              >
                {loading ? "Redirecting…" : "Subscribe & Pay →"}
              </button>
            </div>
            <p className="text-xs text-gray-500 text-center">
              Secure checkout powered by Stripe. Questions?{" "}
              <a href="mailto:support@covecrm.com" className="text-gray-400 hover:text-white underline">
                support@covecrm.com
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section A: Hero / Pricing ──────────────────────────────────────────────────

function HeroSection({ onGetStarted }: { onGetStarted: () => void }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  return (
    <>
      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
      <div className="space-y-6 text-center pt-8 max-w-2xl mx-auto">
        <h1 className="text-4xl font-extrabold text-white">
          Generate Your Own Exclusive Insurance Leads on Facebook
        </h1>
        <p className="text-xl text-gray-300">
          Stop paying $25–50 per lead to vendors. Generate exclusive leads you own for a fraction of the cost — never resold, never shared, 100% yours.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {["✓ 100% Exclusive to You", "✓ Never Resold or Shared", "✓ You Own the Ads & Leads"].map((badge) => (
            <span key={badge} className="text-green-400 text-sm font-medium">
              {badge}
            </span>
          ))}
        </div>
        <div className="pt-2 space-y-2">
          <button
            onClick={() => setUpgradeOpen(true)}
            className="inline-block bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-3 rounded-lg transition text-base"
          >
            Get Started — $249/mo →
          </button>
          <p className="text-xs text-gray-500">
            Questions? Email{" "}
            <a href="mailto:support@covecrm.com" className="text-gray-400 hover:text-white underline">
              support@covecrm.com
            </a>
          </p>
        </div>
      </div>
    </>
  );
}

// ── What's Included ───────────────────────────────────────────────────────────

function WhatsIncluded() {
  const features = [
    "AI-generated ad copy — hook, headline, primary text, image prompt",
    "Facebook Instant Form question generator — ready to copy into Ads Manager",
    "Real-time lead delivery directly into CoveCRM",
    "CRM folder auto-created and named per campaign — zero manual setup",
    "AI SMS + AI call fired on every incoming lead automatically",
    "Google Sheets backup — every lead saved to a sheet you own",
    "Campaign performance dashboard — CPL, spend, total leads",
    "AI optimization recommendations — scale, pause, or test",
    "Daily action reports + market intelligence",
    "Auto Mode — AI flags when to scale or pause",
    "Setup guide for every lead type",
  ];
  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-[#1e293b] border border-blue-500/50 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-white font-bold text-lg">Facebook Lead System</h3>
          <p className="text-blue-400 font-extrabold text-2xl mt-0.5">$249<span className="text-sm text-gray-400 font-normal">/mo</span></p>
          <p className="text-xs text-gray-500 mt-0.5">Everything included. Cancel anytime.</p>
        </div>
        <ul className="space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs text-gray-300">
              <span className="text-green-400 mt-0.5 shrink-0">✓</span> {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Section B: Lead Type Selector ─────────────────────────────────────────────

function LeadTypeSelector({
  plan,
  onSelect,
}: {
  plan: "manager" | "manager_pro";
  onSelect: (leadType: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Choose Your Lead Type</h2>
        <p className="text-gray-400 mt-1">
          Select the type of insurance lead you want to generate on Facebook.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {LEAD_TYPES.map((lt) => (
          <button
            key={lt.id}
            onClick={() => !(lt as any).disabled && onSelect(lt.id)}
            disabled={!!(lt as any).disabled}
            className={`p-5 rounded-xl border text-left transition ${
              (lt as any).disabled
                ? "border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed"
                : "border-gray-600 bg-[#1e293b] hover:border-blue-500 hover:bg-[#1e3a5f] cursor-pointer"
            }`}
          >
            <div className="text-3xl mb-2">{lt.icon}</div>
            <div className="text-white font-semibold">{lt.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{lt.desc}</div>
            {(lt as any).disabled && (
              <div className="text-xs text-gray-500 mt-1">Coming Soon</div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Section C: Setup Wizard ────────────────────────────────────────────────────

function SetupWizard({
  leadType,
  plan,
  onComplete,
}: {
  leadType: string;
  plan: "manager" | "manager_pro";
  onComplete: (campaign: FBCampaign) => void;
}) {
  const { data: session } = useSession();
  const [step, setStep] = useState(0);
  const [adData, setAdData] = useState<GeneratedAd | null>(null);
  const [adCards, setAdCards] = useState<AdCard[]>([]);
  const [adLibraryUrl, setAdLibraryUrl] = useState<string>("");
  const [generatingAds, setGeneratingAds] = useState(false);
  const [loadingIntel, setLoadingIntel] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState(`${LEAD_TYPE_LABEL[leadType] ?? leadType} Campaign`);
  const [dailyBudget, setDailyBudget] = useState("20");
  const [creating, setCreating] = useState(false);

  // Sheet / Apps Script connection state
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [connectingSheet, setConnectingSheet] = useState(false);
  const [sheetMsg, setSheetMsg] = useState("");
  const [appsScriptUrl, setAppsScriptUrl] = useState("");
  const [connectingScript, setConnectingScript] = useState(false);
  const [scriptMsg, setScriptMsg] = useState("");
  const [appsScriptTemplate, setAppsScriptTemplate] = useState("");
  const [appsScriptSteps, setAppsScriptSteps] = useState<string[]>([]);
  const [headerRowText, setHeaderRowText] = useState(DEFAULT_SHEET_HEADERS.join(","));
  const [sheetHeaders, setSheetHeaders] = useState<string[]>(DEFAULT_SHEET_HEADERS);
  const [copiedScript, setCopiedScript] = useState(false);
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const [expectationsChecked, setExpectationsChecked] = useState(false);
  const [imageData, setImageData] = useState<GeneratedImages | null>(null);
  const [generatingImages, setGeneratingImages] = useState(false);
  // Full draft from generate-ad — preserved separately for imageUrl, overlayData, creativeArchetype
  const [adDraft, setAdDraft] = useState<any | null>(null);

  const userEmail = session?.user?.email ?? "";
  const webhookUrl = `https://covecrm.com/api/facebook/webhook?userEmail=${encodeURIComponent(userEmail)}`;

  const goNext = () => setStep((s) => Math.min(SETUP_STEPS.length - 1, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const generateAds = async () => {
    setGeneratingAds(true);
    try {
      const res = await fetch("/api/facebook/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          agentName: session?.user?.name ?? "Agent",
          agentState: "US",
          tone: "empathetic",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // generate-ad returns { ok, draft: { headline, primaryText, cta, targeting, ... } }
        // Normalize into the GeneratedAd shape the UI expects (headlines[], primaryTexts[])
        const draft = data?.draft || data;
        setAdDraft(draft); // store full draft for imageUrl, overlayData, creativeArchetype
        setAdData({
          headlines: draft.headline ? [draft.headline] : [],
          primaryTexts: draft.primaryText ? [draft.primaryText] : [],
          cta: draft.cta ?? "",
          targeting: {
            ageRange: draft.targeting?.recommendedAgeRange ?? `${draft.targeting?.ageMin ?? "30"}–${draft.targeting?.ageMax ?? "65"}`,
            interests: Array.isArray(draft.targeting?.interests) ? draft.targeting.interests : [],
            behaviors: [],
            incomeLevel: "",
            locations: draft.targeting?.location ?? "",
          },
        });
      }
    } finally {
      setGeneratingAds(false);
    }
  };

  const loadAdIntelligence = async () => {
    setLoadingIntel(true);
    try {
      const res = await fetch("/api/facebook/scan-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadType }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdCards(data.winningPatterns ?? data.ads ?? []);
        setAdLibraryUrl(data.adLibraryUrl ?? "");
      }
    } finally {
      setLoadingIntel(false);
    }
  };

  const loadAppsScriptTemplate = async () => {
    if (appsScriptTemplate) return;
    try {
      const res = await fetch(`/api/facebook/setup-sheet-instructions?leadType=${encodeURIComponent(leadType)}`);
      const data = await res.json();
      setAppsScriptTemplate(data.appsScriptTemplate ?? "");
      setAppsScriptSteps(data.steps ?? []);
      setSheetHeaders(data.headers ?? DEFAULT_SHEET_HEADERS);
      setHeaderRowText(data.headerRowText ?? DEFAULT_SHEET_HEADERS.join(","));
    } catch {}
  };

  const generateImages = async () => {
    setGeneratingImages(true);
    try {
      const res = await fetch("/api/ai/generate-ad-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          agentName: session?.user?.name ?? "Agent",
          agentState: "US",
        }),
      });
      const data = await res.json();
      if (res.ok) setImageData(data);
    } finally {
      setGeneratingImages(false);
    }
  };

  const createCampaign = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/facebook/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          campaignName,
          dailyBudget: Number(dailyBudget),
          plan,
        }),
      });
      const data = await res.json();
      if (res.ok && data.campaign) {
        const campaignId = data.campaign._id;
        setCreatedCampaignId(campaignId);
        if (googleSheetUrl.trim()) {
          await connectSheet(campaignId);
        }
        if (appsScriptUrl.trim()) {
          await connectAppsScript(campaignId);
        }
        onComplete(data.campaign);
      }
    } finally {
      setCreating(false);
    }
  };

  const connectSheet = async (campaignId: string) => {
    setConnectingSheet(true);
    setSheetMsg("");
    try {
      const res = await fetch("/api/facebook/connect-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, googleSheetUrl }),
      });
      const data = await res.json();
      setSheetMsg(res.ok ? "Google Sheet connected!" : data.error ?? "Failed.");
    } finally {
      setConnectingSheet(false);
    }
  };

  const connectAppsScript = async (campaignId: string) => {
    setConnectingScript(true);
    setScriptMsg("");
    try {
      const res = await fetch("/api/facebook/connect-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId, appsScriptUrl }),
      });
      const data = await res.json();
      setScriptMsg(res.ok ? "Apps Script connected!" : data.error ?? "Failed.");
    } finally {
      setConnectingScript(false);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedIdx(key);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  useEffect(() => {
    if (step === 4 && !adData) generateAds();
    if (step === 5 && adCards.length === 0) loadAdIntelligence();
    if (step === 7) loadAppsScriptTemplate();
  }, [step]);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Progress bar */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-400">
            Step {step + 1} of {SETUP_STEPS.length}
          </span>
          <span className="text-xs text-blue-400 font-medium">{SETUP_STEPS[step]}</span>
        </div>
        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${((step + 1) / SETUP_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Step content */}
      <div className="bg-[#1e293b] border border-gray-700 rounded-xl p-6 space-y-4 min-h-[300px]">

        {/* ── Step 0: What is Facebook Ads Manager? ── */}
        {step === 0 && (
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-white">What is Facebook Ads Manager?</h3>
            <p className="text-gray-300 text-sm leading-relaxed">
              Facebook Ads Manager is the platform you use to create, run, and monitor your insurance
              lead ads. When someone clicks your ad and fills out a form, their info comes directly
              into your CoveCRM — no manual work required.
            </p>
            <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 space-y-2">
              <p className="text-blue-300 text-sm font-semibold">Why Facebook Ads for Insurance?</p>
              <ul className="text-gray-300 text-sm space-y-1">
                <li>• Target people by age, income, homeowner status, and interests</li>
                <li>• Generate exclusive leads that only you receive</li>
                <li>• Start with as little as $20/day</li>
                <li>• Generate exclusive leads that only you receive</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── Step 1: Create Your Business Account ── */}
        {step === 1 && (
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-white">Create Your Business Account</h3>
            <div className="space-y-4 text-sm text-gray-300">
              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-white">Step 1: Go to Meta Business Suite</p>
                <p>
                  Visit{" "}
                  <a
                    href="https://business.facebook.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    business.facebook.com
                  </a>{" "}
                  and click &quot;Create Account&quot;.
                </p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-white">Step 2: Enter Your Business Info</p>
                <p>Use your real business name (or your name as an agent), your email, and your business address.</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-white">Step 3: Verify Your Identity</p>
                <p>Facebook may ask for ID verification. This is required to run ads and typically takes 24–48 hours.</p>
              </div>
              <div className="bg-[#0f172a] border border-gray-600 rounded-lg p-3 text-xs text-gray-400">
                💡 Tip: Use a Facebook profile that has been active for at least 6 months to avoid restrictions.
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: What to Expect — Read This First ── */}
        {step === 2 && (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">What to Expect — Read This First</h3>

            {/* Timeline */}
            <div className="space-y-4">
              {[
                {
                  icon: "🧠",
                  phase: "Month 1",
                  title: "The Learning Phase",
                  desc: "Facebook's algorithm is learning who your best leads are. You'll see leads come in but volume will be inconsistent. This is completely normal. Do NOT pause or change your ads during this phase — it resets the learning.",
                  action: "Keep your ads running. Set a daily budget you're comfortable with for 30 days straight. Log into CoveCRM daily to work the leads you do get.",
                  color: "border-blue-700",
                },
                {
                  icon: "📈",
                  phase: "Month 2",
                  title: "Finding Its Groove",
                  desc: "The algorithm now has enough data to target more precisely. Lead volume becomes more consistent. CPL starts to stabilize. This is when most agents start seeing real results.",
                  action: "Review your AI optimization recommendations. Consider increasing budget on winning ad sets. Test one new creative variation.",
                  color: "border-purple-700",
                },
                {
                  icon: "🚀",
                  phase: "Month 3+",
                  title: "Full Momentum",
                  desc: "You have a full system working. Consistent lead flow, predictable CPL, your CRM drips are working the leads automatically. This is where the ROI compounds.",
                  action: "Scale what's working. Add new lead types. Let the system run.",
                  color: "border-green-700",
                },
              ].map((p) => (
                <div key={p.phase} className={`bg-[#0f172a] border ${p.color} rounded-xl p-4 space-y-2`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{p.icon}</span>
                    <div>
                      <span className="text-xs text-gray-400 uppercase tracking-wide">{p.phase}</span>
                      <p className="text-white font-semibold">{p.title}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{p.desc}</p>
                  <div className="bg-black/20 rounded-lg px-3 py-2 text-xs text-gray-400">
                    <span className="text-gray-300 font-medium">What to do: </span>{p.action}
                  </div>
                </div>
              ))}
            </div>

            {/* Warning callout */}
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 text-sm text-yellow-200 leading-relaxed">
              ⚠️ <strong>Important:</strong> Most agents see inconsistent results in month 1. This does not mean the system is broken — it means Facebook is learning. Agents who stay consistent for 90 days see the best results. Agents who pause and restart frequently see the worst.
            </div>

            {/* Budget recommendations */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-white">Budget Recommendations by Lead Type</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700 text-xs">
                      <th className="py-2 pr-4">Lead Type</th>
                      <th className="py-2">Daily Budget Guidance</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-300 text-xs">
                    {[
                      { type: "Final Expense", guidance: "Start with $20–30/day minimum. Give it 30 days before evaluating." },
                      { type: "Mortgage Protection", guidance: "Start with $25–35/day minimum. Higher competition market." },
                      { type: "Veteran Leads", guidance: "Start with $20–25/day. Highly targeted audience, very responsive." },
                      { type: "IUL", guidance: "Start with $30–40/day. Longer sales cycle, higher commission." },
                      { type: "Trucker", guidance: "Start with $20–30/day. Niche audience, lower competition." },
                    ].map((r) => (
                      <tr key={r.type} className="border-b border-gray-800">
                        <td className="py-2 pr-4 text-white font-medium">{r.type}</td>
                        <td className="py-2 text-gray-300">{r.guidance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bottom line */}
            <div className="bg-blue-900/30 border border-blue-700 rounded-xl p-4 text-sm text-blue-200 leading-relaxed">
              The agents who win with Facebook leads treat it like planting seeds, not flipping a switch. Your CoveCRM system is working 24/7 to follow up on every lead automatically. Your job is to keep the ads funded and work the leads when they come in.
            </div>

            {/* Commitment checkbox */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={expectationsChecked}
                onChange={(e) => setExpectationsChecked(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-600 bg-gray-800 accent-blue-500 shrink-0"
              />
              <span className="text-sm text-gray-300">
                I understand that results build over 60–90 days and I&apos;m committed to the process.
              </span>
            </label>
          </div>
        )}

        {/* ── Step 3: Set Up Your Ad Account ── */}
        {step === 3 && (
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-white">Set Up Your Ad Account</h3>
            <div className="space-y-4 text-sm text-gray-300">
              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-white">In Meta Business Suite:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>
                    Go to{" "}
                    <a
                      href="https://business.facebook.com/settings"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      Business Settings → Accounts → Ad Accounts
                    </a>
                  </li>
                  <li>Click &quot;Add&quot; → &quot;Create a New Ad Account&quot;</li>
                  <li>Choose your currency (USD) and time zone</li>
                  <li>Add a payment method (credit card or PayPal)</li>
                </ol>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-white">Create a Facebook Page for Your Business</p>
                <p>
                  You need a Facebook Business Page to run lead ads. Go to{" "}
                  <a
                    href="https://www.facebook.com/pages/create"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    facebook.com/pages/create
                  </a>{" "}
                  and create a page for your agency.
                </p>
              </div>
              <div className="bg-[#0f172a] border border-gray-600 rounded-lg p-3 text-xs text-gray-400">
                💡 Tip: Set your spending limit to your daily budget × 7 to avoid unexpected charges.
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: AI-Generated Ad Copy ── */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Your AI-Generated Ad Copy</h3>
            {generatingAds ? (
              <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
                <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                Generating ad copy…
              </div>
            ) : adData ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Headlines (under 40 chars)</p>
                  <div className="space-y-2">
                    {(Array.isArray(adData?.headlines) ? adData.headlines : []).map((h, i) => (
                      <div key={i} className="flex items-center justify-between bg-[#0f172a] border border-gray-700 rounded px-3 py-2">
                        <span className="text-white text-sm">{h}</span>
                        <button
                          onClick={() => copyText(h, `h${i}`)}
                          className="text-xs text-blue-400 hover:text-blue-300 ml-3 shrink-0"
                        >
                          {copiedIdx === `h${i}` ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Primary Texts (under 125 chars)</p>
                  <div className="space-y-2">
                    {(Array.isArray(adData?.primaryTexts) ? adData.primaryTexts : []).map((t, i) => (
                      <div key={i} className="flex items-start justify-between bg-[#0f172a] border border-gray-700 rounded px-3 py-2">
                        <span className="text-white text-sm leading-relaxed">{t}</span>
                        <button
                          onClick={() => copyText(t, `t${i}`)}
                          className="text-xs text-blue-400 hover:text-blue-300 ml-3 shrink-0 mt-0.5"
                        >
                          {copiedIdx === `t${i}` ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-gray-400">Recommended CTA:</span>
                  <span className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-semibold">{adData.cta}</span>
                </div>
                {adDraft && (
                  <div className="border border-blue-800/40 bg-blue-950/30 rounded-lg p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Facebook Instant Form Setup</p>
                      <p className="text-xs text-blue-200 mt-1">
                        Copy these exact fields into your Meta Instant Form when you set up the lead form.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">leadFormQuestions</p>
                      <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-200">
                        {(adDraft.leadFormQuestions || []).map((q: string, i: number) => (
                          <li key={`${q}-${i}`}>{q}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">thankYouPageText</p>
                      <div className="bg-[#0f172a] border border-gray-700 rounded px-3 py-2 text-sm text-white">
                        {adDraft.thankYouPageText}
                      </div>
                    </div>
                  </div>
                )}
                <button
                  onClick={generateAds}
                  className="text-xs text-gray-400 hover:text-white underline"
                >
                  Regenerate
                </button>

                {/* Generated image + overlay metadata from generate-ad */}
                {adDraft && (adDraft.imageUrl || adDraft.creativeArchetype) && (
                  <div className="border-t border-gray-700 pt-4 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">Creative Layout</p>
                      {adDraft.creativeArchetype && (
                        <span className="text-xs bg-indigo-900/40 text-indigo-300 border border-indigo-700/30 px-2 py-0.5 rounded-full">
                          {String(adDraft.creativeArchetype).replace(/_/g, " ")}
                        </span>
                      )}
                      {adDraft.copySource === "ai_generated" && (
                        <span className="text-xs bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 px-2 py-0.5 rounded-full">AI Enhanced</span>
                      )}
                    </div>
                    {adDraft.imageUrl && (
                      <img src={adDraft.imageUrl} alt="Generated ad image" className="rounded-lg max-w-xs w-full object-cover" />
                    )}
                    {adDraft.imageError && (
                      <p className="text-xs text-yellow-500">Image generation failed: {adDraft.imageError}</p>
                    )}
                    {adDraft.overlayData && (
                      <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-3 space-y-2">
                        <p className="text-white text-sm font-semibold">{adDraft.overlayData.headline}</p>
                        <p className="text-gray-400 text-xs">{adDraft.overlayData.subheadline}</p>
                        {Array.isArray(adDraft.overlayData.buttonLabels) && adDraft.overlayData.buttonLabels.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {adDraft.overlayData.buttonLabels.map((label: string) => (
                              <span key={label} className="text-xs bg-indigo-700/60 text-indigo-200 px-2.5 py-1 rounded-full">{label}</span>
                            ))}
                          </div>
                        )}
                        {Array.isArray(adDraft.overlayData.benefitBullets) && adDraft.overlayData.benefitBullets.length > 0 && (
                          <ul className="space-y-0.5">
                            {adDraft.overlayData.benefitBullets.map((b: string) => (
                              <li key={b} className="text-xs text-gray-400 flex items-start gap-1"><span className="text-green-500 shrink-0">✓</span>{b}</li>
                            ))}
                          </ul>
                        )}
                        <p className="text-xs text-indigo-400 font-medium">{adDraft.overlayData.ctaStrip}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Ad Creative Recommendations */}
                <div className="border-t border-gray-700 pt-4 space-y-3">
                  <p className="text-sm font-semibold text-white">System-Provided Creative Direction</p>
                  <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-4 text-sm text-gray-300 leading-relaxed">
                    {CREATIVE_TIPS[leadType] ?? "Use authentic photos with real people. Lifestyle images consistently outperform graphic designs for insurance ads."}
                  </div>
                </div>

                {/* Ad Image Generator */}
                <div className="border-t border-gray-700 pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">System-Provided Creative Assets</p>
                      <p className="text-xs text-gray-400 mt-1">CoveCRM provides the creative asset direction for this campaign. Manual image upload is not part of the standard flow.</p>
                    </div>
                    {!imageData && (
                      <button
                        onClick={generateImages}
                        disabled={generatingImages}
                        className="bg-purple-700 hover:bg-purple-600 text-white text-xs px-4 py-1.5 rounded disabled:opacity-60"
                      >
                        {generatingImages ? "Generating…" : "✨ Generate Images"}
                      </button>
                    )}
                  </div>

                  {generatingImages && (
                    <div className="flex items-center gap-3 text-gray-400 text-sm py-4 justify-center">
                      <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
                      Generating unique images for your campaign…
                    </div>
                  )}

                  {imageData && (
                    <div className="space-y-4">
                      {/* Curated Stock Photos */}
                      {imageData.stockPhotos.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Recommended Creative Assets For This Lead Type</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {imageData.stockPhotos.map((photo: any, i: number) => (
                              <div key={i} className="bg-[#0f172a] border border-gray-700 rounded-lg overflow-hidden">
                                <img
                                  src={photo.url}
                                  alt={`Photo ${i + 1}`}
                                  className="w-full object-cover"
                                  style={{ aspectRatio: "16/9" }}
                                />
                                <div className="p-2 flex items-center justify-between">
                                  <a
                                    href={photo.unsplashLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-gray-500 hover:text-gray-300"
                                  >
                                    Photo by {photo.photographer}
                                  </a>
                                  <a
                                    href={photo.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:text-blue-300"
                                  >
                                    Download ↗
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-3 space-y-1.5">
                        <p className="text-xs text-gray-300">These are CoveCRM-provided recommended visuals for this campaign. Use them as-is or as the benchmark for the final creative you launch in Meta.</p>
                        <p className="text-xs text-blue-300">Agents should not need to go source their own images just to complete setup.</p>
                        <p className="text-xs text-gray-500">📐 {imageData.recommendedSize}</p>
                      </div>
                    </div>
                  )}

                  {!imageData && !generatingImages && (
                    <p className="text-xs text-gray-500">Click &quot;Generate Images&quot; to load CoveCRM-provided creative assets and recommendations for this campaign.</p>
                  )}
                </div>
              </div>
            ) : (
              <button onClick={generateAds} className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded text-sm">
                Generate Ad Copy
              </button>
            )}
          </div>
        )}

        {/* ── Step 5: Winning Ad Examples ── */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-xl font-bold text-white">Winning Ad Examples</h3>
                <p className="text-sm text-gray-400 mt-0.5">Proven patterns in your niche — use these as inspiration, not to copy.</p>
              </div>
              {adLibraryUrl && (
                <a
                  href={adLibraryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 bg-blue-700 hover:bg-blue-600 text-white text-xs px-4 py-2 rounded-lg font-medium"
                >
                  Browse Live Winning Ads →
                </a>
              )}
            </div>

            <div className="bg-[#0f172a] border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300 space-y-1">
              <p>🔍 <strong>How to use the Ad Library:</strong> Click "Browse Live Winning Ads" to see real ads running right now in your niche. Filter by ads running 30+ days — those are proven winners.</p>
              <p>💡 Use these patterns as inspiration, then create your own unique angle. Don't copy ads exactly.</p>
              <p>✅ <strong>No landing page needed.</strong> Facebook Lead Ads keep everything inside Facebook — the lead form IS your landing page. Removing friction = more leads.</p>
            </div>

            {loadingIntel ? (
              <div className="flex items-center gap-3 text-gray-400 py-8 justify-center">
                <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                Loading ad intelligence…
              </div>
            ) : adCards.length === 0 ? (
              <p className="text-gray-500 text-sm">No examples found yet. They&apos;ll be loaded automatically.</p>
            ) : (
              <div className="space-y-3">
                {adCards.slice(0, 5).map((ad) => (
                  <div key={ad._id} className="bg-[#0f172a] border border-gray-700 rounded-lg p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <p className="text-white font-semibold text-sm">{ad.headline}</p>
                      <StarRating rating={ad.performanceRating} />
                    </div>
                    <p className="text-gray-300 text-xs leading-relaxed">{ad.primaryText}</p>
                    {ad.targetingNotes && (
                      <p className="text-gray-500 text-xs">🎯 {ad.targetingNotes}</p>
                    )}
                    {ad.ctaButton && (
                      <p className="text-xs text-gray-500">CTA: {ad.ctaButton}</p>
                    )}
                    {(ad as any).notes && (
                      <p className="text-xs text-gray-600 italic">{(ad as any).notes}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {adLibraryUrl && (
              <div className="bg-white/5 rounded-lg p-3 text-xs text-gray-400">
                <p>Can&apos;t see enough ads? <a href={adLibraryUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">Open Facebook Ad Library →</a> and search for your niche. Look for ads that started 30+ days ago and are still running — those are your benchmarks.</p>
              </div>
            )}
          </div>
        )}

        {/* ── Step 6: Targeting Setup ── */}
        {step === 6 && (
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Targeting Setup</h3>
            {adData?.targeting ? (
              <div className="space-y-3 text-sm">
                <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 w-28 shrink-0">Age Range:</span>
                    <span className="text-white">{adData.targeting.ageRange}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-gray-400 w-28 shrink-0">Interests:</span>
                    <div className="flex flex-wrap gap-1">
                      {adData.targeting.interests.map((i) => (
                        <span key={i} className="bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded">{i}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-gray-400 w-28 shrink-0">Behaviors:</span>
                    <div className="flex flex-wrap gap-1">
                      {adData.targeting.behaviors.map((b) => (
                        <span key={b} className="bg-purple-900/50 text-purple-300 text-xs px-2 py-0.5 rounded">{b}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 w-28 shrink-0">Income:</span>
                    <span className="text-white">{adData.targeting.incomeLevel}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 w-28 shrink-0">Location:</span>
                    <span className="text-white">{adData.targeting.locations}</span>
                  </div>
                </div>
                <div className="bg-[#0f172a] border border-gray-600 rounded-lg p-3 text-xs text-gray-400">
                  <p className="text-gray-300 text-sm font-medium mb-1">Cost per lead varies based on your targeting and creative.</p>
                  Your actual results depend on your ad quality, audience size, and competition in your area.
                </div>
                <div className="bg-[#0f172a] border border-gray-600 rounded-lg p-3 text-xs text-gray-400">
                  💡 Tip: Start with a $20/day budget. After 3 days with 0 leads, adjust your targeting or creative before scaling.
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-sm">
                <p>Complete Step 4 first to generate your targeting recommendations.</p>
                <button onClick={() => setStep(4)} className="text-blue-400 underline mt-2">← Back to Ad Copy</button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 7: Connect Your Leads ── */}
        {step === 7 && (
          <div className="space-y-5">
            <h3 className="text-xl font-bold text-white">Connect Your Leads to CoveCRM</h3>
            <p className="text-sm text-gray-400">Direct Facebook to CoveCRM is the primary path. Your Google Sheet is the ownership layer and Zapier is optional backup only.</p>

            <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-blue-700 text-white text-xs font-bold px-2 py-0.5 rounded">Primary</span>
                <h4 className="font-semibold text-white">Connect Facebook directly into CoveCRM</h4>
              </div>
              <p className="text-sm text-gray-300">
                Use CoveCRM&apos;s native Facebook webhook as your primary lead path. Every lead is created in CoveCRM automatically, routed into the right CRM folder, and ready for watched drip enrollment.
              </p>
              <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-3 text-xs text-gray-300 space-y-1">
                <p>This campaign will create a CRM folder named <span className="font-mono text-blue-300">FB: {campaignName || "Campaign Name"}</span> and route all incoming leads there automatically.</p>
                <p>Google Sheets is your ownership backup. Zapier is optional backup only.</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Your CoveCRM webhook URL:</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 font-mono text-xs text-blue-300 break-all">
                    {webhookUrl}
                  </div>
                  <button
                    onClick={() => copyText(webhookUrl, "webhook")}
                    className="shrink-0 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded"
                  >
                    {copiedIdx === "webhook" ? "Copied!" : "Copy URL"}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-[#0f172a] border border-green-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="bg-green-700 text-white text-xs font-bold px-2 py-0.5 rounded">Required Setup</span>
                <h4 className="font-semibold text-white">Connect a Google Sheet you own</h4>
              </div>
              <p className="text-sm text-gray-300">
                Connect one Google Sheet you own during onboarding. Every incoming Facebook lead will also be written there automatically so you always retain an agent-owned copy of your lead data.
              </p>
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Google Sheet URL</label>
                  <input
                    value={googleSheetUrl}
                    onChange={(e) => setGoogleSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Apps Script Web App URL</label>
                  <input
                    value={appsScriptUrl}
                    onChange={(e) => setAppsScriptUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/..."
                    className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-white text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Keep the existing Apps Script approach. CoveCRM uses this URL to write each lead into your sheet automatically.</p>
                </div>
              </div>
              {appsScriptSteps.length > 0 && (
                <div className="bg-[#111827] border border-gray-700 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">Apps Script setup</p>
                    {appsScriptTemplate && (
                      <button
                        onClick={() => {
                          copyText(appsScriptTemplate, "apps-script");
                          setCopiedScript(true);
                          setTimeout(() => setCopiedScript(false), 1500);
                        }}
                        className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded"
                      >
                        {copiedScript ? "Copied!" : "Copy Apps Script"}
                      </button>
                    )}
                  </div>
                  <ol className="text-sm text-gray-300 space-y-1.5 list-decimal list-inside">
                    {appsScriptSteps.map((item, idx) => (
                      <li key={`${item}-${idx}`}>{item}</li>
                    ))}
                  </ol>
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <p className="text-xs text-gray-400 uppercase tracking-wide">Exact row 1 header</p>
                      <button
                        onClick={() => copyText(headerRowText, "header-row")}
                        className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded"
                      >
                        {copiedIdx === "header-row" ? "Copied!" : "Copy Header Row"}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">Paste this into row 1 of your blank Google Sheet.</p>
                    <textarea
                      readOnly
                      value={headerRowText}
                      rows={4}
                      className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 font-mono resize-none"
                    />
                  </div>
                </div>
              )}
              {(sheetMsg || scriptMsg) && (
                <div className="space-y-1">
                  {sheetMsg && <p className="text-xs text-green-400">{sheetMsg}</p>}
                  {scriptMsg && <p className="text-xs text-green-400">{scriptMsg}</p>}
                </div>
              )}
            </div>

            <div className="bg-[#0f172a] border border-gray-700 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="bg-gray-700 text-white text-xs font-bold px-2 py-0.5 rounded">Optional Backup</span>
                <h4 className="font-semibold text-white">Zapier backup only</h4>
              </div>
              <p className="text-sm text-gray-300">
                Zapier is not the primary integration path. Keep it only as an optional backup if you want a second webhook-style relay.
              </p>
              <ol className="text-sm text-gray-300 space-y-2 list-decimal list-inside ml-2">
                <li>Create a Zap with <strong>Facebook Lead Ads</strong> as the trigger.</li>
                <li>Use <strong>Webhooks by Zapier</strong> with the CoveCRM webhook URL above as the action.</li>
                <li>Leave direct Facebook → CoveCRM as the primary production setup.</li>
              </ol>
              <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 text-xs text-gray-400">
                Zapier remains optional backup only.
              </div>
            </div>
          </div>
        )}

        {/* ── Step 8: You're All Set! ── */}
        {step === 8 && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="text-5xl mb-3">🎉</div>
              <h3 className="text-2xl font-bold text-white">You&apos;re Almost There!</h3>
              <p className="text-gray-400 text-sm mt-2">Name your campaign and we&apos;ll set everything up.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Campaign Name</label>
                <input
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full bg-[#0f172a] border border-gray-600 rounded px-3 py-2 text-white text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  This campaign will create a CRM folder named <span className="font-mono text-blue-300">FB: {campaignName || "Campaign Name"}</span> and route all incoming leads there automatically.
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Daily Budget (USD)</label>
                <input
                  type="number"
                  min="5"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                  className="w-full bg-[#0f172a] border border-gray-600 rounded px-3 py-2 text-white text-sm"
                />
              </div>
            </div>

            <button
              onClick={createCampaign}
              disabled={creating || !campaignName}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-3 rounded-lg transition disabled:opacity-60"
            >
              {creating ? "Setting up…" : "Create My Campaign"}
            </button>
          </div>
        )}
      </div>

      {/* Nav buttons */}
      {step < SETUP_STEPS.length - 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={goBack}
            disabled={step === 0}
            className="text-gray-400 hover:text-white text-sm disabled:opacity-40"
          >
            ← Back
          </button>
          <button
            onClick={goNext}
            disabled={step === 2 && !expectationsChecked}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── AI Manager + ROI Widget ────────────────────────────────────────────────────

function AIManagerWidget({ campaigns }: { campaigns: FBCampaign[] }) {
  const [actions, setActions] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [intel, setIntel] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/facebook/daily-actions").then((r) => r.json()).catch(() => []),
      fetch("/api/facebook/recommendations").then((r) => r.json()).catch(() => []),
      fetch("/api/facebook/market-intel").then((r) => r.json()).catch(() => ({})),
    ]).then(([a, rec, mkt]) => {
      setActions(Array.isArray(a) ? a.slice(0, 3) : []);
      setRecommendations(Array.isArray(rec) ? rec.slice(0, 3) : []);
      setIntel(mkt);
      setLoading(false);
    });
  }, []);

  // Derive ROI snapshot from campaign data
  const totalLeads = campaigns.reduce((s, c) => s + (c.totalLeads || 0), 0);
  const totalSpend = campaigns.reduce((s, c) => s + (c.totalSpend || 0), 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const activeCampaigns = campaigns.filter((c) => c.status === "active" || c.status === "setup").length;

  const ACTION_COLORS: Record<string, string> = {
    scale: "text-emerald-400",
    duplicate: "text-sky-400",
    fix: "text-orange-400",
    pause: "text-rose-400",
    monitor: "text-yellow-400",
    creative_fatigue: "text-orange-300",
    optout_warning: "text-rose-300",
    targeting_warning: "text-orange-300",
    cpl_warning: "text-yellow-300",
    setup: "text-gray-400",
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* ROI Snapshot */}
      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <h2 className="text-base font-semibold text-white">ROI Snapshot</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Total Leads", value: totalLeads.toLocaleString() },
            { label: "Total Spend", value: totalSpend > 0 ? `$${totalSpend.toFixed(2)}` : "—" },
            { label: "Cost Per Lead", value: avgCpl > 0 ? `$${avgCpl.toFixed(2)}` : "—" },
            { label: "Active Campaigns", value: String(activeCampaigns) },
          ].map((s) => (
            <div key={s.label} className="bg-white/5 rounded-lg p-3">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-lg font-bold text-white">{s.value}</p>
            </div>
          ))}
        </div>
        <div className="bg-indigo-900/20 border border-indigo-700/30 rounded-lg px-3 py-2 text-xs text-indigo-300 leading-relaxed">
          System cost: <span className="font-bold">$249/mo</span>. At an average CPL of {avgCpl > 0 ? `$${avgCpl.toFixed(2)}` : "$15–$25"}, your system pays for itself with {avgCpl > 0 ? Math.ceil(249 / avgCpl) : "10–20"} leads/month.
        </div>
      </div>

      {/* AI Manager */}
      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-base">🤖</span>
          <h2 className="text-base font-semibold text-white">AI Manager</h2>
        </div>
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : (
          <div className="space-y-3">
            {actions.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Today&apos;s Actions</p>
                <ul className="space-y-1">
                  {actions.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className={`font-semibold shrink-0 ${ACTION_COLORS[a.type] ?? "text-gray-400"}`}>→</span>
                      <span className="text-gray-300"><span className="text-white font-medium">{a.campaign}:</span> {a.action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {recommendations.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Optimization</p>
                <ul className="space-y-1">
                  {recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-gray-400 leading-relaxed">
                      <span className="text-white font-medium">{r.campaign}:</span> {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intel && intel.trendingHooks && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Market Intel</p>
                <ul className="space-y-0.5">
                  {intel.trendingHooks.slice(0, 2).map((h: string) => (
                    <li key={h} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <span className="text-indigo-400 shrink-0">↗</span> {h}
                    </li>
                  ))}
                </ul>
                {intel.bestTimeOfDay && (
                  <p className="text-xs text-gray-500 mt-1">Best time to run ads: {intel.bestTimeOfDay}</p>
                )}
              </div>
            )}
            {actions.length === 0 && recommendations.length === 0 && (
              <p className="text-xs text-gray-500">No active campaigns to analyze yet. Create your first campaign to get AI recommendations.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section D: Campaign Dashboard ─────────────────────────────────────────────

function CampaignCard({
  campaign,
  onUpdate,
  onDelete,
  onSetupGuide,
}: {
  campaign: FBCampaign;
  onUpdate: () => void;
  onDelete: () => void;
  onSetupGuide: (leadType: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Update Stats inline form
  const [showStatsForm, setShowStatsForm] = useState(false);
  const [statsSpend, setStatsSpend] = useState(String(campaign.totalSpend));
  const [statsLeads, setStatsLeads] = useState(String(campaign.totalLeads));
  const [statsClicks, setStatsClicks] = useState(String(campaign.totalClicks));
  const [savingStats, setSavingStats] = useState(false);

  const daysSince = campaign.createdAt
    ? Math.floor((Date.now() - new Date(campaign.createdAt).getTime()) / 86400000)
    : 0;

  const optimize = async () => {
    setOptimizing(true);
    try {
      const res = await fetch("/api/ai/optimize-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: campaign._id,
          metrics: {
            spend: campaign.totalSpend,
            leads: campaign.totalLeads,
            clicks: campaign.totalClicks,
            cpl: campaign.cpl,
            daysSinceStart: daysSince,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOptimizeResult(data);
        setShowModal(true);
      }
    } finally {
      setOptimizing(false);
    }
  };

  const saveStats = async () => {
    setSavingStats(true);
    try {
      const spend = parseFloat(statsSpend) || 0;
      const leads = parseInt(statsLeads) || 0;
      const clicks = parseInt(statsClicks) || 0;
      const cpl = leads > 0 ? spend / leads : 0;
      await fetch(`/api/facebook/campaigns/${campaign._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalSpend: spend, totalLeads: leads, totalClicks: clicks, cpl }),
      });
      setShowStatsForm(false);
      onUpdate();
    } finally {
      setSavingStats(false);
    }
  };

  const handleCSVUpload = async (file: File) => {
    setUploading(true);
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/facebook/import-leads-csv?campaignId=${campaign._id}`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (res.ok) {
        setUploadMsg(`Imported ${data.imported} leads${data.failed > 0 ? `, ${data.failed} skipped` : ""}.`);
        onUpdate();
      } else {
        setUploadMsg(data.error || "Upload failed.");
      }
    } finally {
      setUploading(false);
    }
  };

  const toggleStatus = async () => {
    setToggling(true);
    const newStatus = campaign.status === "active" ? "paused" : "active";
    await fetch(`/api/facebook/campaigns/${campaign._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setToggling(false);
    onUpdate();
  };

  const deleteCampaign = async () => {
    if (!confirm(`Delete campaign "${campaign.campaignName}"? This cannot be undone.`)) return;
    setDeleting(true);
    await fetch(`/api/facebook/campaigns/${campaign._id}`, { method: "DELETE" });
    setDeleting(false);
    onDelete();
  };

  const statusColors: Record<string, string> = {
    setup: "bg-yellow-800 text-yellow-300",
    active: "bg-green-800 text-green-300",
    paused: "bg-gray-700 text-gray-300",
    cancelled: "bg-red-900 text-red-300",
  };

  return (
    <>
      <div className="bg-[#1e293b] border border-gray-700 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-white text-lg">{campaign.campaignName}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="bg-blue-900/50 text-blue-300 text-xs px-2 py-0.5 rounded">
                {LEAD_TYPE_LABEL[campaign.leadType] ?? campaign.leadType}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[campaign.status] ?? "bg-gray-700 text-gray-300"}`}>
                {campaign.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={() => onSetupGuide(campaign.leadType)}
              className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded"
            >
              📋 Setup Guide
            </button>
            <button
              onClick={optimize}
              disabled={optimizing}
              className="bg-purple-700 hover:bg-purple-600 text-white text-xs px-3 py-1.5 rounded disabled:opacity-60"
            >
              {optimizing ? "Analyzing…" : "🤖 AI Optimize"}
            </button>
          </div>
        </div>

        {/* Day X expectations reminder */}
        {(campaign.status === "setup" || campaign.status === "active") && daysSince <= 90 && (
          <div className="bg-blue-900/20 border border-blue-800 rounded-lg px-4 py-3 text-sm">
            <span className="text-blue-300 font-medium">
              📅 Day {daysSince} of your campaign
            </span>
            <span className="text-gray-400 ml-2">
              {daysSince <= 30
                ? "You're in the Learning Phase. Keep your ads funded and don't make changes yet. The algorithm is working."
                : daysSince <= 60
                ? "You're in the Growth Phase. Check your AI optimization recommendations this week."
                : "You're in Full Momentum. Scale what's working."}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Leads", value: campaign.totalLeads },
            { label: "Total Spend", value: `$${campaign.totalSpend.toFixed(2)}` },
            { label: "CPL", value: campaign.cpl > 0 ? `$${campaign.cpl.toFixed(2)}` : "—" },
            { label: "Clicks", value: campaign.totalClicks },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#0f172a] rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Update Stats inline form */}
        {showStatsForm && (
          <div className="bg-[#0f172a] border border-gray-700 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-white">Update Campaign Stats</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Total Spend ($)</label>
                <input
                  type="number"
                  value={statsSpend}
                  onChange={(e) => setStatsSpend(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Total Leads</label>
                <input
                  type="number"
                  value={statsLeads}
                  onChange={(e) => setStatsLeads(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Total Clicks</label>
                <input
                  type="number"
                  value={statsClicks}
                  onChange={(e) => setStatsClicks(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-white text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500">Connect Facebook Business API for automatic tracking — coming soon.</p>
            <div className="flex gap-2">
              <button
                onClick={saveStats}
                disabled={savingStats}
                className="bg-blue-600 hover:bg-blue-500 text-white text-xs px-4 py-1.5 rounded disabled:opacity-60"
              >
                {savingStats ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setShowStatsForm(false)}
                className="text-gray-400 hover:text-white text-xs px-4 py-1.5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {uploadMsg && (
          <p className="text-xs text-green-400 bg-green-900/30 border border-green-800 rounded px-3 py-2">
            {uploadMsg}
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCSVUpload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => setShowStatsForm((v) => !v)}
            className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-4 py-1.5 rounded"
          >
            📊 Update Stats
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="bg-blue-700 hover:bg-blue-600 text-white text-xs px-4 py-1.5 rounded disabled:opacity-60"
          >
            {uploading ? "Importing…" : "📤 Import Leads (CSV)"}
          </button>
          <button
            onClick={toggleStatus}
            disabled={toggling}
            className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-4 py-1.5 rounded disabled:opacity-60"
          >
            {campaign.status === "active" ? "Pause" : "Activate"}
          </button>
          <button
            onClick={deleteCampaign}
            disabled={deleting}
            className="text-red-400 hover:text-red-300 text-xs disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {/* Optimize modal */}
      {showModal && optimizeResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e293b] border border-gray-700 rounded-2xl p-6 space-y-4 max-w-md w-full">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white text-lg">AI Campaign Analysis</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white text-xl">×</button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">Recommendation:</span>
              <ActionBadge action={optimizeResult.action} />
            </div>
            <p className="text-white text-sm leading-relaxed">{optimizeResult.recommendation}</p>
            <p className="text-gray-400 text-sm leading-relaxed">{optimizeResult.reasoning}</p>
            {optimizeResult.suggestedBudgetChange != null && (
              <p className="text-blue-300 text-sm">
                Suggested budget change:{" "}
                {optimizeResult.suggestedBudgetChange > 0
                  ? `+${optimizeResult.suggestedBudgetChange}%`
                  : `${optimizeResult.suggestedBudgetChange}%`}
              </p>
            )}
            <button
              onClick={() => setShowModal(false)}
              className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Section E: Lead Feed ───────────────────────────────────────────────────────

function LeadFeed() {
  const [leads, setLeads] = useState<FBLeadEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 20;

  const fetchLeads = async (p = 1) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/facebook/leads?page=${p}&limit=${PAGE_SIZE}`);
      const data = await res.json();
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLeads(page); }, [page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sourceLabels: Record<string, string> = {
    csv: "CSV Import",
    facebook_webhook: "Webhook",
    manual_import: "Manual",
    google_sheet_sync: "Sheet Sync",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white">Lead Feed</h3>
        <span className="text-xs text-gray-400">{total.toLocaleString()} total leads</span>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading leads…</p>
      ) : leads.length === 0 ? (
        <p className="text-gray-500 text-sm">No leads yet. Connect Facebook directly to CoveCRM and add your Google Sheet to start receiving leads automatically.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700 text-xs uppercase">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Lead Type</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2">CRM</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l._id} className="border-b border-gray-800 hover:bg-[#1e293b]">
                    <td className="py-2 pr-4 text-white">
                      {l.firstName} {l.lastName}
                    </td>
                    <td className="py-2 pr-4 text-gray-300 text-xs">{l.email || "—"}</td>
                    <td className="py-2 pr-4 text-gray-300 text-xs">{l.phone || "—"}</td>
                    <td className="py-2 pr-4">
                      <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">
                        {LEAD_TYPE_LABEL[l.leadType] ?? l.leadType}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">
                      {sourceLabels[l.source] ?? l.source}
                    </td>
                    <td className="py-2 pr-4 text-gray-400 text-xs">
                      {new Date(l.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      {l.importedToCrm ? (
                        <span className="text-xs text-green-400">✓ Imported</span>
                      ) : (
                        <span className="text-xs text-yellow-400">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 items-center text-xs text-gray-400">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="hover:text-white disabled:opacity-40"
            >
              ← Prev
            </button>
            <span>Page {page} of {pages}</span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="hover:text-white disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

type ViewMode = "loading" | "hero" | "lead-type" | "setup" | "dashboard";

const FILTER_OPTIONS = [
  { id: "", label: "All" },
  { id: "final_expense", label: "Final Expense" },
  { id: "mortgage_protection", label: "Mortgage Protection" },
  { id: "veteran", label: "Veteran" },
  { id: "iul", label: "IUL" },
  { id: "trucker", label: "Trucker" },
];

export default function FacebookLeadsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [fbTab, setFbTab] = useState<"campaigns" | "generate">("campaigns");
  const [viewMode, setViewMode] = useState<ViewMode>("loading");
  const [campaigns, setCampaigns] = useState<FBCampaign[]>([]);
  const [campaignFilter, setCampaignFilter] = useState<string>("");
  const selectedPlan: "manager_pro" = "manager_pro";
  const [selectedLeadType, setSelectedLeadType] = useState<string>("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin");
    }
  }, [status, router]);

  const loadCampaigns = async () => {
    try {
      const res = await fetch("/api/facebook/campaigns");
      const data = await res.json();
      const cList: FBCampaign[] = data.campaigns ?? [];
      setCampaigns(cList);
      return cList;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      const cList = await loadCampaigns();
      setViewMode(cList.length > 0 ? "dashboard" : "hero");
    })();
  }, [status]);

  if (status !== "authenticated" || viewMode === "loading") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-gray-400">Loading…</div>
      </DashboardLayout>
    );
  }

  const handleSetupGuide = (leadType: string) => {
    setSelectedLeadType(leadType);
    setViewMode("setup");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-8 max-w-5xl">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Facebook Lead Manager</h1>
            <p className="text-gray-400 text-sm mt-0.5">Generate exclusive insurance leads from Facebook Ads</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/facebook-ads")}
              className="bg-indigo-600/80 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium border border-indigo-500/30"
            >
              Ads Manager →
            </button>
            {(
              <button
                onClick={() => {
                  setViewMode("lead-type");
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                + New Campaign
              </button>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "0" }}>
          {(["campaigns", "generate"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFbTab(t)}
              style={{
                padding: "8px 20px",
                fontSize: "14px",
                fontWeight: 500,
                color: fbTab === t ? "#fff" : "#9ca3af",
                background: "none",
                border: "none",
                borderBottom: fbTab === t ? "2px solid #6366f1" : "2px solid transparent",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
            >
              {t === "campaigns" ? "My Campaigns" : "Generate Ad"}
            </button>
          ))}
        </div>

        {fbTab === "generate" && (
          <div style={{ padding: "40px 0" }}>
            <div style={{
              background: "linear-gradient(135deg, #1e1b4b 0%, #1e293b 100%)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: "16px",
              padding: "40px",
              maxWidth: "520px",
              margin: "0 auto",
              textAlign: "center",
            }}>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>🤖</div>
              <h2 style={{ color: "#fff", fontSize: "22px", fontWeight: 700, marginBottom: "10px" }}>
                AI Ad Generator
              </h2>
              <p style={{ color: "#94a3b8", fontSize: "15px", lineHeight: "1.6", marginBottom: "28px" }}>
                Generate a complete Facebook lead ad in seconds — AI-written copy, targeting, and budget pre-filled. Review before publishing. Always starts paused.
              </p>
              <button
                onClick={() => router.push("/facebook-ads/copilot?tab=generate")}
                style={{
                  background: "#6366f1",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  padding: "14px 32px",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                Generate My Ad →
              </button>
            </div>
          </div>
        )}

        {fbTab === "campaigns" && viewMode === "hero" && (
          <div className="space-y-12">
            <HeroSection
              onGetStarted={() => {
                setViewMode("lead-type");
              }}
            />
            <div>
              <h2 className="text-center text-lg font-semibold text-white mb-6">What&apos;s Included in Your Plan</h2>
              <WhatsIncluded />
            </div>
          </div>
        )}

        {fbTab === "campaigns" && viewMode === "lead-type" && (
          <div className="space-y-4">
            <button
              onClick={() => setViewMode(campaigns.length > 0 ? "dashboard" : "hero")}
              className="text-gray-400 hover:text-white text-sm"
            >
              ← Back
            </button>
            <LeadTypeSelector
              plan={selectedPlan}
              onSelect={(lt) => {
                setSelectedLeadType(lt);
                setViewMode("setup");
              }}
            />
          </div>
        )}

        {fbTab === "campaigns" && viewMode === "setup" && (
          <div className="space-y-4">
            <button
              onClick={() => setViewMode(campaigns.length > 0 ? "dashboard" : "lead-type")}
              className="text-gray-400 hover:text-white text-sm"
            >
              ← Back
            </button>
            <SetupWizard
              leadType={selectedLeadType}
              plan={selectedPlan}
              onComplete={async () => {
                await loadCampaigns();
                setViewMode("dashboard");
              }}
            />
          </div>
        )}

        {fbTab === "campaigns" && viewMode === "dashboard" && (
          <div className="space-y-8">
            {/* AI Manager + ROI widgets */}
            <AIManagerWidget campaigns={campaigns} />

            {/* Meta Connection Card */}
            <MetaConnectPanel />

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-bold text-white">Your Campaigns</h2>
                {/* Lead type filter */}
                <div className="flex items-center gap-1 flex-wrap">
                  {FILTER_OPTIONS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setCampaignFilter(f.id)}
                      className={`text-xs px-3 py-1 rounded-full transition ${
                        campaignFilter === f.id
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {(() => {
                const filtered = campaignFilter
                  ? campaigns.filter((c) => c.leadType === campaignFilter)
                  : campaigns;
                return filtered.length === 0 ? (
                  <p className="text-gray-500 text-sm">
                    {campaignFilter ? "No campaigns match this filter." : "No campaigns yet."}
                  </p>
                ) : (
                  filtered.map((c) => (
                    <CampaignCard
                      key={c._id}
                      campaign={c}
                      onUpdate={() => loadCampaigns()}
                      onDelete={() => loadCampaigns()}
                      onSetupGuide={handleSetupGuide}
                    />
                  ))
                );
              })()}
            </div>

            <div className="border-t border-gray-700 pt-6">
              <LeadFeed />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// Admin-only: gate this page to experimental admin access
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return { notFound: true };
  return { props: {} };
};
