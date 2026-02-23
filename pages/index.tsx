// /pages/index.tsx
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <>
      <Head>
        <title>Cove CRM – Your Sales Command Center</title>
        <meta
          name="description"
          content="Close more deals with Cove CRM. Built for life insurance telesales agents. Includes AI automation, calling, texting, and Google Calendar booking."
        />
      </Head>

      <main className="min-h-screen text-slate-100 bg-gradient-to-b from-[#020617] via-[#0b1225] to-[#020617]">
        {/* Nav */}
        <nav className="flex justify-between items-center py-5 px-6 border-b border-white/10 bg-[#020617]/60 backdrop-blur supports-[backdrop-filter]:bg-[#020617]/40">
          <div className="flex items-center space-x-2">
            <Image src="/logo.png" alt="Cove CRM Logo" width={32} height={32} />
            <h1 className="text-2xl font-bold text-blue-400">Cove CRM</h1>
          </div>
          <div className="space-x-4">
            <Link href="/login">
              <button className="text-sm text-slate-300 hover:text-white font-medium cursor-pointer transition">
                Login
              </button>
            </Link>
            <Link href="/signup">
              <button className="bg-blue-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-blue-500 text-sm cursor-pointer transition shadow-sm shadow-blue-600/20">
                Start Free Trial
              </button>
            </Link>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="relative text-white py-24 px-6 text-center overflow-hidden bg-[#020617]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-blue-600/15 blur-3xl" />
            <div className="absolute top-32 right-[-10rem] h-72 w-[36rem] rounded-full bg-purple-500/10 blur-3xl" />
          </div>

          <div className="relative">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              The #1 CRM for Life Insurance Sales
            </h1>
            <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8">
              Built for agents. Powered by AI. Close more, faster.
            </p>
            <Link href="/signup">
              <button className="bg-white text-black px-8 py-3 rounded-lg font-medium hover:bg-gray-100 transition cursor-pointer">
                Start Free Trial
              </button>
            </Link>
            <p className="text-sm mt-4 opacity-70">3-day free trial</p>
          </div>
        </section>




        {/* Features + Flagship AI Section */}
        <section className="py-20 px-6 max-w-6xl mx-auto space-y-10">
          <div className="text-center mb-4">
            <h2 className="text-3xl font-bold mb-2">
              Everything you need to sell more policies
            </h2>
            <p className="text-sm md:text-base text-slate-300 max-w-2xl mx-auto">
              A modern command center for high-performing agents — combining a
              full CRM with intelligent calling and texting that works for you
              around the clock.
            </p>
          </div>

          {/* Flagship: AI Dialer */}
          <div className="bg-[#020617] text-white rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">
                Flagship Feature
              </p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI Dialer – Your 24/7 Appointment Setter 
                <span className="ml-3 inline-flex items-center rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 px-3 py-1 text-xs font-bold text-white shadow-lg animate-pulse">
                  Join AI Dialer Waitlist
                </span>
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                A fully autonomous calling agent that dials your leads, is
                trained on proven insurance scripts, rebuttals, and overcoming
                objections, and books real appointments directly on your
                calendar — all while you focus on closing.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• Calls through your existing Cove numbers.</li>
                <li>
                  • Uses your lead types to stay on-message for mortgage
                  protection, final expense, and more.
                </li>
                <li>
                  • Books appointments into your real Google Calendar in the
                  correct time zone.
                </li>
                <li>
                  • Runs quietly in the background while you work, travel, or
                  take the day off.
                </li>
              </ul>
            </div>

            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Automated Calling Engine
                </p>
                <p className="text-center leading-relaxed">
                  Turn entire folders of leads into booked appointments without
                  manually dialing a single number.
                </p>
              </div>
            </div>
          </div>

          {/* Flagship: AI SMS Assistant */}
          <div className="bg-[#020617] text-white rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">
                Flagship Feature
              </p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI SMS Assistant – Always-On Follow-Up
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Your built-in texting assistant that nurtures leads, chases
                no-shows, and reschedules missed appointments — all using
                tested, compliant scripts tailored for life insurance.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• 2-way conversations in your existing SMS inbox.</li>
                <li>
                  • Plays the long game with proven drips for every lead type.
                </li>
                <li>
                  • Automatically follows up with no-shows and missed
                  appointments.
                </li>
                <li>• Keeps everything documented inside Cove conversations.</li>
              </ul>
            </div>

            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Intelligent Follow-Up
                </p>
                <p className="text-center leading-relaxed">
                  Make sure every lead is contacted, followed up with, and
                  rescheduled — without adding more to your daily to-do list.
                </p>
              </div>
            </div>
          </div>

          {/* Flagship: AI Call Overview */}
          <div className="bg-[#020617] text-white rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">
                Flagship Feature
              </p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI Call Overview – Every Call Auto-Summarized
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Every call is automatically summarized so you can scan what happened in seconds and know exactly what to do next.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• AI Call Overview: every call auto-summarized with key details, objections, next steps</li>
                <li>• Saves time for agents and makes follow-up way faster.</li>
                <li>• Stored directly inside the lead profile for quick review.</li>
              </ul>
            </div>

            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Instant Call Recap
                </p>
                <p className="text-center leading-relaxed">
                  Get the highlights, objections, and next steps without replaying recordings.
                </p>
              </div>
            </div>
          </div>

          {/* Core CRM Features Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Power Dialer",
                "Call leads from any number with automatic logging and simple one-click controls.",
              ],
              [
                "2-Way SMS Inbox",
                "Text back and forth with leads in real time. Every conversation is tracked in one place.",
              ],
              [
                "Google Calendar Sync",
                "Appointments sync instantly with your real calendar, two-way, so your schedule is always accurate.",
              ],
              [
                "Lead Import + Smart Folders",
                "Upload from CSV or Google Sheets and automatically organize leads by type and source.",
              ],
              [
                "Built-In Affiliate Program",
                "Earn recurring commissions by sharing your referral link, built directly into the CRM.",
              ],
              [
                "Prebuilt Drip Campaigns",
                "Turn on proven text drips for every lead type plus client retention and referral collection.",
              ],
              [
                "No-Show & Missed Appointment Rescheduling",
                "Automatically text no-shows and missed appointments to reschedule without you lifting a finger.",
              ],
              [
                "Local Presence Dialing",
                "Use local area codes so more leads pick up your calls.",
              ],
            ].map(([title, description], i) => (
              <div
                key={i}
                className="rounded-2xl p-6 border border-white/10 bg-white/5 hover:bg-white/10 transition cursor-pointer shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
              >
                <h3 className="font-bold text-lg mb-2">{title}</h3>
                <p className="text-slate-300 text-sm leading-relaxed">
                  {description}
                </p>
              </div>
            ))}
          </div>

        </section>

        {/* Product Screenshots */}
        <section className="py-14 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="text-xs tracking-[0.22em] uppercase text-slate-400 px-2 pt-2 pb-3">
                  Dashboard
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
                  <Image
                    src="/landing/dashboard.png"
                    alt="Cove CRM dashboard screenshot"
                    width={1400}
                    height={900}
                    className="w-full h-auto"
                    priority
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="text-xs tracking-[0.22em] uppercase text-slate-400 px-2 pt-2 pb-3">
                  Affiliate Program
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
                  <Image
                    src="/landing/affiliate-25refs.png"
                    alt="Cove CRM affiliate program screenshot"
                    width={1400}
                    height={900}
                    className="w-full h-auto"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Comparison Section */}
        <section className="py-14 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold">See How CoveCRM Compares</h2>
              <p className="text-slate-300 mt-3 max-w-3xl mx-auto">
                Built specifically for high-volume outbound life insurance sales — not adapted from marketing-first systems.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] p-6 md:p-8">
              {/* Legend */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="text-xs tracking-[0.22em] uppercase text-slate-400">
                  Comparison (Insurance Use Case)
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                    Native / Included
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 border border-white/10">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="rgb(148 163 184)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 6l12 12" />
                        <path d="M18 6l-12 12" />
                      </svg>
                    </span>
                    Not available
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 border border-white/10 text-slate-200 font-semibold">
                      ~
                    </span>
                    Add-on / Integrations
                  </span>
                </div>
              </div>

              {/* Header Row */}
              <div className="grid grid-cols-6 gap-3 px-3 py-3 rounded-2xl bg-[#020617]/60 border border-white/10 text-slate-200 text-sm font-semibold">
                <div className="col-span-2">Feature</div>
                <div className="text-center">CoveCRM</div>
                <div className="text-center">Ringy</div>
                <div className="text-center">Close</div>
                <div className="text-center">GHL</div>
              </div>

              {/* Rows */}
              <div className="mt-3 space-y-2 text-sm">
                {[
                  {
                    feature: "Full CRM platform",
                    cove: "yes",
                    ringy: "yes",
                    close: "yes",
                    ghl: "yes",
                  },
                  {
                    feature: "Native power dialer",
                    cove: "yes",
                    ringy: "maybe",
                    close: "yes",
                    ghl: "maybe",
                  },
                  {
                    feature: "Native AI voice dialer",
                    cove: "yes",
                    ringy: "no",
                    close: "no",
                    ghl: "no",
                  },
                  {
                    feature: "AI SMS (built-in)",
                    cove: "yes",
                    ringy: "no",
                    close: "no",
                    ghl: "maybe",
                  },
                  {
                    feature: "Insurance-focused templates",
                    cove: "yes",
                    ringy: "maybe",
                    close: "no",
                    ghl: "no",
                  },
                  {
                    feature: "Twilio A2P automation (handled for you)",
                    cove: "yes",
                    ringy: "no",
                    close: "no",
                    ghl: "no",
                  },
                  {
                    feature: "Per-user subaccount compliance architecture",
                    cove: "yes",
                    ringy: "no",
                    close: "no",
                    ghl: "maybe",
                  },
                ].map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-6 gap-3 px-3 py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                  >
                    <div className="col-span-2 text-slate-200 font-medium">
                      {row.feature}
                    </div>

                    {["cove", "ringy", "close", "ghl"].map((k) => {
                      const v = (row as any)[k];
                      if (v === "yes") {
                        return (
                          <div key={k} className="flex justify-center">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm">
                              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            </span>
                          </div>
                        );
                      }
                      if (v === "maybe") {
                        return (
                          <div key={k} className="flex justify-center">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10 text-slate-200 font-bold">
                              ~
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div key={k} className="flex justify-center">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="rgb(148 163 184)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 6l12 12" />
                              <path d="M18 6l-12 12" />
                            </svg>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Why Block */}
              <div className="mt-8 rounded-2xl border border-white/10 bg-[#020617]/60 p-6">
                <h3 className="text-xl font-bold">Why Teams Choose CoveCRM</h3>
                <p className="text-slate-300 mt-2 max-w-3xl">
                  CoveCRM was designed around outbound insurance workflows from day one — so you don’t have to stitch together third-party tools.
                </p>

                <div className="grid gap-3 mt-5 md:grid-cols-2 text-slate-200">
                  {[
                    "Dialer-first workflow built for agent speed",
                    "Native AI voice assistance",
                    "Automated Twilio A2P handling",
                    "Insurance-ready campaigns and templates",
                  ].map((t, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </span>
                      <span className="text-sm leading-relaxed">{t}</span>
                    </div>
                  ))}
                </div>

                <p className="text-[12px] text-slate-400 mt-6 leading-relaxed">
                  Product names and trademarks are property of their respective owners. Comparison is based on publicly available information and may vary by plan.
                </p>
              </div>
            </div>
          </div>
        </section>





{/* Pricing Section */}
        <section className="py-20 px-6 text-center bg-[#020617]">
          <h2 className="text-3xl font-bold mb-6">
            Simple, transparent pricing
          </h2>
          <div className="max-w-3xl mx-auto rounded-3xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] p-10">
            <h3 className="text-2xl font-bold mb-2">Cove CRM</h3>
            <p className="text-4xl font-bold mb-2">$199.99/mo</p>
            <p className="text-sm text-slate-400 mb-4">
              + tax &amp; call/SMS usage
            </p>
            <ul className="text-left text-slate-200 mb-6">
              <li className="mb-2">✔ Unlimited users per account</li>
              <li className="mb-2">
                ✔ Includes dialer, texting, and lead management
              </li>
              <li className="mb-2">✔ 3-day free trial included</li>
            </ul>
            <p className="text-lg font-medium mb-4">
              AI Upgrade (optional): +$50/month
            </p>
            <Link href="/signup">
              <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-500 cursor-pointer transition shadow-sm shadow-blue-600/20">
                Start My Free Trial
              </button>
            </Link>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 text-center px-6 bg-[#0b1225] text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to get started?
          </h2>
          <p className="text-lg mb-8">
            Join hundreds of top agents using Cove CRM to dominate telesales.
          </p>
          <Link href="/signup">
            <button className="bg-white text-black px-8 py-3 rounded-lg font-semibold hover:bg-slate-100 cursor-pointer transition">
              Start Free Trial Now
            </button>
          </Link>
        </section>

        {/* Footer */}
        <footer className="py-10 text-center text-sm text-slate-400 space-y-2 bg-[#020617] border-t border-white/10">
          <div>
            <Link
              href="https://www.covecrm.com/legal/privacy"
              className="text-slate-400 hover:text-white underline mx-2 transition"
            >
              Privacy Policy
            </Link>
            <span className="text-slate-500">•</span>
            <Link
              href="https://www.covecrm.com/legal/terms"
              className="text-slate-400 hover:text-white underline mx-2 transition"
            >
              Terms of Service
            </Link>
          </div>
          <p>© {new Date().getFullYear()} Cove CRM. All rights reserved.</p>
        </footer>
      </main>
    </>
  );
}
