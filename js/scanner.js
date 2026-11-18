import { ReadConfirmFilter, ScanFilter } from "./scan-filter.js";
import { extractPackageNumbers, isPackageNumber } from "./compare.js";
import { prepareTextReader, readWords } from "./ocr.js";

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

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/**
 * Maps a rectangle on screen (e.g. the reading frame) to pixels of the camera image, taking the
 * video's object-fit: cover cropping into account.
 */
export function screenRectToVideoRect(video, rect) {
  const box = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !box.width || !box.height) return null;
  const scale = Math.max(box.width / vw, box.height / vh);
  const offsetX = (box.width - vw * scale) / 2;
  const offsetY = (box.height - vh * scale) / 2;
  const x0 = Math.max(0, (rect.left - box.left - offsetX) / scale);
  const y0 = Math.max(0, (rect.top - box.top - offsetY) / scale);
  const x1 = Math.min(vw, (rect.right - box.left - offsetX) / scale);
  const y1 = Math.min(vh, (rect.bottom - box.top - offsetY) / scale);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** Back camera stream shared by package scanning and list scanning. */
class CameraFeed {
  constructor(video) {
    this.video = video;
    this.canvas = document.createElement("canvas");
    this.ctx2d = this.canvas.getContext("2d", { willReadFrequently: true });
    this.stream = null;
    this.track = null;
    this.running = false;
    this.hasTorch = false;
    this.torchOn = false;
  }

  async open(width, height) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("insecure", "The camera only works when the app is opened over https.");
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: width }, height: { ideal: height } },
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
}

/**
 * Package scanning: calls `onCode(code)` whenever a package label (Code-128 starting with 0000 or
 * one digit + 0000) comes into view. Other barcodes are ignored. Several labels per frame is fine.
 */
export class CameraScanner extends CameraFeed {
  constructor(video, { onCode }) {
    super(video);
    this.onCode = onCode;
    // Decoding in the browser can be slower than in the native apps, so allow a bit more
    // time between the two reads that confirm a code (native apps use 1.0 s).
    this.filter = new ScanFilter({ confirmWindow: 1.5 });
  }

  async start() {
    await prepareDecoder();
    await this.open(1280, 720);
    this.running = true;
    this.#loop();
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
          const codes = results
            .filter((r) => r.isValid && r.text.trim() !== "" && isPackageNumber(r.text))
            .map((r) => r.text);
          for (const code of this.filter.onFrame(codes, performance.now() / 1000)) {
            this.onCode(code);
          }
        } catch (err) {
          console.warn("Decode failed", err);
        }
      }
      await nextFrame();
    }
  }
}

/**
 * Live scanning of the printed list: reads the text inside the reading frame over and over and
 * calls `onNumbers(numbers)` with package numbers that were read twice. `onFrameRead(numbers)` reports
 * what each frame contained, for live feedback.
 */
export class ListScanner extends CameraFeed {
  constructor(video, { onNumbers, onFrameRead, getCropRect }) {
    super(video);
    this.onNumbers = onNumbers;
    this.onFrameRead = onFrameRead;
    this.getCropRect = getCropRect;
    this.confirm = new ReadConfirmFilter({ reads: 2, window: 10 });
  }

  async start() {
    await prepareTextReader();
    await this.open(1920, 1080); // more pixels per character than for barcodes
    this.running = true;
    this.#loop();
  }

  async #loop() {
    const video = this.video;
    while (this.running) {
      const crop = video.readyState >= 2 ? this.getCropRect() : null;
      if (crop && crop.w > 40 && crop.h > 40) {
        // Small crops are enlarged a little: the text reader works best with ~25 px high characters.
        const scale = Math.min(2, Math.max(1, 1200 / crop.w));
        this.canvas.width = Math.round(crop.w * scale);
        this.canvas.height = Math.round(crop.h * scale);
        this.ctx2d.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, this.canvas.width, this.canvas.height);
        try {
          const words = await readWords(this.canvas);
          if (!this.running) break;
          const numbers = extractPackageNumbers(words);
          this.onFrameRead?.(numbers);
          const accepted = this.confirm.onFrame(numbers, performance.now() / 1000);
          if (accepted.length) this.onNumbers(accepted);
        } catch (err) {
          console.warn("Reading the list failed", err);
        }
      }
      await nextFrame();
    }
  }
}
