// utils/voiceClient.ts
// Browser-only helper for Twilio WebRTC (Voice JS SDK v2: @twilio/voice-sdk)

let DeviceCtor: any | null = null;

// Singleton state
let device: any | null = null;
let activeCall: any | null = null;
let registered = false;
let refreshing = false;

type TokenResponse = {
  token: string;
  identity: string;
  usingPersonal?: boolean;
  accountSid?: string;
  outgoingAppSid?: string;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// ---- Token fetch
async function fetchToken(): Promise<string> {
  const r = await fetch("/api/twilio/voice/token");
  if (!r.ok) throw new Error("Failed to fetch voice token");
  const j = (await r.json()) as TokenResponse;
  if (!j?.token) throw new Error("Voice token missing");
  return j.token;
}

// ---- Ensure Voice Device
async function ensureDevice(): Promise<void> {
  if (!isBrowser()) throw new Error("voiceClient must run in the browser");

  if (!DeviceCtor) {
    const mod = await import("@twilio/voice-sdk");
    DeviceCtor = (mod as any).Device || (mod as any).default?.Device || (mod as any);
  }

  const token = await fetchToken();

  if (!device) {
    device = new DeviceCtor(token, {
      logLevel: "error",
      codecPreferences: ["opus", "pcmu"],
      allowIceRestart: true,
      disableAudioContextProxy: true,
      closeProtection: false,
      allowIncomingWhileBusy: false,
    });

    device.on("error", (e: any) => {
      console.warn("Twilio Device error:", e?.message || e);
    });

    device.on("registered", () => {
      registered = true;
    });

    device.on("unregistered", () => {
      registered = false;
    });

    // No inbound in this app; reject immediately to keep the device clean
    device.on("incoming", (call: any) => {
      try { call.reject(); } catch {}
    });
  } else {
    // Refresh token on an existing device
    try {
      await device.updateToken(token);
    } catch {
      try { device.destroy(); } catch {}
      device = null;
      return ensureDevice();
    }
  }

  if (!registered) {
    await device.register();
  }
}

// ---- Proactive token refresh (safe no-op if already refreshing)
async function refreshTokenSoon() {
  if (refreshing || !device) return;
  refreshing = true;
  try {
    const t = await fetchToken();
    await device.updateToken(t);
  } catch (e) {
    console.warn("Token refresh failed:", (e as any)?.message || e);
  } finally {
    refreshing = false;
  }
}

// ---- PUBLIC API

// Join a conference by name (Twilio will invoke your TwiML App URL /api/voice/agent-join)
export async function joinConference(conferenceName: string) {
  await ensureDevice();

  // Disconnect any stale call first
  try { activeCall?.disconnect?.(); } catch {}
  activeCall = null;

  // These params are forwarded to your TwiML App request
  const params = { conferenceName };

  try {
    // Voice SDK v2: connect() returns a Promise<Twilio.Call>
    const call = await device.connect({ params });

    // Hook events on the resolved Call instance
    call.on("accept", () => {
      // Refresh token ~45m in (default token TTL ~60m)
      setTimeout(refreshTokenSoon, 45 * 60 * 1000);
    });

    call.on("disconnect", () => {
      if (activeCall === call) activeCall = null;
    });

    call.on("error", (e: any) => {
      console.warn("Call error:", e?.message || e);
    });

    activeCall = call;
    return call;
  } catch (err) {
    throw err;
  }
}

// Leave the current conference and keep device around (fast rejoin next call)
export async function leaveConference() {
  try { activeCall?.disconnect?.(); } catch {}
  activeCall = null;
  // Keeping device registered for faster next-call connect.
}

// Simple mute helpers for UI
export function setMuted(mute: boolean) {
  try { activeCall?.mute?.(!!mute); } catch {}
}

export function getMuted(): boolean {
  try { return !!activeCall?.isMuted?.(); } catch { return false; }
}
