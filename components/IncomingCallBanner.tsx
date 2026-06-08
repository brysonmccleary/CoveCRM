import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

type Payload = {
  callSid?: string;
  leadId?: string;
  leadName?: string; // already includes first + last on your server emit
  phone: string;     // E.164
};

type RingToneHandle = {
  stop: () => void;
};

function formatPhone(p?: string) {
  const d = (p || "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p || "";
}

export function generateRingTone(volume: number): RingToneHandle {
  if (typeof window === "undefined") return { stop: () => {} };

  const AudioContextCtor =
    window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return { stop: () => {} };

  const safeVolume = Math.max(0, Math.min(1, Number(volume) || 0));
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startTime = context.currentTime;
  let stopped = false;

  oscillator.frequency.value = 440;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0, startTime);

  for (let t = 0; t < 10; t += 1) {
    const cycleStart = startTime + t;
    gain.gain.setValueAtTime(safeVolume, cycleStart);
    gain.gain.setValueAtTime(safeVolume, cycleStart + 0.5);
    gain.gain.setValueAtTime(0, cycleStart + 0.5);
    gain.gain.setValueAtTime(0, cycleStart + 1);
  }

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(0, context.currentTime);
      } catch {}
      try {
        oscillator.stop();
      } catch {}
      try {
        context.close();
      } catch {}
    },
  };
}

export default function IncomingCallBanner({ volume = 1 }: { volume?: number }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const ringRef = useRef<RingToneHandle | null>(null);

  const stopRing = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
  }, []);

  const showIncoming = useCallback(
    (data: any) => {
      const next: Payload = {
        callSid: data?.callSid || undefined,
        leadId: data?.leadId || undefined,
        leadName: data?.leadName || undefined,
        phone: data?.phone || data?.from || "",
      };
      setPayload(next);
      setVisible(true);

      stopRing();
      const dialSessionVolume =
        typeof window !== "undefined" && (window as any).__aiDialSessionActive === true
          ? 0.15
          : volume;
      ringRef.current = generateRingTone(dialSessionVolume);

      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        stopRing();
        setVisible(false);
      }, 10_000);
    },
    [stopRing, volume],
  );

  useEffect(() => {
    let mounted = true;
    let attached = false;
    let tries = 0;
    const maxTries = 80; // ~20s at 250ms

    const onIncoming = (data: any) => showIncoming(data);
    const onBrowserIncoming = (event: Event) =>
      showIncoming((event as CustomEvent).detail || {});

    const attach = () => {
      if (!mounted || attached) return;
      const sock: any = (globalThis as any).__crm_socket__;
      if (!sock || !sock.on) return;
      sock.on?.("call:incoming", onIncoming);
      attached = true;
    };

    window.addEventListener("crm:incomingCall", onBrowserIncoming);

    const interval = setInterval(() => {
      tries++;
      attach();
      if (attached || tries >= maxTries) {
        clearInterval(interval);
      }
    }, 250);

    // try immediately too
    attach();

    return () => {
      mounted = false;
      clearInterval(interval);
      try {
        const sock: any = (globalThis as any).__crm_socket__;
        sock?.off?.("call:incoming", onIncoming);
      } catch {}
      window.removeEventListener("crm:incomingCall", onBrowserIncoming);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      stopRing();
    };
  }, [showIncoming, stopRing]);

  if (!visible || !payload) {
    return null;
  }

  const title = payload.leadName || "Incoming call";
  const subtitle = payload.leadName ? formatPhone(payload.phone) : (payload.phone ? formatPhone(payload.phone) : "");

  const onAnswer = async () => {
    let conf = "";
    stopRing();
    try {
      window.dispatchEvent(new CustomEvent("crm:incomingCall:answer", { detail: payload }));
    } catch {}
    try {
      const r = await fetch("/api/twilio/calls/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: payload.phone, callSid: payload.callSid }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.conferenceName) conf = j.conferenceName;
    } catch {}

    if (!conf) {
      // inbound-only safety: do NOT navigate into dial-session without a conference
      // (prevents outbound-like behavior when the inbound leg wasn't found)
      try { console.warn("Answer failed: missing conferenceName"); } catch {}
      return;
    }

    setVisible(false);
    const params = new URLSearchParams();
    params.set("inbound", "1");
    params.set("conference", conf);
    if (payload.leadId) params.set("leadId", payload.leadId);

    router.push(`/dial-session?${params.toString()}`);
  };

  const onDecline = async () => {
    stopRing();
    try {
      window.dispatchEvent(new CustomEvent("crm:incomingCall:decline", { detail: payload }));
    } catch {}
    try {
      await fetch("/api/twilio/calls/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: payload.phone, callSid: payload.callSid }),
      });
    } catch {}
    setVisible(false);
  };

  return (
    <>
      <div className="fixed top-4 inset-x-0 z-[5000] flex justify-center px-4" role="status" aria-live="polite">
        <div className="max-w-2xl w-full rounded-2xl shadow-xl bg-neutral-900/95 text-white border border-neutral-800 backdrop-blur p-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0 h-10 w-10 rounded-full bg-emerald-600/20 flex items-center justify-center">
              <span className="text-xl">📞</span>
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold leading-tight">{title}</div>
              {subtitle ? <div className="text-sm text-neutral-300">{subtitle}</div> : null}
            </div>
            <div className="flex gap-2">
              <button onClick={onDecline} className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm">
                Decline
              </button>
              <button onClick={onAnswer} className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm text-white">
                Answer
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
