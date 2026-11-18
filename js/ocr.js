/**
 * Reads printed text from camera frames with Tesseract.js (bundled in vendor/tesseract, works offline).
 * The text reader is loaded the first time the printed list is scanned (~7 MB, cached by the
 * service worker afterwards).
 */

const BASE = new URL("../vendor/tesseract/", import.meta.url);

let workerPromise = null;

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
    script.onerror = () => reject(new Error("The text reader could not be loaded. Open the app once with internet."));
    document.head.append(script);
  });
}

/** Loads the text reader once; later calls return the same worker. */
export function prepareTextReader() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(new URL("tesseract.min.js", BASE).href);
      const core = simdSupported() ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js";
      const worker = await window.Tesseract.createWorker("eng", 1, {
        workerPath: new URL("worker.min.js", BASE).href,
        corePath: new URL(core, BASE).href,
        langPath: BASE.href.replace(/\/$/, ""),
        gzip: true,
        workerBlobURL: false,
        cacheMethod: "none", // the service worker caches the files
      });
      // "Sparse text": find as many words as possible, in no particular order (suits tables).
      // A fixed resolution (close to what Tesseract estimates for these frames) stops it from
      // guessing, and logging its guess, on every frame.
      await worker.setParameters({ tessedit_pageseg_mode: "11", user_defined_dpi: "350" });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Returns the words read in the canvas. Words touching the edge of the canvas are left out:
 * they are usually cut off and would give a wrong (shortened) number.
 */
export async function readWords(canvas) {
  const worker = await prepareTextReader();
  const { data } = await worker.recognize(canvas, {}, { text: false, blocks: true });
  const margin = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) * 0.01));
  const words = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const b = word.bbox;
          if (b.x0 <= margin || b.y0 <= margin || b.x1 >= canvas.width - margin || b.y1 >= canvas.height - margin) continue;
          words.push(word.text);
        }
      }
    }
  }
  return words;
}
