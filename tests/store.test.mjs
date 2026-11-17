// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { PalletStore } from "../js/store.js";
import { buildReport } from "../js/format.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }
  setItem(key, value) {
    this.map.set(key, String(value));
  }
}

test("same code is counted once", () => {
  const store = new PalletStore(new MemoryStorage());
  assert.equal(store.add("A"), true);
  assert.equal(store.add("A"), false);
  assert.equal(store.add("B"), true);
  assert.deepEqual(store.packages.map((p) => p.code), ["A", "B"]);
});

test("list survives a restart", () => {
  const storage = new MemoryStorage();
  const store = new PalletStore(storage);
  store.add("A");
  store.add("B");
  store.add("C");
  store.remove("B");
  const reopened = new PalletStore(storage);
  assert.deepEqual(reopened.packages.map((p) => p.code), ["A", "C"]);
  assert.equal(reopened.add("A"), false);
});

test("clear empties the saved list", () => {
  const storage = new MemoryStorage();
  const store = new PalletStore(storage);
  store.add("A");
  store.clear();
  assert.equal(new PalletStore(storage).packages.length, 0);
});

test("corrupt saved data starts an empty pallet", () => {
  const storage = new MemoryStorage();
  storage.setItem("palletScanner.currentPallet", "{not json");
  assert.equal(new PalletStore(storage).packages.length, 0);
});

test("subscribers are told about every change", () => {
  const store = new PalletStore(new MemoryStorage());
  let calls = 0;
  store.subscribe(() => calls++);
  store.add("A");
  store.add("A"); // duplicate: no change
  store.remove("A");
  store.clear();
  assert.equal(calls, 3);
});

test("report lists total and codes in scan order", () => {
  const lines = buildReport([
    { code: "XYZ", scannedAt: 0 },
    { code: "ABC\u001d01", scannedAt: 0 },
  ]).split("\n");
  assert.equal(lines[1], "Total packages: 2");
  assert.equal(lines[3], "1. XYZ");
  assert.equal(lines[4], "2. ABC<GS>01");
});
