import Head from "next/head";

export default function InsuranceLeadsForAgentsPage() {
  const title = "Insurance Leads for Agents | CoveCRM";
  const description =
    "Insurance leads are only valuable when agents can follow up quickly, stay organized, text, dial, and book appointments with a clear lead system.";
  const url = "https://www.covecrm.com/insurance-leads-for-agents";

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="og:image" content="https://www.covecrm.com/logo.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content="https://www.covecrm.com/logo.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Article",
              headline: title,
              description,
              url,
              author: { "@type": "Organization", name: "CoveCRM" },
              publisher: { "@type": "Organization", name: "CoveCRM" },
            }),
          }}
        />
      </Head>

      <main className="min-h-screen text-slate-100 bg-gradient-to-b from-[#020617] via-[#0b1225] to-[#020617]">
        <div className="max-w-5xl mx-auto px-6 py-16 md:py-20">
          <nav className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
            <a href="/" className="text-lg font-bold tracking-tight text-blue-300">
              Cove CRM
            </a>
            <div className="flex items-center gap-3 text-sm font-medium">
              <a href="/" className="text-slate-300 transition hover:text-white">Home</a>
              <a
                href="/signup"
                className="rounded-lg border border-blue-500/40 bg-blue-600 px-4 py-2 text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500"
              >
                Start Free Trial
              </a>
            </div>
          </nav>

          <section className="pt-16 md:pt-20">
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-300">Insurance Sales Workflow</p>
            <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight text-white">Insurance Leads for Agents</h1>
            <div className="mt-4 text-lg leading-relaxed text-slate-300 max-w-3xl">
              <p>
                        Getting insurance leads is only part of the equation. The bigger
                        challenge is responding quickly, organizing each opportunity, following
                        up consistently, and booking appointments before interest cools off.
                      </p>
            </div>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <a
                href="/signup"
                className="inline-flex items-center justify-center rounded-xl border border-blue-500/50 bg-blue-600 px-6 py-3.5 text-base font-bold text-white shadow-[0_0_24px_rgba(59,130,246,0.35)] transition hover:bg-blue-500"
              >
                Start Free Trial
              </a>
              <a href="/" className="text-sm font-semibold text-slate-300 transition hover:text-white">
                Back to CoveCRM
              </a>
            </div>
          </section>

          <div className="mt-10 space-y-8 [&_p]:text-slate-300 [&_p]:leading-8 [&_ul]:space-y-3 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:text-slate-300 [&_a]:text-blue-300 [&_a]:transition [&_a:hover]:text-white">
              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Why Lead Systems Matter More Than Buying Names</h2>
                        <p>
                          A list of names does not create sales by itself. Insurance agents need
                          a system for speed to lead, SMS follow-up, dialing, notes, folders, and
                          appointment booking so every lead has a clear next step.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Insurance Workflows CoveCRM Supports</h2>
                        <p>
                          CoveCRM is built around insurance workflows such as final expense,
                          mortgage protection, IUL, veteran, and similar lead follow-up systems
                          where quick response and persistent organization matter.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">FAQ</h2>
                <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">What should insurance agents do after receiving a lead?</h3>
                  <p>They should respond quickly, organize the lead, begin follow-up, and use SMS, calls, and appointments to move the conversation forward.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Can CoveCRM help organize insurance leads?</h3>
                  <p>Yes. CoveCRM includes lead folders, pipelines, SMS conversations, dialing tools, and appointment workflow features.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Does CoveCRM replace buying leads?</h3>
                  <p>No. CoveCRM helps agents manage and follow up with leads from sources such as Facebook, imports, and other lead channels.</p>
                </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Related Pages</h2>
                <div className="text-sm font-medium">
                          <ul>
                            <li><a href="/best-crm-for-insurance-agents">Best CRM for Insurance Agents</a></li>
                            <li><a href="/facebook-leads-for-insurance-agents">Facebook Leads for Insurance Agents</a></li>
                            <li><a href="/crm-that-texts-leads-automatically">CRM That Texts Leads Automatically</a></li>
                          </ul>
                </div>
              </section>
          </div>

          <section className="mt-16 rounded-3xl border border-blue-500/20 bg-gradient-to-br from-[#0d1a35] to-[#020617] p-8 text-center shadow-2xl shadow-blue-950/30 md:p-10">
            <h2 className="text-3xl font-bold tracking-tight text-white">Ready to see CoveCRM in action?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-300 leading-8">
              Insurance agents use CoveCRM to text leads, dial faster, automate follow-up, and book more appointments from one focused sales workflow.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="/signup"
                className="inline-flex items-center justify-center rounded-xl border border-blue-500/50 bg-blue-600 px-6 py-3.5 text-base font-bold text-white shadow-[0_0_24px_rgba(59,130,246,0.35)] transition hover:bg-blue-500"
              >
                Start Free Trial
              </a>
              <a href="/" className="text-sm font-semibold text-slate-300 transition hover:text-white">
                Return to Homepage
              </a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
