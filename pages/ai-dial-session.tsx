import { authOptions } from "./api/auth/[...nextauth]";
import { getServerSession } from "next-auth";
import type { GetServerSideProps } from "next";
// pages/ai-dial-session.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
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
  const router = useRouter();

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__aiDialSessionActive = Boolean(activeSession);
    return () => {
      (window as any).__aiDialSessionActive = false;
    };
  }, [activeSession]);

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
            data?.version === AI_CALLING_CERTIFICATION_VERSION,
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
  const stats = lastSession?.stats || {};

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

  const canConfigure =
    !!selectedFolderId &&
    !!selectedScriptKey &&
    !!selectedVoiceKey &&
    !!selectedFromNumber;

  const aiDialerLocked = !hasAiDialer;
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
      alert(
        "AI Dialer is locked. Complete billing in Settings → Billing before starting.",
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
      alert(
        "AI Dialer is locked. Complete billing in Settings → Billing before resuming.",
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

  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen">
      <Sidebar />
      <div className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">AI Dial Session</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard").catch(() => {})}
              className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
            >
              ← Back to Dashboard
            </button>
            <button
              onClick={() =>
                router.push("/dashboard?tab=leads").catch(() => {})
              }
              className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600"
            >
              Lead Folders
            </button>
          </div>
        </div>

        {/* AI Dialer billing banner */}
        <div className="mb-4">
          {aiBillingLoading ? (
            <div className="p-3 rounded bg-slate-800 border border-slate-600 text-sm">
              Checking AI Dialer status…
            </div>
          ) : aiBillingError ? (
            <div className="p-3 rounded bg-red-900/40 border border-red-500 text-sm">
              {aiBillingError}
            </div>
          ) : aiDialerLocked ? (
            <div className="p-3 rounded bg-slate-900 border border-yellow-500 text-sm">
              <div className="font-semibold mb-1">
                Billing Required
              </div>
              <p className="text-xs text-gray-200">
                Complete billing in <span className="font-semibold">Settings → Billing</span> to use AI Dialer features.
                <br />
                <span className="font-semibold">$20 for every 4 hours of dial time.</span>
              </p>
            </div>
          ) : (
            <div className="p-3 rounded bg-emerald-900/40 border border-emerald-500 text-sm">
              <div className="font-semibold mb-1">AI Dialer Enabled</div>
              <p className="text-xs text-gray-100">
                AI Dialer runs completely separate from your manual dialer
                usage. We bill{" "}
                <span className="font-semibold">$20 for every 4 hours of dial time.</span>
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded bg-red-900/40 border border-red-500 text-sm">
            {error}
          </div>
        )}
        {sessionError && (
          <div className="mb-4 p-3 rounded bg-yellow-900/40 border border-yellow-500 text-sm">
            {sessionError}
          </div>
        )}

        {/* Config grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {/* Folder selector */}
          <div className="bg-slate-800 rounded p-4 shadow">
            <h2 className="font-semibold mb-2">1. Choose Folder</h2>
            {loadingFolders ? (
              <p className="text-sm text-gray-300">Loading folders…</p>
            ) : folders.length === 0 ? (
              <p className="text-sm text-gray-300">
                No folders found. Import leads first.
              </p>
            ) : (
              <select
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
                className="w-full p-2 rounded text-black border border-gray-400 bg-white"
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
              <p className="mt-2 text-xs text-gray-300">
                Selected:{" "}
                <span className="font-semibold">{selectedFolderName}</span>
              </p>
            )}
          </div>

          {/* From Number selector */}
          <div className="bg-slate-800 rounded p-4 shadow">
            <h2 className="font-semibold mb-2">2. Choose From Number</h2>
            {loadingNumbers ? (
              <p className="text-sm text-gray-300">Loading numbers…</p>
            ) : numbers.length === 0 ? (
              <p className="text-sm text-gray-300">
                You don&apos;t have any numbers yet. Purchase a number in your
                Numbers tab.
              </p>
            ) : (
              <select
                value={selectedFromNumber}
                onChange={(e) => setSelectedFromNumber(e.target.value)}
                className="w-full p-2 rounded text-black border border-gray-400 bg-white"
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
              <p className="mt-2 text-xs text-gray-300">
                Calls will appear as:{" "}
                <span className="font-semibold">{formatPhoneNumber(selectedFromNumber)}{getNumberState(selectedFromNumber) ? ` · ${getNumberState(selectedFromNumber)}` : ""}</span>
              </p>
            )}
          </div>

          {/* Script selector */}
          <div className="bg-slate-800 rounded p-4 shadow">
            <h2 className="font-semibold mb-2">3. Choose Script</h2>
            <select
              value={selectedScriptKey}
              onChange={(e) => setSelectedScriptKey(e.target.value)}
              className="w-full p-2 rounded text-black border border-gray-400 bg-white"
            >
              <option value="">-- Select a script --</option>
              {SCRIPT_OPTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            {currentScript && (
              <p className="mt-2 text-xs text-gray-300">
                {currentScript.description}
              </p>
            )}
          </div>

          {/* Voice selector */}
          <div className="bg-slate-800 rounded p-4 shadow">
            <h2 className="font-semibold mb-2">4. Choose Voice</h2>
            <select
              value={selectedVoiceKey}
              onChange={(e) => setSelectedVoiceKey(e.target.value)}
              className="w-full p-2 rounded text-black border border-gray-400 bg-white"
            >
              <option value="">-- Select a voice --</option>
              {VOICE_OPTIONS.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
            {currentVoice && (
              <p className="mt-2 text-xs text-gray-300">
                Voice preset:{" "}
                <span className="font-semibold">{currentVoice.label}</span>
              </p>
            )}
          </div>
        </div>

        {/* Session controls */}
        <div className="bg-slate-900 rounded p-4 shadow mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold mb-1">AI Dial Session Controls</h2>
              <p className="text-xs text-gray-300">
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
                  AI Dialer is currently locked. Complete billing in Settings →
                  Billing to enable these controls.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
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
                className={`px-4 py-2 rounded text-white ${
                  aiDialerLocked ||
                  !canConfigure ||
                  !!activeSession ||
                  certificationLoading ||
                  certificationRequired ||
                  sessionLoading
                    ? "bg-gray-600 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {sessionLoading ? "Working…" : "Start AI Dial Session"}
              </button>

              <button
                onClick={handleResumeSession}
                disabled={
                  aiDialerLocked ||
                  !canConfigure ||
                  !lastSession ||
                  !!activeSession ||
                  certificationLoading ||
                  certificationRequired ||
                  sessionLoading
                }
                className={`px-4 py-2 rounded text-white ${
                  aiDialerLocked ||
                  !canConfigure ||
                  !lastSession ||
                  !!activeSession ||
                  certificationLoading ||
                  certificationRequired ||
                  sessionLoading
                    ? "bg-gray-600 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                Resume AI Dial Session
              </button>

              <button
                onClick={handleEndSession}
                disabled={!activeSession || sessionLoading}
                className={`px-4 py-2 rounded text-white ${
                  !activeSession || sessionLoading
                    ? "bg-gray-600 cursor-not-allowed"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                End AI Dial Session
              </button>
              {certificationRequired && (
                <p className="basis-full text-xs text-yellow-300">
                  Complete the AI Calling Certification below to start or resume
                  AI dialing.
                </p>
              )}
            </div>
          </div>

          {certificationRequired && (
            <div className="mt-4 rounded border border-yellow-500 bg-yellow-950/40 p-4 text-sm">
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
                disabled={!certificationChecked || certificationSubmitting}
                className={`mt-3 px-4 py-2 rounded text-white ${
                  !certificationChecked || certificationSubmitting
                    ? "bg-gray-600 cursor-not-allowed"
                    : "bg-yellow-600 hover:bg-yellow-700"
                }`}
              >
                {certificationSubmitting ? "Saving..." : "Confirm Certification"}
              </button>
            </div>
          )}

          {/* Current session summary */}
          <div className="mt-4 border-t border-slate-700 pt-4 text-sm">
            {!selectedFolderId ? (
              <p className="text-gray-300">
                Select a folder above to view AI dial session status.
              </p>
            ) : sessionLoading && !lastSession ? (
              <p className="text-gray-300">Loading AI dial session…</p>
            ) : !lastSession ? (
              <p className="text-gray-300">
                No AI dial sessions have been created for{" "}
                <span className="font-semibold">
                  {selectedFolderName || "this folder"}
                </span>{" "}
                yet.
              </p>
            ) : (
              <div className="space-y-1">
                <p>
                  Last session status:{" "}
                  <span className="font-semibold uppercase">
                    {lastSession.status}
                  </span>
                </p>
                <p>
                  Total leads:{" "}
                  <span className="font-semibold">
                    {stats.totalLeads ?? 0}
                  </span>{" "}
                  • Completed:{" "}
                  <span className="font-semibold">
                    {stats.completed ?? 0}
                  </span>{" "}
                  • Booked:{" "}
                  <span className="font-semibold">
                    {stats.booked ?? 0}
                  </span>{" "}
                  • Not interested:{" "}
                  <span className="font-semibold">
                    {stats.notInterested ?? 0}
                  </span>{" "}
                  • No answers:{" "}
                  <span className="font-semibold">
                    {stats.noAnswers ?? 0}
                  </span>
                </p>
                {lastSession.startedAt && (
                  <p className="text-xs text-gray-400">
                    Started:{" "}
                    {new Date(lastSession.startedAt).toLocaleString()}
                  </p>
                )}
                {lastSession.endedAt && (
                  <p className="text-xs text-gray-400">
                    Ended: {new Date(lastSession.endedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Live progress widget */}
        {lastSession && (
          <div className="bg-slate-800 rounded-xl p-5 shadow border border-indigo-700/30 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-white">
                  Kayla is calling{" "}
                  <span className="text-indigo-300">{stats.totalLeads ?? 0}</span> leads
                </h2>
                {lastSession.status === "running" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-600 text-white">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse inline-block" />
                    LIVE
                  </span>
                )}
              </div>
              {lastSession.status === "completed" && (
                <span className="text-xs text-emerald-400 font-semibold">Session complete</span>
              )}
            </div>

            {(() => {
              const total = stats.totalLeads ?? 0;
              const done = (stats.completed ?? 0) + (stats.skipped ?? 0);
              const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
              return (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{done} of {total} processed</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {(
                [
                  { label: "Booked", value: stats.booked ?? 0, color: "text-emerald-400" },
                  { label: "Transferred", value: stats.transferred ?? 0, color: "text-sky-400" },
                  { label: "Not Interested", value: stats.notInterested ?? 0, color: "text-orange-400" },
                  { label: "No Answer", value: stats.noAnswers ?? 0, color: "text-gray-400" },
                  {
                    label: "Remaining",
                    value: Math.max(
                      0,
                      (stats.totalLeads ?? 0) - (stats.completed ?? 0) - (stats.skipped ?? 0)
                    ),
                    color: "text-indigo-300",
                  },
                ] as { label: string; value: number; color: string }[]
              ).map(({ label, value, color }) => (
                <div key={label} className="bg-slate-900/60 rounded-lg p-3 text-center">
                  <div className={`text-xl font-bold ${color}`}>{value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
