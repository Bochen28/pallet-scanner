import { PalletStore } from "./store.js";
import { buildReport, displayCode, formatTime } from "./format.js";
import { CameraError, CameraScanner, prepareDecoder } from "./scanner.js";
import { Feedback } from "./feedback.js";

const $ = (id) => document.getElementById(id);
const els = {
  listScreen: $("list-screen"),
  scanScreen: $("scan-screen"),
  shareBtn: $("share-btn"),
  newPalletBtn: $("new-pallet-btn"),
  installHint: $("install-hint"),
  installHintClose: $("install-hint-close"),
  totalCount: $("total-count"),
  totalSub: $("total-sub"),
  emptyState: $("empty-state"),
  listTools: $("list-tools"),
  search: $("search"),
  sortBtn: $("sort-btn"),
  filterInfo: $("filter-info"),
  list: $("package-list"),
  startBtn: $("start-btn"),
  video: $("video"),
  scanCount: $("scan-count"),
  torchBtn: $("torch-btn"),
  status: $("status"),
  recent: $("recent"),
  recentList: $("recent-list"),
  finishBtn: $("finish-btn"),
  dialog: $("confirm-dialog"),
  confirmTitle: $("confirm-title"),
  confirmText: $("confirm-text"),
  confirmOk: $("confirm-ok"),
  toast: $("toast"),
};

const IDLE_TEXT = "Scanning… point the camera at the package labels";
const HINT_KEY = "palletScanner.hideInstallHint";
const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone =
  navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;

const store = new PalletStore();
const feedback = new Feedback();

let query = "";
let sortByCode = false;
let scanning = false;
let scanner = null;
let eventSeq = 0;
let statusTimer = 0;
let toastTimer = 0;
let wakeLock = null;

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2500);
}

function confirmDialog(title, text, okLabel) {
  const dlg = els.dialog;
  if (typeof dlg.showModal !== "function") {
    return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  }
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  els.confirmOk.textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
  });
}

// ---------- pallet list ----------

function renderList() {
  const packages = store.packages;
  const hasItems = packages.length > 0;

  els.totalCount.textContent = String(packages.length);
  els.totalSub.textContent = hasItems
    ? `First scan ${formatTime(packages[0].scannedAt)} · last ${formatTime(packages[packages.length - 1].scannedAt)}`
    : "";
  els.shareBtn.hidden = !hasItems;
  els.newPalletBtn.hidden = !hasItems;
  els.emptyState.hidden = hasItems;
  els.listTools.hidden = !hasItems;
  els.startBtn.textContent = hasItems ? "CONTINUE SCANNING" : "START SCANNING";

  const q = query.trim().toLowerCase();
  let rows = packages.map((p, i) => ({ number: i + 1, item: p, label: displayCode(p.code) }));
  if (q) rows = rows.filter((r) => r.label.toLowerCase().includes(q));
  if (sortByCode) rows.sort((a, b) => (a.item.code < b.item.code ? -1 : a.item.code > b.item.code ? 1 : 0));

  els.filterInfo.hidden = !(hasItems && q);
  els.filterInfo.textContent = `Showing ${rows.length} of ${packages.length}`;

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const li = el("li", "pkg");
    const body = el("div", "body");
    body.append(el("div", "code", row.label), el("div", "time", formatTime(row.item.scannedAt)));
    const remove = el("button", "icon-btn remove", "✕");
    remove.type = "button";
    remove.dataset.code = row.item.code;
    remove.setAttribute("aria-label", `Remove ${row.label}`);
    li.append(el("span", "num", `${row.number}.`), body, remove);
    fragment.append(li);
  }
  els.list.replaceChildren(fragment);
}

els.list.addEventListener("click", async (event) => {
  const button = event.target.closest("button.remove");
  if (!button) return;
  const code = button.dataset.code;
  const number = store.packages.findIndex((p) => p.code === code) + 1;
  const ok = await confirmDialog("Remove package?", `Remove #${number} ${displayCode(code)} from this pallet?`, "Remove");
  if (ok) store.remove(code);
});

els.search.addEventListener("input", () => {
  query = els.search.value;
  renderList();
});

els.sortBtn.addEventListener("click", () => {
  sortByCode = !sortByCode;
  els.sortBtn.setAttribute("aria-pressed", String(sortByCode));
  renderList();
});

els.shareBtn.addEventListener("click", async () => {
  const packages = store.packages;
  const text = buildReport(packages);
  if (navigator.share) {
    try {
      await navigator.share({ title: `Pallet scan - ${packages.length} packages`, text });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("List copied to clipboard");
  } catch {
    toast("Sharing is not available in this browser");
  }
});

els.newPalletBtn.addEventListener("click", async () => {
  const count = store.packages.length;
  const ok = await confirmDialog(
    "Start a new pallet?",
    `This clears all ${count} scanned packages. Share the list first if you need to keep it.`,
    "Clear list",
  );
  if (!ok) return;
  store.clear();
  query = "";
  els.search.value = "";
});

// ---------- scanning ----------

function renderScan() {
  const packages = store.packages;
  els.scanCount.textContent = String(packages.length);
  els.recent.hidden = packages.length === 0;
  const items = [];
  for (let i = packages.length - 1; i >= Math.max(0, packages.length - 4); i--) {
    const li = el("li");
    li.append(el("span", null, `${i + 1}.`), el("span", null, displayCode(packages[i].code)));
    items.push(li);
  }
  els.recentList.replaceChildren(...items);
}

function setStatus(text, kind = "") {
  els.status.className = `panel status ${kind}`.trim();
  els.status.textContent = text;
}

function showScanEvent(code, added) {
  const id = ++eventSeq;
  els.status.className = `panel status ${added ? "added" : "duplicate"}`;
  els.status.replaceChildren(
    el("div", "status-title", added ? "✓ ADDED" : "ALREADY SCANNED"),
    el("div", "status-code", displayCode(code)),
  );
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (id === eventSeq && scanning && scanner) setStatus(IDLE_TEXT);
  }, 2500);
}

function handleCode(code) {
  if (!scanning) return;
  const added = store.add(code);
  feedback.play(added);
  showScanEvent(code, added);
}

function cameraErrorText(err) {
  if (err instanceof CameraError) {
    switch (err.kind) {
      case "denied":
        return isIOS
          ? "Camera access is blocked. Allow it in Settings → Apps → Safari → Camera (older iPhones: Settings → Safari → Camera), then tap FINISH and START again."
          : "Camera access is blocked. Allow the camera for this site in the browser settings, then tap FINISH and START again.";
      case "missing":
        return "No camera was found on this device.";
      case "busy":
        return "The camera is being used by another app. Close it, then tap FINISH and START again.";
      case "insecure":
        return err.message;
      default:
        return `Camera could not start: ${err.message}`;
    }
  }
  return `Scanner could not start: ${err?.message || err}`;
}

function setTorchUi(on) {
  els.torchBtn.textContent = on ? "Light ON" : "Light OFF";
  els.torchBtn.setAttribute("aria-pressed", String(on));
}

async function startCamera() {
  const current = new CameraScanner(els.video, { onCode: handleCode });
  scanner = current;
  try {
    await current.start();
    if (!scanning || scanner !== current) {
      current.stop(); // FINISH was tapped while the camera was starting
      return;
    }
    els.torchBtn.hidden = !current.hasTorch;
    setTorchUi(false);
    setStatus(IDLE_TEXT);
  } catch (err) {
    current.stop();
    if (scanner === current) scanner = null;
    if (scanning) setStatus(cameraErrorText(err), "error");
  }
}

function stopCamera() {
  scanner?.stop();
  scanner = null;
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && scanning && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch {
    /* not available; the screen may dim during long scans */
  }
}

function releaseWakeLock() {
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

async function startScanning() {
  if (scanning) return;
  feedback.unlock(); // must happen inside the tap
  scanning = true;
  els.listScreen.hidden = true;
  els.scanScreen.hidden = false;
  els.torchBtn.hidden = true;
  setStatus("Starting camera…");
  renderScan();
  history.pushState({ scanning: true }, "");
  requestWakeLock();
  await startCamera();
}

function finishScanning({ fromHistory = false } = {}) {
  if (!scanning) return;
  scanning = false;
  clearTimeout(statusTimer);
  stopCamera();
  releaseWakeLock();
  els.scanScreen.hidden = true;
  els.listScreen.hidden = false;
  renderList();
  if (!fromHistory && history.state?.scanning) history.back();
}

els.startBtn.addEventListener("click", startScanning);
els.finishBtn.addEventListener("click", () => finishScanning());
window.addEventListener("popstate", () => finishScanning({ fromHistory: true }));

els.torchBtn.addEventListener("click", async () => {
  if (!scanner) return;
  if (await scanner.setTorch(!scanner.torchOn)) setTorchUi(scanner.torchOn);
});

// The phone stops the camera when the app goes to the background; restart it on return.
document.addEventListener("visibilitychange", () => {
  if (!scanning) return;
  if (document.visibilityState === "hidden") {
    stopCamera();
  } else {
    setStatus("Starting camera…");
    startCamera();
    requestWakeLock();
  }
});

// ---------- startup ----------

store.subscribe(() => (scanning ? renderScan() : renderList()));
renderList();

let hintHidden = false;
try {
  hintHidden = localStorage.getItem(HINT_KEY) === "1";
} catch {
  /* storage unavailable */
}
els.installHint.hidden = !(isIOS && !isStandalone && !hintHidden);
els.installHintClose.addEventListener("click", () => {
  els.installHint.hidden = true;
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    /* storage unavailable */
  }
});

window.addEventListener("load", () => {
  prepareDecoder().catch((err) => console.warn("Barcode reader preload failed", err));
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Offline mode unavailable", err));
  }
});
