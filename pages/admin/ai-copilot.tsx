import Head from "next/head";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import DashboardLayout from "@/components/DashboardLayout";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

type Proposal = {
  _id: string;
  targetUserEmail: string;
  title: string;
  explanation: string;
  status: string;
  autoEligible?: boolean;
  confidence?: number;
  proposedPayload?: any;
  updatedAt?: string;
};

type EmailDraft = {
  _id: string;
  userEmail: string;
  to: string;
  subject: string;
  body: string;
  status: string;
  relatedProposalId?: string;
  updatedAt?: string;
};

export default function AdminAiCopilotPage() {
  const { data: session, status } = useSession();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [scanResult, setScanResult] = useState<any>(null);
  const [providerHealth, setProviderHealth] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [supportEmailSendEnabled, setSupportEmailSendEnabled] = useState(false);

  const email = String(session?.user?.email || "").toLowerCase();
  const isAdmin = isExperimentalAdminEmail(email);

  const loadData = async () => {
    if (!isAdmin) return;
    const [proposalRes, draftRes, healthRes] = await Promise.all([
      fetch("/api/admin/ai/a2p-proposals?status=pending"),
      fetch("/api/admin/ai/support-email-drafts?status=draft"),
      fetch("/api/admin/ai/provider-health"),
    ]);
    const proposalData = await proposalRes.json().catch(() => ({}));
    const draftData = await draftRes.json().catch(() => ({}));
    const healthData = await healthRes.json().catch(() => ({}));
    if (proposalRes.ok) setProposals(proposalData.proposals || []);
    if (draftRes.ok) {
      setDrafts(draftData.drafts || []);
      setSupportEmailSendEnabled(Boolean(draftData.supportEmailSendEnabled));
    }
    if (healthRes.ok) setProviderHealth(healthData);
  };

  useEffect(() => {
    void loadData();
  }, [isAdmin]);

  const scanFailures = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai/a2p-failures/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50, sinceDays: 30 }),
      });
      const data = await res.json().catch(() => ({}));
      setScanResult(data);
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  const updateProposal = async (id: string, action: "approve" | "reject") => {
    setLoading(true);
    try {
      await fetch(`/api/admin/ai/a2p-proposals/${id}/${action}`, { method: "POST" });
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  const sendDraft = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/ai/support-email-drafts/${id}/send`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setScanResult(data);
      await loadData();
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <DashboardLayout>
        <div className="p-6 text-white">Loading...</div>
      </DashboardLayout>
    );
  }

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-6 text-red-100">
          You do not have access to this page.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <>
      <Head>
        <title>Admin AI Copilot | Cove CRM</title>
      </Head>
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-white">Admin AI Copilot</h1>
            <p className="mt-1 text-sm text-slate-300">
              Foundation-only controls for A2P failure proposals and support email drafts.
            </p>
            <div className="mt-3 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100">
              Auto-send and auto-resubmit are disabled unless env flags explicitly enable them.
            </div>
          </div>

          <section className="rounded-lg border border-white/10 bg-slate-950 p-5">
            <h2 className="text-lg font-semibold text-white">Provider Health</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {["openai", "kimi", "deepseek"].map((name) => {
                const info = providerHealth?.providers?.[name] || {};
                return (
                  <div key={name} className="rounded-md border border-white/10 bg-white/5 p-3">
                    <div className="text-sm font-semibold capitalize text-white">{name}</div>
                    <div className="mt-1 text-xs text-slate-300">
                      {info.configured ? "Configured" : "Not configured"}
                    </div>
                    {info.model && <div className="mt-1 text-xs text-slate-500">{info.model}</div>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-slate-950 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">A2P Failure Scan</h2>
                <p className="text-sm text-slate-400">
                  Scans recent rejected or failed A2P records and creates review proposals.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void scanFailures()}
                disabled={loading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Working..." : "Scan A2P Failures"}
              </button>
            </div>
            {scanResult && (
              <pre className="mt-4 max-h-56 overflow-auto rounded-md bg-black/30 p-3 text-xs text-slate-200">
                {JSON.stringify(scanResult, null, 2)}
              </pre>
            )}
          </section>

          <section className="rounded-lg border border-white/10 bg-slate-950 p-5">
            <h2 className="text-lg font-semibold text-white">Pending A2P Correction Proposals</h2>
            <div className="mt-4 space-y-3">
              {proposals.length === 0 ? (
                <p className="text-sm text-slate-400">No pending proposals.</p>
              ) : (
                proposals.map((proposal) => (
                  <div key={proposal._id} className="rounded-md border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">{proposal.title}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {proposal.targetUserEmail} · {proposal.proposedPayload?.classification || "unclassified"} · confidence {Number(proposal.confidence || 0).toFixed(2)}
                        </div>
                        <p className="mt-2 text-sm text-slate-200">{proposal.explanation}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void updateProposal(proposal._id, "approve")}
                          disabled={loading}
                          className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateProposal(proposal._id, "reject")}
                          disabled={loading}
                          className="rounded-md bg-slate-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                    {proposal.proposedPayload && (
                      <div className="mt-3 grid gap-3 text-xs text-slate-300 md:grid-cols-2">
                        <div className="rounded bg-black/30 p-3">
                          <div className="font-semibold text-slate-100">Likely Cause</div>
                          <p className="mt-1 whitespace-pre-wrap">{proposal.proposedPayload.likelyCause || proposal.explanation}</p>
                        </div>
                        <div className="rounded bg-black/30 p-3">
                          <div className="font-semibold text-slate-100">Missing Info</div>
                          <p className="mt-1 whitespace-pre-wrap">
                            {(proposal.proposedPayload.missingInfoNeeded || []).join("\n") || "None"}
                          </p>
                        </div>
                        <div className="rounded bg-black/30 p-3 md:col-span-2">
                          <div className="font-semibold text-slate-100">Corrected Campaign Description</div>
                          <p className="mt-1 whitespace-pre-wrap">{proposal.proposedPayload.correctedCampaignDescription || ""}</p>
                        </div>
                        <div className="rounded bg-black/30 p-3 md:col-span-2">
                          <div className="font-semibold text-slate-100">Corrected Opt-In Text</div>
                          <p className="mt-1 whitespace-pre-wrap">{proposal.proposedPayload.correctedOptInDescription || ""}</p>
                        </div>
                        <div className="rounded bg-black/30 p-3 md:col-span-2">
                          <div className="font-semibold text-slate-100">Corrected Sample Messages</div>
                          <p className="mt-1 whitespace-pre-wrap">
                            {(proposal.proposedPayload.correctedSampleMessages || []).join("\n\n")}
                          </p>
                        </div>
                        <div className="rounded bg-black/30 p-3 md:col-span-2">
                          <div className="font-semibold text-slate-100">Compliance Warnings</div>
                          <p className="mt-1 whitespace-pre-wrap">
                            {(proposal.proposedPayload.complianceWarnings || [])
                              .map((w: any) => `${w.severity || "medium"}: ${w.message}`)
                              .join("\n") || "None"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-slate-950 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Support Email Drafts</h2>
                <p className="text-sm text-slate-400">
                  Sending is {supportEmailSendEnabled ? "enabled" : "disabled"} by environment flag.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {drafts.length === 0 ? (
                <p className="text-sm text-slate-400">No draft emails.</p>
              ) : (
                drafts.map((draft) => (
                  <div key={draft._id} className="rounded-md border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">{draft.subject}</div>
                        <div className="mt-1 text-xs text-slate-400">To: {draft.to}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void sendDraft(draft._id)}
                        disabled={loading || !supportEmailSendEnabled}
                        className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Send Email
                      </button>
                    </div>
                    <pre className="mt-3 whitespace-pre-wrap rounded bg-black/30 p-3 text-xs text-slate-300">
                      {draft.body}
                    </pre>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </DashboardLayout>
    </>
  );
}
