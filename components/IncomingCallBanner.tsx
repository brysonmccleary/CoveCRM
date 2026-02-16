import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";

type Payload = {
  callSid?: string;
  leadId?: string;
  leadName?: string; // already includes first + last on your server emit
  phone: string;     // E.164
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

  useEffect(() => {
    let mounted = true;
    let attached = false;
    let tries = 0;
    const maxTries = 80; // ~20s at 250ms

    const onIncoming = (data: any) => {
      const next: Payload = {
        callSid: data?.callSid || undefined,
        leadId: data?.leadId || undefined,
        leadName: data?.leadName || undefined,
        phone: data?.phone || "",
      };
      setPayload(next);
      setVisible(true);

      try { chimeRef.current?.play().catch(() => {}); } catch {}

      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 10_000);
    };

    const attach = () => {
      if (!mounted || attached) return;
      const sock: any = (globalThis as any).__crm_socket__;
      if (!sock || !sock.on) return;
      sock.on?.("call:incoming", onIncoming);
      attached = true;
    };

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
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible || !payload) {
    return <audio ref={chimeRef} src="/incoming-soft.mp3" preload="auto" />;
  }

  const title = payload.leadName || "Incoming call";
  const subtitle = payload.leadName ? formatPhone(payload.phone) : (payload.phone ? formatPhone(payload.phone) : "");

  const onAnswer = async () => {
    let conf = "";
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
      <audio ref={chimeRef} src="/incoming-soft.mp3" preload="auto" />
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
