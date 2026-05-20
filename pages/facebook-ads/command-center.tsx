import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

type Confidence = "insufficient_data" | "early_signal" | "reliable" | "high_confidence";
type TabKey = "performance" | "quality" | "health";

type RollupRow = {
  key: string;
  state?: string;
  leadType?: string;
  campaignId?: string;
  metaCampaignId?: string;
  metaAdsetId?: string;
  metaAdId?: string;
  metaCreativeId?: string;
  visualVariantIndex?: number | null;
  creativeArchetype?: string;
  variationType?: string;
  leads: number;
  bookedAppointments: number;
  noShows: number;
  sold: number;
  notInterested: number;
  badNumber: number;
  optOut: number;
  contactConnected: number;
  spend: number;
  bookedRate: number;
  noShowRate: number;
  soldRate: number;
  badNumberRate: number;
  dncRate: number;
  costPerBooked: number;
  costPerSale: number;
  confidence: Confidence;
};

type Rollups = {
  byState?: RollupRow[];
  byLeadType?: RollupRow[];
  byCampaign?: RollupRow[];
  byAdset?: RollupRow[];
  byAd?: RollupRow[];
  byCreative?: RollupRow[];
  byVisualVariant?: RollupRow[];
  byCreativeArchetype?: RollupRow[];
  byVariationType?: RollupRow[];
};

type RollupResponse = {
  ok?: boolean;
  rollups?: Rollups;
};

type MetaStatus = {
  connected?: boolean;
  adAccountId?: string;
  pageName?: string;
  tokenExpiresAt?: string | null;
  lastInsightSyncAt?: string | null;
};

const tabs: { id: TabKey; label: string }[] = [
  { id: "performance", label: "Performance" },
  { id: "quality", label: "Lead Quality" },
  { id: "health", label: "Account Health" },
];

const confidenceRank: Record<Confidence, number> = {
  insufficient_data: 0,
  early_signal: 1,
  reliable: 2,
  high_confidence: 3,
};

function pct(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${Math.round(value * 100)}%`;
}

function int(value: number) {
  return Number(value || 0).toLocaleString();
}

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function raw(value?: string | number | null) {
  return String(value ?? "").trim();
}

function shortId(value?: string | number | null) {
  const text = raw(value);
  if (!text) return "";
  return text.length > 10 ? `${text.slice(0, 4)}...${text.slice(-4)}` : text;
}

function label(value?: string | number | null) {
  const text = raw(value);
  if (!text || text === "unknown") return "Unknown";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function confidenceLabel(confidence?: Confidence) {
  if (confidence === "early_signal") return "Early signal";
  if (confidence === "reliable") return "Reliable";
  if (confidence === "high_confidence") return "High confidence";
  return "Not enough data yet";
}

function confidenceTone(confidence?: Confidence) {
  if (confidence === "high_confidence") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (confidence === "reliable") return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  if (confidence === "early_signal") return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  return "border-white/10 bg-white/5 text-slate-300";
}

function softSignal(row: RollupRow) {
  if (row.confidence === "insufficient_data") return "Needs more data";
  if (row.noShowRate >= 0.35) return "High no-show rate";
  if (row.badNumberRate >= 0.25 || row.dncRate >= 0.18) return "Watch this";
  if (row.bookedRate >= 0.15 || row.soldRate > 0) return "Looks promising";
  if (row.confidence === "early_signal") return "Early signal";
  return confidenceLabel(row.confidence);
}

function rowScore(row: RollupRow) {
  return row.soldRate * 4 + row.bookedRate * 2 + Math.min(row.leads, 50) / 200;
}

function qualityScore(row: RollupRow) {
  const notInterestedRate = row.leads ? row.notInterested / row.leads : 0;
  return row.badNumberRate * 3 + row.dncRate * 2 + row.noShowRate * 2 + notInterestedRate;
}

function aggregateRows(rows: RollupRow[], keyFor: (row: RollupRow) => string, patch: (row: RollupRow) => Partial<RollupRow>) {
  const grouped = new Map<string, RollupRow>();
  for (const row of rows) {
    const key = keyFor(row);
    const prev = grouped.get(key) || {
      key,
      leads: 0,
      bookedAppointments: 0,
      noShows: 0,
      sold: 0,
      notInterested: 0,
      badNumber: 0,
      optOut: 0,
      contactConnected: 0,
      spend: 0,
      bookedRate: 0,
      noShowRate: 0,
      soldRate: 0,
      badNumberRate: 0,
      dncRate: 0,
      costPerBooked: 0,
      costPerSale: 0,
      confidence: "insufficient_data",
      ...patch(row),
    };
    prev.leads += row.leads || 0;
    prev.bookedAppointments += row.bookedAppointments || 0;
    prev.noShows += row.noShows || 0;
    prev.sold += row.sold || 0;
    prev.notInterested += row.notInterested || 0;
    prev.badNumber += row.badNumber || 0;
    prev.optOut += row.optOut || 0;
    prev.contactConnected += row.contactConnected || 0;
    prev.spend += row.spend || 0;
    if (confidenceRank[row.confidence] > confidenceRank[prev.confidence]) prev.confidence = row.confidence;
    grouped.set(key, prev);
  }

  return Array.from(grouped.values()).map((row) => ({
    ...row,
    bookedRate: row.leads ? row.bookedAppointments / row.leads : 0,
    noShowRate: row.bookedAppointments ? row.noShows / row.bookedAppointments : 0,
    soldRate: row.leads ? row.sold / row.leads : 0,
    badNumberRate: row.leads ? row.badNumber / row.leads : 0,
    dncRate: row.leads ? row.optOut / row.leads : 0,
  }));
}

function campaignOptionKey(row: RollupRow) {
  return raw(row.campaignId || row.metaCampaignId || row.key);
}

function campaignDisplayName(row: RollupRow, index: number) {
  const id = row.campaignId || row.metaCampaignId || row.key;
  return `Campaign ${shortId(id) || index + 1}`;
}

function matchesCampaign(row: RollupRow, campaign: RollupRow | null) {
  if (!campaign) return true;
  const selectedCampaignId = raw(campaign.campaignId);
  const selectedMetaCampaignId = raw(campaign.metaCampaignId);
  const selectedKey = raw(campaign.key);
  const rowCampaignId = raw(row.campaignId);
  const rowMetaCampaignId = raw(row.metaCampaignId);

  return Boolean(
    (selectedCampaignId && rowCampaignId === selectedCampaignId) ||
      (selectedMetaCampaignId && rowMetaCampaignId === selectedMetaCampaignId) ||
      (selectedKey && (rowCampaignId === selectedKey || rowMetaCampaignId === selectedKey))
  );
}

function bestRows(rows: RollupRow[], limit = 5) {
  return [...rows]
    .filter((row) => row.leads > 0)
    .sort((a, b) => rowScore(b) - rowScore(a))
    .slice(0, limit);
}

function worstRows(rows: RollupRow[], limit = 5) {
  return [...rows]
    .filter((row) => row.leads > 0)
    .sort((a, b) => qualityScore(b) - qualityScore(a))
    .slice(0, limit);
}

function totalFrom(rows: RollupRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.leads += row.leads || 0;
      acc.booked += row.bookedAppointments || 0;
      acc.sold += row.sold || 0;
      acc.noShows += row.noShows || 0;
      acc.badNumber += row.badNumber || 0;
      acc.optOut += row.optOut || 0;
      acc.notInterested += row.notInterested || 0;
      acc.spend += row.spend || 0;
      if (confidenceRank[row.confidence] > confidenceRank[acc.confidence]) acc.confidence = row.confidence;
      return acc;
    },
    {
      leads: 0,
      booked: 0,
      sold: 0,
      noShows: 0,
      badNumber: 0,
      optOut: 0,
      notInterested: 0,
      spend: 0,
      confidence: "insufficient_data" as Confidence,
    }
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#0f172a]">
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function RankedList({
  rows,
  empty,
  titleFor,
  detailFor,
}: {
  rows: RollupRow[];
  empty: string;
  titleFor: (row: RollupRow) => string;
  detailFor?: (row: RollupRow) => string;
}) {
  if (rows.length === 0) {
    return <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">{empty}</div>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">#{index + 1}</span>
                <h3 className="truncate text-sm font-semibold text-white">{titleFor(row)}</h3>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {detailFor ? detailFor(row) : `${int(row.leads)} leads`}
              </p>
            </div>
            <span className={`w-fit rounded-full border px-2.5 py-1 text-xs ${confidenceTone(row.confidence)}`}>
              {softSignal(row)}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Metric label="Booked" value={pct(row.bookedRate)} />
            <Metric label="Sold" value={pct(row.soldRate)} />
            <Metric label="No-show" value={pct(row.noShowRate)} />
            <Metric label="Leads" value={int(row.leads)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label: metricLabel, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{metricLabel}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function TopCard({ label: cardLabel, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0f172a] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{cardLabel}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {helper && <div className="mt-2 text-xs text-slate-400">{helper}</div>}
    </div>
  );
}

export default function AdCommandCenterPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("performance");
  const [selectedCampaignKey, setSelectedCampaignKey] = useState("all");
  const [rollups, setRollups] = useState<Rollups>({});
  const [metaStatus, setMetaStatus] = useState<MetaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [rollupRes, metaRes] = await Promise.all([
          fetch("/api/facebook/attribution-rollups"),
          fetch("/api/meta/status"),
        ]);
        const rollupJson = (await rollupRes.json()) as RollupResponse;
        if (!rollupRes.ok) throw new Error((rollupJson as any)?.error || "Failed to load ad performance.");
        const metaJson = metaRes.ok ? ((await metaRes.json()) as MetaStatus) : null;
        if (!cancelled) {
          setRollups(rollupJson.rollups || {});
          setMetaStatus(metaJson);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load command center.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const prepared = useMemo(() => {
    const campaigns = rollups.byCampaign || [];
    const selectedCampaign =
      selectedCampaignKey === "all"
        ? null
        : campaigns.find((row) => campaignOptionKey(row) === selectedCampaignKey) || null;
    const scopeRows = (rows: RollupRow[]) => rows.filter((row) => matchesCampaign(row, selectedCampaign));

    const allState = aggregateRows(rollups.byState || [], (row) => row.state || "UNKNOWN", (row) => ({
      state: row.state || "UNKNOWN",
    }));
    const byStateRaw = scopeRows(rollups.byState || []);
    const byState = aggregateRows(byStateRaw, (row) => row.state || "UNKNOWN", (row) => ({
      state: row.state || "UNKNOWN",
      campaignId: row.campaignId,
      metaCampaignId: row.metaCampaignId,
    }));
    const byLeadType = aggregateRows(scopeRows(rollups.byLeadType || []), (row) => row.leadType || row.key, (row) => ({
      leadType: row.leadType || row.key,
      campaignId: row.campaignId,
      metaCampaignId: row.metaCampaignId,
    }));
    const byAd = scopeRows(rollups.byAd || []);
    const byCreative = scopeRows(rollups.byCreative || []);
    const totals = selectedCampaign ? totalFrom([selectedCampaign]) : totalFrom(campaigns.length ? campaigns : allState.length ? allState : rollups.byAd || []);

    return {
      campaigns,
      selectedCampaign,
      byState,
      byLeadType,
      byAd,
      byCreative,
      totals,
      bestAds: bestRows(byAd),
      bestStates: bestRows(byState),
      bestLeadTypes: bestRows(byLeadType),
      bestCreatives: bestRows(byCreative),
      worstAds: worstRows(byAd),
      worstStates: worstRows(byState),
    };
  }, [rollups, selectedCampaignKey]);

  const { totals } = prepared;
  const bookedRate = totals.leads ? totals.booked / totals.leads : 0;
  const soldRate = totals.leads ? totals.sold / totals.leads : 0;
  const noShowRate = totals.booked ? totals.noShows / totals.booked : 0;

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-[#0b1220] px-4 py-6 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <header className="flex flex-col gap-3 border-b border-white/10 pb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">Ad Command Center</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                See which ads, states, and lead sources are actually turning into booked calls and sales.
              </p>
            </div>
          </header>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-[#0f172a] p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <label htmlFor="campaign-select" className="text-sm font-semibold text-white">
                Campaign
              </label>
              <p className="mt-1 max-w-2xl text-sm text-slate-400">
                Select a campaign to view performance by state, ad, creative, and lead quality.
              </p>
            </div>
            <select
              id="campaign-select"
              value={selectedCampaignKey}
              onChange={(event) => setSelectedCampaignKey(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-[#111827] px-3 py-2 text-sm text-white outline-none transition focus:border-blue-400 md:w-72"
            >
              <option value="all">All Campaigns</option>
              {prepared.campaigns.map((campaign, index) => {
                const optionKey = campaignOptionKey(campaign);
                return (
                  <option key={optionKey || campaign.key || index} value={optionKey}>
                    {campaignDisplayName(campaign, index)}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <TopCard label="Total Spend" value={loading ? "--" : money(totals.spend)} helper={prepared.selectedCampaign ? "Spend for this campaign." : "Spend across campaigns."} />
            <TopCard label="Total Leads" value={loading ? "--" : int(totals.leads)} helper="Tracked from attributed leads." />
            <TopCard label="Overall Booked %" value={loading ? "--" : pct(bookedRate)} helper="Booked calls divided by leads." />
            <TopCard label="Overall Sold %" value={loading ? "--" : pct(soldRate)} helper="Sales divided by leads." />
            <TopCard label="Overall No-show %" value={loading ? "--" : pct(noShowRate)} helper="No-shows divided by booked calls." />
          </div>

          <div className="flex flex-wrap gap-2 rounded-lg border border-white/10 bg-[#0f172a] p-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  activeTab === tab.id
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="rounded-lg border border-white/10 bg-[#0f172a] p-8 text-center text-sm text-slate-400">
              Loading command center...
            </div>
          ) : activeTab === "performance" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Section title="Best Ads" subtitle="Ads with the strongest booking and sales signals.">
                <RankedList
                  rows={prepared.bestAds}
                  empty="Not enough data yet."
                  titleFor={(row) => row.metaAdId ? `Ad ${row.metaAdId}` : "Unknown ad"}
                  detailFor={(row) => `${int(row.leads)} leads`}
                />
              </Section>
              <Section title="Best States" subtitle="States producing the best booked-call and sales outcomes.">
                <RankedList
                  rows={prepared.bestStates}
                  empty="Not enough state data yet."
                  titleFor={(row) => label(row.state)}
                  detailFor={(row) => `${int(row.leads)} leads`}
                />
              </Section>
              <Section title="Best Lead Types" subtitle="Lead sources grouped by product or lead type.">
                <RankedList
                  rows={prepared.bestLeadTypes}
                  empty="Not enough lead type data yet."
                  titleFor={(row) => label(row.leadType || row.key)}
                  detailFor={(row) => `${int(row.leads)} leads`}
                />
              </Section>
              <Section title="Best Creatives" subtitle="Creative IDs with promising outcome signals.">
                <RankedList
                  rows={prepared.bestCreatives}
                  empty="Not enough creative data yet."
                  titleFor={(row) => row.metaCreativeId ? `Creative ${row.metaCreativeId}` : "Unknown creative"}
                  detailFor={(row) => `${int(row.leads)} leads`}
                />
              </Section>
            </div>
          ) : activeTab === "quality" ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Section title="Lead Quality Snapshot" subtitle="Simple quality rates for the selected campaign view.">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TopCard label="Bad Number %" value={pct(totals.leads ? totals.badNumber / totals.leads : 0)} />
                  <TopCard label="DNC %" value={pct(totals.leads ? totals.optOut / totals.leads : 0)} />
                  <TopCard label="No-show %" value={pct(noShowRate)} />
                  <TopCard label="Not Interested %" value={pct(totals.leads ? totals.notInterested / totals.leads : 0)} />
                </div>
              </Section>
              <Section title="Worst States" subtitle="Areas to watch for bad numbers, opt-outs, or no-shows.">
                <RankedList
                  rows={prepared.worstStates}
                  empty="Not enough state data yet."
                  titleFor={(row) => label(row.state)}
                  detailFor={(row) => `${int(row.leads)} leads`}
                />
              </Section>
              <Section title="Worst Ads" subtitle="Ads with quality issues worth watching.">
                <RankedList
                  rows={prepared.worstAds}
                  empty="Not enough ad data yet."
                  titleFor={(row) => row.metaAdId ? `Ad ${row.metaAdId}` : "Unknown ad"}
                  detailFor={(row) => `${int(row.leads)} leads`}
                />
              </Section>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Section title="Meta Connection">
                <div className="space-y-3 text-sm text-slate-300">
                  <div className={`rounded-lg border p-4 ${metaStatus?.connected ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="font-semibold text-white">
                      {metaStatus?.connected ? "Meta is connected" : "Meta connection not detected"}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {metaStatus?.pageName ? `Page: ${metaStatus.pageName}` : "Connect Meta to improve live account health visibility."}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    Last insight sync: {metaStatus?.lastInsightSyncAt ? new Date(metaStatus.lastInsightSyncAt).toLocaleString() : "Not available"}
                  </div>
                </div>
              </Section>
              <Section title="Learning Phase Protection">
                <div className="space-y-3 text-sm text-slate-300">
                  <p>New ads need time before the numbers mean much. When data is light, this page will say “Not enough data yet.”</p>
                  <p>Early results are useful for watching patterns, not for making hard decisions.</p>
                </div>
              </Section>
              <Section title="Spend And Account Limits">
                <div className="space-y-3 text-sm text-slate-300">
                  <p>Watch spend in context with booked calls and sales, not leads alone.</p>
                  <p>Account limits and billing status should be reviewed inside Meta when delivery changes suddenly.</p>
                </div>
              </Section>
              <Section title="Policy And Account Quality" subtitle="A calm checklist for account hygiene.">
                <ul className="space-y-2 text-sm text-slate-300">
                  <li>Review rejected or limited ads inside Meta Ads Manager.</li>
                  <li>Keep ad copy clear and avoid promises that cannot be verified.</li>
                  <li>Check page, payment, and ad account notifications regularly.</li>
                  <li>CoveCRM can surface signals, but Meta makes final delivery and review decisions.</li>
                </ul>
              </Section>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!session?.user?.email) {
    return {
      redirect: { destination: "/auth/signin", permanent: false },
    };
  }
  return { props: {} };
};
