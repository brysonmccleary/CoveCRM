import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";

type SubmitState = {
  type: "success" | "error";
  text: string;
};

const BENEFITS = [
  {
    title: "Calls fast",
    body:
      "Kayla can reach out shortly after a lead comes in so your team is not chasing cold prospects later.",
  },
  {
    title: "Texts automatically",
    body:
      "Kayla can follow up by text, keep the conversation moving, and help get the appointment booked.",
  },
  {
    title: "Books warmer appointments",
    body:
      "Kayla keeps the conversation focused on fit, timing, and getting the right next step scheduled.",
  },
];

const TIMELINE = [
  {
    title: "Lead comes in",
    body: "A prospect submits a form, replies to a campaign, or enters your pipeline.",
  },
  {
    title: "Kayla calls first",
    body: "Kayla starts the conversation using insurance-focused scripts, handles common questions, and works toward the appointment.",
  },
  {
    title: "Kayla texts next",
    body: "If they miss the call or need a reminder, Kayla follows up by text to keep the appointment path moving.",
  },
  {
    title: "Your CRM stays updated",
    body: "Calls, outcomes, replies, and next steps stay connected to the lead record.",
  },
  {
    title: "Your team steps in warm",
    body: "Agents focus on the people who are ready for a real conversation.",
  },
];

const CAPABILITIES = [
  "AI Calls",
  "AI SMS",
  "Lead follow-up",
  "Objection handling",
  "Appointment booking",
  "Ask Kayla assistant",
  "Lead generation pipeline support",
  "CRM overview/help",
];

const FAQS = [
  {
    q: "Is Kayla included with CoveCRM?",
    a: "Kayla is positioned as part of the CoveCRM experience. Exact setup can depend on the account, enabled AI settings, and which features you turn on.",
  },
  {
    q: "Can Kayla call new leads automatically?",
    a: "CoveCRM already supports AI-first-call workflows for eligible leads when the account, folder, and AI settings are configured to allow it.",
  },
  {
    q: "Can Kayla send texts too?",
    a: "CoveCRM already supports outbound SMS and follow-up messaging. Texting behavior depends on the account’s messaging setup and compliance status.",
  },
  {
    q: "Can Kayla answer questions about the CRM?",
    a: "That is the goal for this experience. Kayla is meant to help explain CoveCRM, guide setup, and keep the next step moving.",
  },
  {
    q: "Does Kayla replace my team?",
    a: "No. Kayla is built to handle fast first-touch follow-up and routine questions so your team can spend more time on real conversations and closings.",
  },
  {
    q: "Can I turn Kayla off?",
    a: "CoveCRM’s AI calling and messaging behaviors are settings-driven, so teams can control when automation is used.",
  },
  {
    q: "Is this built for insurance agents?",
    a: "CoveCRM is built around insurance sales workflows, lead follow-up, texting, calling, and appointment booking.",
  },
  {
    q: "What happens after I sign up?",
    a: "You can move into your dashboard, connect your workflow, and use Ask Kayla plus the rest of CoveCRM to organize leads, follow up faster, and get set up.",
  },
];

export default function KaylaPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: "",
    workEmail: "",
    phone: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState | null>(null);

  const utmPayload = useMemo(() => {
    const readQuery = (key: string) => {
      const value = router.query[key];
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value[0] || "";
      return "";
    };
    return {
      utmSource: readQuery("utm_source"),
      utmCampaign: readQuery("utm_campaign"),
      utmMedium: readQuery("utm_medium"),
    };
  }, [router.query]);

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitState(null);

    try {
      const response = await fetch("/api/kayla/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...utmPayload,
          referrer: typeof document !== "undefined" ? document.referrer || "" : "",
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        setSubmitState({
          type: "error",
          text: data?.message || "Something went wrong. Please try again.",
        });
        return;
      }

      setSubmitState({
        type: "success",
        text:
          "Kayla has your info. Watch for her call first — then she can text you the private discount code.",
      });
      setForm({ fullName: "", workEmail: "", phone: "" });
    } catch {
      setSubmitState({
        type: "error",
        text: "We couldn’t submit your request right now. Please try again in a moment.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Head>
        <title>Kayla | CoveCRM</title>
        <meta
          name="description"
          content="Meet Kayla, the AI assistant built into CoveCRM to call, text, follow up, and help guide prospects toward the next step."
        />
        <link rel="canonical" href="https://www.covecrm.com/kayla" />
      </Head>

      <main className="min-h-screen bg-[#020617] text-slate-100">
        <section className="relative overflow-hidden bg-gradient-to-b from-[#020617] via-[#0b1225] to-[#020617] text-white">
          <div className="absolute inset-0">
            <div className="absolute left-1/2 top-0 h-[30rem] w-[52rem] -translate-x-1/2 rounded-full bg-blue-600/16 blur-3xl" />
            <div className="absolute right-[-8rem] top-24 h-80 w-80 rounded-full bg-cyan-500/12 blur-3xl" />
            <div className="absolute bottom-[-8rem] left-[-8rem] h-80 w-80 rounded-full bg-blue-500/12 blur-3xl" />
          </div>

          <nav className="relative z-10 border-b border-white/10 bg-[#020617]/70 backdrop-blur">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6">
              <Link href="/" className="flex items-center gap-3">
                <Image src="/logo.png" alt="CoveCRM Logo" width={34} height={34} />
                <span className="text-xl font-bold tracking-tight text-blue-300">CoveCRM</span>
              </Link>
              <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-5">
                <Link href="/" className="text-slate-300 transition hover:text-white">
                  Home
                </Link>
                <Link href="/covecrm-features" className="text-slate-300 transition hover:text-white">
                  Features
                </Link>
                <Link href="/pricing" className="text-slate-300 transition hover:text-white">
                  Pricing
                </Link>
                <Link href="/kayla" className="text-white">
                  Kayla
                </Link>
                <Link href="/login" className="text-slate-300 transition hover:text-white">
                  Login
                </Link>
                <Link
                  href="/signup"
                  className="rounded-full bg-white px-4 py-2 font-semibold text-slate-950 transition hover:bg-slate-200"
                >
                  Try for free
                </Link>
              </div>
            </div>
          </nav>

          <div className="relative z-10 mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="mb-6 inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200">
                Kayla AI Assistant
              </div>
              <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Most leads go cold. Kayla calls, texts, follows up, and books for you.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
                Kayla is the AI assistant built into CoveCRM. She helps respond to new leads, answer
                questions, follow up by text, and move prospects toward booked appointments automatically.
              </p>
              <div className="mt-8 grid gap-3 text-sm text-slate-300 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                  Already trained on insurance scripts
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                  Calls and texts new leads
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                  Books warmer insurance appointments
                </div>
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#kayla-form"
                  className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white shadow-[0_0_30px_rgba(59,130,246,0.35)] transition hover:bg-blue-400"
                >
                  Have Kayla Call Me
                </a>
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  Start Free Trial
                </Link>
              </div>
            </div>

            <div
              id="kayla-form"
              className="rounded-[2rem] border border-white/12 bg-white/8 p-6 shadow-[0_20px_80px_rgba(2,6,23,0.55)] backdrop-blur-md sm:p-8"
            >
              <div className="rounded-[1.5rem] border border-white/12 bg-[#0f172a]/90 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-200">
                  Talk to Kayla
                </p>
                <h2 className="mt-3 text-2xl font-bold text-white">
                  Enter your info and Kayla will call first. After the call, she can text you a private discount code.
                </h2>
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-200">Full name</span>
                    <input
                      type="text"
                      value={form.fullName}
                      onChange={(e) => handleChange("fullName", e.target.value)}
                      className="w-full rounded-2xl border border-white/12 bg-[#111d35] px-4 py-3 text-base text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      placeholder="Jane Agent"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-200">Work email</span>
                    <input
                      type="email"
                      value={form.workEmail}
                      onChange={(e) => handleChange("workEmail", e.target.value)}
                      className="w-full rounded-2xl border border-white/12 bg-[#111d35] px-4 py-3 text-base text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      placeholder="you@agency.com"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-200">Phone</span>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      className="w-full rounded-2xl border border-white/12 bg-[#111d35] px-4 py-3 text-base text-white placeholder:text-slate-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      placeholder="(555) 555-5555"
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded-2xl bg-blue-500 px-5 py-3.5 text-base font-semibold text-white shadow-[0_0_28px_rgba(59,130,246,0.25)] transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting ? "Submitting..." : "Have Kayla call me"}
                  </button>
                  <p className="text-xs leading-6 text-slate-300">
                    By clicking ‘Have Kayla call me,’ you agree to receive an AI-powered call and
                    text from CoveCRM at the number provided. Message and data rates may apply.
                    Reply STOP to opt out.
                  </p>
                  {submitState ? (
                    <div
                      className={`rounded-2xl border px-4 py-3 text-sm ${
                        submitState.type === "success"
                          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                          : "border-red-400/40 bg-red-500/10 text-red-200"
                      }`}
                    >
                      {submitState.text}
                    </div>
                  ) : null}
                </form>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[#081120] px-5 py-20 text-slate-100 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                Speed wins leads
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Speed wins leads. Kayla makes sure you are first.
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-300">
                New leads are highest intent right after they submit. Kayla helps you reach them
                fast, qualify interest, and keep the conversation moving.
              </p>
            </div>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {BENEFITS.map((item) => (
                <div key={item.title} className="rounded-[1.75rem] border border-white/10 bg-[#0f172a] p-7 shadow-lg shadow-black/20">
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-300">
                    <span className="text-lg font-bold">{item.title.charAt(0)}</span>
                  </div>
                  <h3 className="text-xl font-semibold text-white">{item.title}</h3>
                  <p className="mt-3 text-base leading-7 text-slate-300">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#020617] px-5 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                Workflow
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                From first touch to booked appointment.
              </h2>
            </div>
            <div className="mt-12 grid gap-6 lg:grid-cols-5">
              {TIMELINE.map((step, index) => (
                <div key={step.title} className="rounded-[1.75rem] border border-white/10 bg-[#0b1225] p-6">
                  <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">
                    {index + 1}
                  </div>
                  <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-300">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-950 px-5 py-20 text-white sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
                Capability
              </p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Kayla does more than call.
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-300">
                We’re building CoveCRM to help users generate and manage their own leads with less
                manual work. Kayla helps explain the CRM, guide setup, answer questions, and support
                follow-up. For CoveCRM users’ insurance leads, Kayla acts like the agent’s assistant using insurance-focused scripts to help work toward the appointment. The system is designed to help monitor and improve lead performance over time.
              </p>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((item) => (
                <div
                  key={item}
                  className="rounded-[1.5rem] border border-white/10 bg-[#0f172a] p-5 text-sm font-medium text-slate-100"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#081120] px-5 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl rounded-[2rem] border border-white/10 bg-gradient-to-r from-[#0f172a] via-[#111d35] to-[#0f172a] px-6 py-10 text-white shadow-2xl sm:px-10">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Private invite
            </p>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Want the discount code?
            </h2>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
              Have Kayla text you the private code after she calls and answers your questions.
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <a
                href="#kayla-form"
                className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-400"
              >
                Have Kayla text me the code
              </a>
              <p className="text-sm text-slate-400">
                Inside CoveCRM, Kayla also helps answer setup questions through Ask Kayla.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-[#020617] px-5 py-20 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">FAQ</p>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Questions teams ask before they switch.</h2>
            </div>
            <div className="mt-12 space-y-4">
              {FAQS.map((item) => (
                <div key={item.q} className="rounded-[1.5rem] border border-white/10 bg-[#0b1225] p-6">
                  <h3 className="text-lg font-semibold text-white">{item.q}</h3>
                  <p className="mt-3 text-base leading-7 text-slate-300">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-gradient-to-b from-[#020617] to-slate-950 px-5 py-20 text-white sm:px-6">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
              See what happens when your CRM follows up for you.
            </h2>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <a
                href="#kayla-form"
                className="inline-flex items-center justify-center rounded-full bg-blue-500 px-6 py-3 text-base font-semibold text-white transition hover:bg-blue-400"
              >
                Have Kayla Call Me
              </a>
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 py-3 text-base font-semibold text-white transition hover:bg-white/10"
              >
                Start Free Trial
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
