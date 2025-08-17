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
  const r = await fetch("/api/twilio/voice/token");
  if (!r.ok) throw new Error("Unable to obtain voice token");
  return r.json();
}

async function fetchLeadPreviewByNumber(num: string) {
  try {
    const r = await fetch(`/api/leads/search?q=${encodeURIComponent(num)}`);
    const j = await r.json();
    const first = Array.isArray(j?.results) ? j.results[0] : null;
    if (!first) return null;
    return {
      id: first._id,
      name: first.displayName || `${first.firstName || ""} ${first.lastName || ""}`.trim(),
      phone: first.phone || "",
      state: first.state || "",
      status: first.status || "",
    };
  } catch {
    return null;
  }
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
  const [incomingMeta, setIncomingMeta] = useState<any | null>(null);
  const tokenRef = useRef<string | null>(null);
  const identityRef = useRef<string | null>(null);

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
          // TS note: DOM's WebCodecs defines a `Codec` type that can collide with the SDK's.
          // Casting avoids the name clash during type-checking.
          codecPreferences: ["opus", "pcmu"] as unknown as any,
          // Allow incoming events to reach this client
          allowIncomingWhileBusy: false,
        });
        deviceRef.current = dev;

        dev.on("registered", () => setReady(true));
        dev.on("unregistered", () => setReady(false));
        dev.on("error", (e: any) => {
          console.warn("[Twilio Device error]", e?.message || e);
        });

        // Refresh token when expiring
        dev.on("tokenWillExpire", async () => {
          try {
            const { token: newToken } = await fetchToken();
            tokenRef.current = newToken;
            await dev.updateToken(newToken);
          } catch (e) {
            console.warn("Failed refreshing Twilio token", e);
          }
        });

        // Incoming call handling
        dev.on("incoming", async (call: any) => {
          setIncomingCall(call);
          // Try to parse caller
          const from =
            call?.parameters?.From ||
            call?.callerInfo?.from ||
            call?.customParameters?.get?.("From") ||
            "";
          const fromNorm = normalizeE164(from);
          const meta = fromNorm ? await fetchLeadPreviewByNumber(fromNorm) : null;
          setIncomingMeta(meta || { id: null, name: "Unknown Caller", phone: fromNorm });
        });

        dev.on("connect", (conn: any) => {
          setActiveCall(conn);
          setIncomingCall(undefined);
          setIncomingMeta(null);
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
        deviceRef.current?.unregister();
        deviceRef.current?.destroy();
      } catch {}
    };
  }, []);

  const startCall = useCallback(async (toE164: string, fromTwilio: string) => {
    const dev = deviceRef.current;
    if (!dev) throw new Error("Voice device not ready");
    if (!toE164 || !fromTwilio) throw new Error("Missing To/From");
    const To = normalizeE164(toE164);
    const From = normalizeE164(fromTwilio);
    const conn = await dev.connect({ params: { To, From } }); // TwiML answer.ts handles bridge
    setActiveCall(conn);
  }, []);

  const hangup = useCallback(() => {
    try {
      activeCall?.disconnect?.();
    } catch {}
  }, [activeCall]);

  const answer = useCallback(() => {
    try {
      incomingCall?.accept?.();
    } catch {}
  }, [incomingCall]);

  const decline = useCallback(() => {
    try {
      incomingCall?.reject?.();
      setIncomingCall(undefined);
      setIncomingMeta(null);
    } catch {}
  }, [incomingCall]);

  const value = useMemo<SoftphoneCtx>(
    () => ({ ready, device: deviceRef.current, activeCall, incomingCall, startCall, hangup, answer, decline }),
    [ready, activeCall, incomingCall, startCall, hangup, answer, decline]
  );

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* Incoming Call Banner */}
      {incomingCall && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[1000] max-w-xl w-[92%] sm:w-[640px] rounded-xl border border-zinc-600 bg-zinc-900/95 shadow-lg p-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 mt-0.5">📞</div>
            <div className="flex-1">
              <div className="text-sm text-zinc-300">Incoming call</div>
              <div className="text-lg font-semibold">
                {incomingMeta?.name || "Unknown Caller"}
              </div>
              <div className="text-sm text-zinc-400">
                {incomingMeta?.phone || "(no number)"}{" "}
                {incomingMeta?.state ? `• ${incomingMeta.state}` : ""}{" "}
                {incomingMeta?.status ? `• ${incomingMeta.status}` : ""}
              </div>
              {incomingMeta?.id && (
                <a
                  href={`/dial/${incomingMeta.id}`}
                  className="text-xs underline text-blue-400 hover:text-blue-300 cursor-pointer"
                >
                  View lead
                </a>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={decline}
                className="px-3 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white cursor-pointer"
              >
                Decline
              </button>
              <button
                onClick={answer}
                className="px-3 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white cursor-pointer"
              >
                Answer
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
