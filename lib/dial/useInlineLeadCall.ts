// lib/dial/useInlineLeadCall.ts
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { playRingback, stopRingback, primeAudioContext, ensureUnlocked } from "@/utils/ringAudio";
import { joinConference, leaveConference, setMuted as sdkSetMuted, getMuted as sdkGetMuted } from "@/utils/voiceClient";

type StartResult = { callSid: string; conferenceName: string };

const isTerminalStatus = (s: string) =>
  ["completed", "busy", "failed", "no-answer", "canceled"].includes(String(s || "").toLowerCase());

export function useInlineLeadCall() {
  const [status, setStatus] = useState<string>("Idle");
  const [callActive, setCallActive] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);

  const activeCallSidRef = useRef<string | null>(null);
  const activeConferenceRef = useRef<string | null>(null);
  const joinedRef = useRef<boolean>(false);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ringbackDesiredRef = useRef<boolean>(false);
  const ringbackIsOnRef = useRef<boolean>(false);

  const clearStatusPoll = () => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  };

  const applyRingbackDesired = async (desired: boolean) => {
    ringbackDesiredRef.current = desired;
    if (desired) {
      if (!ringbackIsOnRef.current) {
        ringbackIsOnRef.current = true;
        try {
          await ensureUnlocked();
        } catch {}
        try {
          playRingback();
        } catch {}
      }
    } else {
      if (ringbackIsOnRef.current) {
        ringbackIsOnRef.current = false;
        try {
          stopRingback();
        } catch {}
      }
    }
  };

  useEffect(() => {
    let raf: number | null = null;
    let t0: ReturnType<typeof setTimeout> | null = null;
    let t1: ReturnType<typeof setTimeout> | null = null;

    const attemptUnlock = async () => {
      try { await primeAudioContext(); } catch {}
      try { await ensureUnlocked(); } catch {}
    };

    attemptUnlock();
    t0 = setTimeout(() => { attemptUnlock(); }, 0);
    t1 = setTimeout(() => { attemptUnlock(); }, 250);
    raf = window.requestAnimationFrame(() => { attemptUnlock(); });

    const onFirstGesture = () => { attemptUnlock(); };
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

  const hangup = useCallback(async (why?: string) => {
    const sid = activeCallSidRef.current;
    activeCallSidRef.current = null;

    await applyRingbackDesired(false);
    clearStatusPoll();

    try {
      if (sid) {
        await fetch("/api/twilio/calls/hangup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callSid: sid }),
        });
      }
    } catch (e: any) {
      console.warn("Inline hangup failed:", e?.message || e);
    }

    try {
      await leaveConference();
    } catch (e: any) {
      console.warn("leaveConference failed:", e?.message || e);
    } finally {
      activeConferenceRef.current = null;
      joinedRef.current = false;
    }

    setCallActive(false);
    setStatus(why ? `Disconnected (${why})` : "Disconnected");
  }, []);

  const toggleMute = useCallback(async () => {
    try {
      const current = await sdkGetMuted();
      const next = !current;
      await sdkSetMuted(next);
      setMuted(next);
    } catch (e: any) {
      toast.error(e?.message || "Failed to toggle mute");
    }
  }, []);

  const startOutboundCall = useCallback(async (leadId: string, fromNumber: string): Promise<StartResult> => {
    const r = await fetch("/api/twilio/voice/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, fromNumber, dialKey: "" }),
    });

    if (!r.ok) {
      let msg = "Failed to start call";
      try {
        const j = await r.json();
        if (j?.message) msg = j.message;
      } catch {}
      throw new Error(msg);
    }

    const j = (await r.json()) as { success?: boolean; callSid?: string; conferenceName?: string };
    if (!j?.success || !j?.callSid || !j?.conferenceName) {
      throw new Error("Call start did not return callSid + conferenceName");
    }
    return { callSid: j.callSid, conferenceName: j.conferenceName };
  }, []);

  const beginStatusPolling = useCallback(async (sid: string) => {
    clearStatusPoll();

    const interpret = (raw: any) => String(raw || "").toLowerCase();

    statusPollRef.current = setInterval(async () => {
      try {
        const j = await fetch(`/api/twilio/calls/status?sid=${encodeURIComponent(sid)}`, { cache: "no-store" })
          .then((r) => r.json());

        const s = interpret(j?.status);
        // queued | ringing | in-progress | completed | busy | failed | no-answer | canceled

        if (s === "ringing") {
          setStatus("Ringing…");
          await applyRingbackDesired(true);
          return;
        }

        if (s === "queued" || s === "initiated") {
          return;
        }

        if (s === "in-progress") {
          await applyRingbackDesired(false);
          setStatus("Connected");
          return;
        }

        if (isTerminalStatus(s)) {
          await applyRingbackDesired(false);
          const label =
            s === "completed" ? "Completed" :
            s === "busy"      ? "Busy" :
            s === "no-answer" ? "No Answer" :
            s === "failed"    ? "Failed" : "Ended";
          setStatus(label);
          clearStatusPoll();
          return;
        }
      } catch {
        // best-effort; keep polling
      }
    }, 1000);
  }, []);

  const startCall = useCallback(async (opts: { leadId: string; fromNumber: string }) => {
    const leadId = String(opts.leadId || "").trim();
    const fromNumber = String(opts.fromNumber || "").trim();
    if (!leadId) return toast.error("Lead not loaded");
    if (!fromNumber) return toast.error("Select a number to call from");

    // Reset state
    setMuted(false);
    setStatus("Dialing…");
    setCallActive(true);
    joinedRef.current = false;
    activeCallSidRef.current = null;
    activeConferenceRef.current = null;

    try {
      // Ensure audio unlock and start MP3 ringback (matches dial-session philosophy)
      try { await ensureUnlocked(); } catch {}
      await applyRingbackDesired(true);

      const { callSid, conferenceName } = await startOutboundCall(leadId, fromNumber);

      activeCallSidRef.current = callSid;
      activeConferenceRef.current = conferenceName;

      // Pre-join conference for zero-lag bridge
      try {
        if (!joinedRef.current && activeConferenceRef.current) {
          joinedRef.current = true;
          const callObj = await joinConference(activeConferenceRef.current);

          const safeOn = (ev: string, fn: (...args: any[]) => void) => {
            try {
              if ((callObj as any)?.on) (callObj as any).on(ev, fn);
              else if ((callObj as any)?.addListener) (callObj as any).addListener(ev, fn);
            } catch {}
          };

          safeOn("disconnect", () => { hangup("twilio-disconnect"); });
          safeOn("disconnected", () => { hangup("twilio-disconnected"); });
          safeOn("hangup", () => { hangup("twilio-hangup"); });
          safeOn("cancel", async () => { await applyRingbackDesired(false); });
          safeOn("reject", async () => { await applyRingbackDesired(false); });
          safeOn("error", async () => { await applyRingbackDesired(false); });
        }
      } catch (e: any) {
        console.warn("Inline: failed to pre-join conference:", e?.message || e);
      }

      await beginStatusPolling(callSid);
    } catch (e: any) {
      await applyRingbackDesired(false);
      try { await leaveConference(); } catch {}
      setCallActive(false);
      setStatus("Failed");
      toast.error(e?.message || "Call failed");
    }
  }, [beginStatusPolling, hangup, startOutboundCall]);

  return {
    status,
    callActive,
    muted,
    startCall,
    hangup,
    toggleMute,
  };
}
