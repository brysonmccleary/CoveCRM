// utils/voiceClient.ts
// Browser-only helper for Twilio WebRTC (Voice JS SDK v2: @twilio/voice-sdk)

let DeviceCtor: any | null = null;

// Singleton state
let device: any | null = null;
let activeConnection: any | null = null;
let registered = false;
let refreshing = false;

type TokenResponse = {
  token: string;
  identity: string;
  usingPersonal?: boolean;
  accountSid?: string;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// Fetch a fresh Access Token from our API
async function fetchToken(): Promise<string> {
  const r = await fetch("/api/twilio/voice/token");
  if (!r.ok) throw new Error("Failed to fetch voice token");
  const j = (await r.json()) as TokenResponse;
  if (!j?.token) throw new Error("Voice token missing");
  return j.token;
}

// Ensure we have the Voice Device loaded & registered
async function ensureDevice(): Promise<void> {
  if (!isBrowser()) throw new Error("voiceClient must run in the browser");

  if (!DeviceCtor) {
    // Lazy-load the SDK only in the browser
    const mod = await import("@twilio/voice-sdk");
    DeviceCtor = (mod as any).Device || (mod as any).default?.Device || (mod as any);
  }
  if (device && registered) return;

  const token = await fetchToken();

  if (!device) {
    device = new DeviceCtor(token, {
      logLevel: "error",
      // Prefer Opus for better audio; PCMU fallback
      codecPreferences: ["opus", "pcmu"],
      // Auto-reconnect on network blips
      allowIceRestart: true,
    });

    device.on("error", (e: any) => {
      // Keep logs concise
      console.warn("Twilio Device error:", e?.message || e);
    });

    device.on("registered", () => {
      registered = true;
    });

    device.on("unregistered", () => {
      registered = false;
    });

    // Optional: handle incoming (we don't use them here, so auto-reject)
    device.on("incoming", (conn: any) => {
      try { conn.reject(); } catch {}
    });
  } else {
    // Device existed but was not registered or token expired: refresh
    try {
      await device.updateToken(token);
    } catch {
      // If updateToken fails, rebuild the device
      try { device.destroy(); } catch {}
      device = null;
      return ensureDevice();
    }
  }

  if (!registered) {
    await device.register();
  }
}

// Proactively refresh the token (safe no-op if already refreshing)
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

// Join a conference by name (must have a TwiML App whose Voice URL is /api/voice/agent-join)
export async function joinConference(conferenceName: string) {
  await ensureDevice();

  // Disconnect any stale connection first
  try { activeConnection?.disconnect?.(); } catch {}
  activeConnection = null;

  // Connect with params the TwiML App expects
  const params = { conferenceName };

  // Connection event wiring
  return new Promise<any>((resolve, reject) => {
    try {
      const conn = device.connect({ params });

      conn.on("accept", () => {
        // Schedule a token refresh a bit before typical 1h expiry
        setTimeout(refreshTokenSoon, 45 * 60 * 1000);
      });

      conn.on("disconnect", () => {
        if (activeConnection === conn) activeConnection = null;
      });

      conn.on("error", (e: any) => {
        console.warn("Connection error:", e?.message || e);
      });

      activeConnection = conn;

      // Minimal control surface we expose to the UI
      const control = {
        mute: (m: boolean) => {
          try { conn.mute(!!m); } catch {}
        },
        disconnect: () => {
          try { conn.disconnect(); } catch {}
        },
      };

      resolve(control);
    } catch (err) {
      reject(err);
    }
  });
}

// Leave the current conference and unregister
export function leaveConference() {
  try { activeConnection?.disconnect?.(); } catch {}
  activeConnection = null;

  if (device) {
    try { device.unregister(); } catch {}
    // keep device instance around so we can re-register quickly next call
  }
}
