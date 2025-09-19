// Robust ringback player with autoplay fallback, using /ringback.mp3
// Adds a one-time user-gesture unlock so play() resolves immediately thereafter.

let audioEl: HTMLAudioElement | null = null;
let unlocked = false;
let unlockPromise: Promise<void> | null = null;

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
        try {
          const p = el.play();
          if (p && typeof (p as any).then === "function") {
            await (p as Promise<void>).catch(() => {});
          }
        } catch {}
        try { el.pause(); el.currentTime = 0; } catch {}

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
  const el = ensureEl();
  try {
    await el.play();
  } catch {
    // Autoplay blocked: resume on next gesture (covering mobile + desktop)
    const resume = async () => {
      try { await el.play(); } catch {}
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("touchend", resume);
      document.removeEventListener("click", resume);
      document.removeEventListener("keydown", resume);
    };
    document.addEventListener("pointerdown", resume, { once: true, passive: true });
    document.addEventListener("touchend", resume, { once: true, passive: true });
    document.addEventListener("click", resume, { once: true, passive: true });
    document.addEventListener("keydown", resume, { once: true });
  }
}

export function stopRingback(): void {
  try {
    if (!audioEl) return;
    audioEl.pause();
    audioEl.currentTime = 0;
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
