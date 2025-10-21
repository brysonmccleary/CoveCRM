// Browser-only helper for Twilio WebRTC (Voice JS SDK v2: @twilio/voice-sdk)
// - Disables Twilio SDK sounds so we only hear our own ring.mp3
// - Joins/leaves conference by name (defensive against SDK shape differences)
// - HARD MUTE: toggles SDK mute and also disables local mic tracks as a fallback.

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
function attach(emitter: any, evt: string, fn: (...args: any[]) => void) {
  if (!emitter) return;
  const maybeOn = (emitter as any)?.on;
  const maybeAdd = (emitter as any)?.addListener;
  if (typeof maybeOn === "function") return maybeOn.call(emitter, evt, fn);
  if (typeof maybeAdd === "function") return maybeAdd.call(emitter, evt, fn);
}

// ---- Robust track control (best-effort across SDK builds) -------------------
function setLocalTracksEnabled(call: any, enabled: boolean) {
  try {
    // Most common internal paths across SDK variants:
    // 1) call._mediaStream (MediaStream)
    // 2) call.mediaStream (MediaStream)
    // 3) call['_publisher']?.stream (MediaStream)  <-- internal, best-effort
    const streams: any[] = [];
    const s1 = (call as any)?._mediaStream;
    const s2 = (call as any)?.mediaStream;
    const s3 = (call as any)?._publisher?.stream;
    if (s1) streams.push(s1);
    if (s2 && s2 !== s1) streams.push(s2);
    if (s3 && s3 !== s1 && s3 !== s2) streams.push(s3);

    for (const s of streams) {
      try {
        const tracks: MediaStreamTrack[] = (s.getAudioTracks?.() || []) as any;
        for (const t of tracks) t.enabled = enabled;
      } catch {}
    }
  } catch (e) {
    console.warn("setLocalTracksEnabled failed:", (e as any)?.message || e);
  }
}

function getLocalMutedState(call: any): boolean {
  try {
    // Prefer SDK’s truth if available
    const sdkMuted = call?.isMuted?.();
    if (typeof sdkMuted === "boolean") return !!sdkMuted;

    // Otherwise infer from a track if we can see one
    const s = (call as any)?._mediaStream || (call as any)?.mediaStream || (call as any)?._publisher?.stream;
    const tracks: MediaStreamTrack[] | undefined = s?.getAudioTracks?.();
    if (tracks && tracks.length) return tracks.every((t) => t.enabled === false);
  } catch {}
  // default to not muted if we can't tell
  return false;
}

// -----------------------------------------------------------------------------

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

  const params = { conferenceName }; // forwarded to /api/voice/agent-join (your server)

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

  attach(call, "accept", () => startTokenTimer());

  activeCall = call;
  return call;
}

export async function leaveConference() {
  try { activeCall?.disconnect?.(); } catch {}
  activeCall = null;
  if (tokenRefreshTimer) { clearTimeout(tokenRefreshTimer); tokenRefreshTimer = null; }
}

/**
 * Hard mute: use SDK mute + disable local tracks as a fallback
 * so the client cannot hear the agent until unmuted.
 */
export function setMuted(mute: boolean) {
  try {
    // 1) Ask SDK to stop upstream audio
    try { activeCall?.mute?.(!!mute); } catch {}

    // 2) Double-lock by disabling local tracks (if visible)
    setLocalTracksEnabled(activeCall, !mute);
  } catch (e) {
    console.warn("setMuted failed:", (e as any)?.message || e);
  }
}

export function getMuted(): boolean {
  try {
    // If SDK exposes isMuted, trust it; otherwise infer from tracks.
    return !!getLocalMutedState(activeCall);
  } catch {
    return false;
  }
}
