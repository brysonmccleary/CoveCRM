// utils/voiceClient.ts
// Browser-only helper for Twilio WebRTC (Voice JS SDK v2: @twilio/voice-sdk)
// - Disables Twilio SDK sounds so we only hear our own ring.mp3
// - Joins/leaves conference by name (defensive against SDK shape differences)

let DeviceCtor: any | null = null;

// Singleton state
let device: any | null = null;
let activeCall: any | null = null;
let registered = false;
let refreshing = false;
let tokenRefreshTimer: any = null;

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

async function fetchToken(): Promise<string> {
  const r = await fetch("/api/twilio/voice/token");
  if (!r.ok) throw new Error("Failed to fetch voice token");
  const j = (await r.json()) as TokenResponse;
  if (!j?.token) throw new Error("Voice token missing");
  return j.token;
}

// Try both v2 audio API and legacy sounds API to kill SDK tones
function disableSdkSounds(dev: any) {
  try {
    if (dev?.audio) {
      try { dev.audio.incoming?.(false); } catch {}
      try { dev.audio.outgoing?.(false); } catch {}
      try { dev.audio.disconnect?.(false); } catch {}
      try { dev.audio.dtmf?.(false); } catch {}
    }
    if (dev?.sounds) {
      try { dev.sounds.incoming?.(false); } catch {}
      try { dev.sounds.outgoing?.(false); } catch {}
      try { dev.sounds.disconnect?.(false); } catch {}
      try { dev.sounds.dtmf?.(false); } catch {}
    }
  } catch (e) {
    console.warn("disableSdkSounds failed:", (e as any)?.message || e);
  }
}

// Safe event attach that works whether the object exposes .on or .addListener
function attach(call: any, evt: string, fn: (...args: any[]) => void) {
  if (!call) return;
  const maybeOn = (call as any)?.on;
  const maybeAdd = (call as any)?.addListener;
  if (typeof maybeOn === "function") return maybeOn.call(call, evt, fn);
  if (typeof maybeAdd === "function") return maybeAdd.call(call, evt, fn);
  // no-op if the SDK object doesn’t expose either
}

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

    // Immediately disable built-in tones
    disableSdkSounds(device);

    device.on?.("error", (e: any) => console.warn("Twilio Device error:", e?.message || e));
    device.on?.("registered", () => { registered = true; disableSdkSounds(device); });
    device.on?.("unregistered", () => { registered = false; });

    // No inbound in this app
    device.on?.("incoming", (call: any) => { try { call.reject?.(); } catch {} });
  } else {
    try {
      await device.updateToken(token);
    } catch {
      try { device.destroy?.(); } catch {}
      device = null;
      return ensureDevice();
    }
  }

  if (!registered) await device.register?.();
}

async function refreshTokenSoon() {
  if (refreshing || !device) return;
  refreshing = true;
  try {
    const t = await fetchToken();
    await device.updateToken?.(t);
  } catch (e) {
    console.warn("Token refresh failed:", (e as any)?.message || e);
  } finally {
    refreshing = false;
  }
}

function startTokenTimer() {
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  // 45 minutes after a successful connect is plenty
  tokenRefreshTimer = setTimeout(refreshTokenSoon, 45 * 60 * 1000);
}

// PUBLIC API
export async function joinConference(conferenceName: string) {
  await ensureDevice();

  try { activeCall?.disconnect?.(); } catch {}
  activeCall = null;

  const params = { conferenceName }; // forwarded to /api/voice/agent-join

  // Some SDK builds return a Call (with .on), others expose a similar emitter API.
  // We guard all accesses and never assume the shape.
  let call: any;
  try {
    const maybe = await device.connect({ params });
    call = maybe;
  } catch (e) {
    console.warn("Device.connect failed:", e);
    throw e;
  }

  // Just in case the SDK re-enabled tones on connect:
  disableSdkSounds(device);

  // Start token refresh regardless of event availability
  startTokenTimer();

  // Attach listeners defensively
  attach(call, "disconnect", () => {
    if (activeCall === call) activeCall = null;
    if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
  });

  attach(call, "error", (e: any) => console.warn("Call error:", e?.message || e));

  // (Optional) If the SDK exposes 'accept', attach to it; otherwise we already set the timer.
  attach(call, "accept", () => startTokenTimer());

  activeCall = call;
  return call;
}

export async function leaveConference() {
  try { activeCall?.disconnect?.(); } catch {}
  activeCall = null;
  if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
}

export function setMuted(mute: boolean) {
  try { activeCall?.mute?.(!!mute); } catch {}
}
export function getMuted(): boolean {
  try { return !!activeCall?.isMuted?.(); } catch { return false; }
}
