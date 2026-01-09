// pages/dial-session.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import BookAppointmentModal from "@/components/BookAppointmentModal";
import { isCallAllowedForLead, localTimeString } from "@/utils/checkCallTime";
import { playRingback, stopRingback, primeAudioContext, ensureUnlocked } from "@/utils/ringAudio";
import toast from "react-hot-toast";
import { joinConference, leaveConference, setMuted as sdkSetMuted, getMuted as sdkGetMuted } from "@/utils/voiceClient";

interface Lead { id: string; [key: string]: any; }
type Json = Record<string, any>;

const DIAL_DELAY_MS = 2000;
const EARLY_STATUS_MS = 12000;
const LEADS_URL = "/dashboard?tab=leads"; // ✅ canonical destination

type HistoryRow =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; download?: boolean };

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

/** --------------------------------------------------------------- **/

export default function DialSession() {
  const router = useRouter();
  const {
    leads: leadIdsParam,
    fromNumber: fromNumberParam,
    leadId: singleLeadIdParam,
    startIndex,
    progressKey,
    serverProgressKey,
  } = router.query as {
    leads?: string;
    fromNumber?: string;
    leadId?: string;
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
  const [muted, setMuted] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionStartedCount, setSessionStartedCount] = useState(0);

  // UI
  const [showBookModal, setShowBookModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);

  // Numbers (display only; server resolves authoritative values)
  const [fromNumber, setFromNumber] = useState<string>("");
  const [agentPhone, setAgentPhone] = useState<string>("");

  // guard to avoid auto-dial races
  const [numbersLoaded, setNumbersLoaded] = useState(false);

  // sockets + watchdogs + guards
  const socketRef = useRef<any>(null);
  const userEmailRef = useRef<string>("");
  const callWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextLeadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const advanceScheduledRef = useRef<boolean>(false);
  const sessionEndedRef = useRef<boolean>(false);
  const activeCallSidRef = useRef<string | null>(null);
  const activeConferenceRef = useRef<string | null>(null);
  const placingCallRef = useRef<boolean>(false);
  const joinedRef = useRef<boolean>(false);

  const dispositionBusyRef = useRef<boolean>(false);

  const callStartAtRef = useRef<number>(0);
  const hasConnectedRef = useRef<boolean>(false);

  // NEW: call outcome + logging guard
  const callOutcomeRef = useRef<{ status: string; source?: string } | null>(null);
  const callLoggedRef = useRef<boolean>(false);

  const tooEarly = () => !callStartAtRef.current || Date.now() - callStartAtRef.current < EARLY_STATUS_MS;

  /** ✅ Ringback state machine (ONLY controls play/stop; does not touch conference/streaming) **/
  const ringbackDesiredRef = useRef<boolean>(false);
  const ringbackIsOnRef = useRef<boolean>(false);
  const lastCallStatusRef = useRef<string>("");

  const isTerminalStatus = (s: string) =>
    ["completed", "busy", "failed", "no-answer", "canceled"].includes(String(s || "").toLowerCase());

  const applyRingbackDesired = async (desired: boolean) => {
    ringbackDesiredRef.current = desired;

    if (desired) {
      if (!ringbackIsOnRef.current) {
        ringbackIsOnRef.current = true;
        try { await ensureUnlocked(); } catch {}
        try { playRingback(); } catch {}
      }
    } else {
      if (ringbackIsOnRef.current) {
        ringbackIsOnRef.current = false;
        try { stopRingback(); } catch {}
      }
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
  const killAllTimers = () => { clearWatchdog(); clearAdvanceTimers(); clearStatusPoll(); };

  // NEW: central call logging helper (per lead, per call)
  const logCallOutcome = async (opts?: { statusOverride?: string; reason?: string }) => {
    if (callLoggedRef.current) return;

    const current = leadQueue[currentLeadIndex] ?? lead;
    const leadId = (current as any)?.id;
    if (!leadId) return;

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

  const scheduleWatchdog = () => {
    clearWatchdog();
    callWatchdogRef.current = setTimeout(async () => {
      if (advanceScheduledRef.current || sessionEndedRef.current) return;
      setStatus("No answer (timeout)");
      setRingbackDesired(false);
      stopRingback();
      // mark no-answer outcome for logging
      callOutcomeRef.current = { status: "No Answer", source: "watchdog-timeout" };
      await hangupActiveCall("watchdog-timeout");
      await leaveIfJoined("watchdog-timeout");
      await logCallOutcome({ statusOverride: "No Answer", reason: "watchdog-timeout" });
      advanceScheduledRef.current = true;
      scheduleAdvance();
    }, 27000);
  };
  const scheduleAdvance = () => {
    if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
    advanceTimeoutRef.current = setTimeout(() => { if (!sessionEndedRef.current) disconnectAndNext(); }, DIAL_DELAY_MS);
  };
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
    try {
      primeAudioContext();
      ensureUnlocked();
    } catch {}
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
        if (!cancelled) {
          setFromNumber(fromNumberParam);
          localStorage.setItem("selectedDialNumber", fromNumberParam);
        }
      } else {
        const saved = localStorage.getItem("selectedDialNumber");
        if (saved) {
          if (!cancelled) setFromNumber(saved);
        } else {
          try {
            const list = await fetchJson<Json>("/api/twilio/list-numbers").catch(async () => {
              return await fetchJson<Json>("/api/getNumbers");
            });
            if (!cancelled) {
              const first = pickFirstVoiceNumber(list);
              if (first) {
                setFromNumber(first);
                localStorage.setItem("selectedDialNumber", first);
              }
            }
          } catch {}
        }
      }

      try {
        const profile = await fetchJson<Json>("/api/settings/profile");
        const extracted = extractAgentPhone(profile);
        if (!cancelled && extracted) setAgentPhone(extracted);
      } catch {}

      if (!cancelled) setNumbersLoaded(true);

      // ✅ ADDITIVE: override display with Twilio’s authoritative "from" number for this user
      try {
        const j = await fetchJson<{ from: string | null }>("/api/twilio/current-from");
        if (!cancelled && j?.from) {
          setFromNumber(j.from);
          localStorage.setItem("selectedDialNumber", j.from);
        }
      } catch {}

    };
    loadNumbers();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-comments, react-hooks/exhaustive-deps
  }, [fromNumberParam]);

  // Load leads list + support startIndex/progressKey + SERVER resume
  useEffect(() => {
    const loadLeads = async () => {
      // single lead mode
      if (singleLeadIdParam) {
        try {
          const j = await fetchJson<Json>(`/api/get-lead?id=${singleLeadIdParam}`);
          if (j?.lead?._id) {
            const formatted = { id: j.lead._id, ...j.lead };
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
        const valid = (fetched.filter(Boolean) as Lead[]);

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
  }, [leadIdsParam, singleLeadIdParam, startIndex, progressKey, serverProgressKey]);

  // Persist local progress on index change
  useEffect(() => {
    if (typeof progressKey === "string" && leadQueue.length) {
      try { localStorage.setItem(progressKey, JSON.stringify({ index: currentLeadIndex })); } catch {}
    }
  }, [currentLeadIndex, progressKey, leadQueue.length]);

  // Clear + load history for each lead (per-lead only, newest-first)
  useEffect(() => {
    const loadHistory = async () => {
      if (!lead?.id) { setHistory([]); return; }
      setHistory([]);
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

        // 🔒 PINNED SAVED NOTES — only if it looks like a real human note (not fallback junk)
        const savedNotes = (lead as any)?.Notes;
        if (typeof savedNotes === "string" && savedNotes.trim() && !isJunkHistoryText(savedNotes.trim())) {
          rows.push({ kind: "text", text: `📌 Saved Notes (Pinned) — ${savedNotes.trim()}` });
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
            rows.push({ kind: "text", text: `💬 ${sms.dir.toUpperCase()} • ${when} — ${t}` });
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
            if (c.recordingUrl) {
              rows.push({ kind: "link", text: "▶️ Recording", href: c.recordingUrl, download: false });
            }
          }
        }
        setHistory(rows);
      } catch {
        setHistory([]);
      }
    };
    loadHistory();
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

      placingCallRef.current = true;
      setReadyToCall(false);
      callLead(leadQueue[currentLeadIndex]).finally(() => { placingCallRef.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboundMode, numbersLoaded, leadQueue, readyToCall, isPaused, sessionStarted, currentLeadIndex, callActive]);

  /** calling **/
  const startOutboundCall = async (leadId: string): Promise<{ callSid: string; conferenceName: string }> => {
    if (sessionEndedRef.current) throw new Error("Session ended");
    const r = await fetch("/api/twilio/voice/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });
    if (!r.ok) {
      let msg = `Failed to start call`;
      try { const j = await r.json(); if (j?.message) msg = j.message; } catch {}
      throw new Error(msg);
    }
    const j = (await r.json()) as { success?: boolean; callSid?: string; conferenceName?: string };
    if (!j?.success || !j?.callSid || !j?.conferenceName) throw new Error("Call start did not return callSid + conferenceName");
    return { callSid: j.callSid, conferenceName: j.conferenceName };
  };

  // --- REPLACED: tightened status polling (no early Connected; clean terminal handling)
  const beginStatusPolling = (sid: string) => {
    clearStatusPoll();

    const interpret = (raw: any) => String(raw || "").toLowerCase();

    statusPollRef.current = setInterval(async () => {
      try {
        const j = await fetch(`/api/twilio/calls/status?sid=${encodeURIComponent(sid)}`, { cache: "no-store" }).then(r => r.json());
        const s = interpret(j?.status);
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
          await applyRingbackDesired(false);
          clearWatchdog();
          hasConnectedRef.current = true;
          setStatus("Connected");
          return;
        }

        // terminal states: stop all audio/timers
        if (isTerminalStatus(s)) {
          await applyRingbackDesired(false);
          clearWatchdog();
          const label =
            s === "completed" ? "Completed" :
            s === "busy"      ? "Busy" :
            s === "no-answer" ? "No Answer" :
            s === "failed"    ? "Failed" : "Ended";

          // store outcome for logging; actual log happens on disconnect/end
          callOutcomeRef.current = { status: label, source: `poll-${s}` };

          setStatus(label);
          clearStatusPoll();
          return;
        }
      } catch {
        // network hiccup? keep polling a bit longer
      }
    }, 1000);
  };

  // Centralized "Disconnected now" path
  const markDisconnected = async (reason: string) => {
    await applyRingbackDesired(false);
    killAllTimers();
    await hangupActiveCall(reason);
    await leaveIfJoined(reason);
    setCallActive(false);
    await logCallOutcome({ reason });
    setStatus("Disconnected");
    if (!advanceScheduledRef.current && !sessionEndedRef.current) {
      advanceScheduledRef.current = true;
      scheduleAdvance();
    }
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

  const callLead = async (leadToCall: Lead) => {
    if (sessionEndedRef.current) return;
    if (!leadToCall?.id) { setStatus("Missing lead id"); return; }

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
      joinedRef.current = false;
      hasConnectedRef.current = false;
      callOutcomeRef.current = null;
      callLoggedRef.current = false;

      setStatus("Dialing…");
      setCallActive(true);

      // Ensure audio is gesture-unlocked; then start ringback.
      ensureUnlocked();
      await applyRingbackDesired(true);

      callStartAtRef.current = Date.now();

      const { callSid, conferenceName } = await startOutboundCall(leadToCall.id);

      if (sessionEndedRef.current) {
        activeCallSidRef.current = callSid;
        await hangupActiveCall("ended-during-start");
        await leaveIfJoined("ended-during-start");
        setCallActive(false);
        await applyRingbackDesired(false);
        return;
      }

      activeCallSidRef.current = callSid;
      activeConferenceRef.current = conferenceName;

      if (!joinedRef.current && activeConferenceRef.current) {
        try {
          joinedRef.current = true;

          // Capture the returned call object
          const callObj = await joinConference(activeConferenceRef.current);

          const safeOn = (ev: string, fn: (...args: any[]) => void) => {
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

          // Disconnected events
          safeOn("disconnect", () => { markDisconnected("twilio-disconnect"); });
          safeOn("disconnected", () => { markDisconnected("twilio-disconnected"); });
          safeOn("hangup", () => { markDisconnected("twilio-hangup"); });

          // Defensive cuts for non-success paths
          safeOn("cancel", async () => { await applyRingbackDesired(false); });
          safeOn("reject", async () => { await applyRingbackDesired(false); });
          safeOn("error", async () => { await applyRingbackDesired(false); });
        } catch (e) {
          console.warn("Failed to pre-join conference:", e);
        }
      }

      scheduleWatchdog();
      beginStatusPolling(callSid);

      setSessionStartedCount((n) => n + 1);

      // UI-only history line
      setHistory((prev) => [{ kind: "text", text: `📞 Call started (${new Date().toLocaleTimeString()})` }, ...prev]);
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Call failed");
      await applyRingbackDesired(false);
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

  const handleDisposition = async (label: "Sold" | "No Answer" | "Booked Appointment" | "Not Interested") => {
    if (!lead?.id) {
      toast.error("No active lead to disposition");
      return;
    }
    if (dispositionBusyRef.current) return;
    dispositionBusyRef.current = true;

    try {
      setStatus(`Saving disposition: ${label}…`);
      await applyRingbackDesired(false);
      killAllTimers();

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
      // (Left-side "Book Appointment" button still opens the modal.)
      // if (label === "Booked Appointment") setShowBookModal(true);

      if (!sessionEndedRef.current) scheduleNextLead(); // advance to next lead
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save note");
      if (!sessionEndedRef.current) scheduleNextLead(); // still advance on error
    } finally {
      dispositionBusyRef.current = false;
    }
  };

  /** flow controls **/
  const nextLead = () => {
    if (sessionEndedRef.current) return;
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
    applyRingbackDesired(false);
    killAllTimers();
    hangupActiveCall("advance-next");
    leaveIfJoined("advance-next");
    setCallActive(false);
    scheduleNextLead();
  };

  const handleHangUp = () => {
    // Agent hangup should also show Disconnected immediately.
    markDisconnected("agent-hangup");
  };

  const togglePause = () => {
    setIsPaused((p) => !p);
    if (!isPaused) {
      applyRingbackDesired(false);
      killAllTimers();
      hangupActiveCall("pause");
      leaveIfJoined("pause");
      setStatus("Paused");
    } else {
      // Ensure unlock so ringback starts instantly on resume
      ensureUnlocked();
      setReadyToCall(true);
      setStatus("Ready");
    }
  };

  const handleEndSession = () => {
    const ok = window.confirm(
      `Are you sure you want to end this dial session? You have called ${sessionStartedCount} of ${leadQueue.length} leads.`
    );
    if (!ok) return;

    sessionEndedRef.current = true;
    applyRingbackDesired(false);
    killAllTimers();
    placingCallRef.current = false;
    setReadyToCall(false);
    setCallActive(false);
    hangupActiveCall("end-session");
    leaveIfJoined("end-session");
    setIsPaused(false);
    setStatus("Session ended");

    // clear saved LOCAL progress if provided
    if (typeof progressKey === "string") {
      try { localStorage.removeItem(progressKey); } catch {}
    }
    // persist final index to server so Resume starts after it
    serverPersist(currentLeadIndex);

    showSessionSummary();
  };

  const showSessionSummary = () => {
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
            if (sessionEndedRef.current) return;

            const s = String(payload?.status || "").toLowerCase();
            lastCallStatusRef.current = s;

            const sid = activeCallSidRef.current;
            if (sid && payload?.callSid && sid !== payload.callSid) return;

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

            if (s === "initiated") setStatus("Dial initiated…");

            if (s === "ringing") {
              setStatus("Ringing…");
              await applyRingbackDesired(true);
            }

            // ✅ Only treat ANSWERED as a real connection; ignore in-progress
            if (s === "answered") {
              setStatus("Connected");
              await applyRingbackDesired(false);
              clearWatchdog();
              hasConnectedRef.current = true;
            }

            if (s === "no-answer" || s === "busy" || s === "failed") {
              if (s === "no-answer" && tooEarly()) return;
              await applyRingbackDesired(false);
              clearWatchdog();

              const label = s === "no-answer" ? "No Answer" : s === "busy" ? "Busy" : "Failed";
              callOutcomeRef.current = { status: label, source: `socket-${s}` };

              await hangupActiveCall(`status-${s}`);
              await leaveIfJoined(`status-${s}`);
              await logCallOutcome({ statusOverride: label, reason: `socket-${s}` });

              if (!advanceScheduledRef.current && !sessionEndedRef.current) {
                advanceScheduledRef.current = true;
                setStatus(label);
                scheduleAdvance();
              }
            }

            // Completed/canceled => show Disconnected immediately.
            if (s === "completed" || s === "canceled") {
              callOutcomeRef.current = {
                status: s === "completed" ? "Completed" : "Ended",
                source: `socket-${s}`,
              };
              await markDisconnected(`socket-${s}`);
            }
          } catch {}
        });
      } catch {}
    })();

    return () => {
      mounted = false;
      try { socketRef.current?.off?.("call:status"); socketRef.current?.disconnect?.(); } catch {}
      applyRingbackDesired(false);
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
      "rawrow",
    ]);

    const bannedTopNorm = new Set<string>();
    rows.forEach((r) => bannedTopNorm.add(normalizeKey(r.key)));

    const extras = Object.entries(flat)
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
      })
      .map(([k, v]) => ({
        label: normalizeKeyLabel(k),
        key: k,
        value: v,
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

  return (
    <div className="flex bg-[#0f172a] text:white min-h-screen flex-col">
      <div className="bg-[#1e293b] p-4 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-xl font-bold">Dial Session</h1>
      </div>

      <div className="flex flex-1">
        <Sidebar />

        {/* ✅ STEP 1: left column split — top scrolls, bottom pinned */}
        <div className="w-1/4 p-4 border-r border-gray-600 bg-[#1e293b] flex flex-col h-full min-h-0">
          {/* Top (scrollable) */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <p className="text-green-400">
              Calling from: {fromNumber ? formatPhone(fromNumber) : "Resolving…"}
            </p>
            <p className="text-yellow-500 mb-2">Status: {status}</p>

            <p className="text-sm text-gray-400 mb-2">
              Lead {Math.min(currentLeadIndex + 1, Math.max(leadQueue.length, 1))} of {leadQueue.length || 1}
            </p>

            {/* Top-name block with correct spacing */}
            {(firstName || lastName) && (
              <div className="mb-3">
                {firstName && (
                  <p>
                    <strong>First Name:</strong> {firstName}
                  </p>
                )}
                {lastName && (
                  <p>
                    <strong>Last Name:</strong> {lastName}
                  </p>
                )}
                <hr className="border-gray-700 my-2" />
              </div>
            )}

            {/* ✅ Ordered + extras (hide empties, no duplicates, include rawRow headers) */}
            {lead &&
              leadInfoRows.map((r) => {
                const key = r.key;
                const label = r.label;
                const value = r.value;

                let display: string = "";

                if (typeof value === "string") {
                  display = looksLikePhoneKey(key) ? formatPhone(value) : value;
                } else if (typeof value === "number" || typeof value === "boolean") {
                  display = String(value);
                } else {
                  return null;
                }

                if (!display || isJunkHistoryText(display)) return null;

                return (
                  <div key={key}>
                    <p>
                      <strong>{label}:</strong> {display}
                    </p>
                    <hr className="border-gray-700 my-1" />
                  </div>
                );
              })}
          </div>

          {/* Bottom (pinned) */}
          <div className="flex flex-col space-y-2 mt-4 flex-none">
            <button
              onClick={() => {
                const next = !sdkGetMuted();
                sdkSetMuted(next);
                setMuted(next);
              }}
              className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded"
            >
              {muted ? "Unmute" : "Mute"}
            </button>

            <button
              onClick={handleHangUp}
              className={`px-3 py-2 rounded ${callActive ? "bg-red-600 hover:bg-red-700" : "bg-gray-600 hover:bg-gray-700"}`}
            >
              Hang Up
            </button>

            <button onClick={() => setShowBookModal(true)} className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded">
              📅 Book Appointment
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 bg-[#1e293b] flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold mb-2">Notes</h3>
            <div className="border border-gray-500 rounded p-2 mb-2">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 text-white rounded bg-transparent border-none focus:outline-none"
                rows={3}
                placeholder="Type notes here..."
              />
            </div>
            <button onClick={handleSaveNote} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
              Save Note
            </button>

            <h3 className="text-lg font-bold mb-2 mt-4">Interaction History</h3>
            <div className="bg-gray-800 p-3 rounded max-h-60 overflow-y-auto">
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
                      <p key={idx} className="border-b border-gray-700 py-1">{item.text}</p>
                    ) : (
                      <p key={idx} className="border-b border-gray-700 py-1">
                        <a href={item.href} target="_blank" rel="noreferrer" className="text-blue-400 underline">{item.text}</a>
                      </p>
                    )
                  )
              )}
            </div>
          </div>

          <div className="flex flex-col items-center mt-8 space-y-4">
            <div className="flex justify-center flex-wrap gap-2">
              <button onClick={() => handleDisposition("Sold")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Sold</button>
              <button onClick={() => handleDisposition("No Answer")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">No Answer</button>
              <button onClick={() => handleDisposition("Booked Appointment")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Booked Appointment</button>
              <button onClick={() => handleDisposition("Not Interested")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">Not Interested</button>
            </div>

            <div className="flex gap-2 mt-2">
              <button onClick={togglePause} className="bg-yellow-400 hover:bg-yellow-500 text-black px-4 py-2 rounded">
                {isPaused ? "Resume Dial Session" : "Pause Dial Session"}
              </button>
              <button onClick={handleEndSession} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">
                End Dial Session
              </button>
            </div>
          </div>
        </div>
      </div>

      {lead && <BookAppointmentModal isOpen={showBookModal} onClose={() => setShowBookModal(false)} lead={lead} />}
    </div>
  );
}
