import { normalizeCode } from "./compare.js";

const STORAGE_KEY = "palletScanner.currentPallet";

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The current pallet: the scanned packages (scan order, each code once) and the printed list
 * from the system (numbers read from a photo or typed in).
 * Saved to the phone's storage after every change, so closing the app doesn't lose anything.
 */
export class PalletStore {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.listeners = new Set();
    this.packages = [];
    this.codes = new Set();
    this.expected = [];

    const saved = this.#load();
    for (const item of saved.packages) {
      if (typeof item?.code !== "string" || this.codes.has(item.code)) continue;
      this.codes.add(item.code);
      this.packages.push({ code: item.code, scannedAt: Number(item.scannedAt) || Date.now() });
    }
    const seen = new Set();
    for (const item of saved.expected) {
      const n = normalizeCode(item?.code);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      this.expected.push({ code: String(item.code), addedAt: Number(item.addedAt) || Date.now() });
    }
  }

  get expectedCodes() {
    return this.expected.map((e) => e.code);
  }

  /** Adds a scanned package. Returns false if it was already on the pallet list. */
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

  /** Adds numbers to the printed list, skipping ones already on it. Returns how many were added. */
  addExpected(codes, now = Date.now()) {
    const have = new Set(this.expected.map((e) => normalizeCode(e.code)));
    let added = 0;
    for (const raw of codes) {
      const code = String(raw).trim();
      const n = normalizeCode(code);
      if (!n || have.has(n)) continue;
      have.add(n);
      this.expected.push({ code, addedAt: now });
      added++;
    }
    if (added) this.#commit();
    return added;
  }

  /** Corrects a printed-list entry (e.g. a misread digit). Returns false if the new value is empty or a duplicate. */
  updateExpected(oldCode, newCode) {
    const code = String(newCode).trim();
    const n = normalizeCode(code);
    const index = this.expected.findIndex((e) => e.code === oldCode);
    if (index < 0 || !n) return false;
    if (this.expected.some((e, i) => i !== index && normalizeCode(e.code) === n)) return false;
    this.expected[index] = { ...this.expected[index], code };
    this.#commit();
    return true;
  }

  removeExpected(code) {
    const before = this.expected.length;
    this.expected = this.expected.filter((e) => e.code !== code);
    if (this.expected.length !== before) this.#commit();
  }

  clearExpected() {
    if (!this.expected.length) return;
    this.expected = [];
    this.#commit();
  }

  /** New pallet: clears the scanned packages and the printed list. */
  clear() {
    this.codes.clear();
    this.packages = [];
    this.expected = [];
    this.#commit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #commit() {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, packages: this.packages, expected: this.expected }),
      );
    } catch (err) {
      console.error("Could not save pallet", err);
    }
    for (const listener of this.listeners) listener();
  }

  #load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return { packages: [], expected: [] };
      const parsed = JSON.parse(raw);
      return {
        packages: Array.isArray(parsed?.packages) ? parsed.packages : [],
        expected: Array.isArray(parsed?.expected) ? parsed.expected : [],
      };
    } catch (err) {
      console.warn("Could not read saved pallet, starting empty", err);
      return { packages: [], expected: [] };
    }
  }
}
