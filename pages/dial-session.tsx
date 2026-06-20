// pages/dial-session.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import BookAppointmentModal from "@/components/BookAppointmentModal";
import SaleModal from "@/components/SaleModal";
import { isCallAllowedForLead, localTimeString } from "@/utils/checkCallTime";
import { playRingback, stopRingback, primeAudioContext, ensureUnlocked, armRingbackFromUserGesture } from "@/utils/ringAudio";
import toast from "react-hot-toast";
import { connectDirect, joinConference, leaveConference, setMuted as sdkSetMuted, getMuted as sdkGetMuted } from "@/utils/voiceClient";
import { useSoftphone } from "@/components/telephony/SoftphoneProvider";
import {
  FaChevronDown,
  FaCircle,
  FaMicrophone,
  FaMicrophoneSlash,
  FaPaperPlane,
  FaPause,
  FaPhoneSlash,
  FaPlay,
  FaRedo,
  FaRobot,
  FaSignOutAlt,
  FaStickyNote,
} from "react-icons/fa";

interface Lead { id: string; [key: string]: any; }
type Json = Record<string, any>;

const DIAL_DELAY_MS = 2000;
const EARLY_STATUS_MS = 12000;
const LEADS_URL = "/dashboard?tab=leads"; // ✅ canonical destination

type HistoryRow =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; download?: boolean };

type SmsThreadMessage = {
  id?: string;
  dir: "inbound" | "outbound" | "ai";
  text: string;
  date: string;
};

type DialAICallOverview = {
  call?: {
    id?: string;
    callSid?: string;
    startedAt?: string | null;
    completedAt?: string | null;
    duration?: number | null;
    aiOverviewReady?: boolean;
    aiOverview?: {
      overviewBullets?: string[];
      keyDetails?: string[];
      objections?: string[];
      questions?: string[];
      nextSteps?: string[];
      outcome?: string;
      appointmentTime?: string;
      sentiment?: string;
      generatedAt?: string;
    } | null;
  } | null;
};

/** ---------- UI helpers (display-only; no flow changes) ---------- **/
const toTitle = (s: string) =>
  s
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

const normalizeKeyLabel = (k: string) => {
  const lk = k.toLowerCase().trim();
  if (["firstname", "first name", "first_name", "first-name", "first"].includes(lk)) return "First Name";
  if (["lastname", "last name", "last_name", "last-name", "last"].includes(lk)) return "Last Name";
  return toTitle(k);
};

const normalizeKey = (k: string) =>
  String(k || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const isEmptyDisplay = (v: any) => {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return true;
    const lowered = t.toLowerCase();
    if (["-", "n/a", "na", "null", "undefined"].includes(lowered)) return true;
    return false;
  }
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
};

const looksLikePhoneKey = (k: string) => /phone|mobile|cell|number/i.test(k);

const isMeaninglessZero = (key: string, value: any) => {
  const nk = normalizeKey(key);
  const isZero =
    value === 0 ||
    (typeof value === "string" && value.trim() === "0") ||
    (typeof value === "string" && value.trim() === "0.0");
  if (!isZero) return false;

  // Only treat zero as "empty" for fields where 0 is almost always junk
  if (nk.includes("coverage") && nk.includes("amount")) return true;
  if (nk.includes("mortgage") && (nk.includes("amount") || nk.includes("balance") || nk.includes("payment"))) return true;
  if (nk === "age") return true;
  return false;
};

const tryParseJsonObject = (v: any): Record<string, any> | null => {
  if (!v) return null;
  if (typeof v === "object" && !Array.isArray(v)) return v as Record<string, any>;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (!(s.startsWith("{") && s.endsWith("}"))) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    return null;
  } catch {
    return null;
  }
};

// display-only flatten: includes top-level + common nested containers + parses rawRow JSON (Google Sheets)
const flattenDisplayFields = (lead: any) => {
  const out: Record<string, any> = {};
  if (!lead || typeof lead !== "object") return out;

  Object.keys(lead).forEach((k) => {
    out[k] = lead[k];
  });

  const candidates = ["customFields", "fields", "data", "sheet", "payload"];
  for (const c of candidates) {
    const obj = lead?.[c];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      Object.keys(obj).forEach((k) => {
        if (out[k] === undefined) out[k] = obj[k];
      });
    }
  }

  const rawRowObj = tryParseJsonObject(lead?.rawRow);
  if (rawRowObj) {
    Object.keys(rawRowObj).forEach((k) => {
      if (out[k] === undefined) out[k] = rawRowObj[k];
    });
  }

  return out;
};

const isJunkHistoryText = (t: string) => {
  const s = String(t || "").toLowerCase();
  if (!s.trim()) return true;

  // known “code-looking” / fallback junk patterns
  if (s.includes("[ai dialer fallback]")) return true;
  if (s.includes("callsid=")) return true;
  if (s.includes("twilio status=")) return true;
  if (s.includes("answeredby=machine")) return true;
  if (s.includes("voicemail detected") && s.includes("(amd)")) return true;
  if (s.includes("durationsec=")) return true;
  if (s.includes("outcome=disconnected")) return true;

  // extremely long machine blocks are almost never useful in UI
  if (s.length > 600 && (s.includes("callsid") || s.includes("twilio") || s.includes("duration"))) return true;

  return false;
};

function formatSmsThreadTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function sameSmsMessage(a: SmsThreadMessage, b: SmsThreadMessage) {
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  return (
    a.dir === b.dir &&
    a.text === b.text &&
    Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) < 2000
  );
}

const toTimeValue = (value: any, fallback = 0) => {
  if (!value) return fallback;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
};

const toPriorityNumber = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const compareDialPriority = (a: Lead, b: Lead) => {
  const scoreDelta = toPriorityNumber(b.aiPriorityScore) - toPriorityNumber(a.aiPriorityScore);
  if (scoreDelta !== 0) return scoreDelta;

  const createdDelta = toTimeValue(b.createdAt) - toTimeValue(a.createdAt);
  if (createdDelta !== 0) return createdDelta;

  return toTimeValue(a.lastContactedAt) - toTimeValue(b.lastContactedAt);
};

/** --------------------------------------------------------------- **/

export default function DialSession() {
  const router = useRouter();
  const softphone = useSoftphone();
  const {
    leads: leadIdsParam,
    fromNumber: fromNumberParam,
    leadId: singleLeadIdParam,
    quickPhone,
    quickName,
    startIndex,
    progressKey,
    serverProgressKey,
  } = router.query as {
    leads?: string;
    fromNumber?: string;
    leadId?: string;
    quickPhone?: string;
    quickName?: string;
    startIndex?: string;
    progressKey?: string;
    serverProgressKey?: string;
  };

  // 🔒 NEW: inbound Answer flag from URL (?inbound=1|true|yes)
  const inboundMode = useMemo(() => {
    const v = String((router.query as any)?.inbound ?? "").toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }, [router.query]);

  // Queue & selection
  const [leadQueue, setLeadQueue] = useState<Lead[]>([]);
  const [currentLeadIndex, setCurrentLeadIndex] = useState(0);
  const lead = useMemo(() => leadQueue[currentLeadIndex] ?? null, [leadQueue, currentLeadIndex]);

  // Calling state
  const [status, setStatus] = useState("Initializing…");
  const [readyToCall, setReadyToCall] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [connectedDurationSec, setConnectedDurationSec] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionStartedCount, setSessionStartedCount] = useState(0);
  const [tapToStart, setTapToStart] = useState(false);

  // UI
  const [showBookModal, setShowBookModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [defaultComp, setDefaultComp] = useState(100);
  const [notes, setNotes] = useState("");
  const [aiOverviewExpanded, setAiOverviewExpanded] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [sendingSms, setSendingSms] = useState(false);
  const [messages, setMessages] = useState<SmsThreadMessage[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [latestAiOverview, setLatestAiOverview] = useState<DialAICallOverview["call"] | null>(null);

  // Numbers (display only; server resolves authoritative values)
  const [fromNumber, setFromNumber] = useState<string>("");
  const [agentPhone, setAgentPhone] = useState<string>("");

  // guard to avoid auto-dial races
  const [numbersLoaded, setNumbersLoaded] = useState(false);

  // sockets + watchdogs + guards
  const socketRef = useRef<any>(null);
  const userEmailRef = useRef<string>("");
  const currentLeadIdRef = useRef<string>("");
  const showBookModalRef = useRef<boolean>(false);
  const deferredAdvanceRef = useRef<(() => void) | null>(null);
  const callWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextLeadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const connectedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const advanceScheduledRef = useRef<boolean>(false);
  const sessionEndedRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const activeCallSidRef = useRef<string | null>(null);
  const activeConferenceRef = useRef<string | null>(null);
  const placingCallRef = useRef<boolean>(false);
  const activeDialLeadIdRef = useRef<string | null>(null);
  const joinedRef = useRef<boolean>(false);
  const inboundDirectCallRef = useRef<any>(null);
  const inboundDirectSetupRef = useRef(false);

  const dispositionBusyRef = useRef<boolean>(false);

  const leadAttemptCountsRef = useRef<Record<string, number>>({});

  const callStartAtRef = useRef<number>(0);
  const hasConnectedRef = useRef<boolean>(false);
  const terminalHandledRef = useRef<boolean>(false);

  // NEW: call outcome + logging guard
  const callOutcomeRef = useRef<{ status: string; source?: string } | null>(null);
  const callLoggedRef = useRef<boolean>(false);

  const tooEarly = () => !callStartAtRef.current || Date.now() - callStartAtRef.current < EARLY_STATUS_MS;

  /** ✅ Ringback state machine (ONLY controls play/stop; does not touch conference/streaming) **/
  const ringbackDesiredRef = useRef<boolean>(false);
  const ringbackIsOnRef = useRef<boolean>(false);
  const ringbackOpSeqRef = useRef<number>(0);
  const lastCallStatusRef = useRef<string>("");

  const isTerminalStatus = (s: string) =>
    ["completed", "busy", "failed", "no-answer", "canceled"].includes(String(s || "").toLowerCase());

  const stopRingbackNow = () => {
    ringbackDesiredRef.current = false;
    ringbackIsOnRef.current = false;
    ringbackOpSeqRef.current += 1;
    try { stopRingback(); } catch {}
  };

  const applyRingbackDesired = async (desired: boolean) => {
    if (desired && (isPausedRef.current || sessionEndedRef.current)) {
      stopRingbackNow();
      return;
    }

    const opSeq = ringbackOpSeqRef.current + 1;
    ringbackOpSeqRef.current = opSeq;
    ringbackDesiredRef.current = desired;

    if (desired) {
      if (!ringbackIsOnRef.current) {
        ringbackIsOnRef.current = true;
        try { await ensureUnlocked(); } catch {}
        if (
          ringbackOpSeqRef.current !== opSeq ||
          !ringbackDesiredRef.current ||
          sessionEndedRef.current ||
          isPausedRef.current
        ) {
          if (ringbackOpSeqRef.current === opSeq) stopRingbackNow();
          return;
        }
        try { await playRingback(); } catch {}
      }
    } else {
      stopRingbackNow();
    }
  };

  const setRingbackDesired = (on: boolean) => {
    // preserve existing call sites; route through the state machine
    applyRingbackDesired(!!on);
  };

  /** helpers **/
  const formatPhone = (phone: string) => {
    const clean = (phone || "").replace(/\D/g, "");
    if (clean.length === 10) return `${clean.slice(0, 3)}-${clean.slice(3, 6)}-${clean.slice(6)}`;
    if (clean.length === 11 && clean.startsWith("1"))
      return `${clean.slice(0, 1)}-${clean.slice(1, 4)}-${clean.slice(4, 7)}-${clean.slice(7)}`;
    return phone || "";
  };
  const normalizeE164 = (raw?: string) => {
    if (!raw) return "";
    const d = raw.replace(/\D+/g, "");
    if (!d) return "";
    if (d.startsWith("1") && d.length === 11) return `+${d}`;
    if (d.length === 10) return `+1${d}`;
    if (raw.startsWith("+")) return raw.trim();
    return `+${d}`;
  };
  const fetchJson = async <T = Json>(url: string, init?: RequestInit) => {
    const r = await fetch(url, init);
    if (!r.ok) throw new Error(`${r.status}`);
    return (await r.json()) as T;
  };
  const extractAgentPhone = (obj: Json): string | null => {
    const candidates = [
      obj?.agentPhone, obj?.profile?.agentPhone, obj?.settings?.agentPhone,
      obj?.user?.agentPhone, obj?.data?.agentPhone, obj?.phone, obj?.agent_phone,
      obj?.agentMobile, obj?.agentNumber,
    ].filter(Boolean);
    if (candidates.length) return String(candidates[0]);
    const scan = (o: any): string | null => {
      if (!o || typeof o !== "object") return null;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === "string" && k.toLowerCase().includes("agent") && k.toLowerCase().includes("phone")) return v;
        if (typeof v === "object") { const found = scan(v); if (found) return found; }
      }
      return null;
    };
    return scan(obj);
  };
  const pickFirstVoiceNumber = (payload: Json): string | null => {
    const arr: any[] = payload?.numbers || payload?.incomingPhoneNumbers || payload?.data || payload?.items || [];
    for (const n of arr) {
      const num = n?.phoneNumber || n?.friendlyName || n?.number || n?.value || n;
      const caps = n?.capabilities || n?.capability || {};
      const hasVoice = typeof caps === "object" ? !!(caps.voice ?? caps.Voice ?? caps.VOICE) : true;
      if (num && hasVoice) return String(num);
    }
    return arr[0]?.phoneNumber || null;
  };
  const clearWatchdog = () => { if (callWatchdogRef.current) { clearTimeout(callWatchdogRef.current); callWatchdogRef.current = null; } };
  const clearAdvanceTimers = () => {
    if (advanceTimeoutRef.current) { clearTimeout(advanceTimeoutRef.current); advanceTimeoutRef.current = null; }
    if (nextLeadTimeoutRef.current) { clearTimeout(nextLeadTimeoutRef.current); nextLeadTimeoutRef.current = null; }
  };
  const clearStatusPoll = () => { if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; } };
  const formatDuration = (sec: number) => {
    const safeSec = Math.max(0, Math.floor(sec || 0));
    const minutes = Math.floor(safeSec / 60);
    const seconds = safeSec % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };
  const stopConnectedTimer = () => {
    if (connectedTimerRef.current) {
      clearInterval(connectedTimerRef.current);
      connectedTimerRef.current = null;
    }
    connectedAtRef.current = null;
    setConnectedDurationSec(0);
  };
  const startConnectedTimer = () => {
    if (connectedAtRef.current) return;
    connectedAtRef.current = Date.now();
    setConnectedDurationSec(0);
    connectedTimerRef.current = setInterval(() => {
      if (!connectedAtRef.current) return;
      setConnectedDurationSec(Math.floor((Date.now() - connectedAtRef.current) / 1000));
    }, 1000);
  };
  const killAllTimers = () => { clearWatchdog(); clearAdvanceTimers(); clearStatusPoll(); stopConnectedTimer(); };
  const getLeadId = (leadLike?: Lead | null) => String((leadLike as any)?.id || (leadLike as any)?._id || "").trim();
  const currentLeadId = () => getLeadId(leadQueue[currentLeadIndex] ?? lead);
  const getAttemptCount = (leadId: string) => Number(leadAttemptCountsRef.current[leadId] || 0);
  const didCurrentCallConnect = () => {
    const statusLabel = String(callOutcomeRef.current?.status || "").toLowerCase();
    return hasConnectedRef.current || statusLabel === "connected" || statusLabel === "completed";
  };
  const isQuietHoursError = (err: any) => {
    if (err?.quietHours === true) return true;
    const text = [
      err?.message,
      err?.error,
      err?.reason,
      err?.code,
    ].filter(Boolean).join(" ").toLowerCase();
    return /quiet[-\s]?hours|after[-\s]?hours|outside.*(?:legal\s+calling\s+)?hours|outside.*8\s*am.*9\s*pm|legal\s+calling/.test(text);
  };

  useEffect(() => {
    return () => {
      stopConnectedTimer();
    };
  }, []);

  // NEW: central call logging helper (per lead, per call)
  const logCallOutcome = async (opts?: { statusOverride?: string; reason?: string }) => {
    if (callLoggedRef.current) return;

    const current = leadQueue[currentLeadIndex] ?? lead;
    const isQuickDial = Boolean((current as any)?.quickDial);
    const leadId = (current as any)?.id;
    if (!leadId && !isQuickDial) return;

    let statusLabel =
      opts?.statusOverride ||
      callOutcomeRef.current?.status ||
      (hasConnectedRef.current ? "Completed" : "No Answer");

    const durationSec = callStartAtRef.current
      ? Math.max(0, Math.round((Date.now() - callStartAtRef.current) / 1000))
      : undefined;

    callLoggedRef.current = true;

    // Update visible history immediately
    try {
      const when = new Date().toLocaleString();
      setHistory((prev) => [
        {
          kind: "text",
          text: `📞 Call • ${when} — ${statusLabel}${
            typeof durationSec === "number" ? ` — ${durationSec}s` : ""
          }`,
        },
        ...prev,
      ]);
    } catch {
      // ignore UI failure
    }

    if (isQuickDial || !leadId) return;

    // Persist to backend
    try {
      await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          type: "call",
          status: statusLabel,
          durationSec,
          meta: {
            status: statusLabel,
            durationSec,
            reason: opts?.reason || callOutcomeRef.current?.source || "",
            ts: Date.now(),
          },
        }),
      });
    } catch {
      // best-effort only; do not break dial flow
    }
  };

  const hangupActiveCall = async (why?: string) => {
    const sid = activeCallSidRef.current;
    activeCallSidRef.current = null;
    try {
      if (sid) {
        await fetch("/api/twilio/calls/hangup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSid: sid }),
        });
      }
      if (why) console.log("Hangup requested:", { sid, why });
    } catch (e) {
      console.warn("Hangup request failed:", (e as any)?.message || e);
    }
  };

  const leaveIfJoined = async (why?: string) => {
    try {
      await leaveConference();
      if (why) console.log("Left conference:", why, activeConferenceRef.current);
    } catch (e) {
      console.warn("leaveConference failed:", (e as any)?.message || e);
    } finally {
      activeConferenceRef.current = null;
      joinedRef.current = false;
    }
  };

  const requestAdvance = (fn: () => void) => {
    if (showBookModalRef.current) {
      deferredAdvanceRef.current = fn;
      return;
    }
    fn();
  };

  const handleTerminalCall = async (opts: { status: string; reason: string; hangup?: boolean }) => {
    // One terminal owner per call attempt: poller, socket, watchdog, and SDK events can race.
    if (terminalHandledRef.current || sessionEndedRef.current) return;
    terminalHandledRef.current = true;

    callOutcomeRef.current = { status: opts.status, source: opts.reason };
    setStatus(opts.status);
    stopRingbackNow();
    killAllTimers();

    if (opts.hangup) await hangupActiveCall(opts.reason);
    else activeCallSidRef.current = null;

    await leaveIfJoined(opts.reason);
    placingCallRef.current = false;
    activeDialLeadIdRef.current = null;
    setCallActive(false);
    setCallEnded(true);
    await logCallOutcome({ statusOverride: opts.status, reason: opts.reason });

    const endedLead = leadQueue[currentLeadIndex] ?? lead;
    if ((endedLead as any)?.quickDial) {
      clearAdvanceTimers();
      advanceScheduledRef.current = false;
      setReadyToCall(false);
      return;
    }

    // In inbound mode stay on the page — agent sets disposition manually
    if (inboundMode) return;

    requestAdvance(scheduleAdvance);
  };

  const scheduleWatchdog = () => {
    clearWatchdog();
    callWatchdogRef.current = setTimeout(async () => {
      if (advanceScheduledRef.current || sessionEndedRef.current) return;
      await handleTerminalCall({ status: "No Answer", reason: "watchdog-timeout", hangup: true });
    }, 27000);
  };
  function scheduleAdvance() {
    if (advanceScheduledRef.current) return;
    advanceScheduledRef.current = true;

    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);

    advanceTimeoutRef.current = setTimeout(() => {
      advanceScheduledRef.current = false;

      if (sessionEndedRef.current) return;

      const leadId = currentLeadId();
      const shouldRetry =
        !!leadId &&
        !didCurrentCallConnect() &&
        getAttemptCount(leadId) < 2;

      if (shouldRetry) {
        terminalHandledRef.current = false;
        setReadyToCall(true);
        return;
      }

      disconnectAndNext();
    }, DIAL_DELAY_MS);
  }
  const scheduleNextLead = () => {
    if (nextLeadTimeoutRef.current) clearTimeout(nextLeadTimeoutRef.current);
    nextLeadTimeoutRef.current = setTimeout(() => { if (!sessionEndedRef.current) nextLead(); }, DIAL_DELAY_MS);
  };

  // NEW: server-backed progress helpers (non-breaking)
  const serverPersist = async (idx: number) => {
    if (typeof serverProgressKey !== "string" || !serverProgressKey) return;
    try {
      await fetch("/api/dial/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: serverProgressKey, lastIndex: idx, total: leadQueue.length }),
      });
    } catch {}
  };
  const serverFetchLastIndex = async (): Promise<number | null> => {
    if (typeof serverProgressKey !== "string" || !serverProgressKey) return null;
    try {
      const r = await fetch(`/api/dial/progress?key=${encodeURIComponent(serverProgressKey)}`);
      if (!r.ok) return null;
      const j = await r.json();
      return typeof j?.lastIndex === "number" ? j.lastIndex : null;
    } catch { return null; }
  };

  /** bootstrap **/
  useEffect(() => {
    // Safari/WebKit: audio + WebRTC often won't start until a user gesture.
    // We try immediately (and with tiny delays) to "inherit" the navigation click that opened this page.
    // Fallback: first pointer/key gesture will re-attempt unlock and nudge auto-dial if it was waiting.
    let raf: number | null = null;
    let t0: ReturnType<typeof setTimeout> | null = null;
    let t1: ReturnType<typeof setTimeout> | null = null;

    const attemptUnlock = async () => {
      try { await primeAudioContext(); } catch {}
      try { await ensureUnlocked(); } catch {}
    };

    // Immediate + micro-delay + next paint attempts
    // Safari often requires an explicit gesture; show a small banner until the first click/key.
    try {
      const ua = String(navigator.userAgent || "");
      const isSafari =
        /Safari/i.test(ua) &&
        !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS|SamsungBrowser/i.test(ua);
      if (isSafari) setTapToStart(true);
    } catch {}
    attemptUnlock();
    t0 = setTimeout(() => { attemptUnlock(); }, 0);
    t1 = setTimeout(() => { attemptUnlock(); }, 250);
    raf = window.requestAnimationFrame(() => { attemptUnlock(); });

    const onFirstGesture = () => {
      attemptUnlock();
      try { setTapToStart(false); } catch {}

      // If Safari was blocking until gesture, ensure the auto-dial driver gets a state nudge.
      // This does not alter normal flow — only prevents "idle until click" when everything is ready.
      try {
        if (
          !inboundMode &&
          numbersLoaded &&
          leadQueue.length > 0 &&
          sessionStarted &&
          !sessionEndedRef.current &&
          !isPaused &&
          !placingCallRef.current &&
          !callActive
        ) {
          setReadyToCall(true);
        }
      } catch {}
    };

    window.addEventListener("pointerdown", onFirstGesture, { once: true, passive: true } as any);
    window.addEventListener("keydown", onFirstGesture, { once: true } as any);

    return () => {
      try { if (t0) clearTimeout(t0); } catch {}
      try { if (t1) clearTimeout(t1); } catch {}
      try { if (raf !== null) cancelAnimationFrame(raf); } catch {}
      try { window.removeEventListener("pointerdown", onFirstGesture as any); } catch {}
      try { window.removeEventListener("keydown", onFirstGesture as any); } catch {}
    };
  }, []);

  // ✅ ADDITIVE: warm the server/DB/Twilio selection path so the FIRST outbound call doesn't lag.
  useEffect(() => {
    // best-effort only; must never affect dial logic
    fetch("/api/internal/warm-dialer", { method: "GET", cache: "no-store" }).catch(() => {});
  }, []);

  // ✅ Re-prime + re-assert ringback on focus/visibility changes (Safari-safe), only if ringback should be ON
  useEffect(() => {
    const onVis = async () => {
      if (!ringbackDesiredRef.current) return;
      try { await primeAudioContext(); } catch {}
      try { await ensureUnlocked(); } catch {}
      try { await applyRingbackDesired(true); } catch {}
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load selected number + agent phone
  useEffect(() => {
    let cancelled = false;
    const loadNumbers = async () => {
      setNumbersLoaded(false);

      if (typeof fromNumberParam === "string" && fromNumberParam) {
        // URL param is highest priority — use it directly, do NOT persist to localStorage
        if (!cancelled) setFromNumber(fromNumberParam);
      } else {
        // Fetch DB primary, valid numbers list, and session email in parallel
        try {
          const [fromRes, numsRes, sessRes] = await Promise.all([
            fetchJson<{ from: string | null }>("/api/twilio/current-from"),
            fetchJson<{ numbers: Array<{ phoneNumber?: string }> }>("/api/settings/default-number"),
            fetchJson<{ user?: { email?: string } }>("/api/auth/session").catch(() => null as any),
          ]);

          const userEmail = sessRes?.user?.email ? String(sessRes.user.email).toLowerCase() : "";
          const lsKey = userEmail ? `selectedDialNumber:${userEmail}` : "selectedDialNumber";

          const dbPrimary = fromRes?.from || null;
          const validPhones = new Set(
            (numsRes?.numbers || []).map((n: any) => n.phoneNumber).filter(Boolean)
          );

          // localStorage is only honoured if the number is still in this user’s account
          const saved = localStorage.getItem(lsKey);
          let chosen = dbPrimary;

          if (saved && validPhones.has(saved)) {
            chosen = saved; // explicit prior user selection, still valid
          } else if (saved) {
            // Stale or cross-user value — clear it
            localStorage.removeItem(lsKey);
            console.info(`[dial-session] Cleared stale selectedDialNumber for user ${userEmail}`);
          }

          if (!cancelled && chosen) setFromNumber(chosen);
        } catch {
          // on fetch failure fall back to unscoped key without validation
          const saved = localStorage.getItem("selectedDialNumber");
          if (!cancelled && saved) setFromNumber(saved);
        }
      }

      try {
        const profile = await fetchJson<Json>("/api/settings/profile");
        const extracted = extractAgentPhone(profile);
        if (!cancelled && extracted) setAgentPhone(extracted);
        if (!cancelled && profile?.defaultCompPercentage) setDefaultComp(Number(profile.defaultCompPercentage));
      } catch {}

      if (!cancelled) setNumbersLoaded(true);
    };
    loadNumbers();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNumberParam]);

  // Load leads list + support startIndex/progressKey + SERVER resume
  useEffect(() => {
    const loadLeads = async () => {
      if (quickPhone) {
        const phone = String(quickPhone).trim();
        const name = typeof quickName === "string" ? quickName.trim() : "";
        if (!phone) {
          setStatus("Missing quick dial phone");
          return;
        }
        leadAttemptCountsRef.current = {};
        setLeadQueue([
          {
            id: `quick-dial:${phone.replace(/\D/g, "").slice(-10) || Date.now()}`,
            quickDial: true,
            quickPhone: phone,
            Phone: phone,
            "First Name": name,
          } as Lead,
        ]);
        setCurrentLeadIndex(0);
        setSessionStarted(true);
        setReadyToCall(true);
        setStatus("Ready");
        return;
      }

      // single lead mode
      if (singleLeadIdParam) {
        try {
          const j = await fetchJson<Json>(`/api/get-lead?id=${singleLeadIdParam}`);
          if (j?.lead?._id) {
            const formatted = { id: j.lead._id, ...j.lead };
            leadAttemptCountsRef.current = {};
            setLeadQueue([formatted]);
            setCurrentLeadIndex(0);
            setSessionStarted(true);
            setReadyToCall(true);
            setStatus("Ready");
          } else { toast.error("Lead not found"); setStatus("Idle"); }
        } catch { toast.error("Failed to load lead"); setStatus("Idle"); }
        return;
      }

      if (!leadIdsParam) return;
      const ids = String(leadIdsParam).split(",").filter(Boolean);
      try {
        const fetched = await Promise.all(ids.map(async (id) => {
          try {
            const j = await fetchJson<Json>(`/api/get-lead?id=${encodeURIComponent(id)}`);
            return j?.lead?._id ? ({ id: j.lead._id, ...j.lead } as Lead) : null;
          } catch { return null; }
        }));
        const valid = (fetched.filter(Boolean) as Lead[]).sort(compareDialPriority);
        leadAttemptCountsRef.current = {};

        // starting index (local startIndex > server pointer fallback)
        let start = 0;
        if (typeof startIndex === "string") {
          start = Math.max(0, Math.min(parseInt(startIndex, 10) || 0, Math.max(valid.length - 1, 0)));
        } else if (typeof serverProgressKey === "string" && serverProgressKey) {
          const last = await serverFetchLastIndex();
          start = last !== null ? Math.min(last + 1, Math.max(valid.length - 1, 0)) : 0;
        }

        setLeadQueue(valid);
        setCurrentLeadIndex(start);
        if (valid.length) { setSessionStarted(true); setReadyToCall(true); setStatus("Ready"); }
        else { setStatus("Idle"); toast("No valid leads to dial"); }

        // write initial LOCAL progress if key passed
        if (typeof progressKey === "string" && valid.length) {
          localStorage.setItem(progressKey, JSON.stringify({ index: start }));
        }
        // prime SERVER pointer so "last finished" is start-1 before first attempt
        await serverPersist(Math.max(start - 1, -1));
      } catch { setStatus("Idle"); toast.error("Failed to load leads"); }
    };
    loadLeads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadIdsParam, singleLeadIdParam, quickPhone, quickName, startIndex, progressKey, serverProgressKey]);

  // Persist local progress on index change
  useEffect(() => {
    if (typeof progressKey === "string" && leadQueue.length) {
      try { localStorage.setItem(progressKey, JSON.stringify({ index: currentLeadIndex })); } catch {}
    }
  }, [currentLeadIndex, progressKey, leadQueue.length]);

  useEffect(() => {
    currentLeadIdRef.current = getLeadId(lead);
    setAiOverviewExpanded(false);
  }, [lead]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    showBookModalRef.current = showBookModal;
  }, [showBookModal]);

  // Clear + load history for each lead (per-lead only, newest-first)
  useEffect(() => {
    const loadHistory = async () => {
      if (!lead?.id) { setHistory([]); setMessages([]); return; }
      setHistory([]);
      setMessages([]);
      try {
        const j = await fetchJson<{
          events: Array<
            | { type: "sms"; dir: "inbound" | "outbound" | "ai"; text: string; date: string }
            | { type: "call"; status?: string; durationSec?: number; date: string; recordingUrl?: string }
            | { type: "note"; text: string; date: string }
            | { type: "status"; to?: string; date: string }
          >;
        }>(`/api/leads/history?id=${encodeURIComponent(lead.id)}&limit=50&includeCalls=1`);

        const rows: HistoryRow[] = [];
        const smsMessages: SmsThreadMessage[] = [];

        // 🔒 PINNED SAVED NOTES — only if it looks like a real human note (not fallback junk)
        const savedNotes = (lead as any)?.Notes;
        if (typeof savedNotes === "string" && savedNotes.trim() && !isJunkHistoryText(savedNotes.trim())) {
          rows.push({ kind: "text", text: `📌 Saved Notes (Pinned) — ${savedNotes.trim()}` });
        }

        // ✅ PINNED AI OVERVIEW (latest, structured) — only if available
        try {
          const events = Array.isArray(j?.events) ? j.events : [];
          const callsWithOverview = events.filter(
            (ev: any) => ev?.type === "call" && ev?.aiOverviewReady && ev?.aiOverview
          );
          const firstWithOverview = callsWithOverview.sort(
            (a: any, b: any) => +new Date(b?.date || 0) - +new Date(a?.date || 0)
          )[0];
          const o = (firstWithOverview as any)?.aiOverview as any;

          if (o && typeof o === "object") {
            const when2 = new Date((firstWithOverview as any).date).toLocaleString();

            // Close-style card: tight bullets only (no section headings)
            const bullets: string[] = [];

            const ob = Array.isArray(o.overviewBullets) ? o.overviewBullets : [];
            for (const b of ob) {
              const t = String(b || "").trim();
              if (t) bullets.push(t);
              if (bullets.length >= 5) break;
            }

            // If overviewBullets were empty, fall back to keyDetails
            if (!bullets.length) {
              const kd = Array.isArray(o.keyDetails) ? o.keyDetails : [];
              for (const b of kd) {
                const t = String(b || "").trim();
                if (t) bullets.push(t);
                if (bullets.length >= 5) break;
              }
            }

            const header = `🤖 AI Call Overview (Pinned) • ${when2}`;
            const metaBits: string[] = [];
            if (o.outcome) metaBits.push(`Outcome: ${String(o.outcome)}`);
            if (o.sentiment) metaBits.push(`Sentiment: ${String(o.sentiment)}`);

            const lines: string[] = [];
            lines.push(header);
            if (metaBits.length) lines.push(metaBits.join(" • "));
            for (const b of bullets.slice(0, 5)) lines.push(`• ${b}`);

            rows.push({ kind: "text", text: lines.join("\n") });
          }
        } catch {
          // ignore
        }

        for (const ev of (j?.events || [])) {
          const when = new Date((ev as any).date).toLocaleString();
          if ((ev as any).type === "note") {
            const t = String((ev as any).text || "");
            if (isJunkHistoryText(t)) continue;
            rows.push({ kind: "text", text: `📝 Note • ${when} — ${t}` });
          } else if ((ev as any).type === "sms") {
            const sms = ev as any;
            const t = String(sms.text || "");
            if (isJunkHistoryText(t)) continue;
            smsMessages.push({
              id: sms.id ? String(sms.id) : undefined,
              dir: sms.dir === "outbound" || sms.dir === "ai" ? sms.dir : "inbound",
              text: t,
              date: String(sms.date || new Date().toISOString()),
            });
          } else if ((ev as any).type === "status") {
            const t = String((ev as any).to || "");
            if (isJunkHistoryText(t)) continue;
            rows.push({ kind: "text", text: `📌 Status • ${when} — ${t || "-"}` });
          } else if ((ev as any).type === "call") {
            const c = ev as any;
            const pieces = [`📞 Call • ${when}`];
            if (c.status) pieces.push(c.status);
            if (typeof c.durationSec === "number") pieces.push(`${c.durationSec}s`);
            rows.push({ kind: "text", text: pieces.join(" — ") });
            // ✅ Dial Session: do NOT show recording rows here
          }
        }
        setHistory(rows);
        setMessages(
          smsMessages.sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
          ),
        );
      } catch {
        setHistory([]);
        setMessages([]);
      }
    };
    loadHistory();
  }, [lead?.id]);

  useEffect(() => {
    const loadLatestAiOverview = async () => {
      if (!lead?.id) {
        setLatestAiOverview(null);
        return;
      }
      try {
        const r = await fetch(`/api/calls/ai-overview?leadId=${encodeURIComponent(lead.id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({} as DialAICallOverview));
        if (r.ok && j?.call) setLatestAiOverview(j.call);
        else setLatestAiOverview(null);
      } catch {
        setLatestAiOverview(null);
      }
    };
    loadLatestAiOverview();
  }, [lead?.id]);

  // Auto-advance driver
  useEffect(() => {
    // 🔒 NEW: if we arrived from an inbound "Answer", NEVER auto-start an outbound call
    if (inboundMode) return;

    if (!numbersLoaded) { setStatus("Loading your numbers…"); return; }

    // ✅ NEW: if we ran past the end (usually due to skip/quiet-hours), finish cleanly
    if (leadQueue.length > 0 && currentLeadIndex >= leadQueue.length && !sessionEndedRef.current) {
      showSessionSummary();
      return;
    }

    if (
      leadQueue.length > 0 &&
      readyToCall &&
      !isPaused &&
      sessionStarted &&
      !sessionEndedRef.current &&
      !placingCallRef.current &&
      !callActive
    ) {
      // Quiet-hours skip (lead time zone)
      const current = leadQueue[currentLeadIndex] || null;
      const { allowed, zone } = isCallAllowedForLead(current || {});

      if (!current || !current.id) {
        // ✅ NEW: if the current slot is invalid, advance or finish (prevents "Missing lead id" dead-end)
        if (currentLeadIndex + 1 >= leadQueue.length) return showSessionSummary();
        serverPersist(currentLeadIndex);
        setCurrentLeadIndex((i) => i + 1);
        setReadyToCall(true);
        return;
      }

      if (!allowed) {
        const timeStr = localTimeString(zone);
        setHistory((prev) => [
          { kind: "text", text: `⏭️ Skipped (quiet hours) • ${timeStr}` },
          ...prev,
        ]);

        // ✅ NEW: if this was the last lead, finish cleanly instead of running past the array
        if (currentLeadIndex + 1 >= leadQueue.length) {
          serverPersist(currentLeadIndex);
          return showSessionSummary();
        }

        serverPersist(currentLeadIndex);
        setCurrentLeadIndex((i) => i + 1);
        setReadyToCall(true);
        return;
      }

      setReadyToCall(false);
      callLead(leadQueue[currentLeadIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboundMode, numbersLoaded, leadQueue, readyToCall, isPaused, sessionStarted, currentLeadIndex, callActive]);

  /** calling **/
  const startOutboundCall = async (leadToCall: Lead): Promise<{ to: string; from: string }> => {
    if (sessionEndedRef.current) throw new Error("Session ended");
    const isQuickDial = Boolean((leadToCall as any)?.quickDial);
    const quickDialPhone = String((leadToCall as any)?.quickPhone || (leadToCall as any)?.Phone || "").trim();
    const leadId = getLeadId(leadToCall);
    const r = await fetch("/api/twilio/voice/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isQuickDial
          ? { to: quickDialPhone, fromNumber }
          : { leadId, fromNumber },
      ),
    });
    if (!r.ok) {
      let msg = `Failed to start call`;
      let payload: any = {};
      try {
        payload = await r.json();
        if (payload?.message || payload?.error) msg = payload.message || payload.error;
      } catch {}
      const err: any = new Error(msg);
      err.status = r.status;
      err.code = payload?.code;
      err.reason = payload?.reason || payload?.error;
      err.zone = payload?.zone || null;
      err.quietHours = r.status === 409 && isQuietHoursError(err);
      throw err;
    }
    const j = (await r.json()) as { success?: boolean; to?: string; from?: string };
    if (!j?.success || !j?.to || !j?.from) throw new Error("Call start did not return to + from");
    return { to: j.to, from: j.from };
  };

  // --- REPLACED: tightened status polling (no early Connected; clean terminal handling)
  const beginStatusPolling = (
    sid: string,
    manualLookup?: { leadId?: string; to?: string; from?: string; since?: number },
  ) => {
    clearStatusPoll();

    const interpret = (raw: any) => String(raw || "").toLowerCase();

    statusPollRef.current = setInterval(async () => {
      try {
        if (isPausedRef.current || sessionEndedRef.current) return;

        const manualParams = new URLSearchParams();
        if (manualLookup?.leadId) manualParams.set("leadId", manualLookup.leadId);
        if (manualLookup?.to) manualParams.set("to", manualLookup.to);
        if (manualLookup?.from) manualParams.set("from", manualLookup.from);
        if (manualLookup?.since) manualParams.set("since", String(manualLookup.since));
        const hasManualLookup = Boolean(manualLookup?.leadId || manualLookup?.to);

        let j: any = null;
        if (hasManualLookup) {
          manualParams.set("manual", "1");
          j = await fetch(`/api/twilio/calls/status?${manualParams.toString()}`, { cache: "no-store" }).then(r => r.json());
        }

        if (!j?.matched && sid) {
          j = await fetch(`/api/twilio/calls/status?sid=${encodeURIComponent(sid)}`, { cache: "no-store" }).then(r => r.json());
        }

        const s = interpret(j?.status);
        if (!s || s === "unknown") return;
        lastCallStatusRef.current = s;
        // queued | ringing | in-progress | completed | busy | failed | no-answer | canceled

        // While truly ringing => ringback ON (and re-assert if needed)
        if (s === "ringing") {
          setStatus("Ringing…");
          await applyRingbackDesired(true);
          return;
        }

        // For queued/initiated/etc: do not force stop or start (avoid false toggles)
        if (s === "queued" || s === "initiated") {
          // no-op
          return;
        }

        if (s === "in-progress") {
          // TRUE bridge — stop ringback & timers, mark connected, keep polling
          stopRingbackNow();
          clearWatchdog();
          hasConnectedRef.current = true;
          startConnectedTimer();
          callOutcomeRef.current = { status: "Connected", source: "poll-in-progress" };
          setStatus("Connected");
          return;
        }

        // terminal states: stop all audio/timers
        if (isTerminalStatus(s)) {
          const label =
            s === "completed" ? "Completed" :
            s === "busy"      ? "Busy" :
            s === "no-answer" ? "No Answer" :
            s === "failed"    ? "Failed" : "Ended";
          await handleTerminalCall({ status: label, reason: `poll-${s}`, hangup: false });
          return;
        }
      } catch {
        // network hiccup? keep polling a bit longer
      }
    }, 1000);
  };

  // Centralized "Disconnected now" path
  const markDisconnected = async (reason: string) => {
    await handleTerminalCall({
      status: hasConnectedRef.current ? "Completed" : "No Answer",
      reason,
      hangup: true,
    });
  };

  // 🔻🔻🔻 TINY, ISOLATED INBOUND HOOK (supports ?conf= or ?conference=) 🔻🔻🔻
  useEffect(() => {
    const q = (router.query as any) || {};
    const inboundRaw = String(q?.inbound ?? "").toLowerCase();
    const inbound =
      inboundRaw === "1" || inboundRaw === "true" || inboundRaw === "yes";
    const conf =
      (typeof q?.conf === "string" && q.conf) ||
      (typeof q?.conference === "string" && q.conference) ||
      "";

    if (!inbound || !conf) return;
    if (joinedRef.current || callActive) return;

    (async () => {
      try {
        setStatus("Connecting…");
        setCallActive(true);
        ensureUnlocked();

        const callObj = await joinConference(String(conf));

        const safeOn = (ev: string, fn: (...a: any[]) => void) => {
          try {
            if ((callObj as any)?.on) (callObj as any).on(ev, fn);
            else if ((callObj as any)?.addListener) (callObj as any).addListener(ev, fn);
          } catch {}
        };

        // 🔁 Agent leg bridged — do NOT mark Connected or stop ringback here.
        const agentLegBridged = () => {
          hasConnectedRef.current = hasConnectedRef.current || false;
        };
        safeOn("accept", agentLegBridged);
        safeOn("connect", agentLegBridged);
        safeOn("connected", agentLegBridged);

        safeOn("disconnect", () => markDisconnected("twilio-disconnect"));
        safeOn("disconnected", () => markDisconnected("twilio-disconnected"));
        safeOn("hangup", () => markDisconnected("twilio-hangup"));

        joinedRef.current = true;
        activeConferenceRef.current = String(conf);
      } catch (e) {
        console.error("inbound join failed:", e);
        setStatus("Failed to join");
        setCallActive(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query?.inbound, router.query?.conf, router.query?.conference]);
  // 🔺🔺🔺 END INBOUND HOOK 🔺🔺🔺

  // INBOUND DIRECT MODE — no conference, SoftphoneProvider call.accept() path.
  // Runs when ?inbound=1 is set without ?conference. Binds the already-accepted
  // Device call to local state so Mute, Hang Up, and the connected timer work.
  useEffect(() => {
    const q = (router.query as any) || {};
    const inboundRaw = String(q?.inbound ?? "").toLowerCase();
    const inbound = inboundRaw === "1" || inboundRaw === "true" || inboundRaw === "yes";
    const conf =
      (typeof q?.conf === "string" && q.conf) ||
      (typeof q?.conference === "string" && q.conference) ||
      "";
    if (!inbound || conf) return;
    if (inboundDirectSetupRef.current) return;
    // Require both: the call object AND the flag that proves answer() actually accepted it.
    // Without the flag, softphone.activeCall could be an outbound call (e.g. agent was on a
    // conference call when the inbound banner appeared via socket.io and they clicked Answer).
    if (!softphone.activeCall || !softphone.inboundCallAccepted) return;

    // Clean up any voiceClient conference that was running (e.g. agent was on an outbound
    // dial-session call). Same-page navigation keeps the component mounted so unmount
    // cleanup doesn't run; we do it here before binding the inbound call.
    void leaveIfJoined("inbound-answer");

    inboundDirectSetupRef.current = true;
    const call = softphone.activeCall;
    inboundDirectCallRef.current = call;

    // Store inbound callSid so REST hangup endpoint can target the right leg
    const sid = typeof q?.callSid === "string" ? q.callSid : "";
    if (sid) activeCallSidRef.current = sid;

    setStatus("Connected");
    setCallActive(true);
    hasConnectedRef.current = true;
    startConnectedTimer();

    // Detect when lead hangs up
    const onEnd = () => markDisconnected("inbound-disconnect");
    try { call.on?.("disconnect", onEnd); } catch {}
    try { call.on?.("cancel", onEnd); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query, softphone.activeCall]);

  const callLead = async (leadToCall: Lead) => {
    if (sessionEndedRef.current) return;
    const leadId = getLeadId(leadToCall);
    if (!leadId) { setStatus("Missing lead id"); return; }
    if (placingCallRef.current || activeCallSidRef.current) return;

    const attemptsSoFar = getAttemptCount(leadId);
    if (attemptsSoFar >= 2) {
      scheduleNextLead();
      return;
    }

    // ✅ REMOVED the global gate (isCallAllowed). We rely only on per-lead quiet hours.
    // Strong per-lead quiet-hours gate
    const { allowed, zone } = isCallAllowedForLead(leadToCall);
    if (!allowed) {
      setStatus(`Quiet hours (${localTimeString(zone)})`);
      scheduleNextLead();
      return;
    }

    try {
      advanceScheduledRef.current = false;
      terminalHandledRef.current = false;
      stopConnectedTimer();
      placingCallRef.current = true;
      activeDialLeadIdRef.current = leadId;
      joinedRef.current = false;
      hasConnectedRef.current = false;
      callOutcomeRef.current = null;
      callLoggedRef.current = false;
      setCallEnded(false);
      leadAttemptCountsRef.current[leadId] = attemptsSoFar + 1;

      setStatus("Dialing…");
      setCallActive(true);
      setMuted(false);
      try { sdkSetMuted(false); } catch {}

      // Ensure audio is gesture-unlocked; then start ringback.
      try { await ensureUnlocked(); } catch {}
      try { armRingbackFromUserGesture(); } catch {}
      await applyRingbackDesired(true);

      callStartAtRef.current = Date.now();

      const { to, from } = await startOutboundCall(leadToCall);
      placingCallRef.current = false;

      if (sessionEndedRef.current) {
        setCallActive(false);
        stopRingbackNow();
        return;
      }

      // Browser SDK places the call (2-leg: browser WebRTC + PSTN to lead)
      joinedRef.current = true;
      const callObj = await connectDirect(to, from, userEmailRef.current, getLeadId(leadToCall));
      const callSid = String((callObj as any)?.parameters?.CallSid || "");
      activeCallSidRef.current = callSid;
      activeConferenceRef.current = null;

      if (sessionEndedRef.current) {
        await hangupActiveCall("ended-during-start");
        await leaveIfJoined("ended-during-start");
        setCallActive(false);
        stopRingbackNow();
        return;
      }

      const safeOn = (ev: string, fn: (...args: any[]) => void) => {
        try {
          if ((callObj as any)?.on) (callObj as any).on(ev, fn);
          else if ((callObj as any)?.addListener) (callObj as any).addListener(ev, fn);
        } catch {}
      };

      // answerOnBridge=true → SDK fires "ringing" while lead's phone rings
      safeOn("ringing", () => { setStatus("Ringing…"); applyRingbackDesired(true); });

      // "accept"/"connect" fires when lead answers — stop ringback, mark connected
      const onBridged = () => {
        stopRingbackNow();
        clearWatchdog();
        hasConnectedRef.current = true;
        startConnectedTimer();
        callOutcomeRef.current = { status: "Connected", source: "sdk-accept" };
        setStatus("Connected");
      };
      safeOn("accept", onBridged);
      safeOn("connect", onBridged);

      safeOn("disconnect", () => { markDisconnected("twilio-disconnect"); });
      safeOn("disconnected", () => { markDisconnected("twilio-disconnected"); });
      safeOn("hangup", () => { markDisconnected("twilio-hangup"); });
      safeOn("cancel", () => { stopRingbackNow(); });
      safeOn("reject", () => { stopRingbackNow(); });
      safeOn("error", () => { stopRingbackNow(); });

      scheduleWatchdog();
      beginStatusPolling(callSid, {
        leadId: getLeadId(leadToCall),
        to,
        from,
        since: callStartAtRef.current,
      });

      setSessionStartedCount((n) => n + 1);

      // UI-only history line
      setHistory((prev) => [{ kind: "text", text: `📞 Call started (${new Date().toLocaleTimeString()})` }, ...prev]);
    } catch (err: any) {
      console.error(err);
      placingCallRef.current = false;
      activeDialLeadIdRef.current = null;
      if (isQuietHoursError(err)) {
        const zone = err?.zone || isCallAllowedForLead(leadToCall).zone;
        stopRingbackNow();
        killAllTimers();
        await leaveIfJoined("quiet-hours-skip");
        activeCallSidRef.current = null;
        setCallActive(false);
        setStatus(`Quiet hours (${localTimeString(zone)})`);
        setHistory((prev) => [
          { kind: "text", text: `⏭️ Skipped (quiet hours) • ${localTimeString(zone)}` },
          ...prev,
        ]);
        if (!sessionEndedRef.current) scheduleNextLead();
        return;
      }
      setStatus(err?.message || "Call failed");
      stopRingbackNow();
      killAllTimers();
      await leaveIfJoined("start-failed");
      setCallActive(false);
      callOutcomeRef.current = { status: "Failed", source: "start-failed" };
      await logCallOutcome({ statusOverride: "Failed", reason: "start-failed" });
      if (!sessionEndedRef.current) scheduleAdvance();
    }
  };

  /** notes / dispositions **/
  const handleSaveNote = async () => {
    if ((lead as any)?.quickDial) return toast.error("Quick Dial calls are not tied to a saved lead");
    if (!notes.trim() || !lead?.id) return toast.error("Cannot save an empty note");
    try {
      const r = await fetch("/api/leads/add-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, text: notes.trim() }),
      });
      if (!r.ok) {
        let msg = "Failed to save note";
        try { const j = await r.json(); if (j?.message) msg = j.message; } catch {}
        throw new Error(msg);
      }
      // Pin new note to top of the visible history immediately
      setHistory((prev) => [{ kind: "text", text: `📝 Note • ${new Date().toLocaleString()} — ${notes.trim()}` }, ...prev]);
      setNotes("");
      toast.success("✅ Note saved!");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save note");
    }
  };

  const handleSendSms = async () => {
    if ((lead as any)?.quickDial) return toast.error("Quick Dial calls are not tied to a saved lead");

    const leadId = getLeadId(lead);
    const cleanText = smsText.trim();
    if (!leadId) return toast.error("No active lead to text");
    if (!cleanText || sendingSms) return;

    try {
      setSendingSms(true);
      const r = await fetch("/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, text: cleanText, direction: "outbound" }),
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload?.error || payload?.message || "Failed to send text");

      const sentAt = new Date().toISOString();
      const message = payload?.message || {};
      setMessages((prev) => {
        const next: SmsThreadMessage = {
          id: message?._id ? String(message._id) : undefined,
          dir: "outbound",
          text: cleanText,
          date: String(message?.createdAt || message?.date || sentAt),
        };
        return prev.some((m) => sameSmsMessage(m, next)) ? prev : [...prev, next];
      });
      setSmsText("");
      toast.success("Text sent");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to send text");
    } finally {
      setSendingSms(false);
    }
  };

  const persistDisposition = async (leadId: string, label: string) => {
    // ❌ Do NOT move folders or touch disposition endpoints for "No Answer"
    if (label !== "No Answer") {
      const candidates: Array<{ url: string; body: any; required?: boolean }> = [
        { url: "/api/leads/set-disposition", body: { leadId, disposition: label } },
        { url: "/api/leads/update", body: { leadId, update: { disposition: label } } },
      ];
      for (const c of candidates) {
        try {
          const r = await fetch(c.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c.body),
          });
          if (r.ok) break;
        } catch {
          // ignore and try the next candidate
        }
      }
    }

    // ✅ Always log the disposition in history so you can still see "No Answer"
    try {
      await fetch("/api/leads/add-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          type: "disposition",
          message: label,
          meta: { disposition: label, ts: Date.now() },
        }),
      });
    } catch {
      // ignore
    }
  };

  const handleDisposition = async (label: "Sold" | "No Answer" | "Booked Appointment" | "Not Interested" | "Bad Number") => {
    if ((lead as any)?.quickDial) {
      toast.error("Quick Dial calls are not tied to a saved lead");
      return;
    }
    if (!lead?.id) {
      toast.error("No active lead to disposition");
      return;
    }
    if (dispositionBusyRef.current) return;
    dispositionBusyRef.current = true;

    try {
      setStatus(`Saving disposition: ${label}…`);
      stopRingbackNow();
      killAllTimers();
      terminalHandledRef.current = true;
      placingCallRef.current = false;
      activeDialLeadIdRef.current = null;

      const reasonKey = `disposition-${label.replace(/\s+/g, "-").toLowerCase()}`;

      await hangupActiveCall(reasonKey);
      await leaveIfJoined(reasonKey);
      setCallActive(false);

      // Log call outcome tied to this disposition (once)
      await logCallOutcome({ statusOverride: label, reason: reasonKey });

      await persistDisposition(lead.id, label);

      setHistory((prev) => [{ kind: "text", text: `🏷️ Disposition: ${label}` }, ...prev]);
      setStatus(`Disposition saved: ${label}`);
      toast.success(`Saved: ${label}`);

      // ✅ IMPORTANT: disposition button must NOT open calendar (prevents double booking)

      if (!sessionEndedRef.current && !inboundMode) {
        if (label === "No Answer") {
          scheduleAdvance(); // double-dial: redial same lead once before advancing
        } else {
          scheduleNextLead(); // advance to next lead
        }
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save note");
      if (!sessionEndedRef.current) scheduleNextLead(); // still advance on error
    } finally {
      dispositionBusyRef.current = false;
    }
  };

  const handleBookedAppointmentBooked = async () => {
    deferredAdvanceRef.current = null;
    setShowBookModal(false);
    await handleDisposition("Booked Appointment");
  };

  const handleBookModalClose = () => {
    setShowBookModal(false);
    const deferred = deferredAdvanceRef.current;
    deferredAdvanceRef.current = null;
    if (deferred) deferred();
  };

  /** flow controls **/
  const nextLead = () => {
    if (sessionEndedRef.current) return;
    stopRingbackNow();
    stopConnectedTimer();
    if (leadQueue.length <= 1) return showSessionSummary();
    const nextIndex = currentLeadIndex + 1;
    if (nextIndex >= leadQueue.length) return showSessionSummary();
    // persist the just-finished index to server
    serverPersist(currentLeadIndex);
    setCurrentLeadIndex(nextIndex);
    setReadyToCall(true);
  };

  const disconnectAndNext = () => {
    if (sessionEndedRef.current) return;
    stopRingbackNow();
    stopConnectedTimer();
    killAllTimers();
    hangupActiveCall("advance-next");
    leaveIfJoined("advance-next");
    placingCallRef.current = false;
    activeDialLeadIdRef.current = null;
    setCallActive(false);
    scheduleNextLead();
  };

  const handleHangUp = () => {
    if (inboundMode && inboundDirectCallRef.current) {
      try { inboundDirectCallRef.current.disconnect?.(); } catch {}
    }
    markDisconnected("agent-hangup");
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);

    try {
      if (inboundMode && inboundDirectCallRef.current) {
        // Inbound direct: mute the SoftphoneProvider-accepted call object
        inboundDirectCallRef.current.mute?.(next);
      } else {
        sdkSetMuted(next);
        let sdkMuted = sdkGetMuted();

        if (sdkMuted !== next) {
          sdkSetMuted(next);
          sdkMuted = sdkGetMuted();
        }

        if (sdkMuted !== next) {
          setMuted(!next);
          toast.error(next ? "Failed to mute call" : "Failed to unmute call");
        }
      }
    } catch {
      setMuted(!next);
      toast.error(next ? "Failed to mute call" : "Failed to unmute call");
    }
  };

  const handleRedialLead = async () => {
    const currentLead = lead;
    if (!currentLead) return;
    if (callActive || placingCallRef.current || sessionEndedRef.current) return;

    // Cancel any pending auto-advance so it doesn't race with manual redial
    clearAdvanceTimers();
    advanceScheduledRef.current = false;
    terminalHandledRef.current = false;

    // Reset attempt count for this lead so the 2-attempt cap doesn't block redial
    const leadId = getLeadId(currentLead);
    if (leadId) {
      leadAttemptCountsRef.current[leadId] = 0;
    }

    setCallEnded(false);
    if (isPaused) setIsPaused(false);
    await callLead(currentLead);
  };

  const togglePause = () => {
    setIsPaused((p) => {
      const next = !p;
      isPausedRef.current = next;
      return next;
    });
    if (!isPaused) {
      stopRingbackNow();
      stopConnectedTimer();
      killAllTimers();
      hangupActiveCall("pause");
      leaveIfJoined("pause");
      placingCallRef.current = false;
      activeDialLeadIdRef.current = null;
      setStatus("Paused");
    } else {
      // Ensure unlock so ringback starts instantly on resume
      ensureUnlocked();
      setReadyToCall(true);
      setStatus("Ready");
    }
  };

  const handleEndSession = async () => {
    const ok = window.confirm(
      `Are you sure you want to end this dial session? You have called ${sessionStartedCount} of ${leadQueue.length} leads.`
    );
    if (!ok) return;

    sessionEndedRef.current = true;
    stopRingbackNow();
    stopConnectedTimer();
    killAllTimers();
    placingCallRef.current = false;
    activeDialLeadIdRef.current = null;
    setReadyToCall(false);
    setCallActive(false);
    hangupActiveCall("end-session");
    leaveIfJoined("end-session");
    setIsPaused(false);
    setStatus("Session ended");

    // persist final index to server so Resume starts after it
    await serverPersist(currentLeadIndex);

    // clear saved LOCAL progress if provided
    if (typeof progressKey === "string") {
      try { localStorage.removeItem(progressKey); } catch {}
    }

    showSessionSummary();
  };

  const showSessionSummary = () => {
    stopRingbackNow();
    stopConnectedTimer();
    alert(`✅ Session Complete!\nYou called ${sessionStartedCount} out of ${leadQueue.length} leads.`);
    // ✅ Send to the canonical Leads view
    try {
      router.replace(LEADS_URL);
    } catch {
      // fallback if router isn't ready for any reason
      if (typeof window !== "undefined") window.location.replace(LEADS_URL);
    }
  };

  /** sockets **/
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sess = await fetchJson<{ user?: { email?: string } }>("/api/auth/session").catch(() => null as any);
        const email = sess?.user?.email ? String(sess.user.email).toLowerCase() : "";
        userEmailRef.current = email;

        const mod = await import("socket.io-client").catch(() => null as any);
        if (!mounted || !mod) return;
        const { io } = mod as any;

        const socket = io(undefined, {
          path: "/api/socket/",
          transports: ["websocket"],
          withCredentials: false,
        });
        socketRef.current = socket;

        socket.on("connect", () => {
          if (email) {
            socket.emit("join", email);
            socket.emit("room:join", email);
            socket.emit("user:join", email);
          }
        });

        socket.on("call:status", async (payload: any) => {
          try {
            if (isPausedRef.current || sessionEndedRef.current) return;

            const s = String(payload?.status || "").toLowerCase();
            lastCallStatusRef.current = s;

            const sid = activeCallSidRef.current;
            const payloadLeadId = payload?.leadId ? String(payload.leadId) : "";
            const activeLeadId = currentLeadId();
            const isManualPstnStatus =
              String(payload?.billingCategory || "").toLowerCase() === "manual_dial" &&
              String(payload?.legType || "").toLowerCase() === "pstn";
            const sameLead = Boolean(activeLeadId && payloadLeadId && activeLeadId === payloadLeadId);
            const callSidMismatch = Boolean(sid && payload?.callSid && sid !== payload.callSid);

            const leadNum = normalizeE164(
              (leadQueue[currentLeadIndex] && (leadQueue[currentLeadIndex] as any)?.phone) ||
              (leadQueue[currentLeadIndex] &&
                Object.entries(leadQueue[currentLeadIndex]).find(([k]) => k.toLowerCase().includes("phone"))?.[1]) ||
              "",
            );
            const eventOther = normalizeE164(payload?.otherNumber || "");
            const ownerNum = normalizeE164(payload?.ownerNumber || "");
            const fromNum = normalizeE164(fromNumber || "");
            if (leadNum && eventOther && leadNum !== eventOther) return;
            if (fromNum && ownerNum && fromNum !== ownerNum) return;
            if (callSidMismatch && !(isManualPstnStatus && (sameLead || eventOther || ownerNum))) return;

            if (s === "initiated") setStatus("Dial initiated…");

            if (s === "ringing") {
              setStatus("Ringing…");
              await applyRingbackDesired(true);
            }

            // ✅ Only treat ANSWERED as a real connection; ignore in-progress
            if (s === "answered") {
              setStatus("Connected");
              stopRingbackNow();
              clearWatchdog();
              hasConnectedRef.current = true;
              startConnectedTimer();
              callOutcomeRef.current = { status: "Connected", source: "socket-answered" };
            }

            if (s === "no-answer" || s === "busy" || s === "failed") {
              if (s === "no-answer" && tooEarly()) return;
              const label = s === "no-answer" ? "No Answer" : s === "busy" ? "Busy" : "Failed";
              await handleTerminalCall({ status: label, reason: `socket-${s}`, hangup: true });
            }

            // Completed/canceled => show Disconnected immediately.
            if (s === "completed" || s === "canceled") {
              await handleTerminalCall({
                status: s === "completed" ? "Completed" : "Ended",
                reason: `socket-${s}`,
                hangup: false,
              });
            }
          } catch {}
        });

        socket.on("message:new", (payload: any) => {
          try {
            const activeLeadId = currentLeadIdRef.current;
            const payloadLeadId = payload?.leadId ? String(payload.leadId) : "";
            if (!activeLeadId || !payloadLeadId || activeLeadId !== payloadLeadId) return;

            const dirRaw = String(payload?.direction || payload?.dir || payload?.type || "").toLowerCase();
            if (dirRaw !== "inbound") return;

            const text = String(payload?.text || payload?.body || "").trim();
            if (!text || isJunkHistoryText(text)) return;

            const next: SmsThreadMessage = {
              id: payload?._id ? String(payload._id) : undefined,
              dir: "inbound",
              text,
              date: String(payload?.date || payload?.createdAt || payload?.receivedAt || new Date().toISOString()),
            };

            setMessages((prev) => (prev.some((m) => sameSmsMessage(m, next)) ? prev : [...prev, next]));
          } catch {}
        });
      } catch {}
    })();

    return () => {
      mounted = false;
      try {
        socketRef.current?.off?.("call:status");
        socketRef.current?.off?.("message:new");
        socketRef.current?.disconnect?.();
      } catch {}
      stopRingbackNow();
      killAllTimers();
      leaveIfJoined("unmount");
      clearStatusPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeadIndex, leadQueue.length, fromNumber]);

  /** render **/

  // ✅ Build lead info rows like /lead/[id] (ordered + extras, hide empties, dedupe, include rawRow headers)
  const leadInfoRows = useMemo(() => {
    const l = lead || ({} as any);
    const flat = flattenDisplayFields(l);

    const mapNormToKeys: Record<string, string[]> = {};
    Object.keys(flat).forEach((k) => {
      const nk = normalizeKey(k);
      if (!mapNormToKeys[nk]) mapNormToKeys[nk] = [];
      mapNormToKeys[nk].push(k);
    });

    const getByAliases = (aliases: string[]) => {
      for (const a of aliases) {
        const nk = normalizeKey(a);
        const keys = mapNormToKeys[nk];
        if (!keys || !keys.length) continue;
        for (const realKey of keys) {
          const v = flat[realKey];
          if (isEmptyDisplay(v)) continue;
          if (isMeaninglessZero(realKey, v)) continue;
          return { key: realKey, value: v };
        }
      }
      return null;
    };

    const usedNorm = new Set<string>();
    const rows: Array<{ label: string; key: string; value: any }> = [];

    const pushField = (label: string, aliases: string[], transform?: (v: any) => any) => {
      const found = getByAliases(aliases);
      if (!found) return;
      const nk = normalizeKey(found.key);
      if (usedNorm.has(nk)) return;

      const raw = transform ? transform(found.value) : found.value;
      if (isEmptyDisplay(raw)) return;
      if (isMeaninglessZero(found.key, raw)) return;

      usedNorm.add(nk);
      rows.push({ label, key: found.key, value: raw });
    };

    // ---- Important fields (top) ----
    pushField("First Name", ["First Name", "firstName", "first_name", "firstname", "first name"]);
    pushField("Last Name", ["Last Name", "lastName", "last_name", "lastname", "last name"]);

    // If only a single Name field exists
    if (!rows.find((r) => r.label === "First Name") && !rows.find((r) => r.label === "Last Name")) {
      pushField("Name", ["Name", "name", "Full Name", "fullName"]);
    }

    pushField("Phone", ["Phone", "phone", "Phone Number", "phoneNumber", "Mobile", "Cell"], (v) => formatPhone(String(v || "")));
    pushField("Email", ["Email", "email", "Email Address"]);
    pushField("DOB", ["DOB", "Date Of Birth", "Birthday", "birthdate", "Birth Date", "Date of birth"]);
    pushField("Age", ["Age", "age"]);
    pushField("Street Address", ["Street Address", "street address", "Address", "address", "Address 1", "address1"]);
    pushField("City", ["City", "city"]);
    pushField("State", ["State", "state", "ST"]);
    pushField("Zip", ["Zip", "ZIP", "Zip code", "postal", "postalCode"]);

    pushField("Mortgage Amount", ["Mortgage Amount", "Mortgage Balance", "mortgage amount", "mortgage balance", "Mortgage", "mortgage"]);
    pushField("Mortgage Payment", ["Mortgage Payment", "mortgage payment"]);
    pushField("Coverage Amount", ["Coverage Amount", "coverageAmount", "coverage", "How Much Coverage Do You Need?"]);

    // ---- Extras (imported/custom), deduped + filtered ----
    const hardBlockNorm = new Set<string>([
      "_id","id","folderid","createdat","updatedat","__v","ownerid","userid","useremail",
      "assigneddrips","dripprogress","history","interactionhistory",
      "normalizedphone","phonelast10",
      "rawrow","calendareventid",
      // Internal scoring/AI flags — not useful to agents
      "scorebreakdown","aiconversationactive","scoreversion","scoreupdatedat",
      "sheetmeta","sourcetype","realtimeeligible",
      "aifirstcallattempteat","aifirstcallattemptdat","aifirstcalldueat","aifirstcallstatus",
      "donotcall","donotcallat","leadtype","reminderssent","isaiengaged",
      "aifirstcallattemptdat","aifirstcallattemptedat","aifirstcalltriggeredat",
      "aiprioritycategory","aipriorityscore","externalid","source","status",
    ]);

    const bannedTopNorm = new Set<string>();
    rows.forEach((r) => bannedTopNorm.add(normalizeKey(r.key)));

    const maybeFormatExtraValue = (value: any) => {
      if (typeof value !== "string") return value;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    };

    const filteredExtras = Object.entries(flat)
      .filter(([k, v]) => {
        const nk = normalizeKey(k);
        if (!k) return false;
        if (hardBlockNorm.has(nk)) return false;
        if (bannedTopNorm.has(nk)) return false;

        // hide common junk keys seen in the screenshot
        if (nk.includes("aidhistory")) return false;
        if (nk.includes("aicall")) return false;
        if (nk.includes("fallback")) return false;
        if (nk.includes("transcript")) return false;
        if (nk.includes("call")) {
          // avoid dumping internal call tracking blobs in left panel
          if (nk.includes("sid") || nk.includes("status") || nk.includes("duration")) return false;
        }

        if (isEmptyDisplay(v)) return false;
        if (isMeaninglessZero(k, v)) return false;

        // no objects/arrays dumped into left panel
        if (typeof v === "object") return false;

        return true;
      });

    const folderEntry = filteredExtras.find(([k]) => normalizeKey(k) === "folder");
    const folderNameEntry = filteredExtras.find(([k]) => normalizeKey(k) === "foldername");
    const shouldDropFolder =
      folderEntry &&
      folderNameEntry &&
      String(folderEntry[1] || "").trim() === String(folderNameEntry[1] || "").trim();

    const usedExtraNorm = new Set<string>();
    const extras = filteredExtras
      .filter(([k]) => {
        const nk = normalizeKey(k);
        if (shouldDropFolder && nk === "folder") return false;
        if (usedExtraNorm.has(nk)) return false;
        usedExtraNorm.add(nk);
        return true;
      })
      .map(([k, v]) => ({
        label: normalizeKeyLabel(k),
        key: k,
        value: maybeFormatExtraValue(v),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [...rows, ...extras];
  }, [lead]);

  // Derive best-effort First/Last Name from any common variants on the lead (for display only)
  const firstName =
    (lead as any)?.["First Name"] ??
    (lead as any)?.first_name ??
    (lead as any)?.firstname ??
    (lead as any)?.firstName ??
    "";
  const lastName =
    (lead as any)?.["Last Name"] ??
    (lead as any)?.last_name ??
    (lead as any)?.lastname ??
    (lead as any)?.lastName ??
    "";
  const leadDisplayName = [firstName, lastName].filter(Boolean).join(" ").trim() || "Unknown Lead";
  const phoneRow = leadInfoRows.find((r) => normalizeKey(r.key) === "phone" || normalizeKey(r.label) === "phone");
  const leadPhoneDisplay = phoneRow?.value ? String(phoneRow.value) : "";
  const extraLeadInfoRows = leadInfoRows.filter((r) => {
    const nk = String(r.key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const label = String(r.label || "").toLowerCase().trim();
    if (["firstname", "lastname", "phone"].includes(nk)) return false;
    if (label === "first name" || label === "last name" || label === "phone") return false;
    if (nk === "leadtype" || label === "lead type") return false;
    return true;
  });
  const statusLower = String(status || "").toLowerCase();
  const statusDotColor =
    statusLower.includes("connected")
      ? "text-emerald-400"
      : statusLower.includes("ring") || statusLower.includes("dial")
      ? "text-amber-300"
      : statusLower.includes("failed") ||
        statusLower.includes("busy") ||
        statusLower.includes("no answer") ||
        statusLower.includes("ended") ||
        statusLower.includes("completed") ||
        statusLower.includes("disconnected")
      ? "text-red-400"
      : "text-slate-400";

  const latestAiBullets = Array.isArray((latestAiOverview as any)?.aiOverview?.overviewBullets)
    ? (latestAiOverview as any).aiOverview.overviewBullets
        .map((x: any) => String(x || "").trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const redialLeadDisabled =
    !lead ||
    callActive ||
    sessionEndedRef.current;
  const canTextLead = !!lead && !(lead as any)?.quickDial;
  const showConnectedTimer =
    callActive &&
    connectedAtRef.current !== null &&
    (connectedDurationSec > 0 || hasConnectedRef.current);

  return (
    // ✅ UI ONLY: make the area to the right of Sidebar a constrained flex container (Safari-safe scroll)
    <div className="flex bg-[#0f172a] text:white h-screen min-h-0">
      <Sidebar collapsed />

      {/* Safari gesture banner: audio/WebRTC requires a user interaction to begin */}
      {tapToStart && (
        <div
          onClick={() => {
            try { ensureUnlocked(); } catch {}
            try { primeAudioContext(); } catch {}
            try { setTapToStart(false); } catch {}
            try { setReadyToCall(true); } catch {}
          }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-400 text-black px-4 py-2 rounded shadow cursor-pointer"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              try { ensureUnlocked(); } catch {}
              try { primeAudioContext(); } catch {}
              try { setTapToStart(false); } catch {}
              try { setReadyToCall(true); } catch {}
            }
          }}
        >
          Click anywhere to start dialing
        </div>
      )}

      {/* ✅ main content wrapper (full viewport height + allow children to shrink) */}
      <div className="flex flex-1 h-full min-h-0">
        {/* ✅ left column split — top scrolls, bottom pinned */}
        <div className="w-72 p-3 border-r border-gray-600 bg-[#1e293b] flex flex-col h-full min-h-0">
          {/* Top (scrollable) */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="min-w-0 flex items-center gap-2">
                <FaCircle className={`${statusDotColor} text-[9px] flex-none`} />
                <span className="truncate text-xs font-semibold text-slate-100">{status}</span>
              </div>
              {showConnectedTimer ? (
                <span className="text-xs text-green-300 tabular-nums">{formatDuration(connectedDurationSec)}</span>
              ) : null}
            </div>

            <p className="text-xs text-gray-400 mb-3">
              Lead {Math.min(currentLeadIndex + 1, Math.max(leadQueue.length, 1))} of {leadQueue.length || 1}
            </p>

            <div className="mb-4">
              <div className="text-lg font-bold leading-tight text-white break-words">{leadDisplayName}</div>
              <div className="mt-1 text-sm text-slate-300 break-words">{leadPhoneDisplay || "No phone"}</div>
            </div>

            {extraLeadInfoRows.length > 0 ? (
              <div className="mb-3">
                {extraLeadInfoRows.map((r) => {
                  const key = r.key;
                  const value = r.value;
                  const rawRowAny = (lead as any)?.rawRow;
                  const displayLabel =
                    rawRowAny && Object.prototype.hasOwnProperty.call(rawRowAny, key) ? String(key) : r.label;
                  let display = "";
                  if (typeof value === "string") display = looksLikePhoneKey(key) ? formatPhone(value) : value;
                  else if (typeof value === "number" || typeof value === "boolean") display = String(value);
                  if (!display || isJunkHistoryText(display)) return null;
                  return (
                    <div key={key}>
                      <p>
                        <strong>{displayLabel}:</strong> {display}
                      </p>
                      <hr className="border-gray-700 my-1" />
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Bottom (pinned) */}
          <div className="flex flex-col space-y-2 mt-4 flex-none">
            <button
              onClick={handleToggleMute}
              className="bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded flex items-center justify-center gap-2"
            >
              {muted ? <FaMicrophoneSlash className="text-amber-300" /> : <FaMicrophone className="text-slate-300" />}
              {muted ? "Unmute" : "Mute"}
            </button>

            <button
              onClick={handleHangUp}
              className={`px-3 py-2 rounded flex items-center justify-center gap-2 ${callActive ? "bg-slate-700 hover:bg-slate-600" : "bg-slate-800 hover:bg-slate-700 text-slate-300"}`}
            >
              <FaPhoneSlash className="text-red-400" />
              Hang Up
            </button>

            <button
              onClick={handleRedialLead}
              disabled={redialLeadDisabled}
              className={`px-3 py-2 rounded font-semibold transition-all flex items-center justify-center gap-2 border ${
                redialLeadDisabled
                  ? "bg-slate-800 border-slate-700 cursor-not-allowed opacity-60"
                  : callEnded
                  ? "bg-slate-700 hover:bg-slate-600 border-emerald-300 ring-2 ring-emerald-300"
                  : "bg-slate-700 hover:bg-slate-600 border-slate-600"
                }`}
            >
              <FaRedo className={`text-emerald-300 ${callEnded && !redialLeadDisabled ? "animate-pulse" : ""}`} />
              {callEnded ? "Call Again" : "Redial"}
            </button>
          </div>
        </div>

        {/* ✅ right panel: top can scroll if needed; bottom controls pinned to bottom */}
        <div className="flex-1 p-6 bg-[#1e293b] flex flex-col h-full min-h-0">
          {/* Top content (scrollable container so it never pushes bottom controls off-screen) */}
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <div className="mb-4 flex items-center gap-2">
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveNote();
                  }
                }}
                className="flex-1 rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add a note..."
              />
              <button
                type="button"
                onClick={handleSaveNote}
                className="h-10 w-10 rounded bg-slate-700 hover:bg-slate-600 text-white inline-flex items-center justify-center"
                aria-label="Save note"
                title="Save note"
              >
                <FaStickyNote className="text-blue-300" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4 flex-1 min-h-0">
              <div className="border border-gray-600 rounded bg-gray-800 flex-1 min-h-0 flex flex-col">
                <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
                  <h3 className="text-lg font-bold">Messages</h3>
                  <span className="text-xs text-gray-400">{messages.length} total</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 flex flex-col">
                  {messages.length === 0 ? (
                    <p className="text-gray-400 text-sm">No messages yet.</p>
                  ) : (
                    messages.map((msg, idx) => {
                      const isSent = msg.dir === "outbound" || msg.dir === "ai";
                      return (
                        <div key={`${msg.id || msg.date}-${idx}`} className="flex flex-col gap-1">
                          <div className="w-full flex justify-center">
                            <span className="text-[11px] text-gray-300 bg-[#111827] border border-gray-700 rounded-full px-3 py-1">
                              {formatSmsThreadTime(msg.date)}
                            </span>
                          </div>
                          <div
                            className={`px-4 py-2 rounded-2xl text-sm max-w-[78%] w-fit whitespace-pre-wrap break-words shadow ${
                              isSent
                                ? "self-end ml-auto text-white bg-[#7c3aed]"
                                : "self-start text-white bg-[#334155]"
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-gray-700 p-3 bg-gray-900/40">
                  <textarea
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    className="w-full p-2 text-white rounded bg-gray-900 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="Type your message..."
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={handleSendSms}
                      disabled={!canTextLead || !smsText.trim() || sendingSms}
                      className={`px-4 py-2 rounded text-white inline-flex items-center gap-2 ${
                        !canTextLead || !smsText.trim() || sendingSms
                          ? "bg-slate-800 cursor-not-allowed opacity-70"
                          : "bg-slate-700 hover:bg-slate-600"
                      }`}
                    >
                      <FaPaperPlane className="text-emerald-300" />
                      {sendingSms ? "Sending..." : "Send Text"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="border border-gray-600 rounded bg-gray-800 flex-1 min-h-0 flex flex-col">
                <div className="px-3 py-2 border-b border-gray-700">
                  <h3 className="text-lg font-bold">Interaction History</h3>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  {latestAiBullets.length > 0 ? (
                    <div className="mb-3 rounded border border-slate-700 bg-slate-900/40">
                      <button
                        type="button"
                        onClick={() => setAiOverviewExpanded((v) => !v)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                      >
                        <span className="flex items-center gap-2">
                          <FaRobot className="text-blue-300" />
                          AI overview available
                        </span>
                        <FaChevronDown className={`text-slate-400 transition-transform ${aiOverviewExpanded ? "rotate-180" : ""}`} />
                      </button>
                      {aiOverviewExpanded ? (
                        <ul className="list-disc space-y-1 px-8 pb-3 text-sm text-gray-200">
                          {latestAiBullets.map((b: string, i: number) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {history.length === 0 ? (
                    <p className="text-gray-400">No interactions yet.</p>
                  ) : (
                    history
                      .filter((item) => {
                        if (item.kind !== "text") return true;
                        return !isJunkHistoryText(item.text);
                      })
                      .map((item, idx) =>
                        item.kind === "text" ? (
                          <p key={idx} className="border-b border-gray-700 py-1 whitespace-pre-wrap">{item.text}</p>
                        ) : (
                          <p key={idx} className="border-b border-gray-700 py-1">
                            <a href={item.href} target="_blank" rel="noreferrer" className="text-blue-400 underline">{item.text}</a>
                          </p>
                        )
                      )
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom content (pinned to bottom) */}
          <div className="flex flex-col items-center space-y-4 mt-auto pt-6 flex-none">
            <div className="flex justify-center flex-wrap gap-2">
              <button onClick={() => setShowSaleModal(true)} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Sold</button>
              <button onClick={() => handleDisposition("No Answer")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">No Answer</button>
              <button onClick={() => setShowBookModal(true)} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Booked Appointment</button>
              <button onClick={() => handleDisposition("Not Interested")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Not Interested</button>
              <button onClick={() => handleDisposition("Bad Number")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Bad Number</button>
            </div>

            <div className="flex gap-2 mt-2">
              <button onClick={togglePause} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded inline-flex items-center gap-2">
                {isPaused ? <FaPlay className="text-amber-300" /> : <FaPause className="text-amber-300" />}
                {isPaused ? "Resume Dial Session" : "Pause Dial Session"}
              </button>
              <button onClick={handleEndSession} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded inline-flex items-center gap-2">
                <FaSignOutAlt className="text-red-400" />
                End Dial Session
              </button>
            </div>
          </div>
        </div>
      </div>

      {lead && (
        <BookAppointmentModal
          isOpen={showBookModal}
          onClose={handleBookModalClose}
          lead={lead}
          onBooked={handleBookedAppointmentBooked}
        />
      )}

      {showSaleModal && lead && (
        <SaleModal
          leadId={String(lead.id || "")}
          defaultComp={defaultComp}
          onSave={async (result) => {
            setShowSaleModal(false);
            try {
              const saleRes = await fetch("/api/leads/record-sale", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadId: lead.id, ...result }),
              });
              if (!saleRes.ok) {
                const d = await saleRes.json().catch(() => ({}));
                toast.error((d as any)?.error || "Failed to record sale");
                return;
              }
              await handleDisposition("Sold");
            } catch (e: any) {
              toast.error(e?.message || "Failed to record sale");
            }
          }}
          onCancel={() => setShowSaleModal(false)}
        />
      )}
    </div>
  );
}
