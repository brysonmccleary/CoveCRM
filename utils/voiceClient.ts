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
    DeviceCtor =
      (mod as any).Device ||
      (mod as any).default?.Device ||
      (mod as any); // safeguard for different build outputs
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
      // You can add audioConstraints here if needed for specific browsers.
      // rtcConstraints: { audio: true } // default is fine in most cases
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

    // Token lifecycle safety nets
    device.on?.("tokenWillExpire", () => {
      // refresh a bit early when Twilio warns us
      void refreshTokenSoon();
    });
    device.on?.("tokenExpired", () => {
      // attempt immediate refresh if possible
      void refreshTokenSoon();
    });

    // We don’t accept inbound in this app; auto-reject to stay clean
    device.on("incoming", (conn: any) => {
      try {
        conn.reject();
      } catch {}
    });

  } else {
    // Device exists; refresh token
    try {
      await device.updateToken(token);
    } catch {
      try {
        device.destroy();
      } catch {}
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

// Internal helper to nuke all connections safely
async function disconnectAllSafe() {
  try {
    // Disconnect the tracked connection first
    activeConnection?.disconnect?.();
  } catch {}
  activeConnection = null;

  // Then ask the device to drop anything else it might still be holding
  try {
    device?.disconnectAll?.();
  } catch {}
}

// ---- PUBLIC API

// Join a conference by name (Twilio will invoke your TwiML App URL /api/voice/agent-join)
export async function joinConference(conferenceName: string) {
  await ensureDevice();

  // Disconnect any stale connection first
  await disconnectAllSafe();

  // These params are forwarded to your TwiML App request
  const params = { conferenceName };

  return new Promise<any>((resolve, reject) => {
    try {
      const conn = device.connect({ params });

      conn.on("accept", () => {
        // Refresh token ~45m in (default token TTL ~60m)
        setTimeout(refreshTokenSoon, 45 * 60 * 1000);
      });

      conn.on("disconnect", () => {
        if (activeConnection === conn) activeConnection = null;
      });

      conn.on?.("cancel", () => {
        if (activeConnection === conn) activeConnection = null;
      });

      conn.on?.("reject", () => {
        if (activeConnection === conn) activeConnection = null;
      });

      conn.on("error", (e: any) => {
        console.warn("Connection error:", e?.message || e);
      });

      activeConnection = conn;
      resolve(conn);
    } catch (err) {
      reject(err);
    }
  });
}

// Leave the current conference and keep device around (fast rejoin next call)
export async function leaveConference() {
  await disconnectAllSafe();
  // Keep the device registered for faster next-call connect.
  // If you prefer to fully tear down between calls, you can unregister/destroy via fullyTearDown().
}

// Optional: hard reset everything (used only if you want a complete cleanup)
export async function fullyTearDown() {
  await disconnectAllSafe();
  try {
    await device?.unregister?.();
  } catch {}
  try {
    device?.destroy?.();
  } catch {}
  device = null;
  registered = false;
}

// Simple mute helpers for UI
export function setMuted(mute: boolean) {
  try {
    activeConnection?.mute?.(!!mute);
  } catch {}
}

export function getMuted(): boolean {
  try {
    return !!activeConnection?.isMuted?.();
  } catch {
    return false;
  }
}
