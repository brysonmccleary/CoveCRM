// pages/recruiting/index.tsx
import DashboardLayout from "@/components/DashboardLayout";
import Link from "next/link";

export default function RecruitingPage() {
  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto py-8 px-4 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Recruiting</h1>
          <p className="text-gray-400 mt-1">
            Recruit licensed insurance agents from the DOI database
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: DOI Lead Pool */}
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6 space-y-4 flex flex-col">
            <div>
              <div className="h-10 w-10 rounded-lg bg-blue-600/20 border border-blue-500/20 flex items-center justify-center mb-3">
                <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg">DOI Lead Pool</h2>
              <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                Import licensed agents from state DOI databases and run AI-personalized recruiting email campaigns.
              </p>
            </div>
            <div className="flex-1" />
            <Link
              href="/admin/prospecting"
              className="inline-flex items-center justify-center w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Go to Admin Panel
            </Link>
          </div>

          {/* Card 2: Email Campaigns */}
          <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6 space-y-4 flex flex-col">
            <div>
              <div className="h-10 w-10 rounded-lg bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center mb-3">
                <svg className="h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-white font-semibold text-lg">Email Campaigns</h2>
              <p className="text-gray-400 text-sm mt-1 leading-relaxed">
                Build recruiting email sequences that automatically reach out to licensed agents on your behalf.
              </p>
            </div>
            <div className="flex-1" />
            <Link
              href="/dashboard?tab=drip-campaigns"
              className="inline-flex items-center justify-center w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Go to Email Campaigns
            </Link>
          </div>
        </div>

        <div className="bg-[#0f172a] border border-white/10 rounded-xl p-4">
          <p className="text-sm text-gray-400 leading-relaxed">
            <span className="text-gray-300 font-medium">Note:</span> Your DOI leads are managed in the Admin panel. Agents who respond will appear in your Folders automatically.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
