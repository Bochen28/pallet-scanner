/**
 * Turns the raw per-frame detections from the camera into "a barcode has just come into view" events.
 *
 * - A code must be read in `confirmFrames` frames within `confirmWindow` seconds before it is
 *   reported. This filters out the rare one-frame misread.
 * - Once reported, a code is not reported again while it stays in view.
 *   Drop-outs shorter than `reappearAfter` seconds are ignored.
 * - If the code leaves the view for longer than `reappearAfter` and comes back, it is reported
 *   again, so the UI can tell the user "already scanned".
 *
 * Same rules as the Android and iPhone apps.
 */
export class ScanFilter {
  constructor({ confirmFrames = 2, confirmWindow = 1.0, reappearAfter = 2.5 } = {}) {
    this.confirmFrames = confirmFrames;
    this.confirmWindow = confirmWindow;
    this.reappearAfter = reappearAfter;
    this.tracks = new Map();
  }

  /** Feed the codes found in one frame (`now` in seconds); returns the codes to report now. */
  onFrame(codes, now) {
    const reportNow = [];
    for (const code of new Set(codes)) {
      const existing = this.tracks.get(code);
      let track;
      if (existing && !this.#isExpired(existing, now)) {
        existing.hits += 1;
        existing.lastSeen = now;
        track = existing;
      } else {
        track = { hits: 1, lastSeen: now, reported: false };
        this.tracks.set(code, track);
      }
      if (!track.reported && track.hits >= this.confirmFrames) {
        track.reported = true;
        reportNow.push(code);
      }
    }
    for (const [code, track] of this.tracks) {
      if (this.#isExpired(track, now)) this.tracks.delete(code);
    }
    return reportNow;
  }

  reset() {
    this.tracks.clear();
  }

  #isExpired(track, now) {
    const timeout = track.reported ? this.reappearAfter : this.confirmWindow;
    return now - track.lastSeen > timeout;
  }
}
