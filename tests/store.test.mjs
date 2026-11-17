// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { PalletStore } from "../js/store.js";
import { buildReport } from "../js/format.js";
import { comparePallet } from "../js/compare.js";

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
  assert.equal(lines[3], "SCANNED PACKAGES:");
  assert.equal(lines[4], "1. XYZ");
  assert.equal(lines[5], "2. ABC<GS>01");
});

test("report includes the comparison with the printed list", () => {
  const packages = [{ code: "PKG-1", scannedAt: 0 }, { code: "PKG-9", scannedAt: 0 }];
  const comparison = comparePallet(["PKG-1", "PKG-2"], packages.map((p) => p.code));
  const text = buildReport(packages, 0, comparison, 2);
  assert.match(text, /Printed list: 2 numbers - matched 1, missing 1, not on list 1, to check 0/);
  assert.match(text, /MISSING FROM PALLET \(1\):\n- PKG-2/);
  assert.match(text, /SCANNED BUT NOT ON PRINTED LIST \(1\):\n- PKG-9/);
  const allGood = buildReport([{ code: "PKG-1", scannedAt: 0 }], 0, comparePallet(["PKG1"], ["PKG-1"]), 1);
  assert.match(allGood, /Printed list: 1 numbers - ALL MATCH/);
});

test("printed list: duplicates skipped, edits, removal, saved with the pallet", () => {
  const storage = new MemoryStorage();
  const store = new PalletStore(storage);
  assert.equal(store.addExpected(["PKG-1", "pkg 1", "PKG-2", " "]), 2);
  assert.equal(store.addExpected(["PKG-2", "PKG-3"]), 1);
  assert.equal(store.updateExpected("PKG-3", "PKG-2"), false); // would duplicate
  assert.equal(store.updateExpected("PKG-3", "PKG-4"), true);
  store.removeExpected("PKG-1");
  const reopened = new PalletStore(storage);
  assert.deepEqual(reopened.expectedCodes, ["PKG-2", "PKG-4"]);
  reopened.clear();
  assert.deepEqual(new PalletStore(storage).expectedCodes, []);
});

test("pallets saved by the first version still load", () => {
  const storage = new MemoryStorage();
  storage.setItem("palletScanner.currentPallet", JSON.stringify({ version: 1, packages: [{ code: "A", scannedAt: 5 }] }));
  const store = new PalletStore(storage);
  assert.deepEqual(store.packages, [{ code: "A", scannedAt: 5 }]);
  assert.deepEqual(store.expectedCodes, []);
});
