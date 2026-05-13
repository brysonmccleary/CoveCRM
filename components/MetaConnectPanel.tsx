// components/MetaConnectPanel.tsx
// Meta (Facebook) connection status panel — OAuth connect and asset display
import { useEffect, useRef, useState } from "react";

interface MetaStatus {
  connected: boolean;
  pageName?: string;
  pageId?: string;
  adAccountId?: string;
  hasPaymentMethod?: boolean;
  leadAdsTermsAccepted?: boolean;
  tokenExpiresAt?: string | null;
  lastWebhookAt?: string | null;
  lastInsightSyncAt?: string | null;
}

interface MetaPage {
  id: string;
  name: string;
  hasToken?: boolean;
  instagramId?: string;
  selected?: boolean;
}

interface MetaAdAccount {
  id: string;
  name: string;
  account_id: string;
  status?: string | number;
  currency?: string;
  selected?: boolean;
}

const PAGE_NAME_RECOMMENDATIONS: Record<string, string[]> = {
  veteran: ["Veteran Benefits Center", "Veteran Coverage Help", "Veteran Family Benefits"],
  mortgage_protection: ["Mortgage Protection Network", "Family Mortgage Protection", "Home Coverage Help"],
  final_expense: ["Final Expense Support", "Family Burial Coverage", "Legacy Coverage Help"],
  iul: ["Cash Value Coverage Center", "Indexed Life Benefits", "Retirement Coverage Help"],
  trucker: ["Trucker Benefits Center", "Driver Coverage Help", "CDL Family Protection"],
};

const LEAD_TYPE_LABELS: Record<string, string> = {
  veteran: "Veteran",
  mortgage_protection: "Mortgage Protection",
  final_expense: "Final Expense",
  iul: "IUL",
  trucker: "Trucker",
};

function fmt(d?: string | null) {
  if (!d) return "Never";
  return new Date(d).toLocaleString();
}

export default function MetaConnectPanel({ leadType }: { leadType?: string }) {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [selectedPage, setSelectedPage] = useState("");
  const [selectedAdAccount, setSelectedAdAccount] = useState("");
  const [savingAssets, setSavingAssets] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedRecommendedName, setSelectedRecommendedName] = useState("");
  const pageSelectorRef = useRef<HTMLDivElement>(null);
  const adAccountSelectorRef = useRef<HTMLDivElement>(null);

  const recommendedNames = leadType ? PAGE_NAME_RECOMMENDATIONS[leadType] || [] : [];
  const selectedPageRecord = pages.find((p) => p.id === selectedPage) || null;
  const recommendedNameMatch = selectedRecommendedName
    ? pages.find((p) => p.name.trim().toLowerCase() === selectedRecommendedName.trim().toLowerCase()) || null
    : null;
  const createPageUrl = "https://www.facebook.com/pages/create";
  const setupSteps = status?.connected
    ? [
        {
          title: "Connect Facebook Account",
          helper: "Your Facebook account is connected to CoveCRM.",
          complete: status.connected === true,
        },
        {
          title: "Select a Facebook Page",
          helper: "Choose the Facebook Page your ads will run from.",
          complete: Boolean(String(status.pageId || "").trim()),
          actionLabel: "Select Page →",
          onAction: async () => {
            if (!pages.length) await loadAssets();
            setTimeout(() => pageSelectorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
          },
        },
        {
          title: "Select an Ad Account",
          helper: "Choose the ad account that will be billed for your campaigns.",
          complete: Boolean(String(status.adAccountId || "").trim()),
          actionLabel: "Select Ad Account →",
          onAction: async () => {
            if (!adAccounts.length) await loadAssets();
            setTimeout(() => adAccountSelectorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
          },
        },
        {
          title: "Add Payment Method",
          helper: "Your ad account needs a valid payment method to run ads.",
          complete: Boolean(String(status.adAccountId || "").trim()) && status.hasPaymentMethod === true,
          actionLabel: "Add Payment Method →",
          href: "https://business.facebook.com/billing",
        },
        {
          title: "Accept Lead Ads Terms of Service",
          helper: "Required by Meta to run lead generation ads.",
          complete: status.leadAdsTermsAccepted === true,
          actionLabel: "Accept Terms →",
          href: "https://www.facebook.com/ads/leadgen/tos",
        },
      ]
    : [];
  const showSetupChecklist = Boolean(status?.connected) && setupSteps.some((step) => !step.complete);

  const fetchStatus = async () => {
    try {
      const query = leadType ? `?leadType=${encodeURIComponent(leadType)}` : "";
      const res = await fetch(`/api/meta/sync-insights${query}`);
      if (res.ok) {
        const data = await res.json();
        const nextStatus: MetaStatus = {
          connected: !!data?.connected,
          pageId: data?.pageId || "",
          pageName: data?.pageName || "",
          adAccountId: data?.adAccountId || "",
          hasPaymentMethod: false,
          leadAdsTermsAccepted: false,
          tokenExpiresAt: data?.tokenExpiresAt || null,
          lastWebhookAt: data?.lastWebhookAt || null,
          lastInsightSyncAt: data?.lastSyncAt || null,
        };
        setStatus(nextStatus);
        if (nextStatus.pageId) setSelectedPage(nextStatus.pageId);
        if (nextStatus.adAccountId) setSelectedAdAccount(nextStatus.adAccountId);
      } else {
        setStatus(null);
      }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  const loadAssets = async () => {
    setLoadingAssets(true);
    try {
      const [pRes, aRes] = await Promise.all([
        fetch("/api/meta/pages"),
        fetch("/api/meta/ad-accounts"),
      ]);

      if (pRes.ok) {
        const pd = await pRes.json();
        const nextPages = pd.pages || [];
        setPages(nextPages);
        const selected = nextPages.find((p: MetaPage) => p.selected);
        if (selected?.id) setSelectedPage(selected.id);
        else if (nextPages?.length === 1 && !selectedPage) setSelectedPage(nextPages[0].id);
      }

      if (aRes.ok) {
        const ad = await aRes.json();
        const nextAccounts = ad.adAccounts || [];
        setAdAccounts(nextAccounts);
        const selected = nextAccounts.find((a: MetaAdAccount) => a.selected);
        if (selected?.account_id) setSelectedAdAccount(selected.account_id);
        else if (nextAccounts?.length === 1 && !selectedAdAccount) {
          setSelectedAdAccount(nextAccounts[0].account_id || String(nextAccounts[0].id || "").replace(/^act_/, ""));
        }
      }
    } finally {
      setLoadingAssets(false);
    }
  };

  const saveAssets = async () => {
    if (!selectedPage && !selectedAdAccount) return;
    setSavingAssets(true);
    try {
      const res = await fetch("/api/meta/sync-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-assets",
          pageId: selectedPage,
          adAccountId: selectedAdAccount,
          ...(leadType ? { leadType } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncMsg(data?.error || "Failed to save selected assets.");
      } else {
        setSyncMsg("Saved selected Meta assets.");
      }
      await fetchStatus();
    } finally {
      setSavingAssets(false);
    }
  };

  const syncInsights = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      const res = await fetch("/api/meta/sync-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 30 }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncMsg(`Synced ${data.syncedDays ?? 0} days — $${(data.totalSpend ?? 0).toFixed(2)} spend, ${data.totalLeads ?? 0} leads.`);
        await fetchStatus();
      } else {
        setSyncMsg(data.error || "Sync failed.");
      }
    } catch {
      setSyncMsg("Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [leadType]);

  useEffect(() => {
    if (recommendedNames.length > 0) {
      setSelectedRecommendedName(recommendedNames[0]);
    } else {
      setSelectedRecommendedName("");
    }
  }, [leadType]);

  if (loading) {
    return (
      <div className="bg-[#0f172a] border border-white/10 rounded-xl p-5 animate-pulse">
        <div className="h-4 w-32 bg-white/10 rounded mb-2" />
        <div className="h-3 w-48 bg-white/5 rounded" />
      </div>
    );
  }

  return (
    <div className="bg-[#0f172a] border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </div>
          <div>
            <p className="text-white text-sm font-semibold">Meta Connection</p>
            <p className="text-gray-500 text-xs">Facebook ads and lead delivery</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {status?.connected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-900/30 border border-emerald-700/30 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Connected
              </span>
              <button
                onClick={async () => {
                  if (!confirm("Disconnect Meta? You will need to reconnect to run ads.")) return;
                  await fetch("/api/meta/disconnect", { method: "POST" });
                  window.location.href = "/facebook-leads";
                }}
                style={{ fontSize: 11, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <span className="text-xs text-gray-500 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
              Not Connected
            </span>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-gray-400 hover:text-white text-xs"
          >
            {expanded ? "▲ Hide" : "▼ Manage"}
          </button>
        </div>
      </div>

      {!expanded && !status?.connected && (
        <div className="px-5 py-4 flex items-center gap-4">
          <p className="text-gray-400 text-xs flex-1">
            Connect your Facebook account to receive leads automatically as soon as someone fills out your lead form.
          </p>
          <a
            href="/api/meta/connect"
            className="shrink-0 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Connect Meta Account
          </a>
        </div>
      )}

      {expanded && (
        <div className="px-5 py-5 space-y-6">
          {!status?.connected ? (
            <div className="space-y-3">
              <p className="text-gray-300 text-sm">
                Connect your Facebook account to automatically receive leads when someone fills out your Facebook Lead Ad form.
              </p>
              <a
                href="/api/meta/connect"
                className="inline-block bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
              >
                Connect Meta Account →
              </a>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Connection Status</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-0.5">Facebook Page</p>
                    <p className="text-white text-sm font-medium">{status?.pageName || status?.pageId || "—"}</p>
                    {status?.pageId && (
                      <p className="text-gray-600 text-xs mt-0.5 font-mono">{status.pageId}</p>
                    )}
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-0.5">Ad Account</p>
                    <p className="text-white text-sm font-medium">{status?.adAccountId ? `act_${status.adAccountId}` : "Not set"}</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-0.5">Connection</p>
                    <p className="text-emerald-400 text-sm font-medium">Connection active</p>
                  </div>
                </div>



                {showSetupChecklist && (
                  <div
                    style={{
                      background: "#0f172a",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {setupSteps.map((step) => (
                        <div key={step.title} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              background: step.complete ? "#10b981" : "transparent",
                              border: `1px solid ${step.complete ? "#10b981" : "#6b7280"}`,
                              color: step.complete ? "#ffffff" : "#6b7280",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {step.complete ? "✓" : ""}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "#ffffff", fontSize: 14, fontWeight: 500, lineHeight: 1.25 }}>
                              {step.title}
                            </div>
                            <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.35, marginTop: 2 }}>
                              {step.helper}
                            </div>
                          </div>
                          {!step.complete && step.href && (
                            <a
                              href={step.href}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                background: "#0ea5e9",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: 7,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                textDecoration: "none",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {step.actionLabel}
                            </a>
                          )}
                          {!step.complete && step.onAction && (
                            <button
                              type="button"
                              onClick={step.onAction}
                              style={{
                                background: "#0ea5e9",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: 7,
                                padding: "6px 10px",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {step.actionLabel}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    {["Choose Facebook Page", "Confirm Ad Account", "Generate Ads", "Launch Campaign"].map((label, index) => (
                      <div key={label} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-gray-500">Step {index + 1}</p>
                        <p className="text-xs font-semibold text-white">{label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <h4 className="text-sm font-semibold text-white">Step 1: Choose your Facebook Page</h4>
                        <p className="text-xs text-gray-400 mt-1 max-w-2xl">
                          This is the Facebook Page your ads and lead form will run from. Pick an existing Page from Meta, or create one if you do not have a matching Page yet.
                        </p>
                      </div>
                      <button
                        onClick={loadAssets}
                        disabled={loadingAssets}
                        className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-lg disabled:opacity-60"
                      >
                        {loadingAssets ? "Refreshing..." : "Refresh connected assets"}
                      </button>
                    </div>

                    {leadType && recommendedNames.length > 0 && (
                      <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">
                              Suggested Page names
                            </p>
                            <p className="text-xs text-blue-200/80">
                              Pick a name that fits this campaign type, then choose the matching Page below.
                            </p>
                          </div>
                          <a
                            href={createPageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg"
                          >
                            Create Page
                          </a>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {recommendedNames.map((name) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => setSelectedRecommendedName(name)}
                              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                                selectedRecommendedName === name
                                  ? "bg-blue-600 text-white border-blue-500"
                                  : "bg-white/5 text-gray-300 border-white/10 hover:border-blue-500/40"
                              }`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>

                        {selectedRecommendedName && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="bg-[#1e293b] border border-white/10 text-blue-200 text-xs px-3 py-2 rounded-lg">
                              {selectedRecommendedName}
                            </code>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(selectedRecommendedName).catch(() => {})}
                              className="text-xs text-gray-300 hover:text-white bg-white/5 border border-white/10 px-3 py-2 rounded-lg"
                            >
                              Copy name
                            </button>
                          </div>
                        )}

                        {selectedRecommendedName && !recommendedNameMatch && (
                          <p className="text-xs text-yellow-300">
                            No matching Page found yet. Create this Page in Meta, then click Refresh connected assets.
                          </p>
                        )}

                        {recommendedNameMatch && (
                          <p className="text-xs text-emerald-300">
                            Matching Page found: {recommendedNameMatch.name}
                          </p>
                        )}
                      </div>
                    )}

                    {pages.length > 0 && (
                      <div ref={pageSelectorRef}>
                        <label className="text-xs text-gray-400 block mb-1">Facebook Page</label>
                        <select
                          value={selectedPage}
                          onChange={(e) => setSelectedPage(e.target.value)}
                          className="w-full bg-[#1e293b] border border-white/10 text-white text-sm rounded px-3 py-1.5"
                        >
                          <option value="">Select page...</option>
                          {pages.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {selectedPageRecord && (
                      <p className="text-xs text-gray-400">
                        Selected Page: <span className="text-white">{selectedPageRecord.name}</span>
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-white">Step 2: Confirm Ad Account</h4>
                      <p className="text-xs text-gray-400 mt-1">
                        Choose the ad account that should pay for and manage this campaign.
                      </p>
                    </div>

                    {adAccounts.length > 0 && (
                      <div ref={adAccountSelectorRef}>
                        <label className="text-xs text-gray-400 block mb-1">Ad Account</label>
                        <select
                          value={selectedAdAccount}
                          onChange={(e) => setSelectedAdAccount(e.target.value)}
                          className="w-full bg-[#1e293b] border border-white/10 text-white text-sm rounded px-3 py-1.5"
                        >
                          <option value="">Select ad account...</option>
                          {adAccounts.map((a) => (
                            <option key={a.id} value={a.account_id}>
                              {a.name} ({a.account_id})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {(pages.length > 0 || adAccounts.length > 0) && (
                      <>
                        <button
                          onClick={saveAssets}
                          disabled={savingAssets || (!selectedPage && !selectedAdAccount)}
                          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg disabled:opacity-60"
                        >
                          {savingAssets
                            ? "Saving..."
                            : leadType
                              ? `Save Asset Selection for ${LEAD_TYPE_LABELS[leadType] || leadType}`
                              : "Save Asset Selection"}
                        </button>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                      <h4 className="text-sm font-semibold text-white">Step 3: Generate Ads</h4>
                      <p className="text-xs text-gray-400 mt-1">
                        Create ad copy, creative, and lead forms for this campaign.
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                      <h4 className="text-sm font-semibold text-white">Step 4: Launch Campaign</h4>
                      <p className="text-xs text-gray-400 mt-1">
                        Review everything, then launch when you are ready.
                      </p>
                    </div>
                  </div>

                  {pages.length === 0 && adAccounts.length === 0 && (
                    <p className="text-xs text-gray-500">
                      Click Refresh connected assets to load your available Pages and ad accounts.
                    </p>
                  )}

                  {syncMsg && (
                    <p className="text-xs text-emerald-400">{syncMsg}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wide">Ad Insights Sync</h4>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={syncInsights}
                    disabled={syncing || !status?.adAccountId}
                    className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg disabled:opacity-60"
                  >
                    {syncing ? "Syncing..." : "Sync Ad Data Now"}
                  </button>
                  <p className="text-xs text-gray-500">Last synced: {fmt(status?.lastInsightSyncAt)}</p>
                </div>
                {!status?.adAccountId && <p className="text-xs text-yellow-400">Set an ad account above to enable syncing.</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
