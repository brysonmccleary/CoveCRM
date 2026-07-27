import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth/next";
import DashboardLayout from "@/components/DashboardLayout";
import { isRecruitingAdminEmail } from "@/lib/recruiting/access";
import { HOSTED_SOCIAL_CONSENT_VERSION } from "@/lib/recruiting/cloud/lifecycle";
import { DISCOVERY_SOURCE_COPY, DISCOVERY_SOURCE_TYPES, type DiscoverySourceType } from "@/lib/recruiting/cloud/discovery-sources";
import { ACTION_OPTIONS, DEFAULT_PLATFORM_ACTION_SETTINGS, type PlatformActionSettings } from "@/lib/recruiting/action-settings";
import { recruitingErrorMessage } from "@/lib/recruiting/public-errors";
import type { SocialPlatform } from "@/lib/recruiting/social/types";
import { RECRUITING_PLANS, type RecruitingPlanKey } from "@/lib/recruiting/plans";
import {
  DEFAULT_DAILY_DM_LIMIT,
  FIRST_NAME_MESSAGE_TOKEN,
  insertMessageToken,
  MAX_DAILY_DM_LIMIT,
  MIN_DAILY_DM_LIMIT,
} from "@/lib/recruiting/dm-settings";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

type CloudAccount = {
  _id: string;
  platform: SocialPlatform;
  status: "connecting" | "active" | "reauth_required" | "paused";
  lastAuthenticatedAt?: string | null;
  lastCheckedAt?: string | null;
  dailyDmLimit: number;
};

type LoginView = { accountId: string; platform: SocialPlatform; liveViewUrl: string } | null;
type CampaignOverview = {
  id: string;
  name: string;
  status: "active" | "paused";
  platforms: SocialPlatform[];
  prospects: number;
  createdAt: string;
  actions: Array<{ platform: SocialPlatform; actionType: string; status: string; count: number }>;
  discovery: Array<{ platform: SocialPlatform; lastCompletedAt?: string | null; lastCandidateCount: number; nextScanAt?: string | null; needsAttention: boolean }>;
};
type RecentActivity = { platform: SocialPlatform; actionType: string; status: string; summary: string; completedAt?: string | null; displayName: string };
const examples = ["Athletes", "Insurance agents", "D2D sales", "Car sales", "Realtors", "Fitness coaches", "Entrepreneurs"];
const inputClass = "w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20";
const platformCopy = {
  instagram: { name: "Instagram", detail: "Post and story engagement · Follows · DMs", color: "fuchsia" },
  linkedin: { name: "LinkedIn", detail: "Connections · Engagement · DMs", color: "sky" },
} as const;

export default function RecruitingPage() {
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOverview[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionsAvailable, setConnectionsAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loginView, setLoginView] = useState<LoginView>(null);
  const [selectedExamples, setSelectedExamples] = useState<string[]>([]);
  const [form, setForm] = useState({
    platforms: ["instagram", "linkedin"] as SocialPlatform[],
    planKey: "growth_recruiting" as RecruitingPlanKey,
    audienceDescription: "",
    seedAccounts: "",
    discoverySourceTypes: [] as DiscoverySourceType[],
    location: "",
    message: "",
    dailyLimit: DEFAULT_DAILY_DM_LIMIT,
    engagementAudience: "everyone" as "everyone" | "women" | "men",
    platformActionSettings: structuredClone(DEFAULT_PLATFORM_ACTION_SETTINGS) as PlatformActionSettings,
  });

  const loadAccounts = useCallback(async () => {
    try {
      const [accountsResponse, capabilitiesResponse, overviewResponse] = await Promise.all([
        fetch("/api/recruiting/accounts"),
        fetch("/api/recruiting/capabilities"),
        fetch("/api/recruiting/overview"),
      ]);
      const [accountsData, capabilitiesData, overviewData] = await Promise.all([
        accountsResponse.json().catch(() => ({})),
        capabilitiesResponse.json().catch(() => ({})),
        overviewResponse.json().catch(() => ({})),
      ]);
      setConnectionsAvailable(capabilitiesResponse.ok && capabilitiesData.accountConnectionsAvailable === true);
      if (!accountsResponse.ok) {
        setError(recruitingErrorMessage(accountsData, "ACCOUNT_LOAD_FAILED"));
        return;
      }
      setAccounts(accountsData.accounts || []);
      if (overviewResponse.ok) {
        setCampaigns(overviewData.campaigns || []);
        setRecentActivity(overviewData.recent || []);
      }
    } catch {
      setConnectionsAvailable(false);
      setError(recruitingErrorMessage(null, "ACCOUNT_LOAD_FAILED"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  const accountFor = useCallback((platform: SocialPlatform) => accounts.find((account) => account.platform === platform), [accounts]);
  const selectedAccountsReady = useMemo(() => form.platforms.length > 0 && form.platforms.every((platform) => accountFor(platform)?.status === "active"), [accountFor, form.platforms]);
  const dmEnabled = useMemo(() => form.platforms.some((platform) => form.platformActionSettings[platform].dm), [form.platformActionSettings, form.platforms]);

  const connect = async (platform: SocialPlatform) => {
    setBusy(`connect-${platform}`); setError(""); setSuccess("");
    try {
      if (!consentAccepted) throw new Error("Accept the account-access agreement first.");
      if (!connectionsAvailable) {
        setError("Account connections are being prepared. Please check back shortly.");
        return;
      }
      const response = await fetch("/api/recruiting/accounts/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          consentAccepted: true,
          consentVersion: HOSTED_SOCIAL_CONSENT_VERSION,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(recruitingErrorMessage(data, "ACCOUNT_CONNECTION_UNAVAILABLE"));
        return;
      }
      setLoginView({ accountId: data.accountId, platform, liveViewUrl: data.liveViewUrl });
      await loadAccounts();
    } catch (caught) {
      setError(caught instanceof Error && caught.message === "Accept the account-access agreement first."
        ? caught.message
        : recruitingErrorMessage(null, "ACCOUNT_CONNECTION_UNAVAILABLE"));
    } finally { setBusy(""); }
  };

  const verifyLogin = async () => {
    if (!loginView) return;
    setBusy("verify"); setError("");
    try {
      const response = await fetch("/api/recruiting/accounts/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: loginView.accountId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(recruitingErrorMessage(data, "ACCOUNT_VERIFY_FAILED"));
        return;
      }
      setSuccess(`${platformCopy[loginView.platform].name} connected. CoveCRM can now run it securely in the cloud.`);
      setLoginView(null);
      await loadAccounts();
    } catch { setError(recruitingErrorMessage(null, "ACCOUNT_VERIFY_FAILED")); }
    finally { setBusy(""); }
  };

  const updateAccount = async (account: CloudAccount, operation: "pause" | "resume" | "cancel") => {
    if (operation === "cancel" && !window.confirm(`Disconnect ${platformCopy[account.platform].name} and permanently delete its saved cloud browser?`)) return;
    setBusy(`${operation}-${account._id}`); setError("");
    try {
      const response = await fetch("/api/recruiting/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account._id, operation }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(recruitingErrorMessage(data, "ACCOUNT_UPDATE_FAILED"));
        return;
      }
      setSuccess(operation === "cancel" ? `${platformCopy[account.platform].name} access and saved browser data were deleted.` : `Automation ${operation === "pause" ? "paused" : "resumed"}.`);
      await loadAccounts();
    } catch { setError(recruitingErrorMessage(null, "ACCOUNT_UPDATE_FAILED")); }
    finally { setBusy(""); }
  };

  const startRecruiting = async () => {
    setBusy("launch"); setError(""); setSuccess("");
    try {
      if (!selectedAccountsReady) throw new Error("Connect every selected platform first.");
      const response = await fetch("/api/recruiting/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, examples: selectedExamples }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(recruitingErrorMessage(data, "CAMPAIGN_START_FAILED"));
        return;
      }
      setSuccess("Your cloud agent is running. You can close CoveCRM and turn off your computer.");
      await loadAccounts();
    } catch (caught) { setError(caught instanceof Error && caught.message === "Connect every selected platform first." ? caught.message : recruitingErrorMessage(null, "CAMPAIGN_START_FAILED")); }
    finally { setBusy(""); }
  };

  const controlCampaign = async (campaign: CampaignOverview, operation: "pause" | "resume" | "archive") => {
    if (operation === "archive" && !window.confirm("Permanently stop this campaign and cancel all remaining work?")) return;
    setBusy(`${operation}-${campaign.id}`); setError(""); setSuccess("");
    try {
      const response = await fetch("/api/recruiting/campaign-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, operation }),
      });
      if (!response.ok) {
        setError(recruitingErrorMessage(await response.json().catch(() => ({})), "CAMPAIGN_START_FAILED"));
        return;
      }
      setSuccess(operation === "pause" ? "Campaign paused. No new activity will run." : operation === "resume" ? "Campaign resumed." : "Campaign permanently stopped.");
      await loadAccounts();
    } catch { setError(recruitingErrorMessage(null, "CAMPAIGN_START_FAILED")); }
    finally { setBusy(""); }
  };

  const togglePlatform = (platform: SocialPlatform) => setForm((current) => {
    const selected = current.platforms.includes(platform);
    if (!selected && current.planKey === "growth") return { ...current, platforms: [platform] };
    return { ...current, platforms: selected ? current.platforms.filter((item) => item !== platform) : [...current.platforms, platform] };
  });

  const toggleDiscoverySource = (source: DiscoverySourceType) => setForm((current) => ({
    ...current,
    discoverySourceTypes: current.discoverySourceTypes.includes(source)
      ? current.discoverySourceTypes.filter((item) => item !== source)
      : [...current.discoverySourceTypes, source],
  }));

  const togglePlatformAction = (platform: SocialPlatform, action: string) => setForm((current) => {
    if (action === "dm" && current.planKey === "growth") return current;
    return {
      ...current,
      platformActionSettings: {
        ...current.platformActionSettings,
        [platform]: {
          ...current.platformActionSettings[platform],
          [action]: !Boolean((current.platformActionSettings[platform] as Record<string, boolean>)[action]),
        },
      },
    };
  });

  const selectPlan = (planKey: RecruitingPlanKey) => setForm((current) => {
    if (planKey === "growth_recruiting") return { ...current, planKey };
    const platform = current.platforms[0] || "instagram";
    return {
      ...current,
      planKey,
      platforms: [platform],
      platformActionSettings: {
        ...current.platformActionSettings,
        instagram: { ...current.platformActionSettings.instagram, dm: false },
        linkedin: { ...current.platformActionSettings.linkedin, dm: false },
      },
    };
  });

  const importSeedFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 250_000) {
      setError("Choose a CSV or text file smaller than 250 KB.");
      return;
    }
    const imported = await file.text();
    setForm((current) => ({
      ...current,
      seedAccounts: [current.seedAccounts.trim(), imported.trim()].filter(Boolean).join("\n"),
    }));
  };

  const insertFirstName = () => {
    const input = messageInputRef.current;
    const start = input?.selectionStart ?? form.message.length;
    const end = input?.selectionEnd ?? start;
    const inserted = insertMessageToken(form.message, FIRST_NAME_MESSAGE_TOKEN, start, end);
    setForm((current) => ({ ...current, message: inserted.message }));
    window.requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(inserted.caret, inserted.caret);
    });
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6 pb-16 text-white">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-3xl font-bold tracking-tight">AI Social Growth & Recruiting</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Connect once. CoveCRM finds the right people and runs from the cloud—even when your computer is off.</p></div>
          <div className="flex items-center gap-2"><Link href="/recruiting/insights" className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200">View insights</Link><span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">Admin-only preview</span></div>
        </header>

        {(error || success) && <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${error ? "border-amber-400/25 bg-amber-400/10 text-amber-100" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>{error || success}</div>}

        {campaigns.length > 0 && <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Agent activity</h2><p className="mt-1 text-sm text-slate-400">A simple view of who CoveCRM found and what it safely completed.</p></div><button type="button" onClick={() => void loadAccounts()} disabled={Boolean(busy)} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300">Refresh</button></div>
          <div className="mt-4 grid gap-4">{campaigns.map((campaign) => {
            const completed = campaign.actions.filter((item) => item.status === "succeeded").reduce((sum, item) => sum + item.count, 0);
            const dms = campaign.actions.filter((item) => item.status === "succeeded" && item.actionType === "dm").reduce((sum, item) => sum + item.count, 0);
            const pending = campaign.actions.filter((item) => ["queued", "claimed"].includes(item.status)).reduce((sum, item) => sum + item.count, 0);
            return <div key={campaign.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="font-semibold">{campaign.name}</p><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${campaign.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{campaign.status === "active" ? "Running" : "Paused"}</span></div><p className="mt-1 text-xs text-slate-500">{campaign.platforms.map((platform) => platformCopy[platform].name).join(" + ")}</p></div><div className="flex gap-2">{campaign.status === "active" ? <button type="button" disabled={Boolean(busy)} onClick={() => void controlCampaign(campaign, "pause")} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold">Pause</button> : <button type="button" disabled={Boolean(busy)} onClick={() => void controlCampaign(campaign, "resume")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold">Resume</button>}<button type="button" disabled={Boolean(busy)} onClick={() => void controlCampaign(campaign, "archive")} className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-semibold text-red-300">Stop</button></div></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Profiles found", campaign.prospects], ["Actions completed", completed], ["DMs sent", dms], ["Waiting", pending]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-900 px-3 py-3"><p className="text-xl font-bold">{value}</p><p className="text-[11px] text-slate-500">{label}</p></div>)}</div>{campaign.discovery.some((item) => item.needsAttention) && <p className="mt-3 text-xs text-amber-300">Audience scanning will retry automatically. Completed activity is unaffected.</p>}</div>;
          })}</div>
          {recentActivity.length > 0 && <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent activity</p><div className="mt-2 divide-y divide-white/5">{recentActivity.slice(0, 6).map((item, index) => <div key={`${item.platform}-${item.completedAt}-${index}`} className="flex items-center justify-between gap-3 py-3 text-xs"><div><span className="font-semibold text-slate-200">{item.displayName}</span><span className="text-slate-500"> · {platformCopy[item.platform].name} · {item.actionType.replace("_", " ")}</span></div><span className={item.status === "succeeded" ? "text-emerald-300" : item.status === "skipped" ? "text-slate-400" : "text-amber-300"}>{item.status === "succeeded" ? "Completed" : item.status === "skipped" ? "Safely skipped" : "Will retry or review"}</span></div>)}</div></div>}
        </section>}

        <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl"><div><h2 className="text-lg font-semibold">Choose your plan</h2><p className="mt-1 text-sm text-slate-400">Pricing is locked into campaign permissions now; checkout remains hidden during the admin preview.</p></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{Object.values(RECRUITING_PLANS).map((plan) => <button type="button" key={plan.key} onClick={() => selectPlan(plan.key)} className={`rounded-xl border p-4 text-left ${form.planKey === plan.key ? "border-indigo-400 bg-indigo-500/15" : "border-white/10 bg-slate-950/40"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{plan.name}</p><p className="mt-1 text-xs leading-relaxed text-slate-400">{plan.description}</p></div><p className="whitespace-nowrap text-lg font-bold">${plan.monthlyPrice}<span className="text-xs font-normal text-slate-500">/mo</span></p></div></button>)}</div></section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl">
          <div className="flex items-start gap-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold">1</span>
            <div className="w-full">
              <h2 className="text-lg font-semibold">Connect your accounts once</h2>
              <p className="mt-1 text-sm text-slate-400">You log into the real platform inside a secure cloud browser. CoveCRM saves the browser session—not your password.</p>
              {connectionsAvailable === false && <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100"><p className="font-semibold">Account connections are being prepared</p><p className="mt-1 text-xs leading-relaxed text-amber-100/70">Instagram and LinkedIn connection buttons will become available here as soon as setup is complete.</p></div>}
              <label className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-4 text-xs leading-relaxed text-slate-300">
                <input type="checkbox" className="mt-0.5" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} />
                <span>I authorize CoveCRM to perform the audience searches, likes, connections, and exact DMs I configure. I can pause or permanently disconnect access at any time.</span>
              </label>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(["instagram", "linkedin"] as SocialPlatform[]).map((platform) => {
                  const account = accountFor(platform);
                  const connected = account?.status === "active";
                  const needsLogin = account?.status === "reauth_required" || account?.status === "connecting";
                  return <div key={platform} className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{platformCopy[platform].name}</p><p className="mt-1 text-xs text-slate-500">{platformCopy[platform].detail}</p></div><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${connected ? "bg-emerald-500/10 text-emerald-300" : needsLogin ? "bg-amber-500/10 text-amber-300" : account?.status === "paused" ? "bg-slate-700 text-slate-300" : "bg-slate-800 text-slate-500"}`}>{loading ? "Checking" : connected ? "Connected" : needsLogin ? "Login needed" : account?.status === "paused" ? "Paused" : connectionsAvailable === false ? "Preparing" : "Not connected"}</span></div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!connected && account?.status !== "paused" && <button type="button" disabled={!consentAccepted || Boolean(busy) || connectionsAvailable !== true} onClick={() => void connect(platform)} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold hover:bg-indigo-500 disabled:opacity-40">{busy === `connect-${platform}` ? "Opening…" : connectionsAvailable === false ? "Preparing" : account ? "Reconnect" : "Connect"}</button>}
                      {connected && <button type="button" disabled={Boolean(busy)} onClick={() => void updateAccount(account!, "pause")} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold">Pause</button>}
                      {account?.status === "paused" && <button type="button" disabled={Boolean(busy)} onClick={() => void updateAccount(account, "resume")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold">Resume</button>}
                      {account && <button type="button" disabled={Boolean(busy)} onClick={() => void updateAccount(account, "cancel")} className="rounded-lg border border-red-500/20 px-3 py-2 text-xs font-semibold text-red-300">Disconnect</button>}
                    </div>
                  </div>;
                })}
              </div>
            </div>
          </div>
        </section>

        {loginView && <section className="overflow-hidden rounded-2xl border border-indigo-400/30 bg-slate-900 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4"><div><p className="font-semibold">Log into {platformCopy[loginView.platform].name}</p><p className="text-xs text-slate-400">Credentials go directly to {platformCopy[loginView.platform].name}. Complete any verification here.</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void verifyLogin()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold hover:bg-emerald-500 disabled:opacity-50">{busy === "verify" ? "Checking…" : "I’m logged in"}</button></div>
          <iframe title={`${platformCopy[loginView.platform].name} secure login`} src={loginView.liveViewUrl} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals" allow="clipboard-read; clipboard-write" className="h-[650px] w-full bg-white" />
        </section>}

        <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl">
          <div className="flex items-start gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold">2</span><div className="w-full space-y-4">
            <div><h2 className="text-lg font-semibold">Who do you want CoveCRM to find?</h2><p className="mt-1 text-sm text-slate-400">CoveCRM searches nationwide by default. Describe the experience, industry, and interests you want in normal language.</p></div>
            <div className="flex flex-wrap gap-2">{examples.map((example) => <button type="button" key={example} onClick={() => setSelectedExamples((current) => current.includes(example) ? current.filter((item) => item !== example) : [...current, example])} className={`rounded-full border px-3 py-2 text-xs font-medium ${selectedExamples.includes(example) ? "border-indigo-400 bg-indigo-500/20 text-indigo-100" : "border-white/10 bg-slate-950/40 text-slate-300"}`}>{example}</button>)}</div>
            <label className="block text-xs font-medium text-slate-300">Describe your ideal person<textarea className={`${inputClass} mt-1 min-h-28 resize-y`} value={form.audienceDescription} onChange={(event) => setForm({ ...form, audienceDescription: event.target.value })} placeholder="Example: Competitive commission salespeople with strong communication skills and an entrepreneurial mindset." /></label>
            <div><p className="mb-2 text-xs font-medium text-slate-300">Where should CoveCRM start looking?</p><div className="grid gap-2 sm:grid-cols-2">{DISCOVERY_SOURCE_TYPES.map((source) => <button type="button" key={source} onClick={() => toggleDiscoverySource(source)} className={`rounded-xl border px-4 py-3 text-left text-sm ${form.discoverySourceTypes.includes(source) ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-white/10 bg-slate-950/40 text-slate-300"}`}>{DISCOVERY_SOURCE_COPY[source].label}</button>)}</div></div>
            <label className="block text-xs font-medium text-slate-300">Profiles CoveCRM should model first <span className="text-slate-500">(optional · up to 100)</span><textarea className={`${inputClass} mt-1 min-h-32 resize-y`} value={form.seedAccounts} onChange={(event) => setForm({ ...form, seedAccounts: event.target.value })} placeholder={"Paste an entire list at once — handles, profile links, or names separated by lines or commas.\n\n@vivint\n@edmylett\nhttps://www.instagram.com/examplebroker/"} /><span className="mt-2 block font-normal text-slate-500">These profiles receive priority. CoveCRM works through their public networks, learns which profiles match, and uses strong matches to keep expanding to new people.</span><span className="mt-3 flex items-center gap-3"><span className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 font-semibold text-slate-200">Import CSV or TXT</span><input type="file" accept=".csv,.txt,text/csv,text/plain" className="max-w-56 text-xs text-slate-500 file:hidden" onChange={(event) => { void importSeedFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></span></label>
            <label className="block text-xs font-medium text-slate-300">Narrow to a state or city <span className="text-slate-500">(optional)</span><input className={`${inputClass} mt-1`} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Leave blank to search all 50 states" /><span className="mt-2 block font-normal text-slate-500">United States nationwide is the default.</span></label>
            <div><p className="mb-2 text-xs font-medium text-slate-300">Public engagement preference</p><div className="flex flex-wrap gap-2">{([['women', 'Women only'], ['men', 'Men only'], ['everyone', 'Both']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setForm({ ...form, engagementAudience: value })} className={`rounded-lg border px-4 py-2 text-sm font-medium ${form.engagementAudience === value ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-white/10 text-slate-500"}`}>{label}</button>)}</div><p className="mt-2 text-xs text-slate-500">This changes public likes only. It never changes professional DM qualification, and unclear profiles are not guessed.</p></div>
            <div><p className="mb-2 text-xs font-medium text-slate-300">Platforms to run</p><div className="flex gap-2">{(["instagram", "linkedin"] as SocialPlatform[]).map((platform) => <button type="button" key={platform} onClick={() => togglePlatform(platform)} className={`rounded-lg border px-4 py-2 text-sm font-medium ${form.platforms.includes(platform) ? "border-indigo-400 bg-indigo-500/20 text-white" : "border-white/10 text-slate-500"}`}>{platformCopy[platform].name}</button>)}</div></div>
            <div className="grid gap-3 sm:grid-cols-2">{(["instagram", "linkedin"] as SocialPlatform[]).filter((platform) => form.platforms.includes(platform)).map((platform) => <div key={platform} className="rounded-xl border border-white/10 bg-slate-950/40 p-4"><p className="text-sm font-semibold">{platformCopy[platform].name} actions</p><div className="mt-3 grid gap-2">{ACTION_OPTIONS[platform].map(({ action, label }) => { const locked = action === "dm" && form.planKey === "growth"; const enabled = Boolean((form.platformActionSettings[platform] as Record<string, boolean>)[action]); return <button type="button" key={action} disabled={locked} onClick={() => togglePlatformAction(platform, action)} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100" : "border-white/10 text-slate-500"}`}><span>{label}</span><span>{locked ? "Upgrade" : enabled ? "On" : "Off"}</span></button>; })}</div></div>)}</div>
            <div className="rounded-xl border border-indigo-400/20 bg-indigo-500/10 p-4 text-xs leading-relaxed text-slate-300"><p className="font-semibold text-indigo-200">How CoveCRM acts</p><p className="mt-1">High confidence: engage, follow on Instagram or connect on LinkedIn, then send the approved DM. Possible match: engage only. Weak, non-U.S., duplicate, followed, following, or previously messaged: skip the restricted action.</p></div>
          </div></div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-xl"><div className="flex items-start gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-bold">3</span><div className="w-full space-y-4">
          <div><h2 className="text-lg font-semibold">{dmEnabled ? "Choose exactly what CoveCRM sends" : "DM automation is off"}</h2><p className="mt-1 text-sm text-slate-400">{dmEnabled ? "Write the exact message. Use the button below to personalize it with the person’s first name." : "CoveCRM will only perform the enabled growth actions. You can turn DMs on for either platform above."}</p></div>
          {dmEnabled && <><div><button type="button" onClick={insertFirstName} className="rounded-lg border border-indigo-400/40 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/20">+ Add first name</button></div><textarea ref={messageInputRef} className={`${inputClass} min-h-32 resize-y`} maxLength={500} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Type the exact DM you want sent…" />
          <div className="flex items-center justify-between text-xs text-slate-500"><span>Exact approved message only</span><span>{form.message.length}/500</span></div>
          <label className="block text-xs font-medium text-slate-300">Maximum DMs per platform per day<input type="number" min={MIN_DAILY_DM_LIMIT} max={MAX_DAILY_DM_LIMIT} className={`${inputClass} mt-1 max-w-36`} value={form.dailyLimit} onChange={(event) => setForm({ ...form, dailyLimit: Number(event.target.value) })} /><span className="mt-2 block font-normal text-slate-500">CoveCRM stops at 50 per platform per day. Instagram does not publish a guaranteed safe daily DM number, and platform enforcement can vary. Paced engagement can continue between 8:00 AM and 9:00 PM in your timezone.</span></label></>}
        </div></div></section>

        <div className="rounded-2xl border border-indigo-400/20 bg-gradient-to-r from-indigo-600/20 to-violet-600/10 p-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Start the cloud agent</h2><p className="mt-1 text-sm text-slate-400">After starting, you can close CoveCRM and turn off your computer. If a platform logs out, every action stops until you reconnect.</p></div><button type="button" onClick={() => void startRecruiting()} disabled={Boolean(busy) || !selectedAccountsReady} className="rounded-xl bg-indigo-500 px-6 py-3 text-sm font-bold shadow-lg hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">{busy === "launch" ? "Starting…" : "Start recruiting"}</button></div></div>
      </div>
    </DashboardLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!isRecruitingAdminEmail(session?.user?.email)) return { notFound: true };
  return { props: {} };
};
