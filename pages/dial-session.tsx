// pages/dial-session.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "@/components/Sidebar";
import BookAppointmentModal from "@/components/BookAppointmentModal";
import { isCallAllowed, isCallAllowedForLead, localTimeString } from "@/utils/checkCallTime";
import { playRingback, stopRingback, primeAudioContext, ensureUnlocked } from "@/utils/ringAudio";
import toast from "react-hot-toast";
import { joinConference, leaveConference, setMuted as sdkSetMuted, getMuted as sdkGetMuted } from "@/utils/voiceClient";

interface Lead { id: string; [key: string]: any; }
type Json = Record<string, any>;

const DIAL_DELAY_MS = 2000;
const EARLY_STATUS_MS = 12000;

type HistoryRow =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string; download?: boolean };

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
  const tooEarly = () => !callStartAtRef.current || Date.now() - callStartAtRef.current < EARLY_STATUS_MS;

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
    callWatchdogRef.current = setTimeout(() => {
      if (advanceScheduledRef.current || sessionEndedRef.current) return;
      setStatus("No answer (timeout)");
      stopRingback();
      hangupActiveCall("watchdog-timeout");
      leaveIfJoined("watchdog-timeout");
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
      // Prime AudioContext and arm one-time unlock listeners immediately.
      primeAudioContext();
      ensureUnlocked();
    } catch {}
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
    };
    loadNumbers();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        for (const ev of (j?.events || [])) {
          const when = new Date((ev as any).date).toLocaleString();
          if ((ev as any).type === "note") {
            rows.push({ kind: "text", text: `📝 Note • ${when} — ${(ev as any).text}` });
          } else if ((ev as any).type === "sms") {
            const sms = ev as any;
            rows.push({ kind: "text", text: `💬 ${sms.dir.toUpperCase()} • ${when} — ${sms.text}` });
          } else if ((ev as any).type === "status") {
            rows.push({ kind: "text", text: `📌 Status • ${when} — ${(ev as any).to || "-"}` });
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
    if (!numbersLoaded) { setStatus("Loading your numbers…"); return; }
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
      const { allowed, zone } = isCallAllowedForLead(leadQueue[currentLeadIndex] || {});
      if (!allowed) {
        const timeStr = localTimeString(zone);
        setHistory((prev) => [
          { kind: "text", text: `⏭️ Skipped (quiet hours) • ${timeStr}` },
          ...prev,
        ]);
        serverPersist(currentLeadIndex);
        setCurrentLeadIndex((i) => i + 1);
        return;
      }

      placingCallRef.current = true;
      setReadyToCall(false);
      callLead(leadQueue[currentLeadIndex]).finally(() => { placingCallRef.current = false; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numbersLoaded, leadQueue, readyToCall, isPaused, sessionStarted, currentLeadIndex, callActive]);

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

  const beginStatusPolling = (sid: string) => {
    clearStatusPoll();
    statusPollRef.current = setInterval(async () => {
      try {
        const j = await fetchJson<{ status: string }>(`/api/twilio/calls/status?sid=${encodeURIComponent(sid)}`);
        const s = (j?.status || "").toLowerCase();

        if (s === "in-progress" || s === "answered") {
          setStatus("Connected");
          stopRingback();
          clearWatchdog();
          clearStatusPoll();
        }

        if (s === "busy" || s === "failed" || s === "no-answer") {
          if (s === "no-answer" && tooEarly()) return;
          stopRingback(); clearWatchdog(); clearStatusPoll();
          await hangupActiveCall(`status-${s}`); await leaveIfJoined(`status-${s}`);
          if (!advanceScheduledRef.current && !sessionEndedRef.current) {
            advanceScheduledRef.current = true;
            setStatus(s === "no-answer" ? "No answer" : s.charAt(0).toUpperCase() + s.slice(1));
            scheduleAdvance();
          }
        }

        // Treat canceled/completed as a definitive disconnect
        if (s === "canceled" || s === "completed") {
          clearStatusPoll();
          await markDisconnected(`status-${s}`);
        }
      } catch {
        // ignore transient errors
      }
    }, 1000);
  };

  // Centralized "Disconnected now" path
  const markDisconnected = async (reason: string) => {
    stopRingback();
    killAllTimers();
    await hangupActiveCall(reason);
    await leaveIfJoined(reason);
    setCallActive(false);
    setStatus("Disconnected");
    if (!advanceScheduledRef.current && !sessionEndedRef.current) {
      advanceScheduledRef.current = true;
      scheduleAdvance();
    }
  };

  const callLead = async (leadToCall: Lead) => {
    if (sessionEndedRef.current) return;
    if (!leadToCall?.id) { setStatus("Missing lead id"); return; }

    // Global soft gate (optional—kept from your earlier logic)
    if (typeof isCallAllowed === "function" && !isCallAllowed()) {
      toast.error("Calls are restricted at this time.");
      setStatus("Blocked by schedule");
      return;
    }

    // Strong per-lead quiet-hours gate (already checked in driver; keep here defensively)
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
      setStatus("Dialing…");
      setCallActive(true);

      // Ensure audio is gesture-unlocked; then start ringback.
      ensureUnlocked();
      playRingback();

      callStartAtRef.current = Date.now();

      const { callSid, conferenceName } = await startOutboundCall(leadToCall.id);

      if (sessionEndedRef.current) {
        activeCallSidRef.current = callSid;
        await hangupActiveCall("ended-during-start");
        await leaveIfJoined("ended-during-start");
        setCallActive(false);
        stopRingback();
        return;
      }

      activeCallSidRef.current = callSid;
      activeConferenceRef.current = conferenceName;

      if (!joinedRef.current && activeConferenceRef.current) {
        try {
          joinedRef.current = true;

          // Capture the returned call object and cut ringback on instant connect
          const callObj = await joinConference(activeConferenceRef.current);

          const safeOn = (ev: string, fn: (...args: any[]) => void) => {
            try {
              if ((callObj as any)?.on) (callObj as any).on(ev, fn);
              else if ((callObj as any)?.addListener) (callObj as any).addListener(ev, fn);
            } catch {}
          };

          const connectedNow = () => {
            hasConnectedRef.current = true;
            stopRingback();
            clearWatchdog();
            setStatus("Connected");
          };

          // Twilio SDK variants
          safeOn("accept", connectedNow);
          safeOn("connect", connectedNow);
          safeOn("connected", connectedNow);

          // Disconnected events
          safeOn("disconnect", () => { markDisconnected("twilio-disconnect"); });
          safeOn("disconnected", () => { markDisconnected("twilio-disconnected"); });
          safeOn("hangup", () => { markDisconnected("twilio-hangup"); });

          // Defensive cuts for non-success paths
          safeOn("cancel", () => stopRingback());
          safeOn("reject", () => stopRingback());
          safeOn("error", () => stopRingback());
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
      stopRingback();
      killAllTimers();
      await leaveIfJoined("start-failed");
      setCallActive(false);
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
      } catch {}
    }
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
    } catch {}
  };

  const handleDisposition = async (label: "Sold" | "No Answer" | "Booked Appointment" | "Not Interested" | "No Show") => {
    if (!lead?.id) {
      toast.error("No active lead to disposition");
      return;
    }
    if (dispositionBusyRef.current) return;
    dispositionBusyRef.current = true;

    try {
      setStatus(`Saving disposition: ${label}…`);
      stopRingback();
      killAllTimers();

      await hangupActiveCall(`disposition-${label.replace(/\s+/g, "-").toLowerCase()}`);
      await leaveIfJoined(`disposition-${label.replace(/\s+/g, "-").toLowerCase()}`);
      setCallActive(false);

      // Move to folder via server API (also updates status for known labels)
      const res = await fetch("/api/disposition-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, newFolderName: label }),
      });

      if (!res.ok) {
        // fall back to lightweight history write so user still sees action
        await persistDisposition(lead.id, label);
        const msg = (await res.json().catch(() => ({} as any)))?.message || "Server refused disposition";
        console.warn("disposition-lead failed; wrote local history only:", msg);
        setHistory((prev) => [{ kind: "text", text: `🏷️ Disposition (local): ${label}` }, ...prev]);
        toast.error(msg);
      } else {
        setHistory((prev) => [{ kind: "text", text: `🏷️ Disposition: ${label}` }, ...prev]);
        toast.success(`Saved: ${label}`);
      }

      if (label === "Booked Appointment") setShowBookModal(true);

      if (!sessionEndedRef.current) scheduleNextLead(); // advance to next lead
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save disposition");
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
    stopRingback();
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
      stopRingback();
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
    stopRingback();
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
    window.location.href = "/leads";
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
          path: "/api/socket",
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
            if (s === "ringing") setStatus("Ringing…");

            if (s === "answered" || s === "in-progress") {
              setStatus("Connected");
              stopRingback();
              clearWatchdog();
              hasConnectedRef.current = true;
            }

            if (s === "no-answer" || s === "busy" || s === "failed") {
              if (s === "no-answer" && tooEarly()) return;
              stopRingback(); clearWatchdog();
              await hangupActiveCall(`status-${s}`); await leaveIfJoined(`status-${s}`);
              if (!advanceScheduledRef.current && !sessionEndedRef.current) {
                advanceScheduledRef.current = true;
                setStatus(s === "no-answer" ? "No answer" : s === "busy" ? "Busy" : "Failed");
                scheduleAdvance();
              }
            }

            // Completed/canceled => show Disconnected immediately.
            if (s === "completed" || s === "canceled") {
              await markDisconnected(`socket-${s}`);
            }
          } catch {}
        });
      } catch {}
    })();

    return () => {
      mounted = false;
      try { socketRef.current?.off?.("call:status"); socketRef.current?.disconnect?.(); } catch {}
      stopRingback();
      killAllTimers();
      leaveIfJoined("unmount");
      clearStatusPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeadIndex, leadQueue.length, fromNumber]);

  /** render **/
  return (
    <div className="flex bg-[#0f172a] text-white min-h-screen flex-col">
      <div className="bg-[#1e293b] p-4 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-xl font-bold">Dial Session</h1>
      </div>

      <div className="flex flex-1">
        <Sidebar />

        <div className="w-1/4 p-4 border-r border-gray-600 bg-[#1e293b] overflow-y-auto">
          <p className="text-green-400">Calling from: {fromNumber ? formatPhone(fromNumber) : "Resolving…"}</p>
          <p className="text-yellow-500 mb-2">Status: {status}</p>

          <p className="text-sm text-gray-400 mb-2">
            Lead {Math.min(currentLeadIndex + 1, Math.max(leadQueue.length, 1))} of {leadQueue.length || 1}
          </p>

          {lead &&
            Object.entries(lead).map(([key, value]) => {
              if (["_id", "id", "Notes", "First Name", "Last Name", "folderId", "createdAt", "ownerId", "userEmail"].includes(key)) return null;
              const showVal =
                typeof value === "string" && key.toLowerCase().includes("phone") ? formatPhone(value) : String(value ?? "-");
              return (
                <div key={key}>
                  <p><strong>{key.replace(/_/g, " ")}:</strong> {showVal}</p>
                  <hr className="border-gray-700 my-1" />
                </div>
              );
            })}

          <div className="flex flex-col space-y-2 mt-4">
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
                history.map((item, idx) =>
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
              {/* NEW */}
              <button onClick={() => handleDisposition("No Show")} className="bg-gray-600 hover:bg-gray-700 px-3 py-2 rounded">No Show</button>
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
