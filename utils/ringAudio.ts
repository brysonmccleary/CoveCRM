// utils/ringAudio.ts
// Robust ringback player with autoplay fallback, using /ringback.mp3
// Adds a one-time user-gesture unlock so play() resolves immediately thereafter.

let audioEl: HTMLAudioElement | null = null;
let unlocked = false;
let unlockPromise: Promise<void> | null = null;

// --- HARD GUARD: ringback must be explicitly armed by a user gesture ---
let ringbackArmed = false;
let ringbackArmedAt = 0;

/**
 * Call ONLY inside a direct user gesture (e.g. the onClick handler for "Call").
 * Arms ringback for a short window so mount/polling/focus effects can’t start audio.
 */
export function armRingbackFromUserGesture(): void {
  ringbackArmed = true;
  ringbackArmedAt = Date.now();
}

/** Call on hangup/end-call/errors/unmount to prevent re-assert leaks. */
export function disarmRingbackUserGesture(): void {
  ringbackArmed = false;
  ringbackArmedAt = 0;
}

/** True only shortly after the user gesture. */
export function isRingbackArmed(maxAgeMs: number = 6000): boolean {
  if (!ringbackArmed) return false;
  if (!ringbackArmedAt) return false;
  return Date.now() - ringbackArmedAt <= maxAgeMs;
}

export async function primeAudioContext(): Promise<void> {
  try {
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume();
  } catch {}
}

function ensureEl() {
  if (audioEl) return audioEl;
  const el = new Audio("/ringback.mp3"); // asset in /public
  el.loop = true;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.volume = 0.35;
  el.muted = true; // default: silent unless playRingback() explicitly unmutes
  audioEl = el;
  return el;
}

/**
 * Returns true if we've already satisfied the browser's user-gesture requirement.
 */
export function isUnlocked(): boolean {
  return unlocked;
}

/**
 * Arms one-time listeners to unlock audio on the *first* user gesture.
 * Idempotent: safe to call many times; installs listeners only once.
 */
export function ensureUnlocked(): Promise<void> {
  if (unlocked) return Promise.resolve();
  if (unlockPromise) return unlockPromise;

  unlockPromise = new Promise<void>((resolve) => {
    const handler = async () => {
      try {
        await primeAudioContext();
        const el = ensureEl();

        // Attempt a short play to satisfy gesture gating; immediately pause/reset.
        // IMPORTANT: this must be SILENT or it will "ring" when the user clicks anything (like opening a lead).
        const prevMuted = (el as any).muted;
        const prevVol = (el as any).volume;
        try { (el as any).muted = true; (el as any).volume = 0; } catch {}

        try {
          const p = el.play();
          if (p && typeof (p as any).then === "function") {
            await (p as Promise<void>).catch(() => {});
          }
        } catch {}
        try { el.pause(); el.currentTime = 0; } catch {}

        try { (el as any).muted = prevMuted; (el as any).volume = prevVol; } catch {}

        unlocked = true;
      } finally {
        // Clean up all one-time listeners
        window.removeEventListener("pointerdown", handler as any);
        window.removeEventListener("touchend", handler as any);
        window.removeEventListener("click", handler as any);
        window.removeEventListener("keydown", handler as any);
        resolve();
      }
    };

    // Use broad set of gestures for reliability across Safari/iOS/desktop
    window.addEventListener("pointerdown", handler as any, { once: true, passive: true });
    window.addEventListener("touchend", handler as any, { once: true, passive: true });
    window.addEventListener("click", handler as any, { once: true, passive: true });
    window.addEventListener("keydown", handler as any, { once: true });
  });

  return unlockPromise;
}

export async function playRingback(): Promise<void> {
  // HARD BLOCK: never start ringback unless armed by a recent user gesture.
  if (!isRingbackArmed()) {
    throw new Error("Ringback blocked: not armed by user gesture");
  }
  const el = ensureEl();
  // Only this function is allowed to make ringback audible.
  try { el.muted = false; } catch {}
  try {
    await el.play();
  } catch (e) {
    // IMPORTANT: Do NOT attach "resume on next gesture" handlers.
    // That behavior causes ringback to start on unrelated clicks (e.g. navigating to a lead).
    throw e;
  }
}


export function stopRingback(): void {
  try { disarmRingbackUserGesture(); } catch {}
  try {
    if (!audioEl) return;
    audioEl.pause();
    audioEl.currentTime = 0;
    try { (audioEl as any).muted = true; } catch {}
  } catch {}
}

// Optional HEAD check to verify the asset is reachable.
export async function ringAssetHealthcheck(): Promise<boolean> {
  try {
    const r = await fetch("/ringback.mp3", { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}
