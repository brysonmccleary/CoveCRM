let audio: HTMLAudioElement | null = null;

export function playRingback() {
  console.log("🎵 playRingback() called (simplified)");

  if (!audio) {
    audio = new Audio("/ringback.mp3");
    audio.loop = true;
  }

  audio.play().catch((err) => {
    console.error("Error playing ringback:", err);
  });
}

export function stopRingback() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null; // Reset to allow new Audio object next time
  }
}

export function primeAudioContext() {
  if (typeof window !== "undefined") {
    const context = new (window.AudioContext || (window as any).webkitAudioContext)();
    const buffer = context.createBuffer(1, 1, 22050);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    console.log("✅ Audio context primed");
  }
}
