const STORAGE_KEY = "palletScanner.currentPallet";

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The packages scanned for the current pallet, in scan order. Each code is stored once.
 * Saved to the phone's storage after every change, so closing the app doesn't lose a pallet.
 */
export class PalletStore {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.listeners = new Set();
    this.packages = [];
    this.codes = new Set();
    for (const item of this.#load()) {
      if (typeof item?.code !== "string" || this.codes.has(item.code)) continue;
      this.codes.add(item.code);
      this.packages.push({ code: item.code, scannedAt: Number(item.scannedAt) || Date.now() });
    }
  }

  /** Adds `code` to the pallet. Returns false if it was already on the list. */
  add(code, now = Date.now()) {
    if (this.codes.has(code)) return false;
    this.codes.add(code);
    this.packages.push({ code, scannedAt: now });
    this.#commit();
    return true;
  }

  remove(code) {
    if (!this.codes.delete(code)) return;
    this.packages = this.packages.filter((p) => p.code !== code);
    this.#commit();
  }

  clear() {
    this.codes.clear();
    this.packages = [];
    this.#commit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #commit() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, packages: this.packages }));
    } catch (err) {
      console.error("Could not save pallet", err);
    }
    for (const listener of this.listeners) listener(this.packages);
  }

  #load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.packages) ? parsed.packages : [];
    } catch (err) {
      console.warn("Could not read saved pallet, starting empty", err);
      return [];
    }
  }
}
