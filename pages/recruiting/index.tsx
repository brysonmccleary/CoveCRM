// pages/recruiting/index.tsx
// Recruiting hub — DOI lead pool, plan breakdown, compliance notices
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import DashboardLayout from "@/components/DashboardLayout";
import { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

interface EmailCampaign {
  _id: string;
  name: string;
  isActive: boolean;
  fromName: string;
  fromEmail: string;
  steps: { day: number; subject: string }[];
}

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    leads: 250,
    price: "$79",
    color: "border-white/10",
    badge: null,
  },
  {
    id: "growth",
    name: "Growth",
    leads: 500,
    price: "$139",
    color: "border-indigo-500/50",
    badge: null,
  },
  {
    id: "pro",
    name: "Pro",
    leads: 1000,
    price: "$229",
    color: "border-indigo-500",
    badge: "Most Popular",
  },
  {
    id: "elite",
    name: "Elite",
    leads: 2500,
    price: "$449",
    color: "border-purple-500/50",
    badge: null,
  },
];

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "Choose Your Plan",
    desc: "Pick how many licensed agent contacts you need per month — 250 to 2,500.",
  },
  {
    step: "2",
    title: "We Import Verified Agents",
    desc: "We pull active licensed agents from your state's Department of Insurance database. Life/health licenses only.",
  },
  {
    step: "3",
    title: "Leads Appear in Your Folders",
    desc: "Contacts are automatically delivered to a folder called 'Recruiting Leads — {Month Year}' in your CRM.",
  },
  {
    step: "4",
    title: "AI Emails Send on Your Behalf",
    desc: "AI-personalized recruiting email sequences go out automatically. All CAN-SPAM compliant with full unsubscribe handling.",
  },
];

const WHATS_INCLUDED = [
  "DOI-verified licensed agents (active licenses only)",
  "Filtered by life/health license type",
  "Delivered to your 'Recruiting Leads' folder automatically",
  "AI-generated personalized recruiting emails",
  "Full CAN-SPAM compliance — unsubscribe handling & suppression list",
  "No duplicate leads — same lead never sent twice to you",
  "90-day cooldown — leads recycled responsibly",
];

export default function RecruitingPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [folders, setFolders] = useState<{ _id: string; name: string; leadCount: number }[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [enrollResult, setEnrollResult] = useState<{ enrolled: number; skipped: number; message: string } | null>(null);
  const [recruitingFromName, setRecruitingFromName] = useState("");
  const [recruitingFromEmail, setRecruitingFromEmail] = useState("");
  const [savingSender, setSavingSender] = useState(false);
  const [senderSaved, setSenderSaved] = useState(false);

  useEffect(() => {
    setLoadingCampaigns(true);
    fetch("/api/email/campaigns")
      .then((r) => r.json())
      .then((j) => setCampaigns(j.campaigns || []))
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
  }, []);

  useEffect(() => {
    fetch("/api/get-folders")
      .then((r) => r.json())
      .then((j) => {
        const all = Array.isArray(j?.folders) ? j.folders : [];
        // Only show recruiting folders
        setFolders(all.filter((f: any) => f.name?.toLowerCase().includes("recruit")));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/settings/recruiting-sender")
      .then((r) => r.json())
      .then((j) => {
        if (j.fromName) setRecruitingFromName(j.fromName);
        if (j.fromEmail) setRecruitingFromEmail(j.fromEmail);
      })
      .catch(() => {});
  }, []);

  const saveRecruitingSender = async () => {
    setSavingSender(true);
    setSenderSaved(false);
    try {
      const res = await fetch("/api/settings/recruiting-sender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName: recruitingFromName, fromEmail: recruitingFromEmail }),
      });
      if (res.ok) setSenderSaved(true);
    } catch {}
    finally { setSavingSender(false); }
  };

  const enrollInCampaign = async () => {
    if (!selectedCampaignId || !selectedFolderId) {
      alert("Please select both a folder and a campaign.");
      return;
    }
    setEnrolling(true);
    setEnrollResult(null);
    try {
      const res = await fetch("/api/recruiting/enroll-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaignId, folderId: selectedFolderId }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnrollResult(data);
      } else {
        alert(data.error || "Enrollment failed");
      }
    } catch {
      alert("Network error");
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl space-y-8 pb-12">

        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Recruiting</h1>
          <p className="text-gray-400 text-sm mt-1">
            Build your downline with DOI-verified licensed agents — delivered to your CRM automatically.
          </p>
        </div>

        {/* A. Compliance Notice */}
        <div className="bg-amber-900/20 border border-amber-600/40 rounded-xl p-5 space-y-3">
          <h2 className="text-amber-300 font-semibold text-base flex items-center gap-2">
            ⚠️ Important Compliance Notice
          </h2>
          <div className="space-y-2 text-sm text-amber-100/80">
            <p>
              DOI recruiting leads are licensed insurance agents whose information is publicly available through state Department of Insurance records.
            </p>
            <div className="space-y-1">
              <p>
                <span className="font-semibold text-amber-200">📧 Email:</span> You may send professional recruiting emails to these contacts under CAN-SPAM. All emails sent through CoveCRM include required unsubscribe links and comply with federal law.
              </p>
              <p>
                <span className="font-semibold text-amber-200">📱 SMS/Text:</span> You may <span className="font-bold text-red-300">NOT</span> send text messages to DOI leads without their explicit opt-in consent. If a lead replies to your email and provides their phone number with consent, you may then contact them by phone or text.
              </p>
            </div>
            <p className="text-xs text-amber-200/60 pt-1">
              All email campaigns sent through CoveCRM include automatic unsubscribe handling, CAN-SPAM compliant footers, and suppression list management.
            </p>
          </div>
        </div>

        {/* B. How It Works */}
        <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-5">How It Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.step} className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                  {s.step}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{s.title}</p>
                  <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* G. Enroll Recruiting Leads in Email Campaign */}
        <section style={{ maxWidth: "900px", margin: "0 auto 0px", padding: "0 0px" }}>
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: "24px", paddingBottom: "12px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
              Enroll Recruiting Leads in Email Campaign
            </h2>
            <p style={{ fontSize: "14px", color: "#94a3b8", marginTop: "6px" }}>
              Select a recruiting folder and an email campaign to auto-enroll all leads. Emails send at 9am daily. Already-enrolled leads are skipped automatically.
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
            <div style={{ flex: "1", minWidth: "220px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8", display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Recruiting Folder
              </label>
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                style={{ width: "100%", backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#f1f5f9", padding: "10px 12px", fontSize: "14px" }}
              >
                <option value="">— Select folder —</option>
                {folders.map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name} ({f.leadCount} leads)
                  </option>
                ))}
              </select>
              {folders.length === 0 && (
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
                  No recruiting folders found. Purchase a plan below to get started.
                </p>
              )}
            </div>

            <div style={{ flex: "1", minWidth: "220px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8", display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Email Campaign
              </label>
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                style={{ width: "100%", backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#f1f5f9", padding: "10px 12px", fontSize: "14px" }}
              >
                <option value="">— Select campaign —</option>
                {campaigns.filter((c) => c.isActive).map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name} ({c.steps?.length || 0} steps)
                  </option>
                ))}
              </select>
              {campaigns.length === 0 && !loadingCampaigns && (
                <p style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>
                  No email campaigns yet.{" "}
                  <a href="/drip-campaigns" style={{ color: "#60a5fa" }}>Create one in Drip Campaigns →</a>
                </p>
              )}
            </div>
          </div>

          <button
            onClick={enrollInCampaign}
            disabled={enrolling || !selectedCampaignId || !selectedFolderId}
            style={{
              backgroundColor: enrolling ? "#1e3a5f" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "12px 28px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: enrolling ? "not-allowed" : "pointer",
              opacity: (!selectedCampaignId || !selectedFolderId) ? 0.5 : 1,
            }}
          >
            {enrolling ? "Enrolling..." : "Enroll Leads in Campaign"}
          </button>

          {enrollResult && (
            <div style={{ marginTop: "16px", backgroundColor: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "8px", padding: "14px 16px" }}>
              <p style={{ color: "#4ade80", fontWeight: 600, margin: "0 0 4px" }}>
                ✓ {enrollResult.enrolled} leads enrolled successfully
              </p>
              <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>
                {enrollResult.skipped} skipped (already enrolled or no email address)
              </p>
            </div>
          )}
        </section>

        {/* H. Recruiting Email Sender */}
        <section style={{ maxWidth: "900px", margin: "0 auto 0px" }}>
          <div style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", marginBottom: "24px", paddingBottom: "12px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
              Recruiting Email Sender
            </h2>
            <p style={{ fontSize: "14px", color: "#94a3b8", marginTop: "6px" }}>
              Set the name and email address that recruiting emails are sent from. Uses your SMTP credentials.
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
            <div style={{ flex: "1", minWidth: "200px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8", display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                From Name
              </label>
              <input
                type="text"
                value={recruitingFromName}
                onChange={(e) => setRecruitingFromName(e.target.value)}
                placeholder="e.g. John Smith"
                style={{ width: "100%", backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#f1f5f9", padding: "10px 12px", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ flex: "1", minWidth: "200px" }}>
              <label style={{ fontSize: "12px", color: "#94a3b8", display: "block", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                From Email
              </label>
              <input
                type="email"
                value={recruitingFromEmail}
                onChange={(e) => setRecruitingFromEmail(e.target.value)}
                placeholder="e.g. john@youragency.com"
                style={{ width: "100%", backgroundColor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#f1f5f9", padding: "10px 12px", fontSize: "14px", boxSizing: "border-box" }}
              />
            </div>
          </div>

          <button
            onClick={saveRecruitingSender}
            disabled={savingSender || !recruitingFromName || !recruitingFromEmail}
            style={{
              backgroundColor: savingSender ? "#1e3a5f" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              padding: "12px 28px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: savingSender ? "not-allowed" : "pointer",
              opacity: (!recruitingFromName || !recruitingFromEmail) ? 0.5 : 1,
            }}
          >
            {savingSender ? "Saving..." : "Save Sender"}
          </button>

          {senderSaved && (
            <p style={{ marginTop: "12px", color: "#4ade80", fontSize: "14px" }}>✓ Sender saved</p>
          )}
        </section>

        {/* C. Plan Comparison */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Choose Your Plan</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`bg-[#0f172a] border rounded-xl p-5 flex flex-col relative ${plan.color}`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                      {plan.badge}
                    </span>
                  </div>
                )}
                <div className="mb-3">
                  <p className="text-white font-bold text-base">{plan.name}</p>
                  <p className="text-2xl font-extrabold text-indigo-400 mt-0.5">
                    {plan.price}
                    <span className="text-sm text-gray-400 font-normal">/mo</span>
                  </p>
                </div>
                <p className="text-gray-300 text-sm font-medium mb-1">
                  {plan.leads.toLocaleString()} licensed agent contacts/mo
                </p>
                <div className="space-y-1 text-xs text-gray-400 mb-4 flex-1">
                  <p>✓ Leads delivered to your Folders automatically</p>
                  <p>✓ AI email campaigns included</p>
                  <p>✓ Full CAN-SPAM compliance</p>
                </div>
                <button
                  onClick={() => router.push("/upgrade")}
                  className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition"
                >
                  Get Started
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* D. What's Included */}
        <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">What&apos;s Included</h2>
          <ul className="space-y-2">
            {WHATS_INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-gray-300">
                <span className="text-green-400 mt-0.5 shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* E. Active Recruiting Campaigns */}
        <div className="bg-[#0f172a] border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Your Active Recruiting Campaigns</h2>
            <Link
              href="/dashboard?tab=drip-campaigns"
              className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg"
            >
              View All Email Campaigns →
            </Link>
          </div>

          {loadingCampaigns ? (
            <p className="text-gray-500 text-sm">Loading campaigns…</p>
          ) : campaigns.length === 0 ? (
            <div className="text-center py-6 space-y-2">
              <p className="text-gray-500 text-sm">No email campaigns yet.</p>
              <Link
                href="/dashboard?tab=drip-campaigns"
                className="inline-block text-xs text-indigo-400 hover:text-indigo-300 underline"
              >
                Create your first recruiting email sequence →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => (
                <div
                  key={c._id}
                  className="flex items-center justify-between bg-white/5 rounded-lg px-4 py-3 border border-white/5"
                >
                  <div>
                    <p className="text-white text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      From: {c.fromName || c.fromEmail} · {c.steps?.length ?? 0} step{c.steps?.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        c.isActive
                          ? "bg-green-900/40 text-green-300 border border-green-700/40"
                          : "bg-white/5 text-gray-500 border border-white/10"
                      }`}
                    >
                      {c.isActive ? "Active" : "Paused"}
                    </span>
                    <Link
                      href="/dashboard?tab=drip-campaigns"
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      Edit →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* F. SMS Policy callout */}
        <div className="bg-amber-900/10 border border-amber-600/30 rounded-xl p-4">
          <p className="text-amber-300 font-semibold text-sm mb-1">
            ⚠️ Important: SMS Policy
          </p>
          <p className="text-amber-100/70 text-xs leading-relaxed">
            Recruiting leads have <strong className="text-amber-200">not opted in</strong> to receive text messages. Email only until they respond and provide explicit consent. Sending unsolicited text messages to DOI leads may violate the TCPA and state regulations.
          </p>
        </div>

      </div>
    </DashboardLayout>
  );
}

// Admin-only: gate this page to experimental admin access
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return { notFound: true };
  return { props: {} };
};
