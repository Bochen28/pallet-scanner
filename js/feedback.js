/**
 * Beep (+ vibration where the phone supports it from a web page; iPhones don't).
 * `unlock()` must be called from a tap, because browsers only allow sound after user interaction.
 */
export class Feedback {
  constructor() {
    this.ctx = null;
  }

  unlock() {
    try {
      // Safari 17+: play even when the ring/silent switch is on silent.
      if (navigator.audioSession) navigator.audioSession.type = "playback";
    } catch {
      /* not supported */
    }
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    this.ctx?.resume?.().catch(() => {});
    // A silent blip inside the tap fully unlocks audio on iOS.
    this.#tone(440, 0.01, 0.0001);
  }

  play(added) {
    if (added) {
      this.#tone(1800, 0.12, 0.6);
      this.#vibrate(70);
    } else {
      this.#tone(420, 0.3, 0.6);
      this.#vibrate([40, 90, 40]);
    }
  }

  #tone(frequency, duration, volume) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.setValueAtTime(volume, t + Math.max(0.01, duration - 0.02));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  #vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* not supported */
    }
  }
}
