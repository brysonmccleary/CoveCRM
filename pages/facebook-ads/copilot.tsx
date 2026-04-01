// pages/facebook-ads/copilot.tsx
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import DashboardLayout from "@/components/DashboardLayout";
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

const LEAD_TYPES = [
  { value: "mortgage_protection", label: "Mortgage Protection" },
  { value: "final_expense", label: "Final Expense" },
  { value: "iul", label: "IUL / Cash Value" },
  { value: "veteran", label: "Veteran Leads" },
  { value: "trucker", label: "Trucker Leads" },
];

const GEN_LEAD_TYPES = [
  { value: "final_expense", label: "Final Expense" },
  { value: "mortgage_protection", label: "Mortgage Protection" },
  { value: "iul", label: "IUL / Cash Value" },
  { value: "veteran", label: "Veteran Leads" },
  { value: "medicare", label: "Medicare" },
  { value: "annuity", label: "Annuity" },
];

const PERIOD_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const CTA_OPTIONS = [
  { value: "GET_QUOTE", label: "Get Quote" },
  { value: "LEARN_MORE", label: "Learn More" },
  { value: "SIGN_UP", label: "Sign Up" },
  { value: "CONTACT_US", label: "Contact Us" },
];

interface ScoredAd {
  id: string;
  pageName: string;
  body: string;
  title: string;
  description: string;
  snapshotUrl: string;
  daysRunning: number;
  hasVideo: boolean;
  score: number;
  spendRange: string;
  impressionRange: string;
}

interface AdAnalysis {
  hook: string;
  whyItWorks: string;
  emotionalTrigger: string;
  targetAudience: string;
  rewrittenCopy: string;
  imagePrompt: string;
  videoScript: string;
  recreationSteps: string[];
  targetingRecommendations: {
    ageRange: string;
    interests: string[];
    excludedAudiences: string[];
    customAudienceTip: string;
  };
  budgetGuidance: string;
}

interface CampaignPerf {
  id: string;
  campaignName: string;
  leadType: string;
  status: string;
  dailyBudget: number;
  totalSpend: number;
  totalLeads: number;
  cpl: number;
  period: {
    days: number;
    spend: number;
    leads: number;
    clicks: number;
    impressions: number;
    cpl: number;
    ctr: number;
  };
}

interface PerfSummary {
  totalSpend: number;
  totalLeads: number;
  avgCpl: number;
  days: number;
}

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#0a0f1e",
    color: "#e2e8f0",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    padding: "32px 24px",
    maxWidth: "1200px",
    margin: "0 auto",
  } as React.CSSProperties,
  heading: {
    fontSize: "26px",
    fontWeight: 700,
    color: "#f8fafc",
    marginBottom: "4px",
  } as React.CSSProperties,
  subheading: {
    fontSize: "14px",
    color: "#64748b",
    marginBottom: "28px",
  } as React.CSSProperties,
  tabs: {
    display: "flex",
    gap: "4px",
    borderBottom: "1px solid #1e293b",
    marginBottom: "28px",
    flexWrap: "wrap" as const,
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    padding: "10px 20px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    border: "none",
    background: "none",
    color: active ? "#60a5fa" : "#64748b",
    borderBottom: active ? "2px solid #60a5fa" : "2px solid transparent",
    marginBottom: "-1px",
    transition: "color 0.15s",
  }),
  card: {
    backgroundColor: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "10px",
    padding: "18px 20px",
    marginBottom: "14px",
  } as React.CSSProperties,
  adCard: (selected: boolean): React.CSSProperties => ({
    backgroundColor: selected ? "#0c1a2e" : "#0f172a",
    border: `1px solid ${selected ? "#3b82f6" : "#1e293b"}`,
    borderRadius: "10px",
    padding: "16px 18px",
    marginBottom: "10px",
    cursor: "pointer",
    transition: "border-color 0.15s",
  }),
  label: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: "6px",
  } as React.CSSProperties,
  fieldLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: "#64748b",
    display: "block",
    marginBottom: "6px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  } as React.CSSProperties,
  select: {
    backgroundColor: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#e2e8f0",
    padding: "8px 12px",
    fontSize: "14px",
    cursor: "pointer",
  } as React.CSSProperties,
  input: {
    backgroundColor: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#e2e8f0",
    padding: "8px 12px",
    fontSize: "14px",
    width: "100%",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,
  textarea: {
    backgroundColor: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#e2e8f0",
    padding: "10px 12px",
    fontSize: "14px",
    width: "100%",
    boxSizing: "border-box" as const,
    resize: "vertical" as const,
    minHeight: "120px",
    lineHeight: "1.6",
  } as React.CSSProperties,
  btn: (variant: "primary" | "ghost" = "primary"): React.CSSProperties => ({
    padding: "9px 18px",
    borderRadius: "6px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    backgroundColor: variant === "primary" ? "#3b82f6" : "transparent",
    color: variant === "primary" ? "#fff" : "#60a5fa",
    border: variant === "ghost" ? "1px solid #334155" : "none",
  }),
  badge: (color: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 600,
    backgroundColor: `${color}22`,
    color,
    marginLeft: "6px",
  }),
  analysisBlock: {
    backgroundColor: "#070d1a",
    border: "1px solid #1e293b",
    borderRadius: "8px",
    padding: "16px 18px",
    marginBottom: "12px",
  } as React.CSSProperties,
  blockTitle: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#60a5fa",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: "8px",
  } as React.CSSProperties,
  blockBody: {
    fontSize: "14px",
    color: "#cbd5e1",
    lineHeight: "1.65",
    whiteSpace: "pre-wrap" as const,
  } as React.CSSProperties,
  metric: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    padding: "16px 20px",
    backgroundColor: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "8px",
  } as React.CSSProperties,
  fieldGroup: {
    marginBottom: "18px",
  } as React.CSSProperties,
};

export default function AdsCopilorPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<"find" | "generate" | "performance">("find");

  // ── Find Ads tab ──
  const [leadType, setLeadType] = useState("mortgage_protection");
  const [ads, setAds] = useState<ScoredAd[]>([]);
  const [loadingAds, setLoadingAds] = useState(false);
  const [adsError, setAdsError] = useState("");
  const [selectedAd, setSelectedAd] = useState<ScoredAd | null>(null);
  const [analysis, setAnalysis] = useState<AdAnalysis | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  // ── Performance tab ──
  const [perfDays, setPerfDays] = useState(30);
  const [perfData, setPerfData] = useState<CampaignPerf[]>([]);
  const [perfSummary, setPerfSummary] = useState<PerfSummary | null>(null);
  const [loadingPerf, setLoadingPerf] = useState(false);
  const [perfError, setPerfError] = useState("");

  // ── Generate Ad tab ──
  const [genStep, setGenStep] = useState<"form" | "review" | "publishing" | "done">("form");
  const [genLeadType, setGenLeadType] = useState("final_expense");
  const [genLocation, setGenLocation] = useState("United States");
  const [genBudget, setGenBudget] = useState(20);
  const [genGender, setGenGender] = useState(0);
  const [genAgeMin, setGenAgeMin] = useState(30);
  const [genAgeMax, setGenAgeMax] = useState(64);
  const [adDraft, setAdDraft] = useState<any>(null);
  const [campaignRecordId, setCampaignRecordId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<any>(null);
  const [metaConnected, setMetaConnected] = useState(false);
  const [genError, setGenError] = useState("");

  // Check Meta connection on mount
  useEffect(() => {
    fetch("/api/meta/status")
      .then((r) => r.json())
      .then((d) => setMetaConnected(!!d.connected))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "performance") {
      fetchPerformance();
    }
  }, [tab, perfDays]);

  const fetchAds = async () => {
    setLoadingAds(true);
    setAdsError("");
    setAds([]);
    setSelectedAd(null);
    setAnalysis(null);
    try {
      const r = await fetch(`/api/facebook/ads-library?leadType=${leadType}`);
      const data = await r.json();
      if (!r.ok) {
        setAdsError(data.error || "Failed to fetch ads");
        return;
      }
      setAds(data.ads || []);
    } catch {
      setAdsError("Network error. Please try again.");
    } finally {
      setLoadingAds(false);
    }
  };

  const analyzeAd = async (ad: ScoredAd) => {
    setSelectedAd(ad);
    setAnalysis(null);
    setAnalysisError("");
    setLoadingAnalysis(true);
    try {
      const r = await fetch("/api/facebook/analyze-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adBody: ad.body,
          adTitle: ad.title,
          adDescription: ad.description,
          pageName: ad.pageName,
          daysRunning: ad.daysRunning,
          leadType,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setAnalysisError(data.error || "Failed to analyze");
        return;
      }
      setAnalysis(data.analysis);
    } catch {
      setAnalysisError("Network error. Please try again.");
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const fetchPerformance = async () => {
    setLoadingPerf(true);
    setPerfError("");
    try {
      const r = await fetch(`/api/facebook/ad-performance?days=${perfDays}`);
      const data = await r.json();
      if (!r.ok) {
        setPerfError(data.error || "Failed to load performance");
        return;
      }
      setPerfData(data.campaigns || []);
      setPerfSummary(data.summary || null);
    } catch {
      setPerfError("Network error. Please try again.");
    } finally {
      setLoadingPerf(false);
    }
  };

  const generateAd = async () => {
    setGenerating(true);
    setGenError("");
    try {
      const res = await fetch("/api/facebook/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadType: genLeadType,
          location: genLocation,
          dailyBudget: genBudget,
          gender: genGender,
          ageMin: genAgeMin,
          ageMax: genAgeMax,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.notConnected) {
          setGenError("Please connect your Facebook account first.");
          setMetaConnected(false);
        } else if (data.noLeadForms) {
          setGenError(data.error || "No active Facebook lead forms found. Create one in Meta first.");
        } else {
          setGenError(data.error || "Generation failed");
        }
        return;
      }
      setAdDraft(data.draft);
      setGenStep("review");
    } catch {
      setGenError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const publishAd = async () => {
    setPublishing(true);
    setGenError("");
    try {
      if (!adDraft?.selectedLeadFormId) {
        setGenError("Please select a Facebook lead form before publishing.");
        return;
      }

      let campaignId = campaignRecordId;

      if (!campaignId) {
        const createRes = await fetch("/api/facebook/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadType: adDraft.leadType,
            campaignName: adDraft.campaignName,
            dailyBudget: Math.round((adDraft.dailyBudgetCents || 2000) / 100),
            plan: "manager",
          }),
        });

        const createData = await createRes.json();

        if (!createRes.ok || !createData?.campaign?._id) {
          setGenError(createData?.error || "Failed to create campaign record before publish.");
          return;
        }

        campaignId = createData.campaign._id;
        setCampaignRecordId(campaignId);
      }

      const res = await fetch("/api/facebook/publish-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: adDraft, campaignId }),
      });

      const data = await res.json();

      if (res.ok) {
        setPublishResult(data);
        setGenStep("done");
      } else {
        setGenError(data.error || "Publish failed");
      }
    } catch {
      setGenError("Network error during publish.");
    } finally {
      setPublishing(false);
    }
  };

  const resetGenerate = () => {
    setGenStep("form");
    setAdDraft(null);
    setCampaignRecordId(null);
    setPublishResult(null);
    setGenError("");
  };

  return (
    <DashboardLayout>
      <div style={styles.page}>
        <h1 style={styles.heading}>Ads Copilot</h1>
        <p style={styles.subheading}>
          Find winning competitor ads, generate your own, and analyze campaign performance.
        </p>

        <div style={styles.tabs}>
          <button style={styles.tab(tab === "find")} onClick={() => setTab("find")}>
            Find Winning Ads
          </button>
          <button style={styles.tab(tab === "generate")} onClick={() => setTab("generate")}>
            Generate Ad
          </button>
          <button style={styles.tab(tab === "performance")} onClick={() => setTab("performance")}>
            My Performance
          </button>
        </div>

        {/* ── FIND ADS TAB ── */}
        {tab === "find" && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
              <div>
                <p style={styles.label}>Lead Type</p>
                <select
                  value={leadType}
                  onChange={(e) => setLeadType(e.target.value)}
                  style={styles.select}
                >
                  {LEAD_TYPES.map((lt) => (
                    <option key={lt.value} value={lt.value}>{lt.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={fetchAds}
                disabled={loadingAds}
                style={{ ...styles.btn("primary"), opacity: loadingAds ? 0.6 : 1 }}
              >
                {loadingAds ? "Searching..." : "Find Ads"}
              </button>
            </div>

            {adsError && (
              <div style={{ color: "#f87171", fontSize: "14px", marginBottom: "16px" }}>
                {adsError}
              </div>
            )}

            {ads.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: selectedAd ? "1fr 1fr" : "1fr", gap: "20px" }}>
                <div>
                  <p style={{ ...styles.label, marginBottom: "12px" }}>
                    {ads.length} Winning Ads Found — sorted by performance score
                  </p>
                  {ads.map((ad) => (
                    <div
                      key={ad.id}
                      style={styles.adCard(selectedAd?.id === ad.id)}
                      onClick={() => analyzeAd(ad)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9" }}>
                          {ad.pageName}
                        </span>
                        <span style={{ fontSize: "12px", color: "#94a3b8", flexShrink: 0, marginLeft: "8px" }}>
                          Score: <strong style={{ color: "#60a5fa" }}>{ad.score}</strong>
                        </span>
                      </div>
                      {ad.title && (
                        <p style={{ fontSize: "13px", color: "#60a5fa", fontWeight: 600, marginBottom: "4px" }}>
                          {ad.title}
                        </p>
                      )}
                      <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 8px", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {ad.body || "(no body text)"}
                      </p>
                      <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "#475569", flexWrap: "wrap" }}>
                        <span>{ad.daysRunning}d running</span>
                        {ad.hasVideo && <span style={{ color: "#a78bfa" }}>Video</span>}
                        <span>Spend: {ad.spendRange}</span>
                        <span>Impressions: {ad.impressionRange}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {selectedAd && (
                  <div style={{ position: "sticky", top: "20px", alignSelf: "flex-start" }}>
                    <p style={{ ...styles.label, marginBottom: "12px" }}>
                      AI Analysis — {selectedAd.pageName}
                    </p>

                    {loadingAnalysis && (
                      <div style={{ ...styles.card, color: "#64748b", fontSize: "14px" }}>
                        Analyzing with GPT-4o…
                      </div>
                    )}

                    {analysisError && (
                      <div style={{ color: "#f87171", fontSize: "14px", marginBottom: "12px" }}>
                        {analysisError}
                      </div>
                    )}

                    {analysis && !loadingAnalysis && (
                      <div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Hook</p>
                          <p style={styles.blockBody}>{analysis.hook}</p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Why It Works</p>
                          <p style={styles.blockBody}>{analysis.whyItWorks}</p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Emotional Trigger</p>
                          <p style={styles.blockBody}>{analysis.emotionalTrigger}</p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Rewritten Copy</p>
                          <p style={styles.blockBody}>{analysis.rewrittenCopy}</p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Video Script</p>
                          <p style={styles.blockBody}>{analysis.videoScript}</p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Recreation Steps</p>
                          <ol style={{ margin: 0, paddingLeft: "18px" }}>
                            {(analysis.recreationSteps || []).map((step, i) => (
                              <li key={i} style={{ ...styles.blockBody, marginBottom: "4px" }}>{step}</li>
                            ))}
                          </ol>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Targeting</p>
                          <p style={{ ...styles.blockBody, marginBottom: "6px" }}>
                            <strong style={{ color: "#94a3b8" }}>Age:</strong> {analysis.targetingRecommendations?.ageRange}
                          </p>
                          <p style={{ ...styles.blockBody, marginBottom: "6px" }}>
                            <strong style={{ color: "#94a3b8" }}>Interests:</strong>{" "}
                            {(analysis.targetingRecommendations?.interests || []).join(", ")}
                          </p>
                          <p style={styles.blockBody}>
                            {analysis.targetingRecommendations?.customAudienceTip}
                          </p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Budget Guidance</p>
                          <p style={styles.blockBody}>{analysis.budgetGuidance}</p>
                        </div>
                        <div style={styles.analysisBlock}>
                          <p style={styles.blockTitle}>Image Prompt</p>
                          <p style={{ ...styles.blockBody, fontFamily: "monospace", fontSize: "12px", color: "#a78bfa" }}>
                            {analysis.imagePrompt}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!loadingAds && ads.length === 0 && !adsError && (
              <div style={{ ...styles.card, color: "#475569", fontSize: "14px", textAlign: "center", padding: "40px" }}>
                Select a lead type and click "Find Ads" to see winning competitor ads.
              </div>
            )}
          </div>
        )}

        {/* ── GENERATE AD TAB ── */}
        {tab === "generate" && (
          <div style={{ maxWidth: "640px" }}>

            {/* FORM STEP */}
            {genStep === "form" && (
              <div>
                {/* Meta connection banner */}
                {!metaConnected && (
                  <div style={{ backgroundColor: "#1e3a5f", border: "1px solid #3b82f6", borderRadius: "8px", padding: "14px 16px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "14px", color: "#93c5fd" }}>
                      Connect your Facebook account to generate and publish ads.
                    </span>
                    <a
                      href="/api/meta/connect"
                      style={{ backgroundColor: "#3b82f6", color: "#fff", padding: "8px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      Connect Facebook
                    </a>
                  </div>
                )}

                {metaConnected && (
                  <div style={{ backgroundColor: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "8px", padding: "10px 14px", marginBottom: "20px" }}>
                    <span style={{ fontSize: "13px", color: "#4ade80" }}>✓ Facebook account connected</span>
                  </div>
                )}

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Lead Type</label>
                  <select
                    value={genLeadType}
                    onChange={(e) => setGenLeadType(e.target.value)}
                    style={{ ...styles.select, width: "100%" }}
                  >
                    {GEN_LEAD_TYPES.map((lt) => (
                      <option key={lt.value} value={lt.value}>{lt.label}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Target Location</label>
                  <input
                    type="text"
                    value={genLocation}
                    onChange={(e) => setGenLocation(e.target.value)}
                    placeholder="e.g. Florida, Texas, United States"
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Daily Budget</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px", color: "#64748b" }}>$</span>
                    <input
                      type="number"
                      value={genBudget}
                      min={5}
                      onChange={(e) => setGenBudget(Number(e.target.value))}
                      style={{ ...styles.input, width: "120px" }}
                    />
                    <span style={{ fontSize: "13px", color: "#475569" }}>/ day</span>
                  </div>
                </div>

                <div style={{ ...styles.fieldGroup, display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "120px" }}>
                    <label style={styles.fieldLabel}>Age Min</label>
                    <input
                      type="number"
                      value={genAgeMin}
                      min={18}
                      max={65}
                      onChange={(e) => setGenAgeMin(Number(e.target.value))}
                      style={styles.input}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "120px" }}>
                    <label style={styles.fieldLabel}>Age Max</label>
                    <input
                      type="number"
                      value={genAgeMax}
                      min={18}
                      max={65}
                      onChange={(e) => setGenAgeMax(Number(e.target.value))}
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Gender</label>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {[{ v: 0, l: "All" }, { v: 1, l: "Male" }, { v: 2, l: "Female" }].map(({ v, l }) => (
                      <button
                        key={v}
                        onClick={() => setGenGender(v)}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "6px",
                          fontSize: "13px",
                          fontWeight: 500,
                          cursor: "pointer",
                          border: genGender === v ? "1px solid #3b82f6" : "1px solid #334155",
                          backgroundColor: genGender === v ? "#1e3a5f" : "#0f172a",
                          color: genGender === v ? "#60a5fa" : "#94a3b8",
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                {genError && (
                  <div style={{ color: "#f87171", fontSize: "14px", marginBottom: "16px" }}>
                    {genError}
                  </div>
                )}

                <button
                  onClick={generateAd}
                  disabled={generating}
                  style={{
                    backgroundColor: generating ? "#1e3a5f" : "#3b82f6",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "12px 28px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: generating ? "not-allowed" : "pointer",
                    opacity: generating ? 0.7 : 1,
                    width: "100%",
                  }}
                >
                  {generating ? "Generating with GPT-4o…" : "Generate Ad"}
                </button>
              </div>
            )}

            {/* REVIEW STEP */}
            {genStep === "review" && adDraft && (
              <div>
                <p style={{ ...styles.label, marginBottom: "20px" }}>Review & Edit Your Ad Draft</p>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Headline</label>
                  <input
                    type="text"
                    value={adDraft.headline || ""}
                    onChange={(e) => setAdDraft({ ...adDraft, headline: e.target.value })}
                    style={styles.input}
                  />
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Body Copy</label>
                  <textarea
                    value={adDraft.body || ""}
                    onChange={(e) => setAdDraft({ ...adDraft, body: e.target.value })}
                    style={styles.textarea}
                  />
                </div>

                <div style={{ ...styles.fieldGroup, display: "flex", gap: "16px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: "160px" }}>
                    <label style={styles.fieldLabel}>Daily Budget ($)</label>
                    <input
                      type="number"
                      value={Math.round((adDraft.dailyBudgetCents || 2000) / 100)}
                      min={5}
                      onChange={(e) => setAdDraft({ ...adDraft, dailyBudgetCents: Number(e.target.value) * 100 })}
                      style={styles.input}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "160px" }}>
                    <label style={styles.fieldLabel}>Location</label>
                    <input
                      type="text"
                      value={adDraft.location || ""}
                      onChange={(e) => setAdDraft({ ...adDraft, location: e.target.value })}
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Call to Action</label>
                  <select
                    value={adDraft.cta || "GET_QUOTE"}
                    onChange={(e) => setAdDraft({ ...adDraft, cta: e.target.value })}
                    style={{ ...styles.select, width: "100%" }}
                  >
                    {CTA_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Lead Form</label>
                  {adDraft.leadForms?.length > 0 ? (
                    <select
                      value={adDraft.selectedLeadFormId || ""}
                      onChange={(e) => setAdDraft({ ...adDraft, selectedLeadFormId: e.target.value })}
                      style={{ ...styles.select, width: "100%" }}
                    >
                      <option value="">— None —</option>
                      {adDraft.leadForms.map((f: any) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ backgroundColor: "#0f172a", border: "1px solid #334155", borderRadius: "6px", padding: "10px 12px", fontSize: "13px", color: "#475569" }}>
                      No active lead forms found.{" "}
                      <a
                        href="https://www.facebook.com/ads/leadgen/form_builder/legacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "#60a5fa" }}
                      >
                        Create one in Meta →
                      </a>
                    </div>
                  )}
                </div>

                <div style={styles.fieldGroup}>
                  <label style={styles.fieldLabel}>Image (optional)</label>
                  <div style={{ backgroundColor: "#0f172a", border: "1px dashed #334155", borderRadius: "6px", padding: "20px", textAlign: "center", color: "#475569", fontSize: "13px" }}>
                    Upload image — 1200×628px recommended
                    <br />
                    <span style={{ fontSize: "12px" }}>Image upload coming soon. Ad will use page profile image if none provided.</span>
                  </div>
                </div>

                {/* Paused notice */}
                <div style={{ backgroundColor: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: "8px", padding: "12px 14px", marginBottom: "20px" }}>
                  <p style={{ fontSize: "13px", color: "#fbbf24", margin: 0 }}>
                    ⚠️ Ad will be created in <strong>PAUSED</strong> status. Review in Meta Ads Manager before going live.
                  </p>
                </div>

                {genError && (
                  <div style={{ color: "#f87171", fontSize: "14px", marginBottom: "16px" }}>
                    {genError}
                  </div>
                )}

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <button
                    onClick={() => { setGenStep("form"); setGenError(""); }}
                    style={{ padding: "11px 22px", borderRadius: "8px", fontSize: "14px", fontWeight: 500, cursor: "pointer", border: "1px solid #334155", backgroundColor: "transparent", color: "#94a3b8" }}
                  >
                    ← Back
                  </button>
                  <button
                    onClick={publishAd}
                    disabled={publishing}
                    style={{
                      flex: 1,
                      backgroundColor: publishing ? "#1e3a5f" : "#3b82f6",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "11px 22px",
                      fontSize: "14px",
                      fontWeight: 600,
                      cursor: publishing ? "not-allowed" : "pointer",
                      opacity: publishing ? 0.7 : 1,
                    }}
                  >
                    {publishing ? "Publishing to Meta…" : "Publish Ad (Paused)"}
                  </button>
                </div>
              </div>
            )}

            {/* DONE STEP */}
            {genStep === "done" && publishResult && (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ fontSize: "48px", marginBottom: "16px" }}>✓</div>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", marginBottom: "8px" }}>
                  Ad Created in Meta Ads Manager
                </h2>
                <p style={{ fontSize: "14px", color: "#64748b", marginBottom: "24px" }}>
                  Status: <strong style={{ color: "#fbbf24" }}>Paused</strong> — go to Meta Ads Manager to review and activate.
                </p>

                <div style={{ backgroundColor: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "16px", marginBottom: "24px", textAlign: "left" }}>
                  {publishResult.campaignId && (
                    <div style={{ marginBottom: "8px" }}>
                      <span style={{ fontSize: "11px", color: "#475569", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Campaign ID</span>
                      <p style={{ fontSize: "13px", color: "#94a3b8", margin: "2px 0 0", fontFamily: "monospace" }}>{publishResult.campaignId}</p>
                    </div>
                  )}
                  {publishResult.adSetId && (
                    <div style={{ marginBottom: "8px" }}>
                      <span style={{ fontSize: "11px", color: "#475569", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Ad Set ID</span>
                      <p style={{ fontSize: "13px", color: "#94a3b8", margin: "2px 0 0", fontFamily: "monospace" }}>{publishResult.adSetId}</p>
                    </div>
                  )}
                  {publishResult.adId && (
                    <div>
                      <span style={{ fontSize: "11px", color: "#475569", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Ad ID</span>
                      <p style={{ fontSize: "13px", color: "#94a3b8", margin: "2px 0 0", fontFamily: "monospace" }}>{publishResult.adId}</p>
                    </div>
                  )}
                </div>

                <button
                  onClick={resetGenerate}
                  style={{ backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "8px", padding: "12px 28px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                >
                  Generate Another Ad
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE TAB ── */}
        {tab === "performance" && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
              <div>
                <p style={styles.label}>Date Range</p>
                <select
                  value={perfDays}
                  onChange={(e) => setPerfDays(Number(e.target.value))}
                  style={styles.select}
                >
                  {PERIOD_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={fetchPerformance}
                disabled={loadingPerf}
                style={{ ...styles.btn("primary"), opacity: loadingPerf ? 0.6 : 1 }}
              >
                {loadingPerf ? "Loading..." : "Refresh"}
              </button>
            </div>

            {perfError && (
              <div style={{ color: "#f87171", fontSize: "14px", marginBottom: "16px" }}>{perfError}</div>
            )}

            {perfSummary && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
                <div style={styles.metric}>
                  <span style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9" }}>
                    ${perfSummary.totalSpend.toFixed(2)}
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                    Total Spend ({perfSummary.days}d)
                  </span>
                </div>
                <div style={styles.metric}>
                  <span style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9" }}>
                    {perfSummary.totalLeads}
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>Total Leads</span>
                </div>
                <div style={styles.metric}>
                  <span style={{ fontSize: "22px", fontWeight: 700, color: "#f1f5f9" }}>
                    {perfSummary.avgCpl > 0 ? `$${perfSummary.avgCpl.toFixed(2)}` : "—"}
                  </span>
                  <span style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>Avg CPL</span>
                </div>
              </div>
            )}

            {loadingPerf && (
              <div style={{ ...styles.card, color: "#64748b", fontSize: "14px" }}>Loading performance data…</div>
            )}

            {!loadingPerf && perfData.length === 0 && !perfError && (
              <div style={{ ...styles.card, color: "#475569", fontSize: "14px", textAlign: "center", padding: "40px" }}>
                No campaigns found. Set up a campaign in FB Leads to see performance data here.
              </div>
            )}

            {!loadingPerf && perfData.map((c) => (
              <div key={c.id} style={styles.card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                  <div>
                    <span style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9" }}>{c.campaignName}</span>
                    <span style={styles.badge(c.status === "active" ? "#22c55e" : c.status === "paused" ? "#f59e0b" : "#64748b")}>
                      {c.status}
                    </span>
                  </div>
                  <span style={{ fontSize: "12px", color: "#475569" }}>{c.leadType?.replace(/_/g, " ")}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "10px" }}>
                  {[
                    { label: `Spend (${c.period.days}d)`, value: `$${c.period.spend.toFixed(2)}` },
                    { label: "Leads", value: String(c.period.leads) },
                    { label: "CPL", value: c.period.cpl > 0 ? `$${c.period.cpl.toFixed(2)}` : "—" },
                    { label: "Clicks", value: String(c.period.clicks) },
                    { label: "CTR", value: c.period.ctr > 0 ? `${c.period.ctr.toFixed(2)}%` : "—" },
                    { label: "All-Time Leads", value: String(c.totalLeads) },
                  ].map((m) => (
                    <div key={m.label} style={{ backgroundColor: "#070d1a", borderRadius: "6px", padding: "10px 12px" }}>
                      <p style={{ fontSize: "11px", color: "#475569", marginBottom: "4px" }}>{m.label}</p>
                      <p style={{ fontSize: "16px", fontWeight: 600, color: "#e2e8f0", margin: 0 }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
