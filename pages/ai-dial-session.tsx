// pages/ai-dial-session.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";

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
    label: "Mortgage Protection Script",
    description: "Standard mortgage protection opener, fact-find, and close.",
  },
  {
    key: "final_expense",
    label: "Final Expense Script",
    description: "Final expense, social security anchor, and simple close.",
  },
  {
    key: "iul_leads",
    label: "IUL Script",
    description: "Indexed UL positioning, cash value benefits, and close.",
  },
  {
    key: "veteran_leads",
    label: "Veteran Leads Script",
    description: "Veteran program positioning and benefits-focused script.",
  },
  {
    key: "trucker_leads",
    label: "Trucker Leads Script",
    description: "CDL / trucker lead script tailored to over-the-road drivers.",
  },
];

/**
 * Hardcoded voice personas for now (later: AIAgentVoiceProfile)
 *
 * Keys here must match:
 *  - pages/api/ai-calls/context.ts → VOICE_PROFILES
 *  - pages/api/ai-calls/session.ts PostBody.voiceKey docs
 *
 * Primary, selectable voices are now ONLY Jacob and Iris.
 * Legacy keys like Kayla/Elena are still supported on the backend but no longer appear here.
 */
const VOICE_OPTIONS = [
  {
    key: "jacob",
    label: "Jacob (Male)",
    providerVoiceId: "cedar",
  },
  {
    key: "iris",
    label: "Iris (Female)",
    providerVoiceId: "marin",
  },
];

export default function AIDialSessionPage() {
  const router = useRouter();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [numbers, setNumbers] = useState<NumberEntry[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingNumbers, setLoadingNumbers] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const [selectedScriptKey, setSelectedScriptKey] = useState<string>("");
  const [selectedVoiceKey, setSelectedVoiceKey] = useState<string>("");
  const [selectedFromNumber, setSelectedFromNumber] = useState<string>("");

  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lastSession, setLastSession] = useState<AICallSession | null>(null);

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
        setFolders(Array.isArray(data?.folders) ? data.folders : []);
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

  /** Start a brand new AI dial session for the selected folder (mode: fresh) */
  const handleStartSession = async () => {
    if (aiDialerLocked) {
      alert(
        "AI Dialer is locked. Add AI Dialer minutes in Settings → Billing before starting.",
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
        "AI Dialer is locked. Add AI Dialer minutes in Settings → Billing before resuming.",
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

        {/* AI Dialer upgrade banner */}
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
                AI Dialer Add-on Required
              </div>
              <p className="text-xs text-gray-200">
                The AI dialer runs on advanced AI voice calls and is billed
                separately from your normal dialer usage.
                <br />
                Add the <span className="font-semibold">AI Dialer</span> add-on
                in <span className="font-semibold">Settings → Billing</span> to
                unlock this page.
                <br />
                Each $20 top-up gives you ~{" "}
                <span className="font-semibold">133 minutes</span> at{" "}
                <span className="font-semibold">$0.15/min</span> (~$9/hour).
              </p>
            </div>
          ) : (
            <div className="p-3 rounded bg-emerald-900/40 border border-emerald-500 text-sm">
              <div className="font-semibold mb-1">AI Dialer Enabled</div>
              <p className="text-xs text-gray-100">
                AI Dialer runs completely separate from your manual dialer
                usage. We bill{" "}
                <span className="font-semibold">
                  $20 automatically for every 133 minutes
                </span>{" "}
                of AI dialing.
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
                    {n.phoneNumber}{" "}
                    {n.subscriptionStatus ? `• ${n.subscriptionStatus}` : ""}
                  </option>
                ))}
              </select>
            )}
            {selectedFromNumber && (
              <p className="mt-2 text-xs text-gray-300">
                Calls will appear as:{" "}
                <span className="font-semibold">{selectedFromNumber}</span>
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
              {aiDialerLocked && !aiBillingLoading && (
                <p className="mt-1 text-xs text-yellow-300">
                  AI Dialer is currently locked. Add minutes in Settings →
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
                  sessionLoading
                }
                className={`px-4 py-2 rounded text-white ${
                  aiDialerLocked ||
                  !canConfigure ||
                  !!activeSession ||
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
                  sessionLoading
                }
                className={`px-4 py-2 rounded text-white ${
                  aiDialerLocked ||
                  !canConfigure ||
                  !lastSession ||
                  !!activeSession ||
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
            </div>
          </div>

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

        <div className="text-xs text-gray-400">
          <p className="mb-1 font-semibold">
            Architecture notes (for later wiring):
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>
              Each AI Dial Session is stored in <code>AICallSession</code> with
              folder, script, voice, fromNumber, status and basic stats.
            </li>
            <li>
              Individual AI calls (with recordings) will be stored in{" "}
              <code>AICallRecording</code> and attach back to leads +
              interaction history.
            </li>
            <li>
              Scripts and voices can later be managed in{" "}
              <code>AIAgentScript</code> and{" "}
              <code>AIAgentVoiceProfile</code> instead of the hardcoded lists
              here.
            </li>
            <li>
              AI Dialer billing is separate from your manual dialer usage and
              uses a prepaid minute balance.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
