import Head from "next/head";

export default function InsuranceAgentFollowUpSystemPage() {
  const title = "Insurance Agent Follow-Up System | CoveCRM";
  const description =
    "A strong insurance agent follow-up system includes fast texting, organized pipelines, dialing, reminders, and appointment workflows.";
  const url = "https://www.covecrm.com/insurance-agent-follow-up-system";

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
            <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight text-white">Insurance Agent Follow-Up System</h1>
            <div className="mt-4 text-lg leading-relaxed text-slate-300 max-w-3xl">
              <p>
                        A strong insurance agent follow-up system helps agents respond quickly,
                        stay organized, text leads, make calls, set reminders, track context, and
                        book appointments from one connected workflow.
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
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">What a Good Follow-Up System Needs</h2>
                        <p>
                          A useful follow-up system should include lead organization, SMS history,
                          dialing, reminders, appointment workflows, and a clear next step for each lead.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">What a Complete Insurance Follow-Up System Includes</h2>
                        <ul>
                          <li>Fast first response through SMS or calling workflows</li>
                          <li>Two-way conversation history tied to each lead</li>
                          <li>Lead folders, source tracking, and owner clarity</li>
                          <li>Drip campaigns, reminders, and lead nudges</li>
                          <li>Appointment booking connected to the same lead record</li>
                        </ul>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Why Most Leads Are Lost in the Follow-Up Stage</h2>
                        <p>
                          Leads are often lost when response times are slow, notes are scattered,
                          or agents do not have a simple system for consistent follow-up.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">How CoveCRM Combines Texting, Dialing, Reminders, and Organization</h2>
                        <p>
                          CoveCRM brings SMS automation, lead folders, dialing tools, reminders,
                          AI workflows, and appointment booking into one insurance-focused CRM.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">FAQ</h2>
                <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">What is an insurance follow-up system?</h3>
                  <p>It is a process and toolset for keeping insurance leads organized and moving from first contact to appointment or sale.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Why does follow-up matter so much?</h3>
                  <p>Insurance leads often need multiple touches, so consistent follow-up helps agents avoid missed opportunities.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Can CoveCRM help with follow-up?</h3>
                  <p>Yes. CoveCRM publicly lists SMS automation, drip campaigns, lead nudges, dialing, and appointment workflows.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">What should a follow-up system include?</h3>
                  <p>It should include lead organization, SMS, calling, reminders, drip campaigns, appointment booking, and a clear record of what happened last.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Can follow-up systems help with older leads?</h3>
                  <p>Yes. Organized reminders, notes, SMS history, and call activity can help agents revisit older leads without losing context.</p>
                </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Related Pages</h2>
                <div className="text-sm font-medium">
                          <ul>
                            <li><a href="/insurance-leads-for-agents">Insurance Leads for Agents</a></li>
                            <li><a href="/ai-sms-for-insurance-agents">AI SMS for Insurance Agents</a></li>
                            <li><a href="/how-insurance-agents-can-book-more-appointments">How Insurance Agents Can Book More Appointments</a></li>
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
