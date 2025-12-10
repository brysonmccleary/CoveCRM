// /pages/index.tsx
import Head from "next/head";
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <>
      <Head>
        <title>CRM Cove – Your Sales Command Center</title>
        <meta
          name="description"
          content="Close more deals with CRM Cove. Built for life insurance telesales agents. Includes AI automation, calling, texting, and Google Calendar booking."
        />
      </Head>

      <main className="min-h-screen bg-white text-gray-900">
        {/* Nav */}
        <nav className="flex justify-between items-center py-6 px-6 shadow-sm">
          <div className="flex items-center space-x-2">
            <Image src="/logo.png" alt="CRM Cove Logo" width={32} height={32} />
            <h1 className="text-2xl font-bold text-blue-600">CRM Cove</h1>
          </div>
          <div className="space-x-4">
            <Link href="/login">
              <button className="text-sm text-gray-600 hover:text-blue-600 font-medium cursor-pointer">
                Login
              </button>
            </Link>
            <Link href="/signup">
              <button className="bg-blue-600 text-white px-5 py-2 rounded font-semibold hover:bg-blue-700 text-sm cursor-pointer">
                Start Free Trial
              </button>
            </Link>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="bg-[#020617] text-white py-24 px-6 text-center">
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
          <p className="text-sm mt-4 opacity-70">7-day free trial</p>
        </section>

        {/* Features + Flagship AI Section */}
        <section className="py-20 px-6 max-w-6xl mx-auto space-y-10">
          <div className="text-center mb-4">
            <h2 className="text-3xl font-bold mb-2">
              Everything you need to sell more policies
            </h2>
            <p className="text-sm md:text-base text-gray-600 max-w-2xl mx-auto">
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
                className="border rounded-xl p-6 shadow-sm hover:shadow-md transition cursor-pointer bg-white"
              >
                <h3 className="font-bold text-lg mb-2">{title}</h3>
                <p className="text-gray-600 text-sm leading-relaxed">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing Section */}
        <section className="bg-gray-100 py-20 px-6 text-center">
          <h2 className="text-3xl font-bold mb-6">
            Simple, transparent pricing
          </h2>
          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg p-10">
            <h3 className="text-2xl font-bold mb-2">CRM Cove</h3>
            <p className="text-4xl font-bold mb-2">$199.99/mo</p>
            <p className="text-sm text-gray-500 mb-4">
              + tax &amp; call/SMS usage
            </p>
            <ul className="text-left text-gray-700 mb-6">
              <li className="mb-2">✔ Unlimited users per account</li>
              <li className="mb-2">
                ✔ Includes dialer, texting, and lead management
              </li>
              <li className="mb-2">✔ 7-day free trial included</li>
            </ul>
            <p className="text-lg font-medium mb-4">
              AI Upgrade (optional): +$50/month
            </p>
            <Link href="/signup">
              <button className="bg-black text-white px-6 py-3 rounded-md hover:bg-gray-800 cursor-pointer">
                Start My Free Trial
              </button>
            </Link>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-24 text-center px-6 bg-[#0f172a] text-white">
          <h2 className="text-3xl md:text-4xl font-bold mb-6">
            Ready to get started?
          </h2>
          <p className="text-lg mb-8">
            Join hundreds of top agents using CRM Cove to dominate telesales.
          </p>
          <Link href="/signup">
            <button className="bg-white text-black px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 cursor-pointer">
              Start Free Trial Now
            </button>
          </Link>
        </section>

        {/* Footer */}
        <footer className="py-10 text-center text-sm text-gray-400 space-y-2">
          <div>
            <Link
              href="https://www.covecrm.com/legal/privacy"
              className="text-gray-500 hover:text-gray-700 underline mx-2"
            >
              Privacy Policy
            </Link>
            <span className="text-gray-500">•</span>
            <Link
              href="https://www.covecrm.com/legal/terms"
              className="text-gray-500 hover:text-gray-700 underline mx-2"
            >
              Terms of Service
            </Link>
          </div>
          <p>© {new Date().getFullYear()} CRM Cove. All rights reserved.</p>
        </footer>
      </main>
    </>
  );
}
