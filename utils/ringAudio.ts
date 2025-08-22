// utils/ringAudio.ts
let audioEl: HTMLAudioElement | null = null;

export function primeAudioContext() {
  try {
    const a = new Audio();
    a.muted = true;
    a.play().catch(() => {});
    a.pause();
  } catch {}
}

export function playRingback() {
  try {
    stopRingback();
    audioEl = new Audio("/ring.mp3"); // your asset
    audioEl.loop = true;
    // tag so our DOM tone killer never touches it
    (audioEl as any).dataset = (audioEl as any).dataset || {};
    (audioEl as any).dataset.coveRing = "1";
    audioEl.play().catch(() => {});
  } catch {}
}

export function stopRingback() {
  try {
    if (audioEl) {
      audioEl.pause();
      audioEl.src = "";
      audioEl.remove();
      audioEl = null;
    }
  } catch {}
}

// nuclear option if needed elsewhere (kept)
export function forceStopAllSounds() {
  stopRingback();
  try {
    document.querySelectorAll("audio").forEach((el) => {
      const a = el as HTMLAudioElement;
      if ((a as any).dataset?.coveRing === "1") return; // keep ours
      try { a.pause(); } catch {}
      try { a.removeAttribute("src"); } catch {}
      try { (a as any).srcObject = null; } catch {}
      try { a.remove(); } catch {}
    });
  } catch {}
}
