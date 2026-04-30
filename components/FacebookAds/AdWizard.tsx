import { useEffect, useMemo, useState } from "react";
import StateSelector from "@/components/FacebookAds/StateSelector";
import AdPreviewCard from "@/components/FacebookAds/AdPreviewCard";
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

const STEPS = ["Lead Type", "State", "Budget", "Generate", "Review & Launch"];

export default function AdWizard({ onLeadTypeChange }: { onLeadTypeChange?: (leadType: string) => void }) {
  const [step, setStep] = useState(0);
  const [mainCategory, setMainCategory] = useState("final_expense");
  const [leadType, setLeadType] = useState("final_expense");
  const [audienceSegment, setAudienceSegment] = useState("standard");
  const [campaignTypeLabel, setCampaignTypeLabel] = useState("Final Expense");
  const [states, setStates] = useState<string[]>([]);
  const [draft, setDraft] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [imageError, setImageError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any>(null);
  const [regenerateAttempts, setRegenerateAttempts] = useState(0);
  const [dailyBudget, setDailyBudget] = useState(25);
  const [selectedMetaPageId, setSelectedMetaPageId] = useState("");
  const [selectedMetaAdAccountId, setSelectedMetaAdAccountId] = useState("");

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

  const resetGeneratedAd = () => {
    setDraft(null);
    setResult(null);
    setError("");
    setImageError("");
    setRegenerateAttempts(0);
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

  const generateImageForDraft = async (nextDraft: any) => {
    setImageGenerating(true);
    setImageError("");
    try {
      const response = await fetch("/api/ai/generate-ad-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          imagePrompt: nextDraft?.imagePrompt || "",
        }),
      });
      const imageData = await response.json();
      if (!response.ok || !imageData?.imageUrl) {
        throw new Error(imageData?.error || "Image generation failed");
      }
      setDraft({
        ...nextDraft,
        imageUrl: imageData.imageUrl,
      });
    } catch {
      setDraft(nextDraft);
      setImageError("Creative image is required before launch. Retry image generation.");
    } finally {
      setImageGenerating(false);
    }
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
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.draft) throw new Error(json?.error || "Generation failed");
      setDraft(json.draft);
      if (isRegenerate) setRegenerateAttempts((count) => count + 1);
      setStep(3);
      await generateImageForDraft(json.draft);
    } catch (err: any) {
      setError(err?.message || "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const launch = async () => {
    if (!draft?.imageUrl || !states.length) return;
    setLaunching(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/facebook/publish-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType,
          audienceSegment,
          requestedLeadType: leadType,
          campaignTypeLabel,
          campaignName,
          dailyBudgetCents: Math.max(5, Math.round(dailyBudget)) * 100,
          primaryText: draft.primaryText,
          headline: draft.headline,
          description: draft.description || "",
          cta: draft.cta || "LEARN_MORE",
          imagePrompt: draft.imagePrompt || "",
          imageUrl: draft.imageUrl || "",
          creativeArchetype: draft.creativeArchetype || draft.archetype || "",
          licensedStates: states,
          stateRestrictionNoticeAccepted: true,
          borderStateBehavior: "block",
          funnelType: draft.funnelType || "lead_form",
          landingPageConfig: draft.landingPageConfig,
          benefitBullets: draft.benefitBullets,
          buttonLabels: draft.buttonLabels,
          winningFamilyId: draft.winningFamilyId,
          variationType: draft.variationType,
          uniquenessFingerprint: draft.uniquenessFingerprint,
          vendorStyleTag: draft.vendorStyleTag,
          ...(selectedMetaPageId ? { facebookPageId: selectedMetaPageId } : {}),
          ...(selectedMetaAdAccountId ? { adAccountId: selectedMetaAdAccountId } : {}),
        }),
      });
      const json = await response.json();
      if (!response.ok || json?.ok === false) throw new Error(json?.error || "Launch failed");
      setResult(json);
      setStep(4);
    } catch (err: any) {
      setError(err?.message || "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  const canContinue =
    (step === 0 && !!leadType) ||
    (step === 1 && states.length > 0) ||
    (step === 2 && dailyBudget >= 5) ||
    (step === 3 && !!draft?.imageUrl && !imageGenerating);

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

      {step === 1 && <StateSelector value={states} onChange={setStates} />}

      {step === 2 && (
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
        </div>
      )}

      {step === 3 && !draft && (
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

      {step === 3 && draft && (
        <div className="space-y-3">
          <AdPreviewCard
            draft={draft}
            selectedStates={states}
            regenerateAttempts={regenerateAttempts}
            regenerating={loading}
            onRegenerate={() => generate(true)}
          />
          {imageGenerating && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Generating ad image...
            </div>
          )}
          {imageError && !imageGenerating && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3">
              <p className="text-sm text-rose-100">{imageError}</p>
              <button
                type="button"
                onClick={() => generateImageForDraft(draft)}
                className="mt-3 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold"
              >
                Retry Image
              </button>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className={`rounded-lg p-5 border ${result ? "bg-emerald-900/30 border-emerald-700/40" : "bg-white/5 border-white/10"}`}>
          <p className="text-white font-semibold">{result ? "Campaign created in Meta, paused for review." : "Review & Launch"}</p>
          <p className="text-sm text-gray-400 mt-1">
            {result
              ? "Review and activate it in Meta Ads Manager when you are ready."
              : "This creates the Meta campaign, ad set, lead form, ad creative, CRM folder, and hosted funnel."}
          </p>
          {result?.funnelUrl && (
            <a href={result.funnelUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-300 underline">
              Open funnel
            </a>
          )}
          {!result && (
            <button
              type="button"
              onClick={launch}
              disabled={launching || !draft?.imageUrl || !states.length}
              className="mt-4 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {launching ? "Launching..." : "Launch"}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-rose-400 mt-4">{error}</p>}

      <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/10">
        <button
          type="button"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0 || launching}
          className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-gray-300 disabled:opacity-40"
        >
          Back
        </button>
        {step < 4 && step !== 2 && step !== 3 && (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            disabled={!canContinue || launching}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm text-white font-semibold disabled:opacity-50"
          >
            Continue
          </button>
        )}
        {step === 2 && (
          <button
            type="button"
            onClick={() => setStep(3)}
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
            disabled={!draft?.imageUrl || imageGenerating}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm text-white font-semibold disabled:opacity-50"
          >
            Continue to Launch
          </button>
        )}
      </div>
    </div>
  );
}
