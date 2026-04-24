import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import DashboardLayout from "@/components/DashboardLayout";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

const reviewItems = [
  "CTA clicks",
  "rage clicks",
  "scroll depth",
  "dropoff pages",
  "form abandonment",
  "mobile issues",
];

const sections = [
  {
    title: "Homepage Metrics",
    description: "Review first-visit behavior, CTA engagement, and where home traffic stalls before moving deeper into the site.",
  },
  {
    title: "Signup Funnel",
    description: "Track where signups hesitate, abandon, or run into interaction friction before finishing the core CRM onboarding path.",
  },
  {
    title: "Lead Funnels",
    description: "Check funnel pages for dead clicks, weak scroll performance, and any obvious friction in lead capture flows.",
  },
  {
    title: "Pricing Page",
    description: "Inspect plan comparison behavior, CTA attention, and whether pricing visitors are stalling before checkout.",
  },
  {
    title: "Mobile UX",
    description: "Focus on tap frustration, viewport friction, layout issues, and mobile-specific dropoff patterns across key pages.",
  },
];

const dailyChecklist = [
  "Watch 10 newest recordings",
  "Check signup dropoff",
  "Check worst rage-click page",
  "Check lowest scroll page",
  "Check mobile errors",
];

type ClarityInsightsResponse = {
  waiting?: boolean;
  error?: string;
  summary?: {
    visitors?: number;
    uniqueVisitors?: number;
    engagementTime?: number;
    scrollDepth?: number;
    rageClicks?: number;
    deadClicks?: number;
  } | null;
  topUrls?: Array<{ url: string; traffic: number }>;
  devices?: {
    breakdown?: Array<{ device: string; traffic: number }>;
    mobile?: number;
    desktop?: number;
  };
  metricNames?: string[];
  responseShape?: string;
};

function formatNumber(value?: number) {
  const safe = Number(value || 0);
  return new Intl.NumberFormat("en-US").format(safe);
}

function formatEngagementTime(value?: number) {
  const totalSeconds = Math.max(0, Math.round(Number(value || 0)));
  if (!totalSeconds) return "0s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export default function SiteIntelligencePage() {
  const { data: session, status } = useSession();
  const [clarity, setClarity] = useState<ClarityInsightsResponse | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const email = String(session?.user?.email || "").toLowerCase();
  const isAdmin = isExperimentalAdminEmail(email);

  useEffect(() => {
    if (!isAdmin) return;

    let active = true;
    const loadInsights = async () => {
      try {
        setLoadingInsights(true);
        const res = await fetch("/api/admin/clarity-insights");
        const data = (await res.json()) as ClarityInsightsResponse;
        if (!active) return;
        setClarity(data);
      } catch (error: any) {
        if (!active) return;
        setClarity({
          waiting: true,
          error: error?.message || "Failed to load Clarity insights.",
        });
      } finally {
        if (active) setLoadingInsights(false);
      }
    };

    loadInsights();
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const metricCards = useMemo(() => {
    const summary = clarity?.summary || {};
    const devices = clarity?.devices || {};
    return [
      {
        label: "Visitors / Traffic",
        value: formatNumber(summary.visitors),
        subtext: `Unique visitors: ${formatNumber(summary.uniqueVisitors)}`,
      },
      {
        label: "Engagement Time",
        value: formatEngagementTime(summary.engagementTime),
        subtext: "Last 1 day from Clarity export",
      },
      {
        label: "Scroll Depth",
        value: formatNumber(summary.scrollDepth),
        subtext: "Clarity export aggregate",
      },
      {
        label: "Frustration Clicks",
        value: `${formatNumber(summary.rageClicks)} / ${formatNumber(summary.deadClicks)}`,
        subtext: "Rage clicks / dead clicks",
      },
      {
        label: "Mobile vs Desktop",
        value: `${formatNumber(devices.mobile)} / ${formatNumber(devices.desktop)}`,
        subtext: "Mobile traffic / desktop traffic",
      },
    ];
  }, [clarity]);

  if (status === "loading") {
    return (
      <DashboardLayout>
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-900 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white">
          Loading...
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdmin) {
    return (
      <>
        <Head>
          <title>Site Intelligence | Cove CRM</title>
        </Head>
        <DashboardLayout>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-red-700 shadow-sm dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            You do not have access to this page.
          </div>
        </DashboardLayout>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Site Intelligence | Cove CRM</title>
      </Head>

      <DashboardLayout>
        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">
                  Admin Analytics
                </p>
                <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">
                  Site Intelligence
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
                  One place to review high-friction pages, broken conversion moments, and mobile behavior before it impacts signup flow or lead generation.
                </p>
              </div>

              <Link
                href="https://clarity.microsoft.com/projects"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
              >
                Open Microsoft Clarity
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-400">
                  Live Clarity Metrics
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
                  Last 1 Day Snapshot
                </h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Pulled server-side from the Microsoft Clarity Data Export API using URL and device breakdowns.
                </p>
              </div>
              {clarity?.responseShape ? (
                <p className="max-w-md text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {clarity.responseShape}
                </p>
              ) : null}
            </div>

            {loadingInsights ? (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                Loading Clarity insights...
              </div>
            ) : clarity?.waiting ? (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                {clarity.error || "Waiting for Clarity data."}
              </div>
            ) : clarity?.error ? (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                {clarity.error}
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  {metricCards.map((card) => (
                    <div
                      key={card.label}
                      className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        {card.label}
                      </p>
                      <p className="mt-3 text-2xl font-semibold text-slate-900 dark:text-white">
                        {card.value}
                      </p>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        {card.subtext}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Top URLs
                        </h3>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          Highest traffic URLs in the last day.
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {(clarity?.topUrls || []).length ? (
                        (clarity?.topUrls || []).map((item) => (
                          <div
                            key={item.url}
                            className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950"
                          >
                            <span className="min-w-0 break-all text-sm text-slate-700 dark:text-slate-200">
                              {item.url}
                            </span>
                            <span className="whitespace-nowrap text-sm font-semibold text-slate-900 dark:text-white">
                              {formatNumber(item.traffic)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                          Waiting for Clarity data.
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                      Device Breakdown
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Traffic by device value returned from Clarity.
                    </p>

                    <div className="mt-5 space-y-3">
                      {(clarity?.devices?.breakdown || []).length ? (
                        (clarity?.devices?.breakdown || []).map((item) => (
                          <div
                            key={item.device}
                            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950"
                          >
                            <span className="text-sm text-slate-700 dark:text-slate-200">
                              {item.device}
                            </span>
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                              {formatNumber(item.traffic)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                          Waiting for Clarity device data.
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <div className="grid gap-5 md:grid-cols-2">
                {sections.map((section) => (
                  <section
                    key={section.title}
                    className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                          {section.title}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {section.description}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                        Review
                      </span>
                    </div>

                    <div className="mt-5 grid gap-2">
                      {reviewItems.map((item) => (
                        <div
                          key={`${section.title}-${item}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <aside className="space-y-5">
              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-400">
                  Daily Checklist
                </p>
                <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">
                  Daily Review
                </h2>
                <div className="mt-5 space-y-3">
                  {dailyChecklist.map((item, index) => (
                    <div
                      key={item}
                      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white dark:bg-sky-500 dark:text-slate-950">
                        {index + 1}
                      </span>
                      <span className="text-sm text-slate-700 dark:text-slate-200">
                        {item}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-600 dark:text-violet-400">
                  Focus Areas
                </p>
                <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  <p>Prioritize pages with the highest rage-click density before digging into lower-volume recordings.</p>
                  <p>Compare mobile dropoff against desktop before blaming messaging or offer quality.</p>
                  <p>Check whether weak scroll depth lines up with dead CTA zones or layout friction.</p>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </DashboardLayout>
    </>
  );
}
