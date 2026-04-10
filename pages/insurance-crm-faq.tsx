import Head from "next/head";

const faqs = [
  {
    question: "What is an insurance CRM?",
    answer:
      "An insurance CRM is software that helps agents organize leads, track conversations, manage follow-up, and keep sales activity in one place.",
  },
  {
    question: "What is the best CRM for insurance agents?",
    answer:
      "The best CRM for insurance agents is one that supports fast follow-up, texting, dialing, appointment booking, and organized lead workflows.",
  },
  {
    question: "Can a CRM text leads automatically?",
    answer:
      "Yes. Some CRMs, including CoveCRM, include SMS automation and follow-up tools that help agents text leads quickly.",
  },
  {
    question: "Does CoveCRM include a dialer?",
    answer:
      "Yes. CoveCRM publicly lists power dialing and AI dial sessions as part of its insurance sales workflow features.",
  },
  {
    question: "Can CoveCRM help with Facebook leads?",
    answer:
      "Yes. CoveCRM includes Facebook lead workflow positioning, lead organization, and follow-up tools for insurance agents.",
  },
  {
    question: "Why does speed to lead matter in insurance sales?",
    answer:
      "Speed to lead matters because prospects are often most responsive shortly after they submit a form or request information.",
  },
  {
    question: "Can I organize leads by type or campaign?",
    answer:
      "Yes. CoveCRM publicly positions lead folders, pipelines, and campaign-focused organization as part of the CRM workflow.",
  },
  {
    question: "What makes CoveCRM different from a generic CRM?",
    answer:
      "CoveCRM is positioned for insurance agents, with texting, dialing, AI workflows, Facebook lead follow-up, and appointment booking in one place.",
  },
];

export default function InsuranceCRMFAQPage() {
  const title = "Insurance CRM FAQ | CoveCRM";
  const description =
    "Answers to common questions about insurance CRMs, texting, dialing, follow-up automation, appointment booking, and CoveCRM.";
  const url = "https://www.covecrm.com/insurance-crm-faq";

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
              "@type": "FAQPage",
              mainEntity: faqs.map((faq) => ({
                "@type": "Question",
                name: faq.question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: faq.answer,
                },
              })),
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
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-300">Insurance CRM</p>
            <h1 className="mt-4 text-4xl md:text-5xl font-bold tracking-tight text-white">Insurance CRM FAQ</h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-300 max-w-3xl">
              Below are answers to common questions about insurance CRMs, texting,
              dialing, follow-up automation, appointment booking, and CoveCRM.
            </p>
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

          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
            <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Insurance CRM Questions</h2>
            <div className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.question} className="rounded-xl border border-white/10 bg-[#020617]/40 p-5">
                  <h3 className="text-lg font-semibold text-white">{faq.question}</h3>
                  <p className="mt-2 text-slate-300 leading-7">{faq.answer}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 shadow-lg shadow-black/10">
            <h2 className="text-2xl md:text-3xl font-semibold text-white mb-4">Related Pages</h2>
            <ul className="list-disc space-y-3 pl-5 text-sm font-medium text-slate-300">
              <li><a href="/best-crm-for-insurance-agents" className="text-blue-300 transition hover:text-white">Best CRM for Insurance Agents</a></li>
              <li><a href="/crm-that-texts-leads-automatically" className="text-blue-300 transition hover:text-white">CRM That Texts Leads Automatically</a></li>
              <li><a href="/ai-dialer-for-insurance-agents" className="text-blue-300 transition hover:text-white">AI Dialer for Insurance Agents</a></li>
            </ul>
          </section>

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
