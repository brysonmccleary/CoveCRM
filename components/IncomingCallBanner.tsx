// components/IncomingCallBanner.tsx
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

type Payload = {
  leadId?: string;
  leadName?: string;
  phone: string;           // E.164
  // (callSid is not in the socket payload; decline endpoint resolves it server-side)
};

function formatPhone(p?: string) {
  const d = (p || "").replace(/\D+/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p || "";
}

export default function IncomingCallBanner() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<Payload | null>(null);
  const hideTimer = useRef<NodeJS.Timeout | null>(null);
  const chimeRef = useRef<HTMLAudioElement>(null);

  // Attach socket listener once
  useEffect(() => {
    // the socket singleton created in your app: window.__crm_socket__
    const sock: any = (globalThis as any).__crm_socket__;
    if (!sock) return;

    const onIncoming = (data: any) => {
      const next: Payload = {
        leadId: data?.leadId || undefined,
        leadName: data?.leadName || undefined,
        phone: data?.phone || "",
      };
      setPayload(next);
      setVisible(true);

      // play subtle audio if available (place a soft mp3 at /sounds/incoming-soft.mp3)
      try {
        chimeRef.current?.play().catch(() => {});
      } catch {}

      // auto-hide after 10s if no action (does not alter any Twilio flow)
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 10_000);
    };

    // Render service broadcasts "call:incoming" to the user channel
    sock.on?.("call:incoming", onIncoming);

    return () => {
      sock.off?.("call:incoming", onIncoming);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible || !payload) return (
    <>
      {/* preload audio quietly to avoid delay on first play */}
      <audio ref={chimeRef} src="/sounds/incoming-soft.mp3" preload="auto" />
    </>
  );

  const title = payload.leadName || "Incoming call";
  const subtitle = payload.leadName ? formatPhone(payload.phone) : (payload.phone ? formatPhone(payload.phone) : "");

  const onAnswer = async () => {
    // Per your rule: do not change dialer logic — just route to the existing dial session
    // If there is no leadId yet, route to /leads and let user search by phone.
    setVisible(false);
    if (payload.leadId) {
      router.push(`/dial-session?leadId=${encodeURIComponent(payload.leadId)}`);
    } else {
      router.push(`/leads?search=${encodeURIComponent(payload.phone)}`);
    }
  };

  const onDecline = async () => {
    try {
      await fetch("/api/twilio/calls/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: payload.phone }),
      });
    } catch {}
    setVisible(false);
  };

  return (
    <>
      <audio ref={chimeRef} src="/sounds/incoming-soft.mp3" preload="auto" />
      <div
        className="fixed top-4 inset-x-0 z-[5000] flex justify-center px-4"
        role="status"
        aria-live="polite"
      >
        <div className="max-w-2xl w-full rounded-2xl shadow-xl bg-neutral-900/95 text-white border border-neutral-800 backdrop-blur p-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0 h-10 w-10 rounded-full bg-emerald-600/20 flex items-center justify-center">
              {/* phone icon (emoji to avoid extra deps) */}
              <span className="text-xl">📞</span>
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold leading-tight">{title}</div>
              {subtitle ? (
                <div className="text-sm text-neutral-300">{subtitle}</div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onDecline}
                className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm"
              >
                Decline
              </button>
              <button
                onClick={onAnswer}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm text-white"
              >
                Answer
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
