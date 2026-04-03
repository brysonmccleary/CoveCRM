// /pages/index.tsx
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";

const WHATS_NEW = [
  "AI Call Coach",
  "AI Dial Sessions",
  "Lead Scoring",
  "Pipeline Board",
  "Facebook Lead Manager",
  "Meta Native Webhook",
  "Team Leaderboard",
  "Daily Performance Digest",
];

const FEATURES = [
  {
    icon: (
      <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
      </svg>
    ),
    color: "from-blue-600/20 to-blue-800/10",
    border: "border-blue-500/20",
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
    color: "from-purple-600/20 to-purple-800/10",
    border: "border-purple-500/20",
    title: "Work Leads Smarter",
    description: "AI lead scoring, follow-up nudges, and automated SMS drips keep you focused on your best opportunities at exactly the right time.",
    points: ["AI lead scoring (0–100)", "Smart follow-up nudges", "Prebuilt drip campaigns", "Lead aging alerts"],
  },
  {
    icon: (
      <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "from-emerald-600/20 to-emerald-800/10",
    border: "border-emerald-500/20",
    title: "Close More Deals",
    description: "The AI Call Coach scores every call and gives you specific feedback to improve. Combined with the AI dialer, you close more with less effort.",
    points: ["AI Call Coach scoring", "Objection library", "Power dialer + AI dialer", "Visual pipeline board"],
  },
];

const TESTIMONIALS = [
  {
    quote: "I closed 3 policies in my first week from the recruiting leads. The AI follow-up texting is unreal — leads were responding at midnight while I was asleep.",
    name: "Marcus T.",
    role: "Final Expense Agent · Texas",
    stat: "Avg Call Score: 8.2",
  },
  {
    quote: "The AI call coach helped me stop losing deals on the 'need to think about it' objection. My close rate went up within the first two weeks.",
    name: "Jennifer K.",
    role: "Mortgage Protection Agent · Florida",
    stat: "60+ leads/week automated",
  },
  {
    quote: "I was spending $800/month on leads. Now I run my own Facebook ads for $149/month and own every lead. The attribution report shows exactly what's working.",
    name: "David R.",
    role: "Insurance Agency Owner · Georgia",
    stat: "4-agent downline",
  },
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
        <nav className="flex justify-between items-center py-5 px-6 border-b border-white/10 bg-[#020617]/60 backdrop-blur supports-[backdrop-filter]:bg-[#020617]/40 sticky top-0 z-40">
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
        <section className="relative text-white py-28 px-6 text-center overflow-hidden bg-[#020617]">
          {/* Background glows */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-96 w-[56rem] -translate-x-1/2 rounded-full bg-blue-600/12 blur-3xl" />
            <div className="absolute top-32 right-[-10rem] h-72 w-[36rem] rounded-full bg-purple-500/8 blur-3xl" />
            <div className="absolute bottom-0 left-[-8rem] h-64 w-[32rem] rounded-full bg-cyan-500/6 blur-3xl" />
          </div>

          {/* Floating stat badges */}
          <div className="pointer-events-none absolute inset-0 hidden md:block">
            <div className="absolute top-16 left-[8%] flex items-center gap-2 bg-white/5 border border-white/10 backdrop-blur-sm rounded-full px-4 py-2 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              2,400+ agents
            </div>
            <div className="absolute top-28 right-[7%] flex items-center gap-2 bg-white/5 border border-white/10 backdrop-blur-sm rounded-full px-4 py-2 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              1.2M leads managed
            </div>
            
          </div>

          <div className="relative max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-600/15 border border-blue-500/25 px-4 py-1.5 text-xs font-medium text-blue-300 mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Built exclusively for life insurance telesales
            </div>

            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-[1.08] tracking-tight">
              Sell More Policies.<br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-300 bg-clip-text text-transparent">
                Work Smarter.
              </span>
            </h1>

            {/* Glow line */}
            <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent mx-auto mb-6" />

            <p className="text-lg md:text-xl max-w-2xl mx-auto mb-6 text-slate-300 leading-relaxed">
              CoveCRM is an AI-powered sales system that calls leads, texts leads, follows up, books appointments, and coaches you — automatically.
            </p>
            <p className="text-sm text-slate-500 mb-8">
              Built specifically for high-volume life insurance agents.
            </p>

            

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <button className="relative bg-blue-600 text-white px-10 py-4 rounded-xl font-bold hover:bg-blue-500 transition cursor-pointer text-base shadow-[0_0_24px_rgba(59,130,246,0.35)] border border-blue-500/50 hover:shadow-[0_0_36px_rgba(59,130,246,0.5)]">
                  Start Free Trial
                  <span className="absolute inset-0 rounded-xl animate-pulse border border-blue-400/30 pointer-events-none" />
                </button>
              </Link>
              <Link href="/login">
                <button className="text-slate-300 hover:text-white font-medium text-base transition cursor-pointer">
                  Already have an account →
                </button>
              </Link>
            </div>
            <p className="text-sm mt-4 text-slate-500">3-day free trial · No credit card required</p>
          </div>
        </section>

        {/* 3-Column Features Strip */}
        <section className="py-20 px-6 bg-[#020617]">
          <div className="max-w-6xl mx-auto text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Everything you need to dominate your market</h2>
            <div className="w-16 h-0.5 bg-blue-500 mx-auto mt-4" />
          </div>
          <div className="max-w-6xl mx-auto grid gap-6 md:grid-cols-3">
            {FEATURES.map((col, i) => (
              <div
                key={i}
                className={`rounded-2xl border ${col.border} bg-gradient-to-br ${col.color} p-7 hover:border-opacity-60 transition group`}
              >
                <div className="h-12 w-12 rounded-xl bg-white/10 flex items-center justify-center mb-5 group-hover:bg-white/15 transition">
                  {col.icon}
                </div>
                <h3 className="text-white font-bold text-xl mb-3">{col.title}</h3>
                <p className="text-slate-300 text-sm mb-5 leading-relaxed">{col.description}</p>
                <ul className="space-y-2">
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

        {/* AI Call Coach — Full Width Feature */}
        <section className="py-20 px-6 bg-[#030d1f]">
          <div className="max-w-6xl mx-auto">
            <div className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-[#0d1a35] to-[#020617] px-8 py-10 md:px-14 md:py-14 shadow-2xl shadow-blue-900/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-10">
              <div className="max-w-xl">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs tracking-[0.2em] uppercase text-blue-400 font-semibold">Flagship Feature</span>
                  <span className="rounded-full bg-blue-600/20 border border-blue-500/30 px-2 py-0.5 text-xs text-blue-300">AI-Powered</span>
                </div>
                <h3 className="text-3xl md:text-4xl font-bold mb-5 leading-tight">
                  AI Call Coach –<br />Improve Every Call
                </h3>
                <p className="text-base text-gray-200 mb-6 leading-relaxed">
                  After every call, your AI Coach analyzes the transcript and scores you across 6 categories — opening, rapport, discovery, presentation, objection handling, and closing. Get specific feedback on what went well and exactly what to improve.
                </p>
                <ul className="text-sm text-gray-300 space-y-2.5">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">✔</span>
                    Overall call score (1–10) with detailed breakdown per category
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">✔</span>
                    See every objection encountered and the ideal rebuttal you should have used
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">✔</span>
                    Track your coaching score trend over time to measure real improvement
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 mt-0.5">✔</span>
                    Automatically generated after every call — no extra steps required
                  </li>
                </ul>
              </div>

              {/* Mock Score Breakdown */}
              <div className="border border-blue-500/25 rounded-2xl px-7 py-6 text-sm text-gray-200 w-full md:w-72 flex-shrink-0 bg-blue-950/30">
                <p className="text-[10px] tracking-[0.25em] uppercase text-blue-400 mb-1 text-center">Call Report</p>
                <p className="text-center text-2xl font-bold text-white mb-4">8.2 <span className="text-sm font-normal text-gray-400">/ 10</span></p>
                <div className="space-y-3 mb-5">
                  {[
                    ["Opening", 9],
                    ["Rapport", 8],
                    ["Discovery", 7],
                    ["Presentation", 8],
                    ["Objections", 6],
                    ["Closing", 7],
                  ].map(([label, score]) => (
                    <div key={label as string} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-20 text-right shrink-0">{label}</span>
                      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${Number(score) >= 8 ? "bg-emerald-500" : Number(score) >= 6 ? "bg-yellow-500" : "bg-rose-500"}`}
                          style={{ width: `${(Number(score) / 10) * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold w-4 ${Number(score) >= 8 ? "text-emerald-400" : Number(score) >= 6 ? "text-yellow-400" : "text-rose-400"}`}>{score}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="bg-emerald-900/40 text-emerald-300 border border-emerald-700/30 text-[10px] px-2.5 py-1 rounded-full">Strong opening</span>
                    <span className="bg-emerald-900/40 text-emerald-300 border border-emerald-700/30 text-[10px] px-2.5 py-1 rounded-full">Good rapport</span>
                    <span className="bg-yellow-900/40 text-yellow-300 border border-yellow-700/30 text-[10px] px-2.5 py-1 rounded-full">Work on closing faster</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* More Flagship Features */}
        <section className="py-20 px-6 max-w-6xl mx-auto space-y-8">

          {/* AI Dialer */}
          <div className="bg-[#020617] text-white rounded-3xl border border-white/8 px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">Flagship Feature</p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI Dialer – Your 24/7 Appointment Setter{" "}
                <span className="ml-2 inline-flex items-center rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 px-3 py-1 text-xs font-bold text-white shadow-lg">
                  Join Waitlist
                </span>
              </h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                A fully autonomous calling agent that dials your leads, handles objections using proven insurance scripts, and books real appointments directly on your Google Calendar — all while you focus on closing.
              </p>
              <ul className="text-sm text-gray-300 space-y-2">
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Calls through your existing Cove numbers.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Uses your lead types to stay on-message for mortgage protection, final expense, and more.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Books appointments into your real Google Calendar in the correct time zone.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Runs quietly in the background while you work, travel, or take the day off.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 w-full md:max-w-xs flex flex-col justify-center bg-white/3">
              <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">Automated Calling Engine</p>
              <p className="text-center leading-relaxed text-gray-300">
                Turn entire folders of leads into booked appointments without manually dialing a single number.
              </p>
            </div>
          </div>

          {/* AI SMS Assistant */}
          <div className="bg-[#020617] text-white rounded-3xl border border-white/8 px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">Flagship Feature</p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">AI SMS Assistant – Always-On Follow-Up</h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Your built-in texting assistant that nurtures leads, chases no-shows, and reschedules missed appointments — all using tested, compliant scripts tailored for life insurance.
              </p>
              <ul className="text-sm text-gray-300 space-y-2">
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> 2-way conversations in your existing SMS inbox.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Plays the long game with proven drips for every lead type.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Automatically follows up with no-shows and missed appointments.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Keeps everything documented inside Cove conversations.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 w-full md:max-w-xs flex flex-col justify-center bg-white/3">
              <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">Intelligent Follow-Up</p>
              <p className="text-center leading-relaxed text-gray-300">
                Make sure every lead is contacted, followed up with, and rescheduled — without adding more to your daily to-do list.
              </p>
            </div>
          </div>

          {/* Facebook Lead Manager */}
          <div className="bg-[#020617] text-white rounded-3xl border border-white/8 px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">New Feature</p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">Facebook Lead Manager – Leads on Autopilot</h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Connect your Facebook lead forms directly to Cove. New leads are automatically imported, scored, organized into folders, and enrolled in drip campaigns — the moment they fill out your ad.
              </p>
              <ul className="text-sm text-gray-300 space-y-2">
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Real-time webhook delivery from Facebook Lead Ads — no Zapier needed.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Supports final expense, IUL, mortgage protection, veteran, and trucker campaigns.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Auto-creates folders per campaign for easy organization.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Duplicate detection prevents paying to work the same lead twice.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 w-full md:max-w-xs flex flex-col justify-center bg-white/3">
              <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">Lead Flow Automation</p>
              <p className="text-center leading-relaxed text-gray-300">
                From Facebook ad to booked appointment with zero manual entry — every lead is automatically ready to work.
              </p>
            </div>
          </div>

          {/* Agent Recruiting */}
          <div className="bg-[#020617] text-white rounded-3xl border border-white/8 px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">New Feature</p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">Agent Recruiting – Build Your Team Inside Cove</h3>
              <p className="text-sm md:text-base text-gray-200 mb-5 leading-relaxed">
                Invite agents, track team performance with leaderboards, and manage your downline — all from your Cove dashboard. No separate platform needed.
              </p>
              <ul className="text-sm text-gray-300 space-y-2">
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Invite agents via email and manage team access centrally.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Real-time leaderboard: dials, contacts, and bookings by agent.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Built-in affiliate program to earn recurring commissions by referring other agents.</li>
                <li className="flex items-start gap-2"><span className="text-blue-400 mt-0.5">•</span> Visual pipeline board to see where every lead stands.</li>
              </ul>
            </div>
            <div className="border border-gray-700/70 rounded-2xl px-6 py-5 text-xs md:text-sm text-gray-200 w-full md:max-w-xs flex flex-col justify-center bg-white/3">
              <p className="text-[10px] tracking-[0.25em] uppercase text-gray-400 mb-2 text-center">Team Performance</p>
              <p className="text-center leading-relaxed text-gray-300">
                See who's dialing, who's booking, and where each agent is falling behind — all in one leaderboard.
              </p>
            </div>
          </div>

          {/* Core CRM Grid */}
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
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
                className="rounded-2xl p-6 border border-white/10 bg-white/4 hover:bg-white/8 hover:border-blue-500/30 transition cursor-pointer"
              >
                <h3 className="font-bold text-base mb-2 text-white">{title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Product Screenshots */}
        <section className="py-14 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="text-xs tracking-[0.22em] uppercase text-slate-400 px-2 pt-2 pb-3">Dashboard</div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
                  <Image src="/landing/dashboard.png" alt="Cove CRM dashboard screenshot" width={1400} height={900} className="w-full h-auto" priority />
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
                <div className="text-xs tracking-[0.22em] uppercase text-slate-400 px-2 pt-2 pb-3">Affiliate Program</div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#020617]">
                  <Image src="/landing/affiliate-25refs.png" alt="Cove CRM affiliate program screenshot" width={1400} height={900} className="w-full h-auto" />
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

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 md:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div className="text-xs tracking-[0.22em] uppercase text-slate-400">Comparison (Insurance Use Case)</div>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    </span>
                    Native / Included
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 border border-white/10">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="rgb(148 163 184)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12" /><path d="M18 6l-12 12" /></svg>
                    </span>
                    Not available
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 border border-white/10 text-slate-200 font-semibold">~</span>
                    Add-on / Integration
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-6 gap-3 px-3 py-3 rounded-2xl bg-[#020617]/60 border border-white/10 text-slate-200 text-sm font-semibold">
                <div className="col-span-2">Feature</div>
                <div className="text-center">CoveCRM</div>
                <div className="text-center">Ringy</div>
                <div className="text-center">Close</div>
                <div className="text-center">GHL</div>
              </div>

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
                  <div key={idx} className="grid grid-cols-6 gap-3 px-3 py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition">
                    <div className="col-span-2 text-slate-200 font-medium">{row.feature}</div>
                    {["cove", "ringy", "close", "ghl"].map((k) => {
                      const v = (row as any)[k];
                      if (v === "yes") return (
                        <div key={k} className="flex justify-center">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                          </span>
                        </div>
                      );
                      if (v === "maybe") return (
                        <div key={k} className="flex justify-center">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10 text-slate-200 font-bold">~</span>
                        </div>
                      );
                      return (
                        <div key={k} className="flex justify-center">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/10">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="rgb(148 163 184)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12" /><path d="M18 6l-12 12" /></svg>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

            </div>
          </div>
        </section>

        {/* AI Engine */}
        <section className="py-20 px-6 bg-[#030d1f]">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold">The AI Engine Running Your Sales Pipeline</h2>
              <p className="text-slate-400 mt-3 max-w-3xl mx-auto">
                CoveCRM doesn’t just store leads — it remembers, decides, and takes action automatically so no opportunity slips through the cracks.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[
                [
                  "AI Lead Memory",
                  "Remembers conversations, objections, notes, and behavior so the system always knows the full story behind every lead.",
                ],
                [
                  "AI Decision Engine",
                  "Determines the next best action for every lead — call, text, follow up, reschedule, or reactivate.",
                ],
                [
                  "AI Automated Follow-Up",
                  "Sends the right message at the right time so leads don’t go cold while you’re busy closing deals.",
                ],
                [
                  "AI Lead Reactivation",
                  "Finds old leads that are likely to respond and brings them back to life automatically.",
                ],
                [
                  "AI Priority Score",
                  "Shows you exactly who to call first so your best opportunities get attention before anyone else.",
                ],
                [
                  "AI Call Coach",
                  "Analyzes every call and tells you exactly how to improve your pitch, handle objections, and close more business.",
                ],
              ].map(([title, description], i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-white/10 bg-white/4 p-7 hover:border-blue-500/20 hover:bg-white/6 transition"
                >
                  <div className="mb-4 inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-300">
                    AI Layer
                  </div>
                  <h3 className="text-white font-bold text-xl mb-3">{title}</h3>
                  <p className="text-slate-300 text-sm leading-relaxed">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-24 px-6 text-center bg-[#020617]">
          <h2 className="text-3xl md:text-4xl font-bold mb-3">Simple, transparent pricing</h2>
          <p className="text-slate-400 mb-12 max-w-xl mx-auto text-sm">No per-seat fees, no surprise add-ons. One flat monthly rate — every AI feature included.</p>

          <div className="max-w-md mx-auto">
            <div
              className="rounded-3xl border border-blue-500/40 bg-gradient-to-b from-blue-950/30 to-[#020617] p-10 text-left relative"
              style={{ boxShadow: "0 0 40px rgba(59,130,246,0.2)" }}
            >
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1 text-xs font-bold text-white shadow-lg">
                Everything Included
              </div>
              <h3 className="text-2xl font-bold mb-1 text-white">Cove CRM</h3>
              <p className="text-5xl font-bold mb-1 text-white">$199.99<span className="text-xl font-normal text-slate-400">/mo</span></p>
              <p className="text-xs text-slate-400 mb-7">+ tax &amp; call/SMS usage</p>
              <ul className="text-sm text-slate-200 space-y-2.5 mb-8">
                {[
                  "Unlimited users per account",
                  "Power dialer, SMS inbox, lead management",
                  "Google Calendar sync + booking forms",
                  "Prebuilt drip campaigns",
                  "AI Call Coach — score + feedback every call",
                  "AI Call Overview — auto-summarized after every call",
                  "AI SMS Assistant — automated lead follow-up",
                  "AI lead scoring + smart nudges",
                  "3-day free trial included",
                ].map((f) => (
                  <li key={f} className="flex gap-3 items-start">
                    <span className="text-blue-400 mt-0.5 shrink-0">✔</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <button className="w-full bg-blue-600 text-white px-6 py-3.5 rounded-xl hover:bg-blue-500 cursor-pointer transition font-bold text-base shadow-lg shadow-blue-600/20">
                  Start Free Trial
                </button>
              </Link>
              <p className="text-center text-xs text-slate-500 mt-4">
                🤖 AI tools included. Standard Twilio usage charges apply for calls and SMS.
              </p>
            </div>
            <p className="text-sm text-slate-500 mt-6">
              Compare to competitors charging $300–500/month for less features.
            </p>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 text-center px-6 bg-[#0b1225] text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to close more deals?</h2>
          <p className="text-lg mb-8 text-slate-300 max-w-xl mx-auto">
            Join thousands of top life insurance agents using Cove CRM to sell smarter and grow their teams.
          </p>
          <Link href="/signup">
            <button className="bg-white text-black px-10 py-3.5 rounded-xl font-bold hover:bg-slate-100 cursor-pointer transition text-base shadow-lg">
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
            </div>
            <div className="flex items-center gap-5">
              <Link href="/legal/privacy" className="hover:text-white transition">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-white transition">Terms</Link>
              <a href="mailto:support@covecrm.com" className="hover:text-white transition">Support</a>
            </div>
            <p>© 2026 CoveCRM. Built for insurance agents.</p>
          </div>
        </footer>

      </main>
    </>
  );
}
