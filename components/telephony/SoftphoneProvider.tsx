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

// Places the PSTN leg via our server and returns the conferenceName that Twilio should join.
async function placeOutboundConferenceCall(toE164: string, fromTwilio: string): Promise<{ conferenceName: string; callSid?: string }> {
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
  if (!j?.conferenceName) throw new Error("Outbound call missing conferenceName");
  return { conferenceName: String(j.conferenceName), callSid: j.callSid ? String(j.callSid) : undefined };
}


export function useSoftphone() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSoftphone must be used within <SoftphoneProvider/>");
  return v;
}

type Props = {
  children: React.ReactNode;
};

export default function SoftphoneProvider({ children }: Props) {
  const deviceRef = useRef<Device | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [activeCall, setActiveCall] = useState<any | undefined>(undefined);
  const [incomingCall, setIncomingCall] = useState<any | undefined>(undefined);
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
          // Allow incoming events to reach this client
          allowIncomingWhileBusy: false,
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

        dev.on("disconnect", () => {
          setActiveCall(undefined);
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

    // ✅ PRIMARY: Conference-based browser -> PSTN bridging
    // 1) Create PSTN leg on server (returns conferenceName)
    // 2) Join browser leg into SAME conference via TwiML App (/api/voice/agent-join)
    try {
      const { conferenceName } = await placeOutboundConferenceCall(To, From);

      // Join the conference from the browser leg.
      // Twilio will call the TwiML App Voice URL (agent-join) and POST our params.
      const conn = await (dev as any).connect?.({ params: { conferenceName } });
      setActiveCall(conn);
      return;
    } catch (e) {
      console.warn("[softphone] conference bridge failed; falling back to legacy connect", e);
    }

    // 🧯 FALLBACK: legacy direct connect (kept for safety)
    const conn = await (dev as any).connect?.({ params: { To, From } });
    setActiveCall(conn);
  }, []);

  const hangup = useCallback(() => {
    try {
      activeCall?.disconnect?.();
    } catch {}
  }, [activeCall]);

  const answer = useCallback(() => {
    try {
      incomingCall?.ignore?.();
    } catch {}
  }, [incomingCall]);

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
    () => ({ ready, device: deviceRef.current, activeCall, incomingCall, startCall, hangup, answer, decline }),
    [ready, activeCall, incomingCall, startCall, hangup, answer, decline]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}
