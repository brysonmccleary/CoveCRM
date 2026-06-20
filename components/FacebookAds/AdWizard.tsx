import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import AdPreviewCard, { ProductionFeedCreative } from "@/components/FacebookAds/AdPreviewCard";
import StateSelector from "@/components/FacebookAds/StateSelector";
import { US_STATES } from "@/lib/facebook/geo/usStates";

const LEAD_TYPE_LABELS: Record<string, string> = {
  final_expense: "Final Expense",
  mortgage_protection: "Mortgage Protection",
  iul: "IUL",
  veteran: "Veteran",
  trucker: "Trucker",
};

const MAIN_CATEGORY_OPTIONS = [
  { id: "final_expense", label: "Final Expense", leadType: "final_expense", audienceSegment: "standard", needsSubType: false },
  { id: "mortgage_protection", label: "Mortgage Protection", leadType: "mortgage_protection", audienceSegment: "standard", needsSubType: false },
  { id: "iul", label: "IUL", leadType: "iul", audienceSegment: "standard", needsSubType: false },
  { id: "veteran", label: "Veteran Leads", leadType: "veteran", audienceSegment: "standard", needsSubType: true },
  { id: "trucker", label: "Trucker Leads", leadType: "trucker", audienceSegment: "standard", needsSubType: true },
] as const;

const SUBTYPE_OPTIONS: Record<string, { label: string; leadType: string; audienceSegment: string }[]> = {
  veteran: [
    { label: "General Veteran Leads", leadType: "veteran", audienceSegment: "standard" },
    { label: "Veteran Mortgage Leads", leadType: "mortgage_protection", audienceSegment: "veteran" },
    { label: "Veteran IUL Leads", leadType: "iul", audienceSegment: "veteran" },
  ],
  trucker: [
    { label: "General Trucker Leads", leadType: "trucker", audienceSegment: "standard" },
    { label: "Trucker Mortgage Leads", leadType: "mortgage_protection", audienceSegment: "trucker" },
    { label: "Trucker IUL Leads", leadType: "iul", audienceSegment: "trucker" },
  ],
};

const STEPS = ["Lead Type", "Campaign Type", "State", "Budget", "Generate", "Review & Launch"];
const VARIANT_COUNT_OPTIONS = [
  { value: 1, label: "Basic" },
  { value: 2, label: "Small Test" },
  { value: 3, label: "Recommended" },
  { value: 4, label: "Strong Test" },
];

type MetaHealth = {
  ok: boolean;
  reason: string;
  fixUrl?: string;
  status?: string;
};

export default function AdWizard({ onLeadTypeChange }: { onLeadTypeChange?: (leadType: string) => void }) {
  const [step, setStep] = useState(0);
  const [mainCategory, setMainCategory] = useState("final_expense");
  const [leadType, setLeadType] = useState("final_expense");
  const [audienceSegment, setAudienceSegment] = useState("standard");
  const [campaignType, setCampaignType] = useState<"native_form" | "hosted_funnel" | "hosted_funnel_otp">("hosted_funnel");
  const [campaignTypeLabel, setCampaignTypeLabel] = useState("Final Expense");
  const [states, setStates] = useState<string[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [regenerateAttempts, setRegenerateAttempts] = useState(0);
  const [dailyBudget, setDailyBudget] = useState(25);
  const [variantCount, setVariantCount] = useState(3);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [selectedMetaPageId, setSelectedMetaPageId] = useState("");
  const [selectedMetaAdAccountId, setSelectedMetaAdAccountId] = useState("");
  const [metaHealth, setMetaHealth] = useState<MetaHealth | null>(null);
  const [checkingMetaHealth, setCheckingMetaHealth] = useState(false);
  const creativeRef = useRef<HTMLDivElement>(null);
  const productionCreativeRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const stateLabel = useMemo(() => {
    const labels = states.map((code) => US_STATES.find((state) => state.code === code)?.name || code);
    if (labels.length === 1) return labels[0];
    if (labels.length > 1) return `${labels.length} states`;
    return "";
  }, [states]);

  const needsSubType = Boolean(MAIN_CATEGORY_OPTIONS.find((option) => option.id === mainCategory)?.needsSubType);
  const campaignName = `${campaignTypeLabel || LEAD_TYPE_LABELS[leadType] || leadType} - ${stateLabel || "Licensed States"} Campaign`;

  useEffect(() => {
    if (!leadType) return;
    onLeadTypeChange?.(leadType);
  }, [leadType, onLeadTypeChange]);

  useEffect(() => {
    if (!leadType) return;
    (async () => {
      try {
        const res = await fetch(`/api/meta/sync-insights?leadType=${encodeURIComponent(leadType)}`);
        const data = await res.json();
        if (!res.ok) return;
        setSelectedMetaPageId(String(data?.pageId || "").trim());
        setSelectedMetaAdAccountId(String(data?.adAccountId || "").trim());
      } catch {
        setSelectedMetaPageId("");
        setSelectedMetaAdAccountId("");
      }
    })();
  }, [leadType]);

  const checkMetaHealth = async () => {
    setCheckingMetaHealth(true);
    try {
      const params = new URLSearchParams();
      if (leadType) params.set("leadType", leadType);
      if (selectedMetaPageId) params.set("pageId", selectedMetaPageId);
      if (selectedMetaAdAccountId) params.set("adAccountId", selectedMetaAdAccountId);
      const response = await fetch(`/api/meta/health?${params.toString()}`);
      const json = await response.json().catch(() => ({}));
      const nextHealth = {
        ok: !!json?.ok,
        reason: String(json?.metaHealth?.reason || json?.error || "Finish Facebook setup before launching."),
        fixUrl: json?.metaHealth?.fixUrl || "",
        status: json?.metaHealth?.status || "",
      };
      setMetaHealth(nextHealth);
      return nextHealth;
    } catch {
      const nextHealth = {
        ok: false,
        reason: "Facebook setup check failed. Reconnect Facebook and try again.",
        fixUrl: "/api/meta/connect",
        status: "error",
      };
      setMetaHealth(nextHealth);
      return nextHealth;
    } finally {
      setCheckingMetaHealth(false);
    }
  };

  useEffect(() => {
    if (!leadType) return;
    checkMetaHealth();
  }, [leadType, selectedMetaPageId, selectedMetaAdAccountId]);

  const resetGeneratedAd = () => {
    setDraft(null);
    setResult(null);
    setError("");
    setImageError("");
    setRegenerateAttempts(0);
    setDrafts([]);
  };

  const selectCampaignType = (option: {
    label: string;
    leadType: string;
    audienceSegment: string;
  }) => {
    setLeadType(option.leadType);
    setAudienceSegment(option.audienceSegment);
    setCampaignTypeLabel(option.label);
    resetGeneratedAd();
  };

  const selectMainCategory = (option: (typeof MAIN_CATEGORY_OPTIONS)[number]) => {
    setMainCategory(option.id);
    if (option.needsSubType) {
      setLeadType("");
      setAudienceSegment("standard");
      setCampaignTypeLabel("");
      resetGeneratedAd();
      return;
    }
    selectCampaignType(option);
  };

  const generate = async (isRegenerate = false) => {
    if (!states.length) {
      setError("Licensed states required");
      return;
    }
    if (isRegenerate && regenerateAttempts >= 3) return;
    setLoading(true);
    setError("");
    setImageError("");
    setResult(null);
    try {
      const nextAttempt = isRegenerate ? regenerateAttempts + 1 : 0;
      const generationNonce = [
        "wizard",
        leadType,
        audienceSegment,
        String(nextAttempt),
        Date.now().toString(36),
      ].join("_");
      const response = await fetch("/api/facebook/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          audienceSegment,
          requestedLeadType: leadType,
          generationLeadType: leadType,
          campaignTypeLabel,
          licensedStates: states,
          location: stateLabel,
          mode: "wizard",
          dailyBudget,
          variantCount,
          regenerationAttempt: nextAttempt,
          generationNonce,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.draft) throw new Error(json?.error || "Generation failed");
      const nextDrafts = Array.isArray(json?.drafts) && json.drafts.length > 0 ? json.drafts : [json.draft];
      setDraft(json.draft);
      setDrafts(nextDrafts);
      if (isRegenerate) setRegenerateAttempts(nextAttempt);
      setStep(4);
    } catch (err: any) {
      setError(err?.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const continueToLaunch = async () => {
    if (!drafts.length || imageGenerating || loading) return;
    setStep(5);
  };

  const launch = async () => {
    if (!drafts.length || !states.length) return;
    setLaunching(true);
    setError("");
    setResult(null);

    try {
      const health = await checkMetaHealth();
      if (!health.ok) {
        throw new Error(health.reason);
      }

      const selectedDraft = drafts[0] || draft;

      // Capture one production 4:5 feed creative PNG for each generated draft.
      const launchDrafts = [];
      for (let index = 0; index < drafts.length; index++) {
        const currentDraft = drafts[index] || {};
        const node = productionCreativeRefs.current[index];
        if (!node) {
          setError("Ad preview capture failed. Please try again.");
          return;
        }
        let renderedCreativeDataUrl = "";
        try {
          renderedCreativeDataUrl = await toPng(node, {
            quality: 0.92,
            pixelRatio: 2,
            cacheBust: true,
          });
        } catch (captureErr) {
          console.warn("[AdWizard] CSS capture failed:", captureErr);
          setError("Ad preview capture failed. Please try again.");
          return;
        }
        if (!renderedCreativeDataUrl) {
          setError("Ad preview capture failed. Please try again.");
          return;
        }
        launchDrafts.push({
          leadType: currentDraft.leadType || leadType,
          primaryText: currentDraft.primaryText,
          headline: currentDraft.headline,
          description: currentDraft.description || "",
          cta: currentDraft.cta || "LEARN_MORE",
          renderedCreativeDataUrl,
          creativeArchetype: currentDraft.creativeArchetype || currentDraft.archetype || "",
          winningFamilyId: currentDraft.winningFamilyId,
          variationType: currentDraft.variationType,
          uniquenessFingerprint: currentDraft.uniquenessFingerprint,
          vendorStyleTag: currentDraft.vendorStyleTag,
          landingPageConfig: currentDraft.landingPageConfig,
        });
      }

      const renderedCreativeDataUrl = launchDrafts[0]?.renderedCreativeDataUrl || "";

      const response = await fetch("/api/facebook/publish-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          audienceSegment,
          campaignType,
          requestedLeadType: leadType,
          campaignTypeLabel,
          campaignName,
          dailyBudgetCents: Math.max(500, Math.round(Number(dailyBudget) * 100)),
          primaryText: selectedDraft.primaryText,
          headline: selectedDraft.headline,
          description: selectedDraft.description || "",
          cta: selectedDraft.cta || "LEARN_MORE",
          imagePrompt: "",
          imageUrl: "",
          renderedCreativeDataUrl,
          creativeArchetype: selectedDraft.creativeArchetype || selectedDraft.archetype || "",
          licensedStates: states,
          stateRestrictionNoticeAccepted: true,
          borderStateBehavior: "block",
          funnelType: selectedDraft.funnelType || "lead_form",
          winningFamilyId: selectedDraft.winningFamilyId,
          variationType: selectedDraft.variationType,
          uniquenessFingerprint: selectedDraft.uniquenessFingerprint,
          vendorStyleTag: selectedDraft.vendorStyleTag,
          landingPageConfig: selectedDraft.landingPageConfig,
          drafts: launchDrafts,
          ...(selectedMetaPageId ? { facebookPageId: selectedMetaPageId } : {}),
          ...(selectedMetaAdAccountId ? { adAccountId: selectedMetaAdAccountId } : {}),
        }),
      });
      const json = await response.json();
      if (!response.ok || json?.ok === false) {
        const metaError = String(json?.metaError || json?.details || json?.error || "");
        if (metaError.includes("1359188")) {
          throw new Error("Your Meta ad account has no payment method. Add one at business.facebook.com/billing then try again.");
        }
        throw new Error(metaError || "Launch failed");
      }
      setResult(json);
      setStep(5);
    } catch (err: any) {
      setError(err?.message || "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  const activateCampaign = async () => {
    const campaignDbId = String(result?.campaignId || "").trim();
    if (!campaignDbId) {
      setError("Campaign ID missing. Please refresh and try again.");
      return;
    }
    setActivating(true);
    setError("");
    try {
      const response = await fetch(`/api/facebook/campaigns/${campaignDbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACTIVE" }),
      });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error || "Activation failed");
      setResult((current: any) => ({ ...(current || {}), status: "active" }));
    } catch (err: any) {
      setError(err?.message || "Activation failed");
    } finally {
      setActivating(false);
    }
  };

  const canContinue =
    (step === 0 && !!leadType) ||
    (step === 1 && !!campaignType) ||
    (step === 2 && states.length > 0) ||
    (step === 3 && dailyBudget >= 5) ||
    (step === 4 && drafts.length > 0 && !imageGenerating) ||
    step === 5;

  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Launch Campaign</h2>
          <p className="text-xs text-gray-400 mt-1">Choose the basics, review the ad, then create it in Meta paused for review.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {STEPS.map((label, index) => (
            <span
              key={label}
              className={`text-[11px] px-2 py-1 rounded border ${
                index === step
                  ? "bg-emerald-600/20 text-emerald-200 border-emerald-500/40"
                  : "bg-white/5 text-gray-500 border-white/10"
              }`}
            >
              {index + 1}. {label}
            </span>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MAIN_CATEGORY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectMainCategory(option)}
                className={`text-left p-4 rounded-lg border ${
                  mainCategory === option.id
                    ? "bg-emerald-600/20 border-emerald-500/60 text-white"
                    : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
                }`}
              >
                <span className="font-semibold">{option.label}</span>
              </button>
            ))}
          </div>

          {needsSubType && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold text-white mb-3">
                {mainCategory === "veteran" ? "Choose Veteran Campaign Type" : "Choose Trucker Campaign Type"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(SUBTYPE_OPTIONS[mainCategory] || []).map((option) => {
                  const active =
                    leadType === option.leadType &&
                    audienceSegment === option.audienceSegment &&
                    campaignTypeLabel === option.label;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => selectCampaignType(option)}
                      className={`text-left p-4 rounded-lg border ${
                        active
                          ? "bg-emerald-600/20 border-emerald-500/60 text-white"
                          : "bg-[#111827] border-white/10 text-gray-300 hover:bg-white/10"
                      }`}
                    >
                      <span className="font-semibold">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-white font-semibold">How do you want to capture leads?</p>
          <p className="text-sm text-gray-400">Choose the destination where your ad sends people.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              { id: "hosted_funnel" as const, label: "Hosted Landing Page", description: "CoveCRM hosts the form. Leads go directly into your CRM." },
              { id: "hosted_funnel_otp" as const, label: "Landing Page + Phone Verify", description: "Same as above but with OTP phone verification to reduce fake leads." },
              { id: "native_form" as const, label: "Facebook Native Form", description: "Facebook hosts the form inside the ad. Higher volume, slightly lower intent." },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCampaignType(option.id)}
                className={`text-left p-4 rounded-lg border ${
                  campaignType === option.id
                    ? "bg-emerald-600/20 border-emerald-500/60 text-white"
                    : "bg-white/5 border-white/10 text-gray-300 hover:bg-white/10"
                }`}
              >
                <p className="font-semibold text-sm">{option.label}</p>
                <p className="text-xs text-gray-400 mt-1">{option.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && <StateSelector value={states} onChange={setStates} />}

	      {step === 3 && (
	        <div className="bg-white/5 border border-white/10 rounded-lg p-5">
          <p className="text-white font-semibold mb-1">Choose daily budget</p>
          <p className="text-sm text-gray-400 mb-4">
            Your ad will be created paused, so you can review it in Meta before spending starts.
          </p>
          <label className="text-xs text-gray-400 block mb-2">Daily budget</label>
          <div className="flex items-center gap-2">
            <span className="text-gray-400">$</span>
            <input
              type="number"
              min={5}
              value={dailyBudget}
              onChange={(e) => setDailyBudget(Number(e.target.value))}
              className="w-32 rounded-lg border border-white/10 bg-[#111827] px-3 py-2 text-white"
            />
            <span className="text-sm text-gray-400">per day</span>
          </div>
	          {dailyBudget < 5 && (
	            <p className="text-xs text-rose-400 mt-2">Minimum budget is $5/day.</p>
	          )}
	          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="text-white font-semibold mb-1">How many ad versions do you want to test?</p>
            <p className="text-sm text-gray-400 mb-4">
              CoveCRM launches multiple ad versions inside one campaign. Facebook may spend more on the ad people respond to best. CoveCRM tracks each version and will notify you when one looks like a winner or loser.
            </p>
	            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
	              {VARIANT_COUNT_OPTIONS.map((option) => (
	                <button
	                  key={option.value}
	                  type="button"
	                  onClick={() => setVariantCount(option.value)}
	                  className={`rounded-lg border px-4 py-3 text-left ${
	                    variantCount === option.value
	                      ? "bg-emerald-600/20 border-emerald-500/60 text-white"
	                      : "bg-[#111827] border-white/10 text-gray-300 hover:bg-white/10"
	                  }`}
	                >
	                  <div className="text-lg font-bold">{option.value}</div>
	                  <div className="text-sm">{option.label}</div>
	                </button>
	              ))}
	            </div>
	          </div>
	        </div>
	      )}

      {step === 4 && !draft && (
        <div className="bg-white/5 border border-white/10 rounded-lg p-5">
          <p className="text-white font-semibold mb-1">Ready to generate</p>
          <p className="text-sm text-gray-400 mb-4">
            CoveCRM will choose the copy, creative, funnel, targeting, campaign structure, and tracking.
          </p>
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={loading || !states.length}
            className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate Ad"}
          </button>
        </div>
      )}

	      {(step === 4 || step === 5) && draft && (
		        <div
	            className="space-y-3"
	            style={step === 5 ? { position: "absolute", left: -10000, top: 0, width: 375, pointerEvents: "none" } : undefined}
	          >
              {step === 5 && drafts.map((currentDraft, index) => (
                <div
                  key={`production-${currentDraft.uniquenessFingerprint || index}`}
                  ref={(el) => {
                    productionCreativeRefs.current[index] = el;
                  }}
                  style={{ position: "absolute", left: -12000 - index * 700, top: 0, width: 540, height: 675, pointerEvents: "none" }}
                >
                  <ProductionFeedCreative draft={currentDraft} />
                </div>
              ))}
		          <div className="flex items-center justify-between gap-3 flex-wrap">
	            <div>
              <p className="text-white font-semibold">Generated Ad Versions</p>
              <p className="text-sm text-gray-400">Review the selected test set before launch.</p>
	            </div>
	            <button
	              type="button"
	              onClick={() => generate(true)}
	              disabled={loading || imageGenerating}
	              className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm font-semibold disabled:opacity-50"
	            >
	              {loading ? "Regenerating..." : `Regenerate Set (${3 - regenerateAttempts} left)`}
	            </button>
	          </div>
	          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-4">
            {drafts.map((currentDraft, index) => (
              <div key={currentDraft.uniquenessFingerprint || index} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                <div className="p-3 flex justify-center bg-black/20">
                  <div
                    style={{ display: "inline-block", width: "100%", maxWidth: 375 }}
                  >
                    <AdPreviewCard
                      draft={currentDraft}
                      selectedStates={states}
                      regenerateAttempts={regenerateAttempts}
                      regenerating={loading}
                      onRegenerate={() => generate(true)}
                      creativeRef={index === 0 ? creativeRef : undefined}
                    />
                  </div>
                </div>
                <div className="p-4 space-y-3">
	                  <div className="flex items-center justify-between gap-2">
	                    <p className="text-sm font-semibold text-white">Ad {index + 1}</p>
	                    <span className="px-2 py-1 rounded bg-emerald-600/20 text-emerald-200 border border-emerald-500/30 text-[11px] uppercase">
	                      {currentDraft?.variationType || "variant"}
	                    </span>
	                  </div>
	                  <div className="flex flex-wrap gap-2 text-[11px] text-gray-300">
	                    <span className="px-2 py-1 rounded bg-white/5 border border-white/10">
	                      {currentDraft?.creativeArchetype || currentDraft?.vendorStyleTag || "style"}
	                    </span>
	                    <span className="px-2 py-1 rounded bg-white/5 border border-white/10">
	                      {LEAD_TYPE_LABELS[currentDraft?.leadType || leadType] || currentDraft?.leadType || leadType}
	                    </span>
	                  </div>
	                  <div>
	                    <p className="text-xs uppercase text-gray-500 font-semibold">Headline</p>
	                    <p className="text-base text-white font-semibold">{currentDraft?.headline}</p>
	                  </div>
	                  <div>
	                    <p className="text-xs uppercase text-gray-500 font-semibold">Primary Text</p>
	                    <p className="text-sm text-gray-100 whitespace-pre-line line-clamp-6">{currentDraft?.primaryText}</p>
	                  </div>
	                  <div className="flex flex-wrap gap-2 text-xs">
	                    <span className="px-2 py-1 rounded bg-blue-600/20 text-blue-200 border border-blue-500/30">
	                      {currentDraft?.cta || "LEARN_MORE"}
	                    </span>
	                  </div>
	                  <div className="text-[11px] text-gray-500 space-y-1">
	                    {currentDraft?.winningFamilyId && <p>Family: {currentDraft.winningFamilyId}</p>}
	                    {currentDraft?.vendorStyleTag && <p>Style: {currentDraft.vendorStyleTag}</p>}
	                    {currentDraft?.uniquenessFingerprint && <p className="truncate">Variant: {currentDraft.uniquenessFingerprint}</p>}
	                  </div>
	                </div>
	              </div>
	            ))}
	          </div>
          {imageGenerating && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Generating ad images...
            </div>
          )}
          {imageError && !imageGenerating && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3">
              <p className="text-sm text-rose-100">{imageError}</p>
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className={`rounded-lg p-5 border ${result ? "bg-emerald-900/30 border-emerald-700/40" : "bg-white/5 border-white/10"}`}>
          <p className="text-white font-semibold">{result ? "Campaign Created Successfully" : "Review & Launch"}</p>
          <p className="text-sm text-gray-400 mt-1">
            {result
              ? "Your campaign is paused. Activate it when you're ready."
              : "This creates the Meta campaign, ad set, Instant Form, ad creative, and CRM folder."}
          </p>
          {!result && metaHealth && !metaHealth.ok && (
            <div className="mt-4 rounded-lg border border-yellow-700/40 bg-yellow-950/20 p-4">
              <p className="text-sm font-semibold text-yellow-100">Finish Facebook setup before launching</p>
              <p className="text-xs text-yellow-100/80 mt-1">{metaHealth.reason}</p>
              {metaHealth.fixUrl && (
                <a
                  href={metaHealth.fixUrl}
                  target={metaHealth.fixUrl.startsWith("http") ? "_blank" : undefined}
                  rel={metaHealth.fixUrl.startsWith("http") ? "noreferrer" : undefined}
                  className="inline-block mt-3 text-xs text-yellow-50 underline"
                >
                  {metaHealth.status === "missingPaymentMethod"
                    ? "Add payment method in Facebook"
                    : metaHealth.status === "missingLeadAdsEligibility"
                      ? "Accept Lead Ads Terms"
                      : metaHealth.status === "missingPage"
                        ? "Create or choose a Facebook Page"
                        : metaHealth.status === "missingAdAccount"
                          ? "Select Ad Account"
                          : "Reconnect Facebook"}
                </a>
              )}
            </div>
          )}
          {result?.campaignId && (
            <p className="text-xs text-gray-500 mt-2">Campaign ID: {result.campaignId}</p>
          )}
          {result ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={activateCampaign}
                disabled={activating || result?.status === "active"}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {activating ? "Activating..." : result?.status === "active" ? "Campaign Active" : "Activate Campaign"}
              </button>
              <button
                type="button"
                className="px-5 py-2.5 rounded-lg bg-white/10 text-gray-200 text-sm font-semibold cursor-default"
              >
                Keep Paused
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={launch}
              disabled={launching || checkingMetaHealth || !metaHealth?.ok || !drafts.length || !states.length || imageGenerating}
              className="mt-4 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {launching ? "Launching..." : checkingMetaHealth ? "Checking Facebook..." : "Launch"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-400 mt-4">
          {error.includes("business.facebook.com/billing") ? (
            <>
              Your Meta ad account has no payment method. Add one at{" "}
              <a href="https://business.facebook.com/billing" target="_blank" rel="noopener noreferrer" className="underline text-rose-300">
                business.facebook.com/billing
              </a>{" "}
              then try again.
            </>
          ) : (
            error
          )}
        </p>
      )}

      <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/10">
        <button
          type="button"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0 || launching}
          className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 disabled:opacity-40"
        >
          Back
        </button>
        {step < 5 && step !== 3 && step !== 4 && (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            disabled={!canContinue || launching}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm text-white font-semibold disabled:opacity-50"
          >
            Continue
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={() => setStep(4)}
            disabled={!canContinue || launching}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm text-white font-semibold disabled:opacity-50"
          >
            Continue
          </button>
        )}
	        {step === 4 && (
	          <button
	            type="button"
            onClick={continueToLaunch}
            disabled={!drafts.length || imageGenerating || loading}
	            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm text-white font-semibold disabled:opacity-50"
	          >
            Continue to Launch
          </button>
        )}
      </div>
    </div>
  );
}
