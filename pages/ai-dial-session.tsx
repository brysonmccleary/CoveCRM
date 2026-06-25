import { authOptions } from "./api/auth/[...nextauth]";
import { getServerSession } from "next-auth";
import type { GetServerSideProps } from "next";
// pages/ai-dial-session.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Sidebar from "@/components/Sidebar";
import { getNumberState } from "@/lib/twilio/localPresence";

function formatPhoneNumber(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return phone || "";
}

interface Folder {
  _id: string;
  name: string;
  leadCount?: number;
}

type NumberEntry = {
  sid: string;
  phoneNumber: string;
  subscriptionStatus?: string;
};

type AICallSessionStatus =
  | "pending"
  | "running"
  | "paused"
  | "stopped"
  | "completed"
  | "failed"
  | "queued"
  | "error";

interface AICallSession {
  _id: string;
  folderId: string;
  folderName?: string;
  fromNumber: string;
  scriptKey: string;
  voiceKey: string;
  total?: number;
  lastIndex?: number;
  status: AICallSessionStatus;
  stats?: {
    totalLeads?: number;
    completed?: number;
    booked?: number;
    notInterested?: number;
    noAnswers?: number;
    skipped?: number;
    transferred?: number;
  };
  startedAt?: string;
  endedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  resumeFromSessionId?: string | null;
}

interface AICallTranscriptTurn {
  role: "ai" | "lead";
  text: string;
  timestamp?: string;
}

interface AICallTranscript {
  _id?: string;
  callSid: string;
  leadName: string;
  outcome: string;
  durationSeconds: number;
  turns: AICallTranscriptTurn[];
  transcriptSource?: "voice_turns" | "openai_transcribe" | "none";
}

interface TranscriptCallRow {
  callSid: string;
  leadId?: string;
  leadName: string;
  outcome: string;
  durationSeconds: number;
  transcriptAvailable: boolean;
  transcriptEligible: boolean;
  transcript?: AICallTranscript | null;
}

// Hardcoded script options for now (later: AIAgentScript)
const SCRIPT_OPTIONS = [
  {
    key: "mortgage_protection",
    label: "Mortgage Protection",
    description: "For leads who requested mortgage protection coverage.",
  },
  {
    key: "final_expense",
    label: "Life Insurance / Final Expense",
    description: "For general life insurance or final expense leads.",
  },
  {
    key: "generic_life",
    label: "Generic Life Insurance",
    description: "Broad life insurance opener — works for any life insurance lead.",
  },
  {
    key: "iul_cash_value",
    label: "IUL / Cash Value",
    description: "For leads interested in indexed UL or cash value life insurance.",
  },
  {
    key: "veteran_leads",
    label: "Veterans (Life Insurance)",
    description: "General life insurance script tailored for veteran leads.",
  },
  {
    key: "veteran_mortgage",
    label: "Veteran Mortgage Protection",
    description: "Mortgage protection script tailored for veteran leads.",
  },
  {
    key: "veteran_iul",
    label: "Veteran IUL / Cash Value",
    description: "IUL / cash value script tailored for veteran leads.",
  },
  {
    key: "trucker_leads",
    label: "Truckers (Life Insurance)",
    description: "General life insurance script tailored for over-the-road truckers.",
  },
  {
    key: "trucker_mortgage",
    label: "Trucker Mortgage Protection",
    description: "Mortgage protection script tailored for over-the-road truckers.",
  },
  {
    key: "trucker_iul",
    label: "Trucker IUL / Cash Value",
    description: "IUL / cash value script tailored for over-the-road truckers.",
  },
];

/**
 * Hardcoded voice personas for now (later: AIAgentVoiceProfile)
 *
 * Keys here must match:
 *  - pages/api/ai-calls/context.ts → VOICE_PROFILES
 *  - pages/api/ai-calls/session.ts PostBody.voiceKey docs
 *
 * Primary, selectable voices are now ONLY Jacob and Kayla.
 * Legacy keys like Elena are still supported on the backend but no longer appear here.
 */
const VOICE_OPTIONS = [
  {
    key: "iris",
    label: "Kayla (Female) — Default",
    providerVoiceId: "marin",
  },
  {
    key: "jacob",
    label: "Jacob (Male)",
    providerVoiceId: "cedar",
  },
];

const AI_CALLING_CERTIFICATION_VERSION = "ai_calling_consent_v1";

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.91.32 1.8.59 2.65a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.25-1.25a2 2 0 0 1 2.11-.45c.85.27 1.74.47 2.65.59A2 2 0 0 1 22 16.92Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

function BellOffIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="m2 2 20 20M8.56 4.56A6 6 0 0 1 18 9.5V11l1.7 3.4a1 1 0 0 1-.9 1.45H14M6 9.5V11l-1.7 3.4a1 1 0 0 0 .9 1.45H10M10 19a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getOutcomeBadgeClass(outcome: string) {
  switch (String(outcome || "").toLowerCase()) {
    case "booked":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "transferred":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "not_interested":
      return "border-orange-500/30 bg-orange-500/10 text-orange-300";
    case "no_answer":
    case "voicemail":
      return "border-gray-500/30 bg-gray-500/10 text-gray-300";
    case "callback":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";
    case "do_not_call":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    case "disconnected":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

function formatOutcomeLabel(outcome: string) {
  const normalized = String(outcome || "unknown").replace(/_/g, " ");
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function CallTranscriptsCard({
  active,
  rows,
  loading,
  error,
  expandedCallSid,
  onToggle,
}: {
  active: boolean;
  rows: TranscriptCallRow[];
  loading: boolean;
  error: string | null;
  expandedCallSid: string | null;
  onToggle: (callSid: string) => void;
}) {
  const expandedRow = rows.find((row) => row.callSid === expandedCallSid);
  const expandedTranscript = expandedRow?.transcript;

  return (
    <div className="rounded-2xl border border-gray-700/70 bg-[#07101e] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Call Transcripts</h2>
          <p className="mt-1 text-xs text-gray-400">
            Review what Kayla and the lead said on eligible calls.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-gray-300">
          Loading transcripts...
        </div>
      ) : error ? (
        <div className="rounded-xl border border-yellow-500/50 bg-yellow-900/30 p-4 text-sm text-yellow-100">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-gray-300">
          {active ? "No transcripts yet for this session" : "No eligible transcripts for this session"}
        </div>
      ) : (
        <div className="max-h-[620px] overflow-hidden">
          <div className="max-h-[330px] overflow-y-auto rounded-xl border border-slate-700">
            <div className="grid grid-cols-[minmax(0,1.5fr)_auto_auto_auto] gap-3 border-b border-slate-700 bg-slate-900/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              <span>Lead</span>
              <span>Result</span>
              <span>Duration</span>
              <span className="text-right">Transcript</span>
            </div>
            <div className="divide-y divide-slate-800">
              {rows.map((row) => {
                const canView = row.transcriptAvailable && !!row.transcript;
                const isExpanded = expandedCallSid === row.callSid;
                return (
                  <div key={row.callSid} className="px-3 py-3">
                    <div className="grid grid-cols-[minmax(0,1.5fr)_auto_auto_auto] items-center gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-100">
                          {row.leadName || "Lead"}
                        </p>
                        <p className="truncate text-xs text-gray-500">{row.callSid}</p>
                      </div>
                      <span className={`whitespace-nowrap rounded-full border px-2 py-1 text-xs font-semibold ${getOutcomeBadgeClass(row.outcome)}`}>
                        {formatOutcomeLabel(row.outcome)}
                      </span>
                      <span className="whitespace-nowrap text-xs font-semibold text-gray-300">
                        {formatDuration(row.durationSeconds)}
                      </span>
                      <div className="text-right">
                        {canView ? (
                          <button
                            type="button"
                            onClick={() => onToggle(row.callSid)}
                            className="rounded-lg border border-indigo-500/30 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition hover:bg-indigo-500/10"
                          >
                            {isExpanded ? "Hide" : "View Transcript"}
                          </button>
                        ) : row.durationSeconds < 90 ? (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-gray-400">Not generated</p>
                            <p className="text-[11px] text-gray-500">Calls under 1:30 are skipped.</p>
                          </div>
                        ) : (
                          <p className="text-xs font-semibold text-gray-400">
                            {active ? "Processing" : "Unavailable"}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {expandedTranscript && (
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-100">
                    {expandedTranscript.leadName || expandedRow?.leadName || "Lead"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatDuration(expandedTranscript.durationSeconds || expandedRow?.durationSeconds || 0)}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${getOutcomeBadgeClass(expandedTranscript.outcome)}`}>
                  {formatOutcomeLabel(expandedTranscript.outcome)}
                </span>
              </div>
              <div className="max-h-[280px] overflow-y-auto rounded-xl bg-[#0f172a] p-3">
                {expandedTranscript.turns.map((turn, index) => {
                  const isKayla = turn.role === "ai";
                  const speaker = isKayla
                    ? "Kayla"
                    : expandedTranscript.leadName || expandedRow?.leadName || "Lead";
                  return (
                    <div
                      key={`${expandedTranscript.callSid}-${index}`}
                      className={`mb-3 flex flex-col ${isKayla ? "items-end" : "items-start"}`}
                    >
                      <span className="mb-1 px-1 text-[11px] font-semibold text-gray-400">
                        {speaker}
                      </span>
                      <div
                        className={`max-w-[82%] rounded-2xl px-4 py-2 text-sm leading-relaxed text-white shadow ${
                          isKayla ? "bg-[#7c3aed]" : "bg-[#334155]"
                        }`}
                      >
                        {turn.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req as any, ctx.res as any, authOptions as any);
  if (!(session as any)?.user?.email) {
    return {
      redirect: {
        destination: "/login",
        permanent: false,
      },
    };
  }
  return { props: {} };
};

export default function AIDialSessionPage() {
  const { data: session } = useSession();
  const sessionUser = session?.user as any;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);

  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [selectedScriptKey, setSelectedScriptKey] = useState<string>("");
  const [selectedVoiceKey, setSelectedVoiceKey] = useState<string>("iris");
  const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");

  // If switching accounts, clear any saved dial number that isn't owned by this account.
  useEffect(() => {
    if (!selectedFromNumber) return;
    if (!Array.isArray(numbers) || numbers.length === 0) return;
    const ok = numbers.some((n) => n.phoneNumber === selectedFromNumber);
    if (ok) return;
    setSelectedFromNumber("");
    try {
      localStorage.removeItem("selectedDialNumber");
    } catch {}
  }, [numbers, selectedFromNumber]);

  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lastSession, setLastSession] = useState<AICallSession | null>(null);
  const [certificationLoading, setCertificationLoading] = useState(true);
  const [certificationAccepted, setCertificationAccepted] = useState(false);
  const [certificationChecked, setCertificationChecked] = useState(false);
  const [certificationSubmitting, setCertificationSubmitting] = useState(false);
  const [certificationError, setCertificationError] = useState<string | null>(
    null,
  );
  const [transcriptRows, setTranscriptRows] = useState<TranscriptCallRow[]>([]);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);
  const [transcriptsError, setTranscriptsError] = useState<string | null>(null);
  const [expandedTranscriptCallSid, setExpandedTranscriptCallSid] = useState<string | null>(null);

  // 🔹 AI Dialer billing state (separate from SMS AI)
  const [aiBillingLoading, setAiBillingLoading] = useState(true);
  const [aiBillingError, setAiBillingError] = useState<string | null>(null);
  const [hasAiDialer, setHasAiDialer] = useState(false);
  // minutes still tracked internally if we ever want it, just not shown
  const [aiMinutesRemaining, setAiMinutesRemaining] = useState<number | null>(
    null,
  );

  // Active = anything still in play (queued / running / paused)
  const activeSession = useMemo(
    () =>
      lastSession &&
      (lastSession.status === "queued" ||
        lastSession.status === "running" ||
        lastSession.status === "paused")
        ? lastSession
        : null,
    [lastSession],
  );
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__aiDialSessionActive = Boolean(activeSession);
    return () => {
      (window as any).__aiDialSessionActive = false;
    };
  }, [activeSession]);

  useEffect(() => {
    setSessionDetailsOpen(false);
  }, [activeSession?._id]);

  useEffect(() => {
    setExpandedTranscriptCallSid(null);
  }, [lastSession?._id]);

  useEffect(() => {
    const loadActiveSession = async () => {
      try {
        setSessionLoading(true);
        setSessionError(null);
        const res = await fetch("/api/ai-calls/session");
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.message || "Failed to load active AI dial session");
        }

        const session = data.session || null;
        if (!session) return;

        setLastSession(session);
        if (session.folderId) setSelectedFolderId(String(session.folderId));
        if (session.scriptKey) setSelectedScriptKey(String(session.scriptKey));
        if (session.voiceKey) setSelectedVoiceKey(String(session.voiceKey));
        if (session.fromNumber) setSelectedFromNumber(String(session.fromNumber));
      } catch (e: any) {
        console.error("AI Dial: active session load error", e);
        setSessionError(e?.message || "Failed to load active AI dial session");
      } finally {
        setSessionLoading(false);
      }
    };

    loadActiveSession();
  }, []);

  useEffect(() => {
    const loadCertification = async () => {
      try {
        setCertificationLoading(true);
        setCertificationError(null);
        const res = await fetch("/api/legal/ai-calling-certification");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load AI calling certification");
        }
        setCertificationAccepted(
          data?.accepted === true &&
            (!data?.version ||
              data?.version === AI_CALLING_CERTIFICATION_VERSION),
        );
      } catch (e: any) {
        console.error("AI Dial: certification status error", e);
        setCertificationAccepted(false);
        setCertificationError(
          e?.message || "Failed to load AI calling certification",
        );
      } finally {
        setCertificationLoading(false);
      }
    };
    loadCertification();
  }, []);

  const selectedFolderName = useMemo(
    () => folders.find((f) => f._id === selectedFolderId)?.name || "",
    [folders, selectedFolderId],
  );

  const currentScript = SCRIPT_OPTIONS.find(
    (s) => s.key === selectedScriptKey,
  );
  const currentVoice = VOICE_OPTIONS.find((v) => v.key === selectedVoiceKey);
  const displayFolderName =
    selectedFolderName ||
    activeSession?.folderName ||
    lastSession?.folderName ||
    (selectedFolderId ? "Folder unavailable" : "-");
  const displayScriptLabel =
    currentScript?.label ||
    (activeSession?.scriptKey === "default" || lastSession?.scriptKey === "default"
      ? "Legacy default script"
      : activeSession?.scriptKey || lastSession?.scriptKey || "-");
  const displayVoiceLabel =
    currentVoice?.label ||
    activeSession?.voiceKey ||
    lastSession?.voiceKey ||
    "-";
  const displayFromNumber = formatPhoneNumber(
    selectedFromNumber ||
      activeSession?.fromNumber ||
      lastSession?.fromNumber ||
      "",
  );
  const stats = lastSession?.stats || {};
  const totalLeads = stats.totalLeads ?? 0;
  const completed = stats.completed ?? 0;
  const skipped = stats.skipped ?? 0;
  const lastSessionLastIndex =
    typeof lastSession?.lastIndex === "number" ? lastSession.lastIndex : -1;
  const dialedLeads = totalLeads > 0
    ? Math.min(
        totalLeads,
        Math.max(0, lastSessionLastIndex + 1, completed + skipped),
      )
    : 0;
  const pct =
    totalLeads > 0
      ? Math.min(100, Math.round((dialedLeads / totalLeads) * 100))
      : 0;
  const remainingLeads = Math.max(0, totalLeads - dialedLeads);
  const resumeRemainingLeads = lastSession
    ? Math.max(0, totalLeads - (lastSessionLastIndex + 1))
    : 0;
  const resumeLeadNumber =
    totalLeads > 0 ? Math.min(totalLeads, lastSessionLastIndex + 2) : 0;
  const canResumeSession = !!lastSession && resumeRemainingLeads > 0;
  const sessionResultRows = [
    {
      show: (stats.booked ?? 0) > 0,
      color: "bg-emerald-400",
      text: `${stats.booked ?? 0} appointments booked`,
    },
    {
      show: (stats.transferred ?? 0) > 0,
      color: "bg-sky-400",
      text: `${stats.transferred ?? 0} live transfers connected`,
    },
    {
      show: (stats.notInterested ?? 0) > 0,
      color: "bg-orange-400",
      text: `${stats.notInterested ?? 0} leads marked not interested`,
    },
    {
      show: (stats.noAnswers ?? 0) > 0,
      color: "bg-gray-400",
      text: `${stats.noAnswers ?? 0} no answers`,
    },
    {
      show: (stats.skipped ?? 0) > 0,
      color: "bg-slate-400",
      text: `${stats.skipped ?? 0} leads skipped`,
    },
  ].filter((row) => row.show);

  /** Load folders (same source as leads page) */
  useEffect(() => {
    const fetchFolders = async () => {
      try {
        setLoadingFolders(true);
        setError(null);
        const res = await fetch("/api/get-folders");
        if (!res.ok) throw new Error("Failed to fetch folders");
        const data = await res.json();
        // Filter out the KAYLA LEADS folder — Kayla demo calls are backend/internal only.
        setFolders(
          (Array.isArray(data?.folders) ? data.folders : []).filter(
            (f: Folder) => f.name !== "KAYLA LEADS",
          ),
        );
      } catch (e: any) {
        console.error("AI Dial: error fetching folders", e);
        setError(e?.message || "Failed to load folders");
        setFolders([]);
      } finally {
        setLoadingFolders(false);
      }
    };
    fetchFolders();
  }, []);

  /** Load numbers (same API as manual dialer) */
  useEffect(() => {
    const fetchNumbers = async () => {
      try {
        setLoadingNumbers(true);
        const res = await fetch("/api/getNumbers");
        const data = await res.json();
        const rows: NumberEntry[] = Array.isArray(data?.numbers)
          ? data.numbers
          : [];
        setNumbers(rows);
        // Restore last used
        try {
          const saved =
            typeof window !== "undefined"
              ? localStorage.getItem("selectedDialNumber")
              : null;
          if (saved) setSelectedFromNumber(saved);
        } catch {
          // ignore
        }
      } catch (e) {
        console.error("AI Dial: error fetching numbers", e);
        setNumbers([]);
      } finally {
        setLoadingNumbers(false);
      }
    };
    fetchNumbers();
  }, []);

  /** Load AI Dialer billing status (separate from SMS AI) */
  useEffect(() => {
    const loadBilling = async () => {
      try {
        setAiBillingLoading(true);
        setAiBillingError(null);
        const res = await fetch("/api/ai-calls/billing-status");
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to load AI Dialer status");
        }
        setHasAiDialer(Boolean(data.hasAiDialer));
        setAiMinutesRemaining(
          typeof data.minutesRemaining === "number"
            ? data.minutesRemaining
            : null,
        );
      } catch (e: any) {
        console.error("AI Dial: billing status error", e);
        setAiBillingError(e?.message || "Failed to load AI Dialer status");
        setHasAiDialer(false);
        setAiMinutesRemaining(null);
      } finally {
        setAiBillingLoading(false);
      }
    };
    loadBilling();
  }, []);

  /** Load + poll latest AI call session for selected folder */
  useEffect(() => {
    if (!selectedFolderId) {
      setLastSession(null);
      setSessionError(null);
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const fetchSession = async () => {
      try {
        const res = await fetch(
          `/api/ai-calls/session?folderId=${encodeURIComponent(
            selectedFolderId,
          )}`,
        );
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.message || "Failed to load AI dial session");
        }
        if (!cancelled) {
          setLastSession(data.session || null);
        }
      } catch (e: any) {
        if (!cancelled) {
          console.error("AI Dial: error fetching session", e);
          setSessionError(e?.message || "Failed to load AI dial session");
          setLastSession(null);
        }
      }
    };

    // initial fetch
    setSessionLoading(true);
    fetchSession()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });

    // poll every 5s while this folder is selected
    if (typeof window !== "undefined") {
      intervalId = window.setInterval(fetchSession, 5000);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [selectedFolderId]);

  useEffect(() => {
    if (!lastSession?._id) {
      setTranscriptRows([]);
      setTranscriptsError(null);
      setExpandedTranscriptCallSid(null);
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const fetchTranscripts = async () => {
      try {
        setTranscriptsLoading(true);
        setTranscriptsError(null);
        const res = await fetch(
          `/api/ai-calls/transcript?sessionId=${encodeURIComponent(lastSession._id)}`,
        );
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.message || "Failed to load call transcripts");
        }

        const rows: TranscriptCallRow[] = Array.isArray(data.callRows)
          ? data.callRows
          : Array.isArray(data.transcripts)
            ? data.transcripts.map((transcript: AICallTranscript) => ({
                callSid: transcript.callSid,
                leadName: transcript.leadName || "Lead",
                outcome: transcript.outcome || "unknown",
                durationSeconds: transcript.durationSeconds || 0,
                transcriptAvailable: true,
                transcriptEligible: true,
                transcript,
              }))
            : [];

        if (!cancelled) {
          setTranscriptRows(rows);
        }
      } catch (e: any) {
        if (!cancelled) {
          setTranscriptsError(e?.message || "Failed to load call transcripts");
          setTranscriptRows([]);
        }
      } finally {
        if (!cancelled) {
          setTranscriptsLoading(false);
        }
      }
    };

    fetchTranscripts();
    if (activeSession && typeof window !== "undefined") {
      intervalId = window.setInterval(fetchTranscripts, 7000);
    }

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, [activeSession, lastSession?._id]);

  const canConfigure =
    !!selectedFolderId &&
    !!selectedScriptKey &&
    !!selectedVoiceKey &&
    !!selectedFromNumber;

  const aiDialerLocked = !hasAiDialer;
  const billingReadyForAI = sessionUser?.cardOnFile === true;
  const aiUpgradeRequired =
    aiDialerLocked &&
    sessionUser?.hasAI === false &&
    billingReadyForAI &&
    (sessionUser?.planCode === "base" || sessionUser?.planCode == null);
  const certificationRequired =
    !certificationLoading && !certificationAccepted;

  const handleCertificationRequired = () => {
    setCertificationAccepted(false);
    setCertificationError(
      "Confirm the AI calling certification before starting an AI dial session.",
    );
  };

  const handleConfirmCertification = async () => {
    if (!certificationChecked) {
      setCertificationError("Check the certification box to continue.");
      return;
    }

    try {
      setCertificationSubmitting(true);
      setCertificationError(null);
      const res = await fetch("/api/legal/ai-calling-certification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      const data = await res.json();
      if (!res.ok || data?.accepted !== true) {
        throw new Error(data?.error || "Failed to save AI calling certification");
      }
      setCertificationAccepted(true);
      setCertificationChecked(false);
      setCertificationError(null);
    } catch (e: any) {
      console.error("AI Dial: certification save error", e);
      setCertificationError(
        e?.message || "Failed to save AI calling certification",
      );
    } finally {
      setCertificationSubmitting(false);
    }
  };

  /** Start a brand new AI dial session for the selected folder (mode: fresh) */
  const handleStartSession = async () => {
    if (aiDialerLocked) {
      setSessionError(
        aiUpgradeRequired
          ? "AI Dialer requires the AI plan. Go to Settings → Billing & Usage to upgrade for $50/month."
          : "Add a payment method in Settings → Billing & Usage before starting AI Dialer.",
      );
      return;
    }
    if (!canConfigure) {
      alert("Choose a folder, script, voice, and number first.");
      return;
    }
    if (activeSession) {
      alert(
        "You already have an AI dial session in progress for this folder. End it first.",
      );
      return;
    }
    if (certificationRequired) {
      handleCertificationRequired();
      return;
    }

    try {
      setSessionLoading(true);
      setSessionError(null);

      // Save last selected number (same behavior as manual dialer)
      try {
        localStorage.setItem("selectedDialNumber", selectedFromNumber);
      } catch {
        // ignore
      }

      const res = await fetch("/api/ai-calls/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: selectedFolderId,
          scriptKey: selectedScriptKey,
          voiceKey: selectedVoiceKey,
          fromNumber: selectedFromNumber,
          mode: "fresh",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        if (data?.code === "AI_CALLING_CERTIFICATION_REQUIRED") {
          handleCertificationRequired();
          return;
        }
        throw new Error(data?.message || "Failed to create AI dial session");
      }

      setLastSession(data.session || null);
    } catch (e: any) {
      console.error("AI Dial: start session error", e);
      setSessionError(e?.message || "Failed to create AI dial session");
    } finally {
      setSessionLoading(false);
    }
  };

  /** Resume AI dial session (keep lastIndex, mark as queued) */
  const handleResumeSession = async () => {
    if (aiDialerLocked) {
      setSessionError(
        aiUpgradeRequired
          ? "AI Dialer requires the AI plan. Go to Settings → Billing & Usage to upgrade for $50/month."
          : "Add a payment method in Settings → Billing & Usage before resuming AI Dialer.",
      );
      return;
    }
    if (!canConfigure) {
      alert("Choose a folder, script, voice, and number first.");
      return;
    }
    if (!lastSession) {
      alert("No previous AI dial session found to resume for this folder.");
      return;
    }
    if (!canResumeSession) {
      alert("That session has no remaining leads to resume. Start a fresh AI dial session instead.");
      return;
    }
    if (activeSession) {
      alert("You already have an AI dial session in progress for this folder.");
      return;
    }
    if (certificationRequired) {
      handleCertificationRequired();
      return;
    }

    try {
      setSessionLoading(true);
      setSessionError(null);

      try {
        localStorage.setItem("selectedDialNumber", selectedFromNumber);
      } catch {
        // ignore
      }

      const res = await fetch("/api/ai-calls/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId: selectedFolderId,
          scriptKey: selectedScriptKey,
          voiceKey: selectedVoiceKey,
          fromNumber: selectedFromNumber,
          mode: "resume",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        if (data?.code === "AI_CALLING_CERTIFICATION_REQUIRED") {
          handleCertificationRequired();
          return;
        }
        throw new Error(data?.message || "Failed to resume AI dial session");
      }

      setLastSession(data.session || null);
    } catch (e: any) {
      console.error("AI Dial: resume session error", e);
      setSessionError(e?.message || "Failed to resume AI dial session");
    } finally {
      setSessionLoading(false);
    }
  };

  /** End the currently active AI dial session */
  const handleEndSession = async () => {
    if (!activeSession) return;
    const confirmEnd = window.confirm(
      "End the current AI dial session? The AI will stop calling new leads in this folder.",
    );
    if (!confirmEnd) return;

    try {
      setSessionLoading(true);
      setSessionError(null);

      const res = await fetch("/api/ai-calls/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession._id,
          action: "stop",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || "Failed to end AI dial session");
      }

      setLastSession(data.session || null);
    } catch (e: any) {
      console.error("AI Dial: end session error", e);
      setSessionError(e?.message || "Failed to end AI dial session");
    } finally {
      setSessionLoading(false);
    }
  };

  const selectClassName =
    "w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30";
  const configCardClassName =
    "rounded-xl border border-slate-700 bg-slate-800/80 p-5 shadow";

  return (
    <div className="flex min-h-screen bg-[#0f172a] text-white">
      <Sidebar />
      <div className="flex-1 p-6">
        {!activeSession && (
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-2xl font-bold">AI Dial Session</h1>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
                className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-100 transition hover:bg-slate-700"
              >
                ← Back to Dashboard
              </button>
              <button
                onClick={() => {
                  window.location.href = "/dashboard?tab=leads";
                }}
                className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-gray-100 transition hover:bg-slate-700"
              >
                Lead Folders
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          {aiBillingLoading ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-4 text-sm text-gray-200">
              Checking AI Dialer status...
            </div>
          ) : aiBillingError ? (
            <div className="rounded-xl border border-red-500 bg-red-900/40 p-4 text-sm">
              {aiBillingError}
            </div>
          ) : aiDialerLocked ? (
            <div className="rounded-xl border border-yellow-500/70 bg-slate-900 p-4 text-sm">
              {aiUpgradeRequired ? (
                <>
                  <div className="mb-1 font-semibold text-yellow-100">
                    AI Dialer Requires the AI Plan
                  </div>
                  <p className="text-xs text-gray-200">
                    You&apos;re on the Base plan. Upgrade to AI for $50/month to unlock Kayla, the AI voice dialer.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/settings?tab=billing";
                    }}
                    className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                    style={{ cursor: "pointer" }}
                  >
                    Upgrade to AI — $50/month
                  </button>
                </>
              ) : (
                <>
                  <div className="mb-1 font-semibold text-yellow-100">
                    Billing Required
                  </div>
                  <p className="text-xs text-gray-200">
                    Complete billing in <span className="font-semibold">Settings → Billing</span> to use AI Dialer features.
                    <br />
                    <span className="font-semibold">$20 for every 4 hours of dial time.</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/settings?tab=billing";
                    }}
                    className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
                    style={{ cursor: "pointer" }}
                  >
                    Go to Billing
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-900/40 p-4 text-sm">
              <div className="mb-1 font-semibold">AI Dialer Enabled</div>
              <p className="text-xs text-gray-100">
                AI Dialer runs completely separate from your manual dialer
                usage. We bill{" "}
                <span className="font-semibold">$20 for every 4 hours of dial time.</span>
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500 bg-red-900/40 p-4 text-sm">
            {error}
          </div>
        )}
        {sessionError && (
          <div className="mb-4 rounded-xl border border-yellow-500 bg-yellow-900/40 p-4 text-sm">
            {sessionError}
          </div>
        )}
        {certificationAccepted && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-900/40 px-4 py-2 text-sm font-semibold text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            AI Calling Certified ✔
          </div>
        )}

        {!activeSession ? (
          <>
            <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className={configCardClassName}>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                    Folder
                  </p>
                  <h2 className="text-lg font-semibold">Choose Folder</h2>
                </div>
                {loadingFolders ? (
                  <p className="text-sm text-gray-300">Loading folders...</p>
                ) : folders.length === 0 ? (
                  <p className="text-sm text-gray-300">
                    No folders found. Import leads first.
                  </p>
                ) : (
                  <select
                    value={selectedFolderId}
                    onChange={(e) => setSelectedFolderId(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="">-- Select a folder --</option>
                    {folders.map((f) => (
                      <option key={f._id} value={f._id}>
                        {f.name} — {f.leadCount ?? 0} leads
                      </option>
                    ))}
                  </select>
                )}
                {selectedFolderName && (
                  <p className="mt-3 text-xs text-gray-400">
                    Selected:{" "}
                    <span className="font-semibold text-gray-200">{selectedFolderName}</span>
                  </p>
                )}
              </div>

              <div className={configCardClassName}>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                    From Number
                  </p>
                  <h2 className="text-lg font-semibold">Choose From Number</h2>
                </div>
                {loadingNumbers ? (
                  <p className="text-sm text-gray-300">Loading numbers...</p>
                ) : numbers.length === 0 ? (
                  <p className="text-sm text-gray-300">
                    You don&apos;t have any numbers yet. Purchase a number in your
                    Numbers tab.
                  </p>
                ) : (
                  <select
                    value={selectedFromNumber}
                    onChange={(e) => setSelectedFromNumber(e.target.value)}
                    className={selectClassName}
                  >
                    <option value="">-- Select a number --</option>
                    {numbers.map((n) => (
                      <option key={n.sid} value={n.phoneNumber}>
                        {formatPhoneNumber(n.phoneNumber)}{getNumberState(n.phoneNumber) ? ` · ${getNumberState(n.phoneNumber)}` : ""}{n.subscriptionStatus ? ` • ${n.subscriptionStatus}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {selectedFromNumber && (
                  <p className="mt-3 text-xs text-gray-400">
                    Calls will appear as:{" "}
                    <span className="font-semibold text-gray-200">{formatPhoneNumber(selectedFromNumber)}{getNumberState(selectedFromNumber) ? ` · ${getNumberState(selectedFromNumber)}` : ""}</span>
                  </p>
                )}
              </div>

              <div className={configCardClassName}>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                    Script
                  </p>
                  <h2 className="text-lg font-semibold">Choose Script</h2>
                </div>
                <select
                  value={selectedScriptKey}
                  onChange={(e) => setSelectedScriptKey(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">-- Select a script --</option>
                  {SCRIPT_OPTIONS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {currentScript && (
                  <p className="mt-3 text-xs text-gray-400">
                    {currentScript.description}
                  </p>
                )}
              </div>

              <div className={configCardClassName}>
                <div className="mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-300">
                    Voice
                  </p>
                  <h2 className="text-lg font-semibold">Choose Voice</h2>
                </div>
                <select
                  value={selectedVoiceKey}
                  onChange={(e) => setSelectedVoiceKey(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">-- Select a voice --</option>
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.key} value={v.key}>
                      {v.label}
                    </option>
                  ))}
                </select>
                {currentVoice && (
                  <p className="mt-3 text-xs text-gray-400">
                    Voice preset:{" "}
                    <span className="font-semibold text-gray-200">{currentVoice.label}</span>
                  </p>
                )}
              </div>
            </div>

            {certificationRequired && (
              <div className="mb-6 rounded-xl border border-yellow-500/70 bg-slate-900 p-5 text-sm shadow">
                <h3 className="font-semibold text-yellow-100">
                  AI Calling Certification Required
                </h3>
                <p className="mt-1 text-xs text-yellow-50">
                  Confirm this once before starting AI-assisted calling. Review the{" "}
                  <a
                    href="/legal/terms"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="/legal/acceptable-use"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Acceptable Use Policy
                  </a>
                  .
                </p>
                <label className="mt-3 flex items-start gap-2 text-xs text-yellow-50">
                  <input
                    type="checkbox"
                    checked={certificationChecked}
                    onChange={(e) => setCertificationChecked(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    I certify that I have obtained all consent required by
                    applicable law before using CoveCRM&apos;s AI-assisted calling
                    features.
                  </span>
                </label>
                {certificationError && (
                  <p className="mt-2 text-xs text-red-200">
                    {certificationError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleConfirmCertification}
                  disabled={certificationSubmitting}
                  className={`mt-3 rounded-xl px-4 py-2 font-semibold text-white ${
                    certificationSubmitting
                      ? "cursor-not-allowed bg-gray-600"
                      : certificationChecked
                        ? "bg-yellow-600 hover:bg-yellow-700"
                        : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  {certificationSubmitting ? "Saving..." : "Confirm Certification"}
                </button>
              </div>
            )}

            <div className="mb-6 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="font-semibold">AI Dial Session Controls</h2>
                  <p className="mt-1 text-xs text-gray-300">
                    The AI dialer will run in the background. You can navigate
                    anywhere in CoveCRM while it calls leads from the selected
                    folder.
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    By using AI-assisted calling, you are responsible for obtaining
                    all consent required by applicable law.
                  </p>
                  {aiDialerLocked && !aiBillingLoading && (
                    <p className="mt-1 text-xs text-yellow-300">
                      {aiUpgradeRequired
                        ? "AI Dialer is currently locked. Upgrade to AI in Settings → Billing & Usage to enable these controls."
                        : "AI Dialer is currently locked. Complete billing in Settings → Billing to enable these controls."}
                    </p>
                  )}
                  {certificationRequired && (
                    <p className="mt-1 text-xs text-yellow-300">
                      Complete the AI Calling Certification below to start or resume
                      AI dialing.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleStartSession}
                    disabled={
                      aiDialerLocked ||
                      !canConfigure ||
                      !!activeSession ||
                      certificationLoading ||
                      certificationRequired ||
                      sessionLoading
                    }
                    className={`rounded-xl px-5 py-2.5 font-semibold text-white transition ${
                      aiDialerLocked ||
                      !canConfigure ||
                      !!activeSession ||
                      certificationLoading ||
                      certificationRequired ||
                      sessionLoading
                        ? "cursor-not-allowed bg-gray-600"
                        : "bg-emerald-600 hover:bg-emerald-700"
                    }`}
                  >
                    {sessionLoading ? "Working..." : "Start AI Dial Session"}
                  </button>

                  <button
                    onClick={handleResumeSession}
                    disabled={
                      aiDialerLocked ||
                      !canConfigure ||
                      !lastSession ||
                      !canResumeSession ||
                      !!activeSession ||
                      certificationLoading ||
                      certificationRequired ||
                      sessionLoading
                    }
                    className={`rounded-xl px-5 py-2.5 font-semibold text-white transition ${
                      aiDialerLocked ||
                      !canConfigure ||
                      !lastSession ||
                      !canResumeSession ||
                      !!activeSession ||
                      certificationLoading ||
                      certificationRequired ||
                      sessionLoading
                        ? "cursor-not-allowed bg-gray-600"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    Resume AI Dial Session
                  </button>
                </div>
              </div>
              {lastSession && (
                <div className="mt-4 rounded-xl border border-slate-700 bg-slate-800/70 p-4 text-sm">
                  {canResumeSession ? (
                    <p className="text-gray-300">
                      Resume will continue at lead{" "}
                      <span className="font-semibold text-white">
                        {resumeLeadNumber}
                      </span>{" "}
                      of{" "}
                      <span className="font-semibold text-white">
                        {totalLeads}
                      </span>{" "}
                      from the saved queue for this session.
                    </p>
                  ) : (
                    <p className="text-gray-300">
                      The last saved queue has no remaining leads. Start a fresh
                      AI dial session to rebuild the queue and dial again.
                    </p>
                  )}
                </div>
              )}
            </div>

            {lastSession && (
              <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 shadow">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-semibold">Last Session Summary</h2>
                    <p className="text-xs uppercase tracking-wide text-gray-400">
                      Status: {lastSession.status}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                  {[
                    { label: "Total Leads", value: stats.totalLeads ?? 0 },
                    { label: "Completed", value: stats.completed ?? 0 },
                    { label: "Booked", value: stats.booked ?? 0 },
                    { label: "Not Interested", value: stats.notInterested ?? 0 },
                    { label: "No Answers", value: stats.noAnswers ?? 0 },
                    {
                      label: "Started",
                      value: lastSession.startedAt
                        ? new Date(lastSession.startedAt).toLocaleString()
                        : "-",
                    },
                    {
                      label: "Ended",
                      value: lastSession.endedAt
                        ? new Date(lastSession.endedAt).toLocaleString()
                        : "-",
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-slate-900/60 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-gray-400">
                        {item.label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-gray-100">
                        {item.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lastSession && (
              <CallTranscriptsCard
                active={false}
                rows={transcriptRows}
                loading={transcriptsLoading}
                error={transcriptsError}
                expandedCallSid={expandedTranscriptCallSid}
                onToggle={(callSid) =>
                  setExpandedTranscriptCallSid((current) =>
                    current === callSid ? null : callSid,
                  )
                }
              />
            )}
          </>
        ) : (
          <div className="space-y-6">
            <div
              className={`rounded-xl border p-5 shadow ${
                activeSession.status === "running"
                  ? "border-emerald-500/50 bg-emerald-900/50"
                  : activeSession.status === "queued"
                    ? "border-indigo-500/50 bg-indigo-900/50"
                    : "border-yellow-500/50 bg-yellow-900/50"
              }`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    {activeSession.status === "running" && (
                      <span className="relative flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-300" />
                      </span>
                    )}
                    {activeSession.status === "queued" && (
                      <span className="h-3 w-3 rounded-full bg-indigo-300" />
                    )}
                    {activeSession.status === "paused" && (
                      <span className="h-3 w-3 rounded-full bg-yellow-300" />
                    )}
                    <h1 className="text-xl font-bold md:text-2xl">
                      {activeSession.status === "running"
                        ? "KAYLA IS LIVE — Dial Session In Progress"
                        : activeSession.status === "queued"
                          ? "KAYLA IS QUEUED — Starting soon..."
                          : "SESSION PAUSED"}
                    </h1>
                  </div>
                  <p className="mt-2 text-sm text-gray-200">
                    {displayFolderName} · {displayScriptLabel} · {displayFromNumber}
                  </p>
                </div>
                <button
                  onClick={handleEndSession}
                  disabled={!activeSession || sessionLoading}
                  className={`rounded-xl px-5 py-2.5 font-semibold text-white transition ${
                    !activeSession || sessionLoading
                      ? "cursor-not-allowed bg-gray-600"
                      : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  End AI Dial Session
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-[#0d1a35] to-[#020617] px-6 py-8 shadow-2xl shadow-blue-900/30 md:px-10 md:py-10">
              <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="mb-3 text-[10px] uppercase tracking-[0.25em] text-gray-400">
                    DIAL SESSION IN PROGRESS
                  </p>
                  <h1 className="text-3xl font-bold md:text-4xl">
                    Kayla is calling {totalLeads} leads
                  </h1>
                  <p className="mt-2 text-base font-semibold text-indigo-200">
                    {dialedLeads} / {totalLeads} dialed
                  </p>
                  <p className="mt-1 text-sm text-gray-400">{pct}% complete</p>
                </div>
                <div className="rounded-2xl border border-gray-700/70 bg-[#07101e] px-5 py-4">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-gray-500">
                    Queue
                  </p>
                  <p className="mt-1 text-3xl font-bold text-indigo-300">
                    {remainingLeads}
                  </p>
                  <p className="text-xs text-gray-400">remaining</p>
                </div>
              </div>

              <div className="mb-8 h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-3 rounded-full bg-indigo-500 transition-all duration-500 motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
                {[
                  {
                    label: "Booked",
                    value: stats.booked ?? 0,
                    color: "text-emerald-400",
                    icon: <CheckIcon />,
                  },
                  {
                    label: "Live Transfers",
                    value: stats.transferred ?? 0,
                    color: "text-sky-400",
                    icon: <PhoneIcon />,
                  },
                  {
                    label: "Not Interested",
                    value: stats.notInterested ?? 0,
                    color: "text-orange-400",
                    icon: <XIcon />,
                  },
                  {
                    label: "No Answer",
                    value: stats.noAnswers ?? 0,
                    color: "text-gray-400",
                    icon: <BellOffIcon />,
                  },
                  {
                    label: "Remaining",
                    value: remainingLeads,
                    color: "text-indigo-300",
                    icon: <ClockIcon />,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-gray-700/70 bg-[#07101e] p-5 text-center"
                  >
                    <div className={`mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 ${item.color}`}>
                      {item.icon}
                    </div>
                    <div className={`text-3xl font-bold ${item.color}`}>
                      {item.value}
                    </div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-gray-700/70 bg-[#07101e] p-5">
                <h2 className="mb-4 text-lg font-semibold">Session Results</h2>
                {sessionResultRows.length === 0 ? (
                  <div className="flex items-center gap-3 text-sm text-gray-300">
                    <span className="h-2.5 w-2.5 rounded-full bg-indigo-400" />
                    <span>
                      Kayla is dialing — results will appear here as calls complete
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sessionResultRows.map((row) => (
                      <div
                        key={row.text}
                        className="flex items-center gap-3 text-sm text-gray-200"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${row.color}`} />
                        <span>{row.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <CallTranscriptsCard
                active
                rows={transcriptRows}
                loading={transcriptsLoading}
                error={transcriptsError}
                expandedCallSid={expandedTranscriptCallSid}
                onToggle={(callSid) =>
                  setExpandedTranscriptCallSid((current) =>
                    current === callSid ? null : callSid,
                  )
                }
              />
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-900/80">
              <button
                type="button"
                onClick={() => setSessionDetailsOpen((open) => !open)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-gray-200"
              >
                <span>Session Details</span>
                <span className="text-gray-400">
                  {sessionDetailsOpen ? "Collapse" : "Expand"}
                </span>
              </button>
              {sessionDetailsOpen && (
                <div className="grid grid-cols-1 gap-3 border-t border-slate-700 p-4 text-sm md:grid-cols-2 xl:grid-cols-3">
                  {[
                    {
                      label: "Selected Folder",
                      value: displayFolderName,
                    },
                    {
                      label: "Script",
                      value: displayScriptLabel,
                    },
                    {
                      label: "Voice",
                      value: displayVoiceLabel,
                    },
                    {
                      label: "From Number",
                      value: displayFromNumber || "-",
                    },
                    {
                      label: "Started",
                      value: activeSession.startedAt
                        ? new Date(activeSession.startedAt).toLocaleString()
                        : "-",
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-slate-800/70 p-3">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">
                        {item.label}
                      </p>
                      <p className="mt-1 break-words text-gray-100">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
