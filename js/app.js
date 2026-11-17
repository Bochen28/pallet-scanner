import { PalletStore } from "./store.js";
import { buildReport, displayCode, formatTime } from "./format.js";
import { CameraError, CameraScanner, prepareDecoder } from "./scanner.js";
import { Feedback } from "./feedback.js";
import { Level, comparePallet, extractCandidates, isOnList, parseTypedCodes } from "./compare.js";
import { readTextFromImage } from "./ocr.js";

const $ = (id) => document.getElementById(id);
const els = {
  listScreen: $("list-screen"),
  scanScreen: $("scan-screen"),
  compareScreen: $("compare-screen"),
  reviewScreen: $("review-screen"),
  shareBtn: $("share-btn"),
  newPalletBtn: $("new-pallet-btn"),
  installHint: $("install-hint"),
  installHintClose: $("install-hint-close"),
  totalCount: $("total-count"),
  totalSub: $("total-sub"),
  printedSub: $("printed-sub"),
  printedSummary: $("printed-summary"),
  compareBtn: $("compare-btn"),
  printedPhotoBtn: $("printed-photo-btn"),
  printedTypeBtn: $("printed-type-btn"),
  emptyState: $("empty-state"),
  listTools: $("list-tools"),
  search: $("search"),
  sortBtn: $("sort-btn"),
  filterInfo: $("filter-info"),
  list: $("package-list"),
  startBtn: $("start-btn"),
  compareBack: $("compare-back"),
  compareClear: $("compare-clear"),
  compareMain: $("compare-main"),
  comparePhotoBtn: $("compare-photo-btn"),
  compareTypeBtn: $("compare-type-btn"),
  reviewCancel: $("review-cancel"),
  reviewToggle: $("review-toggle"),
  reviewInfo: $("review-info"),
  reviewList: $("review-list"),
  reviewAdd: $("review-add"),
  video: $("video"),
  scanCount: $("scan-count"),
  scanOnList: $("scan-onlist"),
  torchBtn: $("torch-btn"),
  status: $("status"),
  recent: $("recent"),
  recentList: $("recent-list"),
  finishBtn: $("finish-btn"),
  busy: $("busy-overlay"),
  busyText: $("busy-text"),
  busyBar: $("busy-bar"),
  photoInput: $("photo-input"),
  confirmDialog: $("confirm-dialog"),
  confirmTitle: $("confirm-title"),
  confirmText: $("confirm-text"),
  confirmOk: $("confirm-ok"),
  inputDialog: $("input-dialog"),
  inputTitle: $("input-title"),
  inputText: $("input-text"),
  inputArea: $("input-area"),
  inputOk: $("input-ok"),
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

let screen = "list";
let query = "";
let sortByCode = false;
let scanning = false;
let scanner = null;
let eventSeq = 0;
let statusTimer = 0;
let toastTimer = 0;
let wakeLock = null;
let photoFrom = "list";
let reviewFrom = "list";
let reviewCandidates = [];

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2800);
}

function confirmDialog(title, text, okLabel) {
  const dlg = els.confirmDialog;
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

/** Text input dialog; resolves with the text, or null when cancelled. */
function inputDialog(title, text, value, okLabel, rows = 6) {
  const dlg = els.inputDialog;
  if (typeof dlg.showModal !== "function") {
    return Promise.resolve(window.prompt(`${title}\n\n${text}`, value));
  }
  els.inputTitle.textContent = title;
  els.inputText.textContent = text;
  els.inputArea.value = value;
  els.inputArea.rows = rows;
  els.inputOk.textContent = okLabel;
  dlg.returnValue = "";
  dlg.showModal();
  els.inputArea.focus();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok" ? els.inputArea.value : null), {
      once: true,
    });
  });
}

function scannedCodes() {
  return store.packages.map((p) => p.code);
}

function currentComparison() {
  return store.expected.length ? comparePallet(store.expectedCodes, scannedCodes()) : null;
}

// ---------- screens & back navigation ----------

const screens = {
  list: els.listScreen,
  scan: els.scanScreen,
  compare: els.compareScreen,
  review: els.reviewScreen,
};

function showScreen(name) {
  screen = name;
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  if (name === "list") renderList();
  else if (name === "compare") renderCompare();
  else if (name === "scan") renderScan();
  else if (name === "review") renderReview();
}

function openScreen(name) {
  history.pushState({ screen: name }, "");
  showScreen(name);
}

function closeScreen() {
  if (history.state?.screen) history.back();
  else showScreen("list");
}

// The phone's Back gesture closes the current screen (and stops scanning).
window.addEventListener("popstate", (event) => {
  if (scanning) stopScanningSession();
  const target = event.state?.screen;
  showScreen(target === "compare" ? "compare" : "list");
});

// ---------- pallet list ----------

function renderPrintedCard(comparison) {
  const count = store.expected.length;
  els.compareBtn.hidden = count === 0;
  els.printedPhotoBtn.textContent = count ? "📷 Add page" : "📷 Photo of list";
  els.printedSummary.hidden = count === 0;
  if (!count) {
    els.printedSub.textContent = "Compare the pallet with the list from your system.";
    els.printedSummary.replaceChildren();
    return;
  }
  els.printedSub.textContent = `${plural(count, "number")} on the printed list`;
  const badges = [];
  if (comparison.allGood) {
    badges.push(el("span", "badge b-green", `✓ All ${count} match`));
  } else {
    badges.push(el("span", "badge b-green", `✓ ${comparison.matched.length} matched`));
    if (comparison.missing.length) badges.push(el("span", "badge b-red", `✗ ${comparison.missing.length} missing`));
    if (comparison.extra.length) badges.push(el("span", "badge b-purple", `+ ${comparison.extra.length} not on list`));
    if (comparison.check.length) badges.push(el("span", "badge b-amber", `? ${comparison.check.length} to check`));
  }
  els.printedSummary.replaceChildren(...badges);
}

function renderList() {
  const packages = store.packages;
  const hasItems = packages.length > 0;
  const comparison = currentComparison();

  els.totalCount.textContent = String(packages.length);
  els.totalSub.textContent = hasItems
    ? `First scan ${formatTime(packages[0].scannedAt)} · last ${formatTime(packages[packages.length - 1].scannedAt)}`
    : "";
  els.shareBtn.hidden = !hasItems && !store.expected.length;
  els.newPalletBtn.hidden = !hasItems && !store.expected.length;
  els.emptyState.hidden = hasItems;
  els.listTools.hidden = !hasItems;
  els.startBtn.textContent = hasItems ? "CONTINUE SCANNING" : "START SCANNING";
  renderPrintedCard(comparison);

  const notOnList = new Set(comparison?.extra ?? []);
  const toCheck = new Set((comparison?.check ?? []).map((c) => c.scanned));

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
    const code = el("div", "code", row.label);
    if (notOnList.has(row.item.code)) code.append(el("span", "tag b-purple", "not on list"));
    else if (toCheck.has(row.item.code)) code.append(el("span", "tag b-amber", "check"));
    body.append(code, el("div", "time", formatTime(row.item.scannedAt)));
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
  const text = buildReport(packages, Date.now(), currentComparison(), store.expected.length);
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
  const parts = [];
  if (store.packages.length) parts.push(`all ${plural(store.packages.length, "scanned package")}`);
  if (store.expected.length) parts.push("the printed list");
  const ok = await confirmDialog(
    "Start a new pallet?",
    `This clears ${parts.join(" and ")}. Share the list first if you need to keep it.`,
    "Clear all",
  );
  if (!ok) return;
  store.clear();
  query = "";
  els.search.value = "";
});

els.compareBtn.addEventListener("click", () => openScreen("compare"));

// ---------- printed list: photo, review, typing ----------

function showBusy(text, fraction) {
  els.busyText.textContent = text;
  els.busyBar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  els.busy.hidden = false;
}

function pickPhoto(from) {
  photoFrom = from;
  els.photoInput.value = "";
  els.photoInput.click();
}

els.printedPhotoBtn.addEventListener("click", () => pickPhoto("list"));
els.comparePhotoBtn.addEventListener("click", () => pickPhoto("compare"));

els.photoInput.addEventListener("change", async () => {
  const file = els.photoInput.files?.[0];
  if (!file) return;
  showBusy("Opening the photo…", 0);
  try {
    const text = await readTextFromImage(file, (stage, fraction) => {
      if (stage === "reading") showBusy("Reading the numbers on the list…", fraction);
      else showBusy("Preparing the text reader (first time takes longer)…", fraction);
    });
    reviewCandidates = extractCandidates(text, { scanned: scannedCodes(), existing: store.expectedCodes });
    reviewFrom = photoFrom;
    openScreen("review");
  } catch (err) {
    console.error(err);
    await confirmDialog("Could not read the photo", String(err?.message || err), "OK");
  } finally {
    els.busy.hidden = true;
  }
});

function renderReview() {
  const total = reviewCandidates.length;
  const selectable = reviewCandidates.filter((c) => !c.alreadyOnList);
  const selected = reviewCandidates.filter((c) => c.selected).length;

  els.reviewInfo.textContent = total
    ? `Found ${plural(total, "number")}. Ticked numbers are added to the printed list: untick anything that isn't a package number, and tap ✎ to fix a misread character.`
    : "No package numbers were found on this photo. Take it again closer to the list, with the page flat and well lit, or type the numbers.";
  els.reviewToggle.hidden = selectable.length === 0;
  els.reviewToggle.textContent = selectable.length && selectable.every((c) => c.selected) ? "Select none" : "Select all";
  els.reviewAdd.textContent = selected ? `ADD ${selected} TO PRINTED LIST` : total ? "NOTHING SELECTED" : "BACK";
  els.reviewAdd.disabled = total > 0 && selected === 0;

  const rows = reviewCandidates.map((c, index) => {
    const li = el("li", `review-row${c.selected ? "" : " unselected"}`);
    const box = el("input");
    box.type = "checkbox";
    box.id = `cand-${index}`;
    box.checked = c.selected;
    box.disabled = c.alreadyOnList;
    box.dataset.index = String(index);
    const label = el("label");
    label.htmlFor = box.id;
    label.append(el("span", "code", c.code));
    if (c.alreadyOnList) label.append(el("span", "sub", "already on the printed list"));
    const edit = el("button", "icon-btn edit", "✎");
    edit.type = "button";
    edit.dataset.index = String(index);
    edit.setAttribute("aria-label", `Fix ${c.code}`);
    li.append(box, label, edit);
    return li;
  });
  els.reviewList.replaceChildren(...rows);
}

els.reviewList.addEventListener("change", (event) => {
  const box = event.target.closest("input[type=checkbox]");
  if (!box) return;
  reviewCandidates[Number(box.dataset.index)].selected = box.checked;
  renderReview();
});

els.reviewList.addEventListener("click", async (event) => {
  const button = event.target.closest("button.edit");
  if (!button) return;
  const candidate = reviewCandidates[Number(button.dataset.index)];
  const value = await inputDialog("Fix number", "Correct the number exactly as printed.", candidate.code, "Save", 2);
  if (value == null || !value.trim()) return;
  candidate.code = value.trim().toUpperCase();
  candidate.selected = !candidate.alreadyOnList;
  renderReview();
});

els.reviewToggle.addEventListener("click", () => {
  const selectable = reviewCandidates.filter((c) => !c.alreadyOnList);
  const selectAll = !selectable.every((c) => c.selected);
  for (const c of selectable) c.selected = selectAll;
  renderReview();
});

els.reviewCancel.addEventListener("click", () => closeScreen());

els.reviewAdd.addEventListener("click", () => {
  const codes = reviewCandidates.filter((c) => c.selected).map((c) => c.code);
  if (!codes.length) {
    closeScreen();
    return;
  }
  const added = store.addExpected(codes);
  toast(added ? `${plural(added, "number")} added to the printed list` : "Those numbers were already on the list");
  if (reviewFrom === "compare") {
    history.back(); // back to the comparison the photo was taken from
  } else {
    history.replaceState({ screen: "compare" }, "");
    showScreen("compare");
  }
});

async function typeNumbers() {
  const text = await inputDialog(
    "Type numbers",
    "Type or paste the package numbers from the printed list, one per line (spaces and commas also work).",
    "",
    "Add",
  );
  if (text == null) return;
  const codes = parseTypedCodes(text);
  if (!codes.length) return;
  const added = store.addExpected(codes);
  toast(added ? `${plural(added, "number")} added to the printed list` : "Those numbers were already on the list");
  if (screen === "list" && added) openScreen("compare");
}

els.printedTypeBtn.addEventListener("click", typeNumbers);
els.compareTypeBtn.addEventListener("click", typeNumbers);

// ---------- comparison ----------

function cmpRow(mark, markClass, code, sub, actions = []) {
  const li = el("li", "cmp-row");
  li.append(el("span", `mark ${markClass}`, mark));
  const body = el("div", "body");
  body.append(el("div", "code", displayCode(code)));
  if (sub) {
    const subEl = el("div", "sub");
    subEl.append(...sub);
    body.append(subEl);
  }
  li.append(body);
  for (const [action, symbol, label] of actions) {
    const b = el("button", "icon-btn", symbol);
    b.type = "button";
    b.dataset.action = action;
    b.dataset.code = code;
    b.setAttribute("aria-label", `${label} ${displayCode(code)}`);
    li.append(b);
  }
  return li;
}

function codeText(prefix, code) {
  return [document.createTextNode(prefix), el("code", null, displayCode(code))];
}

function section(title, colorClass, hint, rows) {
  const nodes = [el("h2", `section-title ${colorClass}`, title)];
  if (hint) nodes.push(el("p", "section-hint", hint));
  const list = el("ul", "cmp-list");
  list.append(...rows);
  nodes.push(list);
  return nodes;
}

function renderCompare() {
  const count = store.expected.length;
  els.compareClear.hidden = count === 0;
  els.comparePhotoBtn.textContent = count ? "📷 Add page" : "📷 Photo of list";
  if (!count) {
    const v = el("div", "verdict empty", "No printed list yet. Take a photo of the list (one photo per page) or type the numbers.");
    els.compareMain.replaceChildren(v);
    return;
  }
  const c = currentComparison();
  const verdict = el("div", `verdict ${c.allGood ? "good" : "bad"}`);
  verdict.append(
    document.createTextNode(c.allGood ? "✓ The pallet matches the printed list" : "The pallet does not match the printed list"),
    el("small", null, `${c.matched.length} of ${plural(count, "number")} on the list matched · ${plural(store.packages.length, "package")} scanned`),
  );
  const nodes = [verdict];
  const editActions = [["edit", "✎", "Fix"], ["remove", "✕", "Remove from list"]];

  if (c.missing.length) {
    nodes.push(
      ...section(
        `✗ Missing from pallet (${c.missing.length})`,
        "red",
        "On the printed list but not scanned. Find and scan these packages, or fix the number if it was misread.",
        c.missing.map((code) => cmpRow("✗", "red", code, null, editActions)),
      ),
    );
  }
  if (c.extra.length) {
    nodes.push(
      ...section(
        `+ Not on printed list (${c.extra.length})`,
        "purple",
        "Scanned on the pallet but not on the printed list.",
        c.extra.map((code) => cmpRow("+", "purple", code)),
      ),
    );
  }
  if (c.check.length) {
    nodes.push(
      ...section(
        `? Check (${c.check.length})`,
        "amber",
        "One character different: usually a misread on the photo. Compare with the label and fix the list number if needed.",
        c.check.map((p) => cmpRow("?", "amber", p.expected, codeText("scanned: ", p.scanned), editActions)),
      ),
    );
  }
  if (c.matched.length) {
    nodes.push(
      ...section(
        `✓ Matched (${c.matched.length})`,
        "green",
        null,
        c.matched.map((m) =>
          cmpRow("✓", "green", m.expected, m.level === Level.EXACT ? null : codeText("scanned as ", m.scanned)),
        ),
      ),
    );
  }
  els.compareMain.replaceChildren(...nodes);
}

els.compareMain.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const code = button.dataset.code;
  if (button.dataset.action === "remove") {
    const ok = await confirmDialog("Remove from printed list?", `Remove ${displayCode(code)} from the printed list?`, "Remove");
    if (ok) store.removeExpected(code);
  } else if (button.dataset.action === "edit") {
    const value = await inputDialog("Fix number", "Correct the number exactly as printed on the list.", code, "Save", 2);
    if (value == null || !value.trim() || value.trim() === code) return;
    if (!store.updateExpected(code, value.trim().toUpperCase())) toast("That number is already on the list");
  }
});

els.compareBack.addEventListener("click", () => closeScreen());

els.compareClear.addEventListener("click", async () => {
  const ok = await confirmDialog(
    "Clear the printed list?",
    `Removes all ${plural(store.expected.length, "number")} of the printed list. Scanned packages stay.`,
    "Clear list",
  );
  if (ok) store.clearExpected();
});

// ---------- scanning ----------

function renderScan() {
  const packages = store.packages;
  els.scanCount.textContent = String(packages.length);
  if (store.expected.length) {
    const c = currentComparison();
    let text = `On printed list: ${c.matched.length} of ${store.expected.length}`;
    if (c.extra.length) text += ` · ${c.extra.length} not on list`;
    els.scanOnList.textContent = text;
    els.scanOnList.hidden = false;
  } else {
    els.scanOnList.hidden = true;
  }
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

const EVENT_TITLES = {
  added: "✓ ADDED",
  addedListed: "✓ ADDED · ON PRINTED LIST",
  duplicate: "ALREADY SCANNED",
  notListed: "NOT ON PRINTED LIST · added to pallet",
};

function showScanEvent(code, kind) {
  const id = ++eventSeq;
  const cssClass = kind === "duplicate" ? "duplicate" : kind === "notListed" ? "notlisted" : "added";
  els.status.className = `panel status ${cssClass}`;
  els.status.replaceChildren(el("div", "status-title", EVENT_TITLES[kind]), el("div", "status-code", displayCode(code)));
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    if (id === eventSeq && scanning && scanner) setStatus(IDLE_TEXT);
  }, kind === "notListed" ? 4000 : 2500);
}

function handleCode(code) {
  if (!scanning) return;
  const added = store.add(code);
  let kind = added ? "added" : "duplicate";
  if (added && store.expected.length) kind = isOnList(code, store.expectedCodes) ? "addedListed" : "notListed";
  feedback.play(kind === "addedListed" ? "added" : kind);
  showScanEvent(code, kind);
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
  els.torchBtn.hidden = true;
  setStatus("Starting camera…");
  openScreen("scan");
  requestWakeLock();
  await startCamera();
}

function stopScanningSession() {
  if (!scanning) return;
  scanning = false;
  clearTimeout(statusTimer);
  stopCamera();
  releaseWakeLock();
}

function finishScanning() {
  if (!scanning) return;
  stopScanningSession();
  closeScreen();
}

els.startBtn.addEventListener("click", startScanning);
els.finishBtn.addEventListener("click", finishScanning);

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

store.subscribe(() => {
  if (screen === "scan") renderScan();
  else if (screen === "compare") renderCompare();
  else if (screen === "list") renderList();
});
history.replaceState(null, "");
showScreen("list");

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
    navigator.serviceWorker
      .register("sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => registration.active?.postMessage("cache-ocr"))
      .catch((err) => console.warn("Offline mode unavailable", err));
  }
});
