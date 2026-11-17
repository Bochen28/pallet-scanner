import { ScanFilter } from "./scan-filter.js";

const READER_OPTIONS = {
  formats: ["Code128"],
  tryHarder: true,
  tryRotate: true, // labels stuck on sideways
  tryInvert: false,
  tryDownscale: true,
  maxNumberOfSymbols: 32, // several labels in one frame
  textMode: "Plain", // raw value, same as the Android and iPhone apps
};

let decoderReady = null;

/** Loads the bundled ZXing WebAssembly reader once (works offline, no CDN). */
export function prepareDecoder() {
  if (!decoderReady) {
    const zxing = window.ZXingWASM;
    if (!zxing) return Promise.reject(new Error("Barcode reader script did not load."));
    const wasmUrl = new URL("../vendor/zxing_reader.wasm", import.meta.url).href;
    decoderReady = zxing
      .prepareZXingModule({
        overrides: {
          locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
        },
        fireImmediately: true,
      })
      .catch((err) => {
        decoderReady = null;
        throw err;
      });
  }
  return decoderReady;
}

export class CameraError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Runs the back camera and calls `onCode(code)` whenever a Code-128 barcode comes into view
 * (several in one frame is fine).
 */
export class CameraScanner {
  constructor(video, { onCode }) {
    this.video = video;
    this.onCode = onCode;
    // Decoding in the browser can be slower than in the native apps, so allow a bit more
    // time between the two reads that confirm a code (native apps use 1.0 s).
    this.filter = new ScanFilter({ confirmWindow: 1.5 });
    this.canvas = document.createElement("canvas");
    this.ctx2d = this.canvas.getContext("2d", { willReadFrequently: true });
    this.stream = null;
    this.track = null;
    this.running = false;
    this.hasTorch = false;
    this.torchOn = false;
  }

  async start() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("insecure", "The camera only works when the app is opened over https.");
    }
    await prepareDecoder();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (err) {
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        throw new CameraError("denied", "Camera access is blocked.");
      }
      if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
        throw new CameraError("missing", "No camera was found.");
      }
      if (err?.name === "NotReadableError") {
        throw new CameraError("busy", "The camera is being used by another app.");
      }
      throw new CameraError("other", err?.message || String(err));
    }

    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});

    this.track = this.stream.getVideoTracks()[0] ?? null;
    const caps = this.track?.getCapabilities?.() ?? {};
    this.hasTorch = Boolean(caps.torch);
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
      this.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }

    this.running = true;
    this.#loop();
  }

  stop() {
    this.running = false;
    this.torchOn = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  async setTorch(on) {
    if (!this.track || !this.hasTorch) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      this.torchOn = on;
      return true;
    } catch {
      return false;
    }
  }

  async #loop() {
    const video = this.video;
    while (this.running) {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
        }
        this.ctx2d.drawImage(video, 0, 0, w, h);
        const frame = this.ctx2d.getImageData(0, 0, w, h);
        try {
          const results = await window.ZXingWASM.readBarcodes(frame, READER_OPTIONS);
          if (!this.running) break;
          const codes = results.filter((r) => r.isValid && r.text.trim() !== "").map((r) => r.text);
          for (const code of this.filter.onFrame(codes, performance.now() / 1000)) {
            this.onCode(code);
          }
        } catch (err) {
          console.warn("Decode failed", err);
        }
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
}
