// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import { ScanFilter } from "../js/scan-filter.js";

const newFilter = () => new ScanFilter({ confirmFrames: 2, confirmWindow: 1.0, reappearAfter: 2.5 });

test("code is reported after two frames", () => {
  const f = newFilter();
  assert.deepEqual(f.onFrame(["A"], 0), []);
  assert.deepEqual(f.onFrame(["A"], 0.05), ["A"]);
});

test("code staying in view is reported only once", () => {
  const f = newFilter();
  f.onFrame(["A"], 0);
  f.onFrame(["A"], 0.05);
  for (let step = 2; step <= 100; step++) assert.deepEqual(f.onFrame(["A"], step * 0.05), [], `step ${step}`);
});

test("short drop-outs do not re-report", () => {
  const f = newFilter();
  f.onFrame(["A"], 0);
  f.onFrame(["A"], 0.05);
  assert.deepEqual(f.onFrame([], 1.0), []);
  assert.deepEqual(f.onFrame(["A"], 2.0), []);
  assert.deepEqual(f.onFrame(["A"], 2.05), []);
});

test("code coming back after leaving view is reported again", () => {
  const f = newFilter();
  f.onFrame(["A"], 0);
  f.onFrame(["A"], 0.05);
  f.onFrame([], 3.0);
  assert.deepEqual(f.onFrame(["A"], 3.1), []);
  assert.deepEqual(f.onFrame(["A"], 3.15), ["A"]);
});

test("single stray read is never reported", () => {
  const f = newFilter();
  assert.deepEqual(f.onFrame(["GARBAGE"], 0), []);
  assert.deepEqual(f.onFrame([], 2.0), []);
  assert.deepEqual(f.onFrame(["GARBAGE"], 2.05), []);
});

test("several codes in one frame are all reported", () => {
  const f = newFilter();
  f.onFrame(["A", "B", "C"], 0);
  assert.deepEqual(new Set(f.onFrame(["C", "B", "A"], 0.04)), new Set(["A", "B", "C"]));
});

test("duplicate detections within a frame count once", () => {
  const f = newFilter();
  assert.deepEqual(f.onFrame(["A", "A"], 0), []);
  assert.deepEqual(f.onFrame(["A"], 0.04), ["A"]);
});
