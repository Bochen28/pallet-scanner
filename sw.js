// Offline support: serve the app from the cache, refresh the cache in the background.
// Bump CACHE when releasing a new version so installed copies update right away.
const CACHE = "pallet-scanner-v5";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/app.js",
  "js/compare.js",
  "js/feedback.js",
  "js/format.js",
  "js/ocr.js",
  "js/scan-filter.js",
  "js/scanner.js",
  "js/store.js",
  "vendor/zxing-reader.js",
  "vendor/zxing_reader.wasm",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
// The text reader for photos of the printed list (~10 MB): downloaded in the background after
// install so it also works offline, without delaying the first start.
const OCR_ASSETS = [
  "vendor/tesseract/tesseract.min.js",
  "vendor/tesseract/worker.min.js",
  "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract/tesseract-core-lstm.wasm.js",
  "vendor/tesseract/eng.traineddata.gz",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

async function cacheOcrAssets() {
  const cache = await caches.open(CACHE);
  for (const url of OCR_ASSETS) {
    if (!(await cache.match(url))) await cache.add(url).catch(() => {});
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Only this app's old caches: other tools on the same site (Package Finder) keep theirs.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pallet-scanner-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this on every start, so an interrupted download is finished later.
self.addEventListener("message", (event) => {
  if (event.data === "cache-ocr") event.waitUntil(cacheOcrAssets());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => null);
  event.waitUntil(network);

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const response = await network;
      if (response) return response;
      if (request.mode === "navigate") {
        const shell = await caches.match("index.html");
        if (shell) return shell;
      }
      return Response.error();
    })(),
  );
});
