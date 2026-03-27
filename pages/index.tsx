// /pages/index.tsx
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";

const WHATS_NEW = [
  "AI Call Coach",
  "Lead Scoring",
  "Pipeline Board",
  "Facebook Lead Manager",
  "Agent Recruiting",
  "Team Leaderboard",
  "Daily Performance Digest",
  "Voicemail Drop",
];

export default function Home() {
  return (
    <>
      <Head>
        <title>Cove CRM – The #1 CRM for Life Insurance Sales</title>
        <meta
          name="description"
          content="Close more deals with Cove CRM. Built for life insurance telesales agents. AI Call Coach, AI Dialer, SMS automation, Facebook Lead Manager, and agent recruiting — all in one platform."
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

        {/* What's New Strip */}
        <div className="border-b border-white/10 bg-[#020617]/80 py-2.5 px-6 overflow-x-auto">
          <div className="flex items-center gap-3 max-w-6xl mx-auto">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-wider shrink-0">New:</span>
            <div className="flex items-center gap-2 flex-wrap">
              {WHATS_NEW.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-full bg-blue-600/15 border border-blue-500/25 px-3 py-1 text-xs font-medium text-blue-300"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <section className="relative text-white py-24 px-6 text-center overflow-hidden bg-[#020617]">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-blue-600/15 blur-3xl" />
            <div className="absolute top-32 right-[-10rem] h-72 w-[36rem] rounded-full bg-purple-500/10 blur-3xl" />
          </div>

          <div className="relative max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-600/15 border border-blue-500/25 px-4 py-1.5 text-xs font-medium text-blue-300 mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Built exclusively for life insurance telesales
            </div>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
              Sell More Policies.<br />
              <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                Work Smarter.
              </span>
            </h1>
            <p className="text-lg md:text-xl max-w-2xl mx-auto mb-8 text-slate-300">
              The complete sales platform for high-volume insurance agents — AI dialer, AI call coach, SMS automation, Facebook lead manager, and team recruiting, all in one place.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <button className="bg-blue-600 text-white px-8 py-3.5 rounded-lg font-semibold hover:bg-blue-500 transition cursor-pointer shadow-lg shadow-blue-600/25 text-base">
                  Start Free Trial
                </button>
              </Link>
              <Link href="/login">
                <button className="text-slate-300 hover:text-white font-medium text-base transition cursor-pointer">
                  Already have an account →
                </button>
              </Link>
            </div>
            <p className="text-sm mt-4 opacity-60">3-day free trial · No credit card required</p>
          </div>
        </section>

        {/* 3-Column Features Strip */}
        <section className="py-16 px-6 bg-[#020617]">
          <div className="max-w-6xl mx-auto grid gap-8 md:grid-cols-3">
            {[
              {
                icon: (
                  <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                  </svg>
                ),
                title: "Generate Leads",
                description: "Connect your Facebook lead forms or import from CSV and Google Sheets. Leads flow directly into organized folders, ready to work.",
                points: ["Facebook Lead Manager", "Google Sheets sync", "CSV import", "Smart folder organization"],
              },
              {
                icon: (
                  <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.5 3.5 0 01-4.95 0l-.347-.347z" />
                  </svg>
                ),
                title: "Work Leads Smarter",
                description: "AI lead scoring, follow-up nudges, and automated SMS drips keep you focused on your best opportunities at exactly the right time.",
                points: ["AI lead scoring (0-100)", "Smart follow-up nudges", "Prebuilt drip campaigns", "Lead aging alerts"],
              },
              {
                icon: (
                  <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                title: "Close More Deals",
                description: "The AI Call Coach scores every call and gives you specific feedback to improve. Combined with the AI dialer, you close more with less effort.",
                points: ["AI Call Coach scoring", "Objection library", "Power dialer + AI dialer", "Visual pipeline board"],
              },
            ].map((col, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-6 hover:bg-white/8 transition">
                <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center mb-4">
                  {col.icon}
                </div>
                <h3 className="text-white font-bold text-lg mb-2">{col.title}</h3>
                <p className="text-slate-300 text-sm mb-4 leading-relaxed">{col.description}</p>
                <ul className="space-y-1.5">
                  {col.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Flagship Features */}
        <section className="py-20 px-6 max-w-6xl mx-auto space-y-10">
          <div className="text-center mb-4">
            <h2 className="text-3xl font-bold mb-2">Everything you need to sell more policies</h2>
            <p className="text-sm md:text-base text-slate-300 max-w-2xl mx-auto">
              A modern command center for high-performing agents — combining a full CRM with intelligent calling, texting, and coaching that works for you around the clock.
            </p>
          </div>

          {/* Flagship: AI Call Coach */}
          <div className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-[#0d1a35] to-[#020617] px-8 py-10 md:px-12 md:py-12 shadow-xl shadow-blue-900/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs tracking-[0.2em] uppercase text-blue-400 font-semibold">New Feature</span>
                <span className="rounded-full bg-blue-600/20 border border-blue-500/30 px-2 py-0.5 text-xs text-blue-300">AI-Powered</span>
              </div>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI Call Coach – Improve Every Call
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                After every call, your AI Coach analyzes the transcript and scores you across 6 categories — opening, rapport, discovery, presentation, objection handling, and closing. Get specific feedback on what went well and exactly what to improve.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• Overall call score (1-10) with detailed breakdown per category.</li>
                <li>• See every objection encountered and the ideal rebuttal you should have used.</li>
                <li>• Track your coaching score trend over time to measure real improvement.</li>
                <li>• Automatically generated after every call — no extra steps required.</li>
              </ul>
            </div>
            <div className="border border-blue-500/25 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between bg-blue-950/30">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-blue-400 mb-2 text-center">
                  Score Breakdown
                </p>
                <div className="space-y-3">
                  {[
                    ["Opening", 9],
                    ["Rapport", 8],
                    ["Discovery", 7],
                    ["Presentation", 8],
                    ["Objections", 6],
                    ["Closing", 7],
                  ].map(([label, score]) => (
                    <div key={label as string} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-20 text-right">{label}</span>
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${Number(score) >= 8 ? "bg-green-500" : Number(score) >= 6 ? "bg-yellow-500" : "bg-red-500"}`}
                          style={{ width: `${(Number(score) / 10) * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold ${Number(score) >= 8 ? "text-green-400" : Number(score) >= 6 ? "text-yellow-400" : "text-red-400"}`}>{score}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Flagship: AI Dialer */}
          <div className="bg-[#020617] text-white rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">
                Flagship Feature
              </p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI Dialer – Your 24/7 Appointment Setter{" "}
                <span className="ml-3 inline-flex items-center rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 px-3 py-1 text-xs font-bold text-white shadow-lg animate-pulse">
                  Join Waitlist
                </span>
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                A fully autonomous calling agent that dials your leads, handles objections using proven insurance scripts, and books real appointments directly on your Google Calendar — all while you focus on closing.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• Calls through your existing Cove numbers.</li>
                <li>• Uses your lead types to stay on-message for mortgage protection, final expense, and more.</li>
                <li>• Books appointments into your real Google Calendar in the correct time zone.</li>
                <li>• Runs quietly in the background while you work, travel, or take the day off.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Automated Calling Engine
                </p>
                <p className="text-center leading-relaxed">
                  Turn entire folders of leads into booked appointments without manually dialing a single number.
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
                Your built-in texting assistant that nurtures leads, chases no-shows, and reschedules missed appointments — all using tested, compliant scripts tailored for life insurance.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• 2-way conversations in your existing SMS inbox.</li>
                <li>• Plays the long game with proven drips for every lead type.</li>
                <li>• Automatically follows up with no-shows and missed appointments.</li>
                <li>• Keeps everything documented inside Cove conversations.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Intelligent Follow-Up
                </p>
                <p className="text-center leading-relaxed">
                  Make sure every lead is contacted, followed up with, and rescheduled — without adding more to your daily to-do list.
                </p>
              </div>
            </div>
          </div>

          {/* Flagship: Facebook Lead Manager */}
          <div className="bg-[#020617] text-white rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">
                New Feature
              </p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                Facebook Lead Manager – Leads on Autopilot
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Connect your Facebook lead forms directly to Cove. New leads are automatically imported, scored, organized into folders, and enrolled in drip campaigns — the moment they fill out your ad.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• Real-time webhook delivery from Facebook Lead Ads.</li>
                <li>• Supports final expense, IUL, mortgage protection, veteran, and trucker campaigns.</li>
                <li>• Auto-creates folders per campaign for easy organization.</li>
                <li>• Duplicate detection prevents paying to work the same lead twice.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Lead Flow Automation
                </p>
                <p className="text-center leading-relaxed">
                  From Facebook ad to booked appointment with zero manual entry — every lead is automatically ready to work.
                </p>
              </div>
            </div>
          </div>

          {/* Flagship: Agent Recruiting */}
          <div className="bg-[#020617] text-white rounded-3xl px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">
                New Feature
              </p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                Agent Recruiting – Build Your Team Inside Cove
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Invite agents, track team performance with leaderboards, and manage your downline — all from your Cove dashboard. No separate platform needed.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• Invite agents via email and manage team access centrally.</li>
                <li>• Real-time leaderboard: dials, contacts, and bookings by agent.</li>
                <li>• Built-in affiliate program to earn recurring commissions by referring other agents.</li>
                <li>• Visual pipeline board to see where every lead stands.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 max-w-xs self-stretch flex flex-col justify-between">
              <div>
                <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">
                  Team Performance
                </p>
                <p className="text-center leading-relaxed">
                  See who's dialing, who's booking, and where each agent is falling behind — all in one leaderboard.
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
                Every call is automatically summarized so you can scan what happened in seconds and know exactly what to do next — no replaying recordings.
              </p>
              <ul className="text-xs md:text-sm text-gray-300 space-y-2">
                <li>• AI Call Overview: every call auto-summarized with key details, objections, next steps.</li>
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
              ["Power Dialer", "Call leads from any number with automatic logging and one-click controls."],
              ["2-Way SMS Inbox", "Text back and forth with leads in real time. Every conversation tracked in one place."],
              ["Google Calendar Sync", "Appointments sync instantly with your real calendar, two-way, so your schedule is always accurate."],
              ["Lead Import + Smart Folders", "Upload from CSV or Google Sheets and automatically organize leads by type and source."],
              ["Voicemail Drop", "Drop a pre-recorded voicemail with one click and move on to the next dial."],
              ["Prebuilt Drip Campaigns", "Turn on proven text drips for every lead type plus client retention and referral collection."],
              ["No-Show Rescheduling", "Automatically text no-shows and missed appointments to reschedule without lifting a finger."],
              ["Local Presence Dialing", "Use local area codes so more leads pick up your calls."],
            ].map(([title, description], i) => (
              <div
                key={i}
                className="rounded-2xl p-6 border border-white/10 bg-white/5 hover:bg-white/10 transition cursor-pointer shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
              >
                <h3 className="font-bold text-lg mb-2">{title}</h3>
                <p className="text-slate-300 text-sm leading-relaxed">{description}</p>
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
              <p className="text-xs text-slate-400 mt-3 max-w-4xl mx-auto leading-relaxed">
                Note: Many CRMs now offer AI-assisted features. CoveCRM's AI is purpose-built for life insurance outbound — built directly into calling, call coaching, and automated follow-up, not just a generic add-on.
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
                        <path d="M6 6l12 12" /><path d="M18 6l-12 12" />
                      </svg>
                    </span>
                    Not available
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 border border-white/10 text-slate-200 font-semibold">~</span>
                    Add-on / Integration
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
                  { feature: "Full CRM platform", cove: "yes", ringy: "yes", close: "yes", ghl: "yes" },
                  { feature: "Native power dialer", cove: "yes", ringy: "maybe", close: "yes", ghl: "maybe" },
                  { feature: "Native AI voice dialer", cove: "yes", ringy: "no", close: "no", ghl: "no" },
                  { feature: "AI Call Coach", cove: "yes", ringy: "no", close: "no", ghl: "no" },
                  { feature: "AI SMS (built-in)", cove: "yes", ringy: "no", close: "no", ghl: "maybe" },
                  { feature: "Facebook Lead Manager", cove: "yes", ringy: "no", close: "maybe", ghl: "maybe" },
                  { feature: "Agent Recruiting Tools", cove: "yes", ringy: "no", close: "no", ghl: "maybe" },
                  { feature: "Insurance-focused templates", cove: "yes", ringy: "maybe", close: "no", ghl: "no" },
                  { feature: "Twilio A2P automation (handled for you)", cove: "yes", ringy: "no", close: "no", ghl: "no" },
                ].map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-6 gap-3 px-3 py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
                  >
                    <div className="col-span-2 text-slate-200 font-medium">{row.feature}</div>
                    {["cove", "ringy", "close", "ghl"].map((k) => {
                      const v = (row as any)[k];
                      if (v === "yes")
                        return (
                          <div key={k} className="flex justify-center">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm">
                              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            </span>
                          </div>
                        );
                      if (v === "maybe")
                        return (
                          <div key={k} className="flex justify-center">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10 text-slate-200 font-bold">~</span>
                          </div>
                        );
                      return (
                        <div key={k} className="flex justify-center">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="rgb(148 163 184)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M6 6l12 12" /><path d="M18 6l-12 12" />
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
                <h3 className="text-xl font-bold">Why Agents Choose CoveCRM</h3>
                <p className="text-slate-300 mt-2 max-w-3xl">
                  CoveCRM was designed around outbound insurance workflows from day one — with AI coaching, lead automation, and team tools built in, not bolted on.
                </p>
                <div className="grid gap-3 mt-5 md:grid-cols-2 text-slate-200">
                  {[
                    "AI Call Coach scores every call and shows you exactly how to improve",
                    "Dialer-first workflow built for agent speed",
                    "Facebook leads automatically imported, scored, and enrolled in drips",
                    "Build and manage your downline inside the same platform you use to sell",
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

        {/* Testimonials */}
        <section className="py-16 px-6 bg-[#020617]">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold">What Agents Are Saying</h2>
              <p className="text-slate-400 mt-2">Real results from real life insurance agents.</p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {[
                {
                  quote: "The AI Call Coach is a game changer. I finally know exactly what objections I'm not handling well — and the suggested rebuttals are spot on for final expense.",
                  name: "Marcus T.",
                  role: "Final Expense Agent · Texas",
                  score: "Avg Call Score: 8.2",
                },
                {
                  quote: "I was spending 2 hours a day manually importing Facebook leads. Now it's zero. They come in, get scored, drop into a folder, and the drip starts — I just dial.",
                  name: "Jasmine R.",
                  role: "Mortgage Protection Agent · Florida",
                  score: "60+ leads/week automated",
                },
                {
                  quote: "I recruited 4 agents and run the whole team out of Cove. The leaderboard keeps everyone competitive and I don't have to babysit dials anymore.",
                  name: "Derek M.",
                  role: "Agency Owner · Georgia",
                  score: "4-agent downline",
                },
              ].map((t, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <div className="flex gap-1 mb-3">
                    {[...Array(5)].map((_, s) => (
                      <svg key={s} className="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                  <p className="text-slate-200 text-sm leading-relaxed mb-4">"{t.quote}"</p>
                  <div>
                    <div className="font-semibold text-white text-sm">{t.name}</div>
                    <div className="text-xs text-slate-400">{t.role}</div>
                    <div className="text-xs text-blue-400 mt-1">{t.score}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-20 px-6 text-center bg-[#020617]">
          <h2 className="text-3xl font-bold mb-3">Simple, transparent pricing</h2>
          <p className="text-slate-400 mb-10 max-w-xl mx-auto text-sm">No per-seat fees, no surprise add-ons. One flat monthly rate covers your whole operation.</p>

          <div className="max-w-5xl mx-auto grid gap-6 md:grid-cols-3">
            {/* Core Plan */}
            <div className="rounded-3xl border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] p-8 text-left">
              <h3 className="text-xl font-bold mb-1">Cove CRM</h3>
              <p className="text-4xl font-bold mb-1">$199.99<span className="text-lg font-normal text-slate-400">/mo</span></p>
              <p className="text-xs text-slate-400 mb-5">+ tax &amp; call/SMS usage</p>
              <ul className="text-sm text-slate-200 space-y-2 mb-6">
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Unlimited users per account</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Power dialer, SMS inbox, lead management</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Google Calendar sync + booking forms</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Prebuilt drip campaigns</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> 3-day free trial included</li>
              </ul>
              <Link href="/signup">
                <button className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-500 cursor-pointer transition font-semibold">
                  Start Free Trial
                </button>
              </Link>
            </div>

            {/* AI Upgrade */}
            <div className="rounded-3xl border border-blue-500/40 bg-gradient-to-b from-blue-950/40 to-[#020617] shadow-xl shadow-blue-900/20 p-8 text-left relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-1 text-xs font-bold text-white shadow">Most Popular</div>
              <h3 className="text-xl font-bold mb-1">Cove CRM + AI</h3>
              <p className="text-4xl font-bold mb-1">$249.99<span className="text-lg font-normal text-slate-400">/mo</span></p>
              <p className="text-xs text-slate-400 mb-5">+ tax &amp; call/SMS usage</p>
              <ul className="text-sm text-slate-200 space-y-2 mb-6">
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Everything in Cove CRM</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> AI Call Coach — score + feedback every call</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> AI Call Overview — auto-summarized after every call</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> AI SMS Assistant — automated follow-up</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> AI lead scoring + nudges</li>
              </ul>
              <Link href="/signup">
                <button className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-500 cursor-pointer transition font-semibold">
                  Start Free Trial
                </button>
              </Link>
            </div>

            {/* Agency / Team */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-left">
              <h3 className="text-xl font-bold mb-1">Agency &amp; Teams</h3>
              <p className="text-2xl font-bold mb-1 text-slate-300">Contact Us</p>
              <p className="text-xs text-slate-400 mb-5">Custom pricing for agencies</p>
              <ul className="text-sm text-slate-200 space-y-2 mb-6">
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Everything in Cove CRM + AI</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Agent recruiting + team leaderboard</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Facebook Lead Manager for multiple campaigns</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> AI Dialer waitlist priority access</li>
                <li className="flex gap-2 items-start"><span className="text-blue-400 mt-0.5">✔</span> Dedicated onboarding support</li>
              </ul>
              <a href="mailto:support@covecrm.com">
                <button className="w-full border border-white/20 text-white px-6 py-3 rounded-lg hover:bg-white/10 cursor-pointer transition font-semibold">
                  Contact Sales
                </button>
              </a>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 text-center px-6 bg-[#0b1225] text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to close more deals?
          </h2>
          <p className="text-lg mb-8 text-slate-300 max-w-xl mx-auto">
            Join hundreds of top life insurance agents using Cove CRM to sell smarter and grow their teams.
          </p>
          <Link href="/signup">
            <button className="bg-white text-black px-8 py-3 rounded-lg font-semibold hover:bg-slate-100 cursor-pointer transition text-base">
              Start Free Trial Now
            </button>
          </Link>
          <p className="text-sm mt-4 text-slate-500">3-day free trial · No credit card required</p>
        </section>

        {/* Footer */}
        <footer className="py-10 px-6 bg-[#020617] border-t border-white/10">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <Image src="/logo.png" alt="Cove CRM" width={24} height={24} />
              <span className="font-semibold text-slate-300">Cove CRM</span>
              <span className="hidden md:inline text-slate-600">·</span>
              <span className="hidden md:inline text-slate-500">Built for life insurance telesales</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="https://www.covecrm.com/legal/privacy" className="hover:text-white transition underline">
                Privacy Policy
              </Link>
              <span className="text-slate-600">·</span>
              <Link href="https://www.covecrm.com/legal/terms" className="hover:text-white transition underline">
                Terms of Service
              </Link>
            </div>
            <p>© {new Date().getFullYear()} Cove CRM. All rights reserved.</p>
          </div>
        </footer>
      </main>
    </>
  );
}
