// components/telephony/SoftphoneProvider.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
// IMPORTANT: install the SDK once:  npm i @twilio/voice-sdk
import { Device } from "@twilio/voice-sdk";

type SoftphoneCtx = {
  ready: boolean;
  device?: Device;
  activeCall?: any;
  incomingCall?: any;
  /** true only while an inbound call accepted via answer() is the active call */
  inboundCallAccepted: boolean;
  startCall: (toE164: string, fromTwilio: string) => Promise<void>;
  hangup: () => void;
  answer: () => void;
  decline: () => void;
};

const Ctx = createContext<SoftphoneCtx | null>(null);

function normalizeE164(raw?: string) {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (raw.startsWith("+")) return raw.trim();
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.trim();
}

async function fetchToken(): Promise<{ token: string; identity: string }> {
  // include credentials so session cookies are sent in all browsers
  const r = await fetch("/api/twilio/voice/token", { credentials: "include" });
  if (!r.ok) throw new Error("Unable to obtain voice token");
  return r.json();
}

async function fetchLeadPreviewByNumber(num: string) {
  try {
    const r = await fetch(`/api/leads/by-phone/${encodeURIComponent(num)}`, {
      credentials: "include",
    });
    const j = await r.json();
    const first = j?.lead || null;
    if (!first) return null;
    const firstName = first.displayName || first["First Name"] || first.firstName || "";
    const lastName = first["Last Name"] || first.lastName || "";
    return {
      id: first._id,
      name: first.displayName || `${firstName || ""} ${lastName || ""}`.trim(),
      phone: first.Phone || first.phone || first.normalizedPhone || num,
      state: first.State || first.state || "",
      status: first.status || "",
    };
  } catch {
    return null;
  }
}

async function validateAndResolveCall(toE164: string, fromTwilio: string): Promise<{ to: string; from: string }> {
  const r = await fetch("/api/twilio/voice/call", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: toE164, fromNumber: fromTwilio }),
  });
  if (!r.ok) {
    let detail = "";
    try { detail = await r.text(); } catch {}
    throw new Error(`Outbound call failed (${r.status}): ${detail || r.statusText}`);
  }
  const j = await r.json();
  if (!j?.success || !j?.to || !j?.from) throw new Error("Outbound call validation failed");
  return { to: String(j.to), from: String(j.from) };
}


const NOOP_CTX: SoftphoneCtx = {
  ready: false,
  device: undefined,
  activeCall: undefined,
  incomingCall: undefined,
  inboundCallAccepted: false,
  startCall: async () => {},
  hangup: () => {},
  answer: () => {},
  decline: () => {},
};

export function useSoftphone(): SoftphoneCtx {
  // During SSR / static prerender the provider is not mounted; return a no-op stub
  // so pages that import this hook don't crash at build time.
  return useContext(Ctx) ?? NOOP_CTX;
}

type Props = {
  children: React.ReactNode;
};

export default function SoftphoneProvider({ children }: Props) {
  const deviceRef = useRef<Device | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [activeCall, setActiveCall] = useState<any | undefined>(undefined);
  const [incomingCall, setIncomingCall] = useState<any | undefined>(undefined);
  const [inboundCallAccepted, setInboundCallAccepted] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const identityRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleFallbackRefresh = useCallback((minutes = 50) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const dev = deviceRef.current;
        if (!dev) return;
        const { token: newToken } = await fetchToken();
        tokenRef.current = newToken;
        await (dev as any).updateToken?.(newToken);
        // re-arm
        scheduleFallbackRefresh(minutes);
        // eslint-disable-next-line no-empty
      } catch {}
    }, minutes * 60 * 1000);
  }, []);

  // Boot + register the Device once
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { token, identity } = await fetchToken();
        if (!mounted) return;
        tokenRef.current = token;
        identityRef.current = identity;

        // Create device
        const dev = new Device(token, {
          // Keep logs quiet in prod
          logLevel: process.env.NODE_ENV === "production" ? "error" : "warn",
          // Prefer Opus in modern browsers; fallback PCMU
          codecPreferences: ["opus", "pcmu"] as unknown as any,
          // Allow incoming events to reach this client even when a call is active
          allowIncomingWhileBusy: true,
        });
        deviceRef.current = dev;

        dev.on("registered", () => {
          setReady(true);
          scheduleFallbackRefresh(50); // ~50min safety refresh before 1h TTL
        });
        dev.on("unregistered", () => setReady(false));
        dev.on("error", async (e: any) => {
          const msg = String(e?.message || e);
          console.warn("[Twilio Device error]", msg);
          // If token expired/invalid, refresh immediately
          if (msg.includes("AccessToken") || msg.includes("expired") || (e && e.code === 31205)) {
            try {
              const { token: newToken } = await fetchToken();
              tokenRef.current = newToken;
              await (dev as any).updateToken?.(newToken);
              scheduleFallbackRefresh(50);
            } catch (err) {
              console.warn("Error-triggered Twilio token refresh failed:", err);
            }
          }
        });

        // Refresh token when expiring (SDK signal)
        dev.on("tokenWillExpire", async () => {
          try {
            const { token: newToken } = await fetchToken();
            tokenRef.current = newToken;
            await (dev as any).updateToken?.(newToken);
            scheduleFallbackRefresh(50);
          } catch (e) {
            console.warn("Failed refreshing Twilio token", e);
          }
        });

        // Incoming call handling
        dev.on("incoming", async (call: any) => {
          setIncomingCall(call);
          const from =
            call?.parameters?.From ||
            call?.callerInfo?.from ||
            call?.customParameters?.get?.("From") ||
            "";
          const fromNorm = normalizeE164(from);
          const meta = fromNorm ? await fetchLeadPreviewByNumber(fromNorm) : null;
          const callSid =
            call?.parameters?.CallSid ||
            call?.customParameters?.get?.("CallSid") ||
            "";
          window.dispatchEvent(
            new CustomEvent("crm:incomingCall", {
              detail: {
                callSid,
                from: fromNorm,
                leadName: meta?.name || "",
                leadId: meta?.id || "",
                phone: meta?.phone || fromNorm,
              },
            }),
          );
        });

        dev.on("connect", (conn: any) => {
          setActiveCall(conn);
          setIncomingCall(undefined);
          scheduleFallbackRefresh(50);
        });

        dev.on("disconnect", (conn: any) => {
          // Only clear activeCall if it's the call that just disconnected.
          // Prevents a race where we disconnect outbound and immediately accept inbound:
          // the outbound disconnect event must not wipe out the new inbound activeCall.
          setActiveCall((c: any) => (c === conn ? undefined : c));
        });

        await dev.register();
      } catch (e) {
        console.error("Softphone init failed:", e);
      }
    })();
    return () => {
      mounted = false;
      try {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        deviceRef.current?.unregister();
        deviceRef.current?.destroy();
      } catch {}
    };
  }, [scheduleFallbackRefresh]);

  const startCall = useCallback(async (toE164: string, fromTwilio: string) => {
    const dev = deviceRef.current;
    if (!dev) throw new Error("Voice device not ready");
    if (!toE164 || !fromTwilio) throw new Error("Missing To/From");

    const To = normalizeE164(toE164);
    const From = normalizeE164(fromTwilio);
    const userEmail = identityRef.current || "";

    // Server validates billing, number ownership, quiet hours → returns resolved { to, from }
    const { to, from } = await validateAndResolveCall(To, From);

    // Browser SDK places the call directly (2-leg: browser WebRTC + PSTN to lead)
    const conn = await (dev as any).connect?.({ params: { To: to, CallerId: from, userEmail } });
    setActiveCall(conn);
  }, []);

  const hangup = useCallback(() => {
    try {
      activeCall?.disconnect?.();
    } catch {}
  }, [activeCall]);

  const answer = useCallback(() => {
    try {
      const call = incomingCall;
      if (!call) return;
      // If agent is on an active SoftphoneProvider-tracked call, hang it up first.
      // voiceClient conference cleanup is handled by the inbound-direct hook in dial-session.
      try { activeCall?.disconnect?.(); } catch {}
      call.accept?.();
      // Promote to activeCall immediately — Device "connect" may not fire for accepted inbound calls
      setActiveCall(call);
      setIncomingCall(undefined);
      setInboundCallAccepted(true);
      const onEnd = () => {
        setActiveCall((c: any) => (c === call ? undefined : c));
        setInboundCallAccepted(false);
      };
      try { call.on?.("disconnect", onEnd); } catch {}
      try { call.on?.("cancel", onEnd); } catch {}
    } catch {}
  }, [incomingCall, activeCall]);

  const decline = useCallback(() => {
    try {
      incomingCall?.reject?.();
      setIncomingCall(undefined);
    } catch {}
  }, [incomingCall]);

  useEffect(() => {
    window.addEventListener("crm:incomingCall:answer", answer);
    window.addEventListener("crm:incomingCall:decline", decline);
    return () => {
      window.removeEventListener("crm:incomingCall:answer", answer);
      window.removeEventListener("crm:incomingCall:decline", decline);
    };
  }, [answer, decline]);

  const value = useMemo<SoftphoneCtx>(
    () => ({ ready, device: deviceRef.current, activeCall, incomingCall, inboundCallAccepted, startCall, hangup, answer, decline }),
    [ready, activeCall, incomingCall, inboundCallAccepted, startCall, hangup, answer, decline]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}
