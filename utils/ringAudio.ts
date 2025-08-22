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
    audioEl = new Audio("/ring.mp3"); // or your existing asset
    audioEl.loop = true;
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

// nuclear option in case any other <audio> tags linger
export function forceStopAllSounds() {
  stopRingback();
  try {
    document.querySelectorAll("audio").forEach((el) => {
      try {
        (el as HTMLAudioElement).pause();
        (el as HTMLAudioElement).src = "";
        el.remove();
      } catch {}
    });
  } catch {}
}
