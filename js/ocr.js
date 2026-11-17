/**
 * Reads printed text from a photo with Tesseract.js (bundled in vendor/tesseract, works offline).
 * The text reader is loaded on first use (~7 MB, cached by the service worker afterwards).
 */

const BASE = new URL("../vendor/tesseract/", import.meta.url);
const MAX_SIDE = 2400; // phone photos are ~4000 px; this keeps text sharp but recognition fast

let workerPromise = null;
let progressListener = null;

function simdSupported() {
  try {
    // Minimal module using a SIMD instruction (from wasm-feature-detect).
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("The text reader could not be loaded. Check the internet connection once."));
    document.head.append(script);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(new URL("tesseract.min.js", BASE).href);
      const core = simdSupported() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js";
      return window.Tesseract.createWorker("eng", 1, {
        workerPath: new URL("worker.min.js", BASE).href,
        corePath: new URL(core, BASE).href,
        langPath: BASE.href.replace(/\/$/, ""),
        gzip: true,
        workerBlobURL: false,
        cacheMethod: "none", // the service worker caches the files
        logger: (m) => progressListener?.(m),
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function imageToCanvas(file) {
  let source;
  let width;
  let height;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
    width = source.width;
    height = source.height;
  } catch {
    source = new Image();
    const url = URL.createObjectURL(file);
    try {
      source.src = url;
      await source.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  return canvas;
}

/**
 * Returns the text found in the image file.
 * `onProgress(stage, fraction)` reports "loading" (first use) and "reading" progress.
 */
export async function readTextFromImage(file, onProgress = () => {}) {
  progressListener = (m) => {
    if (m.status === "recognizing text") onProgress("reading", m.progress ?? 0);
    else onProgress("loading", m.progress ?? 0);
  };
  try {
    onProgress("loading", 0);
    const canvas = await imageToCanvas(file);
    const worker = await getWorker();
    onProgress("reading", 0);
    const { data } = await worker.recognize(canvas);
    return data.text || "";
  } finally {
    progressListener = null;
  }
}
