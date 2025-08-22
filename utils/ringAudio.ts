// utils/ringAudio.ts
// Robust ringback player with autoplay fallback, using /ringback.mp3

let audioEl: HTMLAudioElement | null = null;

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
  audioEl = new Audio("/ringback.mp3"); // <-- filename here
  audioEl.loop = true;
  audioEl.preload = "auto";
  audioEl.crossOrigin = "anonymous";
  audioEl.volume = 0.35;
  return audioEl;
}

export async function playRingback(): Promise<void> {
  const el = ensureEl();
  try {
    await el.play();
  } catch (err) {
    // Autoplay blocked (Safari). Resume on first tap/click.
    const resume = async () => { try { await el.play(); } catch {} document.removeEventListener("click", resume); };
    document.addEventListener("click", resume, { once: true, passive: true });
  }
}

export function stopRingback(): void {
  try {
    if (!audioEl) return;
    audioEl.pause();
    audioEl.currentTime = 0;
  } catch {}
}

// Quick HEAD check to verify the asset is reachable.
export async function ringAssetHealthcheck(): Promise<boolean> {
  try {
    const r = await fetch("/ringback.mp3", { method: "HEAD", cache: "no-store" }); // <-- filename here
    return r.ok;
  } catch {
    return false;
  }
}
