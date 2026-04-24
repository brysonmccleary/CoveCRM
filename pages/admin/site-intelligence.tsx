import Head from "next/head";
import Link from "next/link";
import { useSession } from "next-auth/react";
import DashboardLayout from "@/components/DashboardLayout";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

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

export default function SiteIntelligencePage() {
  const { data: session, status } = useSession();

  const email = String(session?.user?.email || "").toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;

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
