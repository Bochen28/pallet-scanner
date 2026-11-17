// Run with: node --test
import test from "node:test";
import assert from "node:assert/strict";
import {
  Level,
  comparePallet,
  extractCandidates,
  isOnList,
  matchLevel,
  normalizeCode,
  parseTypedCodes,
} from "../js/compare.js";

test("normalize keeps letters and digits only", () => {
  assert.equal(normalizeCode(" (00) 3401-2345 "), "0034012345");
  assert.equal(normalizeCode("pkg-0001"), "PKG0001");
});

test("match levels", () => {
  assert.equal(matchLevel("340123450000000018", "340123450000000018"), Level.EXACT);
  // printed without the GS1 "00" prefix the barcode has
  assert.equal(matchLevel("340123450000000018", "00340123450000000018"), Level.FORMAT);
  // OCR read O for 0 and S for 5
  assert.equal(matchLevel("34O1234SOOOOOOOO18", "340123450000000018"), Level.OCR);
  // one character really different -> needs checking
  assert.equal(matchLevel("340123450000000019", "340123450000000018"), Level.NEAR);
  // sequential SSCCs differ in serial and check digit -> no match at all
  assert.equal(matchLevel("340123450000000025", "340123450000000018"), Level.NONE);
  // short codes are never matched by containment
  assert.equal(matchLevel("1234", "991234"), Level.NONE);
});

test("everything matches -> all good", () => {
  const r = comparePallet(["PKG-0001", "pkg 0002", "PKG0003"], ["PKG-0003", "PKG-0001", "PKG-0002"]);
  assert.equal(r.matched.length, 3);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.extra, []);
  assert.equal(r.allGood, true);
});

test("missing, extra and check are reported", () => {
  const expected = ["340123450000000018", "340123450000000025", "34012345000000003Z", "340123450000000049"];
  const scanned = ["00340123450000000018", "340123450000000032", "340123450000000048", "999999999999999999"];
  const r = comparePallet(expected, scanned);
  assert.deepEqual(
    r.matched.map((m) => [m.expected, m.scanned]),
    [
      ["340123450000000018", "00340123450000000018"],
      ["34012345000000003Z", "340123450000000032"],
    ],
  );
  assert.deepEqual(r.check, [{ expected: "340123450000000049", scanned: "340123450000000048" }]);
  assert.deepEqual(r.missing, ["340123450000000025"]);
  assert.deepEqual(r.extra, ["999999999999999999"]);
  assert.equal(r.allGood, false);
});

test("each scanned package is used for one list entry only", () => {
  const r = comparePallet(["ABC12345", "ABC12345X"], ["ABC12345"]);
  assert.equal(r.matched.length, 1);
  assert.equal(r.missing.length, 1);
});

test("empty printed list is never all good", () => {
  assert.equal(comparePallet([], ["A1234"]).allGood, false);
});

test("isOnList tolerates format and OCR differences but not real differences", () => {
  const list = ["340123450000000018", "PKG-0007"];
  assert.equal(isOnList("00340123450000000018", list), true);
  assert.equal(isOnList("PKG0007", list), true);
  assert.equal(isOnList("PKG-0008", list), false);
});

const PRINTOUT = `
DELIVERY NOTE 2026-11-17   Order 4711
No. Package number        Article   Qty  Weight
1   340123450000000018    A-100      12  14.5 kg
2   340123450000000025    A-100      12  14.5 kg
3   34O123450000000032    B-200       6  9.0 kg
Page 1/1   Phone +48 123 456 789
`;

test("extracts and pre-selects the package-number column", () => {
  const c = extractCandidates(PRINTOUT);
  const selected = c.filter((x) => x.selected).map((x) => x.code);
  assert.deepEqual(selected, ["340123450000000018", "340123450000000025", "34O123450000000032"]);
  // other numbers are offered but not selected
  assert.ok(c.some((x) => x.normalized === "20261117" && !x.selected));
});

test("pre-selection follows the format of already scanned packages", () => {
  const c = extractCandidates("PKG-0001 PKG-0002 PKG-0003 ORDER 47110815 12345", { scanned: ["PKG-0002"] });
  assert.deepEqual(
    c.filter((x) => x.selected).map((x) => x.code),
    ["PKG-0001", "PKG-0002", "PKG-0003"],
  );
});

test("numbers already on the list are marked and not selected again", () => {
  const c = extractCandidates(PRINTOUT, { existing: ["340123450000000018"] });
  const first = c.find((x) => x.normalized === "340123450000000018");
  assert.equal(first.alreadyOnList, true);
  assert.equal(first.selected, false);
});

test("typed codes are split on lines, spaces, commas and semicolons", () => {
  assert.deepEqual(parseTypedCodes("PKG-1001\n pkg-1002, PKG-1003;PKG-1004  x"), [
    "PKG-1001",
    "PKG-1002",
    "PKG-1003",
    "PKG-1004",
  ]);
});
