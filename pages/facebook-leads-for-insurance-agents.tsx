import Head from "next/head";

export default function FacebookLeadsForInsuranceAgentsPage() {
  const title = "Facebook Leads for Insurance Agents | CoveCRM";
  const description =
    "Learn how insurance agents can manage Facebook leads with faster follow-up, lead folders, drip campaigns, duplicate prevention, and CoveCRM workflows.";
  const url = "https://www.covecrm.com/facebook-leads-for-insurance-agents";

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
            <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight text-white">Facebook Leads for Insurance Agents</h1>
            <div className="mt-4 text-lg leading-relaxed text-slate-300 max-w-3xl">
              <p>
                        Facebook leads for insurance agents are easier to work when capture,
                        speed to lead, duplicate handling, campaign context, SMS, calls, and
                        appointments all stay connected in the CRM.
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
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Real-Time Lead Flow</h2>
                        <p>
                          Speed matters when a Facebook lead requests information. CoveCRM’s
                          public positioning includes Facebook lead workflows that help agents
                          respond quickly and manage each lead in the CRM.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">What Makes Facebook Leads Hard to Manage</h2>
                        <p>
                          Facebook leads can become difficult when response speed is slow, duplicate
                          submissions clutter the CRM, campaign attribution is unclear, or agents lose
                          track of the context that created the inquiry.
                        </p>
                        <p>
                          Follow-up consistency is another common issue. A lead may need a text, a call,
                          a reminder, and an appointment prompt, which is why Facebook lead workflows
                          should connect to a broader <a href="/insurance-agent-follow-up-system">insurance follow-up system</a>.
                        </p>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">What Insurance Agents Should Look For in a Facebook Lead Workflow</h2>
                        <ul>
                          <li>Fast routing into the CRM after a lead submits a form</li>
                          <li>Automatic SMS follow-up and clear two-way conversation history</li>
                          <li>Campaign and source context for better lead organization</li>
                          <li>Duplicate prevention and lead ownership clarity</li>
                          <li>Calling and appointment workflows connected to the same record</li>
                        </ul>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Organization and Follow-Up</h2>
                        <ul>
                          <li>Lead folders for campaign organization</li>
                          <li>Drip campaigns for consistent follow-up</li>
                          <li>SMS workflows for faster response</li>
                          <li>Duplicate prevention to keep records cleaner</li>
                        </ul>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">FAQ</h2>
                <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Why do Facebook leads need fast follow-up?</h3>
                  <p>Because interest can fade quickly after a form submission, and faster response can improve the chance of a conversation.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Can CoveCRM organize Facebook leads?</h3>
                  <p>Yes. CoveCRM includes Facebook lead manager positioning, lead folders, and follow-up tools for insurance agents.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Does CoveCRM support drip campaigns?</h3>
                  <p>Yes. CoveCRM publicly lists prebuilt drip campaigns and automated follow-up as part of the product.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">What should agents compare in a Facebook lead CRM?</h3>
                  <p>Agents should compare speed to lead, duplicate handling, campaign organization, SMS automation, dialing, and appointment workflow support.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">Can Facebook leads work with automatic texting?</h3>
                  <p>Yes. Facebook leads are often strongest when they move quickly into a CRM that can start SMS follow-up and keep the conversation organized.</p>
                </div>
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
                <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Related Pages</h2>
                <div className="text-sm font-medium">
                          <ul>
                            <li><a href="/best-crm-for-insurance-agents">Best CRM for Insurance Agents</a></li>
                            <li><a href="/insurance-leads-for-agents">Insurance Leads for Agents</a></li>
                            <li><a href="/crm-that-texts-leads-automatically">CRM That Texts Leads Automatically</a></li>
                            <li><a href="/insurance-agent-follow-up-system">Insurance Agent Follow-Up System</a></li>
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
