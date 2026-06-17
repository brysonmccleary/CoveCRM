// lib/dial/useInlineLeadCall.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { playRingback, stopRingback, primeAudioContext, ensureUnlocked, armRingbackFromUserGesture, disarmRingbackUserGesture, isRingbackArmed } from "@/utils/ringAudio";
import { connectDirect, leaveConference, setMuted as sdkSetMuted, getMuted as sdkGetMuted } from "@/utils/voiceClient";

type StartResult = { to: string; from: string };

export function useInlineLeadCall() {
  const { data: session } = useSession();
  const userEmail = String(session?.user?.email || "").toLowerCase();

  const [status, setStatus] = useState<string>("Idle");
  const [callActive, setCallActive] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);

  const activeCallSidRef = useRef<string | null>(null);
  const activeConferenceRef = useRef<string | null>(null);
  const joinedRef = useRef<boolean>(false);

  const ringbackDesiredRef = useRef<boolean>(false);
  const ringbackIsOnRef = useRef<boolean>(false);

  const applyRingbackDesired = async (desired: boolean) => {
    ringbackDesiredRef.current = desired;
    if (desired) {
      if (!ringbackIsOnRef.current) {
        ringbackIsOnRef.current = true;
        try {
          await ensureUnlocked();
        } catch {}
        // Do NOT allow polling/focus/mount to start ringback unless the user explicitly initiated a call.
        if (!isRingbackArmed()) return;
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
    let did = false;

    const attemptUnlock = async () => {
      if (did) return;
      did = true;
      try { await primeAudioContext(); } catch {}
      try { await ensureUnlocked(); } catch {}
    };

    // Only unlock on FIRST user gesture (no autoplay attempts on mount)
    const onFirstGesture = () => { attemptUnlock(); };

    window.addEventListener("pointerdown", onFirstGesture, { once: true, passive: true } as any);
    window.addEventListener("keydown", onFirstGesture, { once: true } as any);

    return () => {
      try { window.removeEventListener("pointerdown", onFirstGesture as any); } catch {}
      try { window.removeEventListener("keydown", onFirstGesture as any); } catch {}
    };
  }, []);

  // Safety: if component using this hook unmounts (navigation), kill ringback immediately.
  useEffect(() => {
    return () => {
      try { stopRingback(); } catch {}
      try { disarmRingbackUserGesture(); } catch {}
    };
  }, []);

  const hangup = useCallback(async (why?: string) => {
    const sid = activeCallSidRef.current;
    activeCallSidRef.current = null;

    await applyRingbackDesired(false);
    try { disarmRingbackUserGesture(); } catch {}

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
      body: JSON.stringify({ leadId, fromNumber }),
    });

    if (!r.ok) {
      let msg = "Failed to start call";
      try {
        const j = await r.json();
        if (j?.message) msg = j.message;
      } catch {}
      throw new Error(msg);
    }

    const j = (await r.json()) as { success?: boolean; to?: string; from?: string };
    if (!j?.success || !j?.to || !j?.from) {
      throw new Error("Call start did not return to + from");
    }
    return { to: j.to, from: j.from };
  }, []);

  const startCall = useCallback(async (opts: { leadId: string; fromNumber: string }) => {
    const leadId = String(opts.leadId || "").trim();
    const fromNumber = String(opts.fromNumber || "").trim();
    try { armRingbackFromUserGesture(); } catch {}
    if (!leadId) return toast.error("Lead not loaded");
    if (!fromNumber) return toast.error("Select a number to call from");

    setMuted(false);
    setStatus("Dialing…");
    setCallActive(true);
    joinedRef.current = false;
    activeCallSidRef.current = null;
    activeConferenceRef.current = null;

    try {
      try { await ensureUnlocked(); } catch {}
      await applyRingbackDesired(true);

      // Server validates billing, quiet hours, caller ID ownership → returns { to, from }
      const { to, from } = await startOutboundCall(leadId, fromNumber);

      // Browser SDK places the call (2-leg: browser WebRTC + PSTN to lead)
      const callObj = await connectDirect(to, from, userEmail, leadId);
      const callSid = String((callObj as any)?.parameters?.CallSid || "");
      activeCallSidRef.current = callSid;
      joinedRef.current = true;

      const safeOn = (ev: string, fn: (...args: any[]) => void) => {
        try {
          if ((callObj as any)?.on) (callObj as any).on(ev, fn);
          else if ((callObj as any)?.addListener) (callObj as any).addListener(ev, fn);
        } catch {}
      };

      // answerOnBridge=true → SDK fires "ringing" while lead's phone rings
      safeOn("ringing", async () => { setStatus("Ringing…"); await applyRingbackDesired(true); });
      safeOn("accept", async () => { await applyRingbackDesired(false); try { disarmRingbackUserGesture(); } catch {} setStatus("Connected"); });
      safeOn("disconnect", () => { hangup("twilio-disconnect"); });
      safeOn("disconnected", () => { hangup("twilio-disconnected"); });
      safeOn("hangup", () => { hangup("twilio-hangup"); });
      safeOn("cancel", async () => { await applyRingbackDesired(false); });
      safeOn("reject", async () => { await applyRingbackDesired(false); });
      safeOn("error", async () => { await applyRingbackDesired(false); });
    } catch (e: any) {
      await applyRingbackDesired(false);
      try { disarmRingbackUserGesture(); } catch {}
      try { await leaveConference(); } catch {}
      setCallActive(false);
      setStatus("Failed");
      toast.error(e?.message || "Call failed");
    }
  }, [hangup, startOutboundCall, userEmail]);

  return {
    status,
    callActive,
    muted,
    startCall,
    hangup,
    toggleMute,
  };
}
