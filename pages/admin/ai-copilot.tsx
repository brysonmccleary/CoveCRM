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

type SimulationResult = {
  simulationFingerprint: string;
  simulatedAt: string;
  canProceed: boolean;
  riskLevel: "low" | "medium" | "high" | "blocked";
  requiredAdminApproval: true;
  blockers: string[];
  warnings: string[];
  currentState: {
    profileId: string;
    userEmail: string;
    messagingReady: boolean;
    applicationStatus: string;
    registrationStatus: string;
    brandSid: string | null;
    brandStatus: string | null;
    campaignSid: string | null;
    campaignStatus: string | null;
    trustProductSid: string | null;
    profileSid: string | null;
    failure: { stage?: string; simpleTitle?: string; signature?: string } | null;
    profileUpdatedAt: string;
    lastSubmittedAt: string | null;
    campaignSubmitAttempts: number;
  };
  proposedChanges: {
    proposalId: string;
    classification: string;
    confidence: number;
    issueType: string;
    likelyCause: string;
    fieldsToUpdate: Record<string, { current: string | null; proposed: string | null }>;
    wouldTriggerChainRotation: boolean;
    wouldTouchBrand: boolean;
    wouldTouchCampaign: boolean;
    wouldTouchTrustProduct: boolean;
  };
  intendedDbMutations: string[];
  intendedTwilioActions: string[];
  forbiddenActionsConfirmedNotUsed: {
    noTwilioCallsMade: boolean;
    noSmsSent: boolean;
    noEmailSent: boolean;
    noDbWritten: boolean;
    noStartTsInvoked: boolean;
    noExecutorConnected: boolean;
    noBillingTouched: boolean;
  };
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

  // Per-proposal dry-run simulation state — keyed by proposal._id
  const [simulations, setSimulations] = useState<Record<string, SimulationResult>>({});
  const [simLoading, setSimLoading] = useState<Record<string, boolean>>({});
  const [simErrors, setSimErrors] = useState<Record<string, string>>({});

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

  const runDryRun = async (proposalId: string) => {
    setSimLoading((prev) => ({ ...prev, [proposalId]: true }));
    setSimErrors((prev) => { const next = { ...prev }; delete next[proposalId]; return next; });
    try {
      const res = await fetch(`/api/admin/ai/a2p-proposals/${proposalId}/dry-run`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setSimErrors((prev) => ({ ...prev, [proposalId]: data.error || `HTTP ${res.status}` }));
      } else {
        setSimulations((prev) => ({ ...prev, [proposalId]: data.simulation as SimulationResult }));
      }
    } catch (err: any) {
      setSimErrors((prev) => ({ ...prev, [proposalId]: err?.message || "Network error" }));
    } finally {
      setSimLoading((prev) => ({ ...prev, [proposalId]: false }));
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

                    {/* ── Dry-Run Simulation Panel ── */}
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold text-slate-300">Dry-Run Simulation</div>
                        <button
                          type="button"
                          onClick={() => void runDryRun(proposal._id)}
                          disabled={Boolean(simLoading[proposal._id])}
                          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {simLoading[proposal._id] ? "Running simulation…" : "Run Dry-Run Simulation"}
                        </button>
                      </div>

                      {simErrors[proposal._id] && (
                        <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                          {simErrors[proposal._id]}
                        </div>
                      )}

                      {simulations[proposal._id] && (() => {
                        const sim = simulations[proposal._id];
                        const riskColors: Record<string, string> = {
                          blocked: "border-red-500/50 bg-red-500/10 text-red-200",
                          high:    "border-amber-500/50 bg-amber-500/10 text-amber-200",
                          medium:  "border-yellow-500/50 bg-yellow-500/10 text-yellow-200",
                          low:     "border-green-500/50 bg-green-500/10 text-green-200",
                        };
                        const riskCls = riskColors[sim.riskLevel] ?? riskColors.blocked;

                        return (
                          <div className="mt-3 space-y-3 text-xs">

                            {/* Metadata */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded bg-black/30 px-3 py-2 font-mono text-slate-400">
                              <span>Fingerprint: <span className="text-slate-200">{sim.simulationFingerprint}</span></span>
                              <span>At: <span className="text-slate-200">{new Date(sim.simulatedAt).toLocaleString()}</span></span>
                            </div>

                            {/* Required approval notice — always visible */}
                            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
                              ⚠️ Admin approval required — this simulation does not approve or execute anything.
                            </div>

                            {/* Verdict */}
                            <div className={`rounded border px-3 py-2 font-semibold ${riskCls}`}>
                              {sim.canProceed
                                ? `Simulation: Can Proceed — Risk level: ${sim.riskLevel.toUpperCase()}`
                                : `Simulation: BLOCKED — Risk level: ${sim.riskLevel.toUpperCase()}`}
                            </div>

                            {/* Blockers — never collapsed */}
                            {sim.blockers.length > 0 && (
                              <div className="rounded border border-red-500/40 bg-red-500/10 p-3">
                                <div className="font-semibold text-red-200">Blockers (must be resolved before execution)</div>
                                <ul className="mt-2 space-y-1">
                                  {sim.blockers.map((b, i) => (
                                    <li key={i} className="text-red-300">• {b}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Warnings */}
                            {sim.warnings.length > 0 && (
                              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3">
                                <div className="font-semibold text-amber-200">Warnings</div>
                                <ul className="mt-2 space-y-1">
                                  {sim.warnings.map((w, i) => (
                                    <li key={i} className="text-amber-300">• {w}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Current state */}
                            <div className="rounded bg-black/30 p-3">
                              <div className="font-semibold text-slate-100">Current A2P State</div>
                              <div className="mt-2 grid gap-x-6 gap-y-1 text-slate-300 sm:grid-cols-2">
                                <span>Application: <span className="text-slate-100">{sim.currentState.applicationStatus || "—"}</span></span>
                                <span>Registration: <span className="text-slate-100">{sim.currentState.registrationStatus || "—"}</span></span>
                                <span>Brand: <span className="text-slate-100">{sim.currentState.brandStatus || "—"} {sim.currentState.brandSid ? `(${sim.currentState.brandSid.slice(0, 10)}…)` : ""}</span></span>
                                <span>Campaign: <span className="text-slate-100">{sim.currentState.campaignStatus || "—"} {sim.currentState.campaignSid ? `(${sim.currentState.campaignSid.slice(0, 10)}…)` : ""}</span></span>
                                <span>Messaging ready: <span className="text-slate-100">{sim.currentState.messagingReady ? "Yes" : "No"}</span></span>
                                <span>Submit attempts: <span className="text-slate-100">{sim.currentState.campaignSubmitAttempts} / 3</span></span>
                                {sim.currentState.failure?.simpleTitle && (
                                  <span className="sm:col-span-2">Failure: <span className="text-red-300">{sim.currentState.failure.simpleTitle}</span></span>
                                )}
                              </div>
                            </div>

                            {/* Proposed changes */}
                            <div className="rounded bg-black/30 p-3">
                              <div className="font-semibold text-slate-100">Proposed Changes</div>
                              <div className="mt-2 grid gap-x-6 gap-y-1 text-slate-300 sm:grid-cols-2">
                                <span>Classification: <span className="text-slate-100">{sim.proposedChanges.classification || "—"}</span></span>
                                <span>Confidence: <span className="text-slate-100">{(sim.proposedChanges.confidence * 100).toFixed(0)}%</span></span>
                                <span>Issue type: <span className="text-slate-100">{sim.proposedChanges.issueType || "—"}</span></span>
                                <span>Chain rotation: <span className={sim.proposedChanges.wouldTriggerChainRotation ? "text-red-300" : "text-slate-100"}>{sim.proposedChanges.wouldTriggerChainRotation ? "YES ⚠️" : "No"}</span></span>
                                <span>Touches brand: <span className="text-slate-100">{sim.proposedChanges.wouldTouchBrand ? "Yes" : "No"}</span></span>
                                <span>Touches campaign: <span className="text-slate-100">{sim.proposedChanges.wouldTouchCampaign ? "Yes" : "No"}</span></span>
                                <span>Touches trust product: <span className="text-slate-100">{sim.proposedChanges.wouldTouchTrustProduct ? "Yes" : "No"}</span></span>
                              </div>
                              {Object.keys(sim.proposedChanges.fieldsToUpdate).length > 0 && (
                                <div className="mt-3 space-y-1">
                                  <div className="font-semibold text-slate-200">Field diffs:</div>
                                  {Object.entries(sim.proposedChanges.fieldsToUpdate).map(([field, diff]) => (
                                    <div key={field} className="rounded bg-black/20 px-2 py-1.5">
                                      <span className="font-mono text-slate-400">{field}</span>
                                      <div className="mt-0.5 pl-2">
                                        {diff.current !== null && <div className="text-red-300/80 line-through">{String(diff.current).slice(0, 120)}</div>}
                                        <div className="text-green-300">{String(diff.proposed ?? "").slice(0, 120)}</div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Intended DB mutations — collapsed */}
                            <details className="rounded bg-black/30">
                              <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-200 hover:text-white">
                                Intended DB mutations ({sim.intendedDbMutations.length})
                              </summary>
                              <ul className="border-t border-white/5 px-3 pb-3 pt-2 space-y-1 text-slate-300">
                                {sim.intendedDbMutations.map((m, i) => <li key={i}>• {m}</li>)}
                              </ul>
                            </details>

                            {/* Intended Twilio actions — collapsed, clearly labelled simulation-only */}
                            <details className="rounded bg-black/30">
                              <summary className="cursor-pointer px-3 py-2 font-semibold text-slate-200 hover:text-white">
                                Planned Twilio calls — simulation only ({sim.intendedTwilioActions.length})
                              </summary>
                              <div className="border-t border-white/5 px-3 pb-3 pt-2">
                                <div className="mb-2 rounded border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-indigo-200">
                                  Simulation only — no Twilio calls were made during this dry-run.
                                </div>
                                <ul className="space-y-1 text-slate-300">
                                  {sim.intendedTwilioActions.map((a, i) => <li key={i}>• {a}</li>)}
                                </ul>
                              </div>
                            </details>

                            {/* Forbidden actions safety attestation */}
                            <div className="rounded border border-green-500/20 bg-green-500/5 p-3">
                              <div className="font-semibold text-green-300">Safety confirmation</div>
                              <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                {Object.entries(sim.forbiddenActionsConfirmedNotUsed).map(([key, val]) => (
                                  <span key={key} className={val ? "text-green-400" : "text-red-400"}>
                                    {val ? "✓" : "✗"} {key.replace(/([A-Z])/g, " $1").replace(/^no/, "No").trim()}
                                  </span>
                                ))}
                              </div>
                            </div>

                          </div>
                        );
                      })()}
                    </div>
                    {/* ── End Dry-Run Simulation Panel ── */}

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
