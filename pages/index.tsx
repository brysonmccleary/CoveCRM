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

        {/* Features Section */}
        <section className="py-20 px-6 max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">
            Everything you need to sell more policies
          </h2>
          <div className="grid md:grid-cols-3 gap-10">
            {[
              [
                "Power Dialer",
                "Call leads from any number, with local presence and automatic logging.",
              ],
              [
                "2-Way SMS Inbox",
                "Text back and forth with leads in real time. Full conversation tracking included.",
              ],
              [
                "AI Follow-Up Bot",
                "Automatically follow up with unresponsive leads and book appointments for you.",
              ],
              [
                "Google Calendar Sync",
                "Appointments sync instantly with your real calendar, two-way.",
              ],
              [
                "Lead Import + Smart Folders",
                "Upload from CSV or Google Sheets. Automatically categorize leads by type.",
              ],
              // ⬇️ REPLACED the last card
              [
                "Built-in Affiliate Program",
                "Recruit partners and track referrals. Auto payouts via Stripe Connect.",
              ],
            ].map(([title, description], i) => (
              <div
                key={i}
                className="border rounded-xl p-6 shadow-sm hover:shadow-md transition cursor-pointer"
              >
                <h3 className="font-bold text-xl mb-2">{title}</h3>
                <p className="text-gray-600 text-sm">{description}</p>
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
            <p className="text-sm text-gray-500 mb-4">+ tax & call/SMS usage</p>
            <ul className="text-left text-gray-700 mb-6">
              {/* ⬇️ REMOVED the “1 Free Phone Number …” line */}
              <li className="mb-2">✔ Unlimited users per account</li>
              <li className="mb-2">✔ Includes dialer, texting, and lead management</li>
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
        <footer className="py-10 text-center text-sm text-gray-400">
          © {new Date().getFullYear()} CRM Cove. All rights reserved.
        </footer>
      </main>
    </>
  );
}
