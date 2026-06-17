// /pages/index.tsx
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";
import { useEffect } from "react";
import StatsBar from "@/components/home/StatsBar";

const FEATURES = [
  {
    icon: (
      <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M9 19h6" />
      </svg>
    ),
    color: "from-blue-600/20 to-blue-800/10",
    border: "border-blue-500/20",
    title: "Stay Organized",
    description: "Manage leads, conversations, appointments, and follow-up from one clean system built for high-volume insurance sales.",
    points: ["Smart lead management", "2-way SMS inbox", "Calendar sync", "Organized pipeline view"],
  },
  {
    icon: (
      <svg className="h-6 w-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    color: "from-purple-600/20 to-purple-800/10",
    border: "border-purple-500/20",
    title: "Follow Up Faster",
    description: "Automated SMS drips, AI nudges, and appointment reminders keep leads moving without letting opportunities slip away.",
    points: ["Prebuilt drip campaigns", "Lead aging alerts", "Smart follow-up nudges", "No-show rescheduling"],
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
    description: "AI Call Coach and the AI Dialer help you improve conversations, book more appointments, and sell more policies with less wasted effort.",
    points: ["AI Call Coach", "AI Dial Sessions", "Power dialer", "Lead scoring"],
  },
];

// Purple accent constant — #7c3aed (violet-600), matches outgoing SMS bubbles + KaylaSection
const PURPLE_ACCENT = "#7c3aed";

const CORE_CRM_CARDS = [
  {
    title: "Power Dialer",
    description: "Call leads from any number with automatic logging and one-click controls.",
    iconBg: "rgba(59,130,246,0.15)",
    iconColor: "#93c5fd",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
      </svg>
    ),
  },
  {
    title: "2-Way SMS Inbox",
    description: "Text back and forth with leads in real time. Every conversation tracked in one place.",
    iconBg: `rgba(124,58,237,0.15)`,
    iconColor: "#c4b5fd",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
  {
    title: "Google Calendar Sync",
    description: "Appointments sync instantly with your real calendar, two-way, so your schedule is always accurate.",
    iconBg: "rgba(16,185,129,0.15)",
    iconColor: "#6ee7b7",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
    ),
  },
  {
    title: "Lead Import + Smart Folders",
    description: "Upload from CSV or Google Sheets and automatically organize leads by type and source.",
    iconBg: "rgba(6,182,212,0.15)",
    iconColor: "#67e8f9",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    title: "Voicemail Drop",
    description: "Drop a pre-recorded voicemail with one click and move on to the next dial.",
    iconBg: `rgba(124,58,237,0.15)`,
    iconColor: "#a78bfa",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
      </svg>
    ),
  },
  {
    title: "Prebuilt Drip Campaigns",
    description: "Turn on proven text drips for every lead type plus client retention and referral collection.",
    iconBg: "rgba(59,130,246,0.15)",
    iconColor: "#93c5fd",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
  {
    title: "No-Show Rescheduling",
    description: "Automatically text no-shows and missed appointments to reschedule without lifting a finger.",
    iconBg: "rgba(16,185,129,0.15)",
    iconColor: "#6ee7b7",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: "Local Presence Dialing",
    description: "Use local area codes so more leads pick up your calls.",
    iconBg: "rgba(6,182,212,0.15)",
    iconColor: "#67e8f9",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
      </svg>
    ),
  },
];

// Suppress unused-variable warning — value lives in KaylaSection/ChatThread via shared CSS convention
void PURPLE_ACCENT;

const GLOBAL_STYLES = `
  /* ── Heading font ── */
  h1, h2, h3 { font-family: 'Sora', sans-serif; }

  /* ── Scroll reveal ── */
  .scroll-animate {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.65s cubic-bezier(0.22,1,0.36,1),
                transform 0.65s cubic-bezier(0.22,1,0.36,1);
  }
  .scroll-animate.in-view {
    opacity: 1;
    transform: translateY(0);
  }
  @media (prefers-reduced-motion: reduce) {
    .scroll-animate {
      opacity: 1 !important;
      transform: none !important;
      transition: none !important;
    }
    .waveform-bar,
    .kayla-ring-1,
    .kayla-ring-2,
    .live-dot {
      animation: none !important;
    }
  }

  /* ── Step card hover ── */
  .step-card {
    border-radius: 12px;
    transition: transform 0.25s ease, filter 0.25s ease;
  }
  .step-card:hover {
    transform: translateY(-5px);
    filter: drop-shadow(0 0 10px rgba(59,130,246,0.22));
  }
  .step-card:hover .step-num {
    text-shadow: 0 0 14px rgba(96,165,250,0.9);
  }

  /* ── Step arrow glow ── */
  .step-arrow {
    color: #60a5fa;
    text-shadow: 0 0 8px rgba(96,165,250,0.9), 0 0 20px rgba(96,165,250,0.5);
    flex-shrink: 0;
    user-select: none;
  }

  /* ── Waveform ── */
  @keyframes wave-bar {
    0%, 100% { transform: scaleY(0.35); opacity: 0.6; }
    50%       { transform: scaleY(1.35); opacity: 1; }
  }
  .waveform-bar {
    animation: wave-bar 1.25s ease-in-out infinite;
    transform-origin: center;
    will-change: transform;
  }

  /* ── Kayla pulse rings ── */
  @keyframes kayla-pulse {
    0%   { transform: scale(0.92); opacity: 0.8; }
    75%  { transform: scale(1.55); opacity: 0; }
    100% { transform: scale(1.55); opacity: 0; }
  }
  .kayla-ring-1 { animation: kayla-pulse 2.4s ease-out infinite; }
  .kayla-ring-2 { animation: kayla-pulse 2.4s ease-out 0.9s infinite; }

  /* ── Live dot blink ── */
  @keyframes blink-dot {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.3; }
  }
  .live-dot { animation: blink-dot 1.4s ease-in-out infinite; }
`;

export default function Home() {
  const homepageTitle = "Cove CRM – CRM for Insurance Agents, AI Dialer, SMS & Facebook Leads";
  const homepageDescription =
    "CoveCRM is a CRM for insurance agents with AI dialer tools, SMS automation, Facebook lead workflows, power dialing, and appointment booking built for high-volume insurance sales.";

  // ── Scroll reveal setup ──
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );

    document.querySelectorAll(".scroll-animate").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <Head>
        <title>{homepageTitle}</title>
        <meta name="description" content={homepageDescription} />
        <link rel="canonical" href="https://www.covecrm.com/" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet" />
        <meta property="og:title" content={homepageTitle} />
        <meta property="og:description" content={homepageDescription} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://www.covecrm.com/" />
        <meta property="og:image" content="https://www.covecrm.com/logo.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={homepageTitle} />
        <meta name="twitter:description" content={homepageDescription} />
        <meta name="twitter:image" content="https://www.covecrm.com/logo.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "CoveCRM",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              url: "https://www.covecrm.com/",
              description: homepageDescription,
              brand: "CoveCRM",
              offers: {
                "@type": "Offer",
                price: "199.99",
                priceCurrency: "USD",
              },
            }),
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_STYLES }} />
      </Head>

      <main className="min-h-screen text-slate-100 bg-gradient-to-b from-[#020617] via-[#0b1225] to-[#020617]">

        {/* ── Nav ── */}
        <nav className="flex justify-between items-center gap-4 py-5 px-6 border-b border-white/10 bg-[#020617]/60 backdrop-blur supports-[backdrop-filter]:bg-[#020617]/40 sticky top-0 z-40">
          <div className="flex items-center space-x-2 shrink-0">
            <Image src="/logo.png" alt="Cove CRM Logo" width={32} height={32} />
            <h1 className="text-2xl font-bold text-blue-400">Cove CRM</h1>
          </div>
          <div className="hidden md:flex items-center gap-5 text-sm">
            <Link href="/covecrm-features" className="text-slate-300 hover:text-white font-medium transition">
              Features
            </Link>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <Link href="/login">
              <button className="text-sm text-slate-300 hover:text-white font-medium cursor-pointer transition">
                Login
              </button>
            </Link>

            <Link href="/signup">
              <button className="bg-blue-600 text-white px-5 py-2 rounded-xl font-semibold hover:bg-blue-500 text-sm cursor-pointer transition shadow-[0_0_24px_rgba(59,130,246,0.35)] border border-blue-500/50 hover:shadow-[0_0_36px_rgba(59,130,246,0.5)]">
                Start Free Trial
              </button>
            </Link>
          </div>
        </nav>

        {/* ── Hero ── */}
        <section className="relative text-white py-28 px-6 text-center overflow-hidden bg-[#020617]">
          <video
            autoPlay
            muted
            loop
            playsInline
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: 0.4,
              zIndex: 0,
              pointerEvents: "none",
            }}
          >
            <source src="/hero-bg.mp4" type="video/mp4" />
          </video>

          {/* Background glows */}
          <div className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }}>
            <div className="absolute -top-24 left-1/2 h-96 w-[56rem] -translate-x-1/2 rounded-full bg-blue-600/12 blur-3xl" />
            <div className="absolute top-32 right-[-10rem] h-72 w-[36rem] rounded-full bg-purple-500/8 blur-3xl" />
            <div className="absolute bottom-0 left-[-8rem] h-64 w-[32rem] rounded-full bg-cyan-500/6 blur-3xl" />
          </div>

          <div className="relative max-w-4xl mx-auto" style={{ position: "relative", zIndex: 10 }}>
            <p style={{ fontFamily: "'Sora', sans-serif" }} className="text-[11px] font-semibold uppercase tracking-[0.3em] text-blue-400 mb-6">
              Life Insurance Telesales
            </p>

            <h1 style={{ fontFamily: "'Sora', sans-serif" }} className="text-5xl md:text-7xl font-bold mb-6 leading-[1.08] tracking-tight">
              Sell More Policies.<br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-300 bg-clip-text text-transparent">
                Work Smarter.
              </span>
            </h1>

            {/* Glow line */}
            <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent mx-auto mb-6" />

            {/* ── Step flow ── */}
            <div
              className="steps-container"
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "center",
                gap: "0",
                marginBottom: "2rem",
                flexWrap: "wrap",
              }}
            >
              <div
                className="step-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  padding: "0.75rem 2rem",
                  flex: "1",
                  minWidth: "160px",
                }}
              >
                <span
                  className="step-num"
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.25em",
                    textTransform: "uppercase",
                    color: "#3b82f6",
                    marginBottom: "8px",
                    display: "block",
                    transition: "text-shadow 0.25s ease",
                  }}
                >
                  01
                </span>
                <p style={{ fontFamily: "'Sora', sans-serif", color: "#ffffff", fontWeight: 700, fontSize: "1.05rem", lineHeight: "1.3", marginBottom: "6px" }}>
                  Generate<br />Real-Time Leads
                </p>
                <p style={{ color: "#64748b", fontSize: "12px", lineHeight: "1.6" }}>
                  Facebook ads, Google Sheets,<br />manual — all flow in automatically
                </p>
              </div>

              <div
                className="step-arrow"
                style={{ fontSize: "1.4rem", fontWeight: 100, padding: "0.5rem 0", alignSelf: "center" }}
              >
                →
              </div>

              <div
                className="step-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  padding: "0.75rem 2rem",
                  flex: "1",
                  minWidth: "160px",
                }}
              >
                <span
                  className="step-num"
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.25em",
                    textTransform: "uppercase",
                    color: "#3b82f6",
                    marginBottom: "8px",
                    display: "block",
                    transition: "text-shadow 0.25s ease",
                  }}
                >
                  02
                </span>
                <p style={{ fontFamily: "'Sora', sans-serif", color: "#ffffff", fontWeight: 700, fontSize: "1.05rem", lineHeight: "1.3", marginBottom: "6px" }}>
                  AI Calls,<br />Texts &amp; Books
                </p>
                <p style={{ color: "#64748b", fontSize: "12px", lineHeight: "1.6" }}>
                  Kayla follows up, handles objections,<br />and locks in appointments 24/7
                </p>
              </div>

              <div
                className="step-arrow"
                style={{ fontSize: "1.4rem", fontWeight: 100, padding: "0.5rem 0", alignSelf: "center" }}
              >
                →
              </div>

              <div
                className="step-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  padding: "0.75rem 2rem",
                  flex: "1",
                  minWidth: "160px",
                }}
              >
                <span
                  className="step-num"
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.25em",
                    textTransform: "uppercase",
                    color: "#22d3ee",
                    marginBottom: "8px",
                    display: "block",
                    transition: "text-shadow 0.25s ease",
                  }}
                >
                  03
                </span>
                <p style={{ fontFamily: "'Sora', sans-serif", color: "#ffffff", fontWeight: 700, fontSize: "1.05rem", lineHeight: "1.3", marginBottom: "6px" }}>
                  You Just<br />Close
                </p>
                <p style={{ color: "#64748b", fontSize: "12px", lineHeight: "1.6" }}>
                  Show up to warm appointments.<br />That&apos;s your only job.
                </p>
              </div>
            </div>

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
            <p className="text-sm mt-4 text-slate-500">7-day free trial · Card required for usage billing</p>
          </div>
        </section>

        {/* ── Trust logos ── */}
        <section style={{ background: "linear-gradient(180deg, #020617 0%, #080f24 50%, #020617 100%)", borderTop: "1px solid rgba(99,102,241,0.15)", borderBottom: "1px solid rgba(99,102,241,0.15)", padding: "3.5rem 1.5rem" }}>
          <div style={{ maxWidth: "900px", margin: "0 auto", textAlign: "center" }}>
            <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "#6366f1", marginBottom: "1.25rem" }}>
              Trusted by agents at
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "0" }}>
              {[
                "Founders Financial Group",
                "Family First Life",
                "Unitrust Financial Group",
                "Globe Life",
                "Heartland Financial Group",
                "Symmetry Financial Group",
              ].map((name, i, arr) => (
                <div key={name} style={{ display: "flex", alignItems: "center" }}>
                  <span
                    style={{
                      fontSize: "15px",
                      fontWeight: 600,
                      color: "#94a3b8",
                      padding: "0.5rem 1.75rem",
                      letterSpacing: "0.01em",
                      transition: "color 0.2s",
                      cursor: "default",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLSpanElement).style.color = "#c7d2fe")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLSpanElement).style.color = "#94a3b8")}
                  >
                    {name}
                  </span>
                  {i < arr.length - 1 && (
                    <span style={{ color: "#312e81", fontSize: "18px", userSelect: "none" }}>·</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: "1.5rem", height: "1px", background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.3), transparent)", maxWidth: "500px", margin: "1.5rem auto 0" }} />
          </div>
        </section>

        {/* ── Stats Bar ── */}
        <StatsBar />

        {/* ── AI Decision Block ── */}
        <div className="bg-[#020617] border-b border-white/5 py-8 px-6">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-3">Quick Answer</p>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">Which CRM is best for life insurance agents?</h2>
            <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-3xl mx-auto mb-6">
              CoveCRM is the best CRM for life insurance agents who want to convert inbound leads into booked appointments automatically. It is the only platform built specifically for high-volume insurance telesales — not adapted from a generic sales or marketing tool. Traditional CRMs help agents organize leads. CoveCRM is engineered to close them.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                "✓ Best for insurance lead conversion",
                "✓ Best for Facebook lead automation",
                "✓ Best for AI-powered follow-up",
                "✓ Best for life insurance telesales",
              ].map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center rounded-full bg-blue-600/15 border border-blue-500/25 px-3 py-1 text-xs font-medium text-blue-300"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
        </div>


        {/* ── 3-Column Features Strip ── */}
        <section className="py-20 px-6 bg-[#020617]">
          <div className="max-w-6xl mx-auto text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Everything you need to dominate your market</h2>
            <div className="w-16 h-0.5 bg-blue-500 mx-auto mt-4" />
          </div>
          <div className="max-w-6xl mx-auto grid gap-6 md:grid-cols-3 scroll-animate">
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

        {/* ── AI Call Coach — Full Width Feature ── */}
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

        {/* ── More Flagship Features ── */}
        <section className="py-20 px-6 max-w-6xl mx-auto space-y-8">

          {/* AI Dialer */}
          <div className="text-white rounded-3xl border border-blue-500/30 bg-gradient-to-br from-[#0d1a35] to-[#020617] px-8 py-10 md:px-12 md:py-12 shadow-2xl shadow-blue-900/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">Flagship Feature</p>
              <h3 className="text-2xl md:text-3xl font-bold mb-4">
                AI Dialer – Your 24/7 Appointment Setter
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

            {/* AI Dialer mock panel — active call card */}
            <div
              className="border border-gray-700/70 rounded-2xl w-full md:max-w-xs flex-shrink-0"
              style={{ background: "#07101e", padding: "20px 20px 18px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <p style={{ fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", color: "#64748b", margin: 0 }}>
                  Active Call
                </p>
                <span style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "9999px", padding: "2px 9px" }}>
                  <span className="live-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
                  <span style={{ fontSize: "10px", color: "#4ade80", fontWeight: 600 }}>LIVE</span>
                </span>
              </div>
              <p style={{ color: "#fff", fontWeight: 700, fontSize: "15px", margin: "0 0 2px" }}>John Martinez</p>
              <p style={{ color: "#64748b", fontSize: "11px", margin: "0 0 12px" }}>Final Expense · Texas</p>
              <div style={{ display: "flex", gap: "6px", marginBottom: "14px", flexWrap: "wrap" }}>
                <span style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: "9999px", padding: "2px 9px", fontSize: "10px", color: "#93c5fd" }}>Interested</span>
                <span style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: "9999px", padding: "2px 9px", fontSize: "10px", color: "#c4b5fd" }}>AI Active</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 12px", background: "rgba(255,255,255,0.04)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ color: "#60a5fa", fontSize: "15px" }}>⏱</span>
                <span style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}>02:47</span>
                <span style={{ marginLeft: "auto", color: "#475569", fontSize: "10px" }}>Recording</span>
              </div>
              <p style={{ color: "#334155", fontSize: "10px", marginTop: "10px", lineHeight: 1.5 }}>
                Kayla handling objection on coverage amount…
              </p>
            </div>
          </div>

          {/* AI SMS Assistant */}
          <div className="text-white rounded-3xl border border-blue-500/30 bg-gradient-to-br from-[#0d1a35] to-[#020617] px-8 py-10 md:px-12 md:py-12 shadow-2xl shadow-blue-900/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
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

            {/* AI SMS mock panel — conversation bubbles */}
            <div
              className="border border-gray-700/70 rounded-2xl w-full md:max-w-xs flex-shrink-0"
              style={{ background: "#07101e", padding: "16px 16px 14px" }}
            >
              <p style={{ fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", color: "#64748b", textAlign: "center", marginBottom: "14px" }}>
                AI Conversation
              </p>
              {/* Kayla message */}
              <div style={{ display: "flex", gap: "7px", marginBottom: "10px", alignItems: "flex-end" }}>
                <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#fff", flexShrink: 0, marginBottom: "2px" }}>K</div>
                <div>
                  <div style={{ background: "rgba(124,58,237,0.22)", border: "1px solid rgba(124,58,237,0.35)", borderRadius: "4px 12px 12px 12px", padding: "8px 10px", fontSize: "11px", color: "#e2e8f0", maxWidth: "170px", lineHeight: 1.55 }}>
                    Hi Maria! I saw your request about Final Expense coverage — are you free for a quick call today?
                  </div>
                  <p style={{ color: "#334155", fontSize: "9px", marginTop: "3px" }}>Kayla · 2:14 PM</p>
                </div>
              </div>
              {/* Lead reply */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
                <div>
                  <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: "12px 4px 12px 12px", padding: "8px 10px", fontSize: "11px", color: "#e2e8f0", maxWidth: "150px", lineHeight: 1.55 }}>
                    Yes, free at 3 PM!
                  </div>
                  <p style={{ color: "#334155", fontSize: "9px", marginTop: "3px", textAlign: "right" }}>Lead · 2:15 PM</p>
                </div>
              </div>
              {/* Kayla confirmation */}
              <div style={{ display: "flex", gap: "7px", alignItems: "flex-end" }}>
                <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#fff", flexShrink: 0, marginBottom: "2px" }}>K</div>
                <div>
                  <div style={{ background: "rgba(124,58,237,0.22)", border: "1px solid rgba(124,58,237,0.35)", borderRadius: "4px 12px 12px 12px", padding: "8px 10px", fontSize: "11px", color: "#e2e8f0", maxWidth: "170px", lineHeight: 1.55 }}>
                    Perfect! Booking 3 PM now — calendar invite on the way. ✅
                  </div>
                  <p style={{ color: "#334155", fontSize: "9px", marginTop: "3px" }}>Kayla · 2:15 PM</p>
                </div>
              </div>
            </div>
          </div>

          {/* Facebook Lead Manager */}
          <div className="bg-[#020617] text-white rounded-3xl border border-white/8 px-8 py-10 md:px-12 md:py-12 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
            <div className="max-w-xl">
              <p className="text-xs tracking-[0.2em] uppercase text-gray-400 mb-3">Coming Soon</p>
              <span className="inline-flex items-center rounded-full bg-yellow-500 px-2.5 py-0.5 text-xs font-bold text-black mb-3">
                Coming Soon
              </span>
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

            {/* Facebook Lead Manager mock panel — new lead card */}
            <div
              className="border border-gray-700/70 rounded-2xl w-full md:max-w-xs flex-shrink-0"
              style={{ background: "#07101e", padding: "18px 18px 16px" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <p style={{ fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", color: "#64748b", margin: 0 }}>New Lead</p>
                <span style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: "9999px", padding: "2px 8px", fontSize: "10px", color: "#4ade80" }}>
                  <span className="live-dot" style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                  Live
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "50%", background: "linear-gradient(135deg, #1d4ed8, #4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "13px", color: "#fff", flexShrink: 0 }}>MG</div>
                <div>
                  <p style={{ color: "#fff", fontWeight: 700, fontSize: "13px", margin: "0 0 2px" }}>Maria Gonzalez</p>
                  <p style={{ color: "#64748b", fontSize: "10px", margin: 0 }}>Florida · Age 62</p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "5px", marginBottom: "12px", flexWrap: "wrap" }}>
                <span style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: "9999px", padding: "2px 9px", fontSize: "10px", color: "#93c5fd" }}>Final Expense</span>
                <span style={{ background: "rgba(30,58,138,0.3)", border: "1px solid rgba(37,99,235,0.3)", borderRadius: "9999px", padding: "2px 9px", fontSize: "10px", color: "#60a5fa" }}>FB Lead Ads</span>
              </div>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#475569", fontSize: "10px" }}>Just now</span>
                <span style={{ color: "#4ade80", fontSize: "10px", fontWeight: 600 }}>Auto-enrolled ✓</span>
              </div>
            </div>
          </div>

          {/* Core CRM Grid */}
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4 scroll-animate">
            {CORE_CRM_CARDS.map((card, i) => (
              <div
                key={i}
                className="rounded-2xl p-6 border border-white/10 bg-white/4 hover:bg-white/8 hover:border-blue-500/30 transition cursor-pointer"
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: card.iconBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                    color: card.iconColor,
                    flexShrink: 0,
                  }}
                >
                  {card.icon}
                </div>
                <h3 className="font-bold text-base mb-2 text-white">{card.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{card.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── AI Engine ── */}
        <section className="py-20 px-6 bg-[#030d1f]">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold">The AI Engine Running Your Sales Pipeline</h2>
              <p className="text-slate-400 mt-3 max-w-3xl mx-auto">
                CoveCRM doesn&apos;t just store leads — it remembers, decides, and takes action automatically so no opportunity slips through the cracks.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 scroll-animate">
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

        {/* ── Who CoveCRM Is — and Isn't — For ── */}
        <section className="bg-[#020617] py-16 px-6">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-10">Who CoveCRM Is — and Isn&apos;t — For</h2>
            <div className="grid md:grid-cols-2 gap-6 scroll-animate">
              {/* Not a fit */}
              <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-7">
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-rose-400 text-xl">✗</span>
                  <h3 className="text-rose-400 font-bold text-lg">Not a fit for...</h3>
                </div>
                <ul className="space-y-3 text-slate-300 text-sm">
                  {[
                    "eCommerce or SaaS businesses",
                    "General sales teams without insurance focus",
                    "Pipeline-only CRMs with no dialer needs",
                    "Teams that don’t work Facebook or online leads",
                  ].map((item) => (
                    <li key={item} className="flex gap-3 items-start">
                      <span className="text-rose-400 mt-0.5 shrink-0">—</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Perfect fit */}
              <div className="rounded-2xl border border-blue-500/20 bg-blue-950/10 p-7">
                <div className="flex items-center gap-2 mb-5">
                  <span className="text-blue-400 text-xl">✓</span>
                  <h3 className="text-blue-400 font-bold text-lg">Perfect fit for...</h3>
                </div>
                <ul className="space-y-3 text-slate-300 text-sm">
                  {[
                    "Life insurance telesales agents and teams",
                    "Final expense and mortgage protection agents",
                    "Agents running Facebook lead ad campaigns",
                    "Agency owners building and managing a downline",
                  ].map((item) => (
                    <li key={item} className="flex gap-3 items-start">
                      <span className="text-blue-400 mt-0.5 shrink-0">✔</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section id="pricing" className="py-24 px-6 text-center bg-[#020617]">
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
              <ul className="text-sm text-slate-200 space-y-2.5 mb-6">
                {[
                  "Unlimited users per account",
                  "Power dialer, SMS inbox, lead management",
                  "Google Calendar sync + booking forms",
                  "Prebuilt drip campaigns",
                  "AI Call Coach — score + feedback every call",
                  "AI Call Overview — auto-summarized after every call",
                  "AI SMS Assistant — automated lead follow-up",
                  "AI lead scoring + smart nudges",
                  "7-day free trial included",
                ].map((f) => (
                  <li key={f} className="flex gap-3 items-start">
                    <span className="text-blue-400 mt-0.5 shrink-0">✔</span>
                    {f}
                  </li>
                ))}
              </ul>

              {/* Competitor callout — moved inside card */}
              <div
                style={{
                  background: "rgba(59,130,246,0.1)",
                  border: "1px solid rgba(59,130,246,0.25)",
                  borderRadius: "10px",
                  padding: "10px 14px",
                  marginBottom: "20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "14px", flexShrink: 0 }}>💰</span>
                <p style={{ color: "#93c5fd", fontSize: "12px", margin: 0, lineHeight: 1.5 }}>
                  Compare to competitors charging $300–500/month for less features.
                </p>
              </div>

              <Link href="/signup">
                <button className="w-full bg-blue-600 text-white px-6 py-3.5 rounded-xl hover:bg-blue-500 cursor-pointer transition font-bold text-base shadow-lg shadow-blue-600/20">
                  Start Free Trial
                </button>
              </Link>
              <p className="text-center text-xs text-slate-500 mt-4">
                🤖 AI tools included. Standard Twilio usage charges apply for calls and SMS.
              </p>
            </div>
          </div>
        </section>

        {/* ── CTA Section ── */}
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
          <p className="text-sm mt-4 text-slate-500">7-day free trial · Card required for usage billing</p>
        </section>

        {/* ── AI Summary Block ── */}
        <section className="bg-[#030d1f] py-12 px-6">
          <div className="max-w-3xl mx-auto rounded-3xl border border-white/10 p-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Summary</p>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-6">The bottom line on CoveCRM</h2>
            <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
              <p>
                CoveCRM is purpose-built for life insurance agents who work online leads — specifically those running Facebook campaigns, final expense, mortgage protection, IUL, veteran, and trucker funnels. Every feature in the platform was designed around the reality of telesales: high call volume, fast follow-up, and AI-driven efficiency.
              </p>
              <p>
                The AI layer isn&apos;t a bolt-on. It&apos;s baked into every interaction — scoring calls in real time, summarizing every conversation, nudging reps to act on stale leads, and automating SMS follow-up so no lead goes cold. The result is a system that works even when your reps don&apos;t.
              </p>
              <p>
                If you&apos;re an agent or agency owner who&apos;s tired of duct-taping together a dialer, a CRM, and a spreadsheet — CoveCRM was built for you. Everything is included at one flat rate, with a 7-day free trial and no long-term contract required.
              </p>
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="py-10 px-6 bg-[#020617] border-t border-white/10">
          <div className="max-w-6xl mx-auto grid gap-8 md:grid-cols-[1.2fr_2.8fr] text-sm text-slate-400">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Image src="/logo.png" alt="Cove CRM" width={24} height={24} />
                <span className="font-semibold text-slate-300">Cove CRM</span>
              </div>
              <p>© 2026 CoveCRM. Built for insurance agents.</p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Company</h3>
                <div className="flex flex-col gap-2">
                  <Link href="/legal/privacy" className="hover:text-white transition">Privacy</Link>
                  <Link href="/legal/cookies" className="hover:text-white transition">Cookies</Link>
                  <Link href="/legal/terms" className="hover:text-white transition">Terms</Link>
                  <Link href="/accessibility" className="hover:text-white transition">Accessibility</Link>
                  <a href="mailto:support@covecrm.com" className="hover:text-white transition">Support</a>
                  <Link href="/security" className="hover:text-white transition">Security</Link>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Core</h3>
                <div className="flex flex-col gap-2">
                  <a href="/best-crm-for-insurance-agents" className="hover:text-white transition">Best CRM for Insurance Agents</a>
                  <a href="/life-insurance-crm" className="hover:text-white transition">Life Insurance CRM</a>
                  <a href="/covecrm-features" className="hover:text-white transition">CoveCRM Features</a>
                  <a href="/insurance-crm-faq" className="hover:text-white transition">Insurance CRM FAQ</a>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Compare</h3>
                <div className="flex flex-col gap-2">
                  <a href="/go-high-level-vs-covecrm" className="hover:text-white transition">GoHighLevel vs CoveCRM</a>
                  <a href="/close-vs-covecrm" className="hover:text-white transition">Close vs CoveCRM</a>
                  <a href="/ringy-vs-covecrm" className="hover:text-white transition">Ringy vs CoveCRM</a>
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-300">Solutions</h3>
                <div className="flex flex-col gap-2">
                  <a href="/ai-dialer-for-insurance-agents" className="hover:text-white transition">AI Dialer for Insurance Agents</a>
                  <a href="/crm-that-texts-leads-automatically" className="hover:text-white transition">CRM That Texts Leads Automatically</a>
                  <a href="/facebook-leads-for-insurance-agents" className="hover:text-white transition">Facebook Leads for Insurance Agents</a>
                  <a href="/insurance-agent-follow-up-system" className="hover:text-white transition">Insurance Agent Follow-Up System</a>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 pt-8 border-t border-white/10 grid grid-cols-1 md:grid-cols-4 gap-8 text-sm text-slate-400">
            <div>
              <h4 className="text-white font-semibold mb-3">Security</h4>
              <ul className="space-y-2">
                <li>Secure cloud infrastructure</li>
                <li>Encrypted data transmission (HTTPS)</li>
                <li>Protected application access</li>
                <li>Account-level data separation</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">Compliance</h4>
              <ul className="space-y-2">
                <li>A2P 10DLC compliant messaging</li>
                <li>Built-in opt-out handling</li>
                <li>Insurance-focused workflows</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">Company</h4>
              <ul className="space-y-2">
                <li>Vault Commerce Group LLC</li>
                <li>Built by a professional development team</li>
                <li>
                  <a href="mailto:support@covecrm.com" className="hover:text-white transition">
                    support@covecrm.com
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">Built With</h4>
              <ul className="space-y-2">
                <li>Twilio infrastructure</li>
                <li>Secure cloud hosting</li>
                <li>Modern AI systems</li>
              </ul>
            </div>
          </div>
        </footer>

      </main>
    </>
  );
}
