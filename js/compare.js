/**
 * Comparing the scanned packages with the printed list from the system.
 *
 * The printed list is read from a photo (OCR) or typed, so the comparison tolerates:
 *  - formatting differences: spaces, dashes, brackets, and a code printed without a prefix
 *    the barcode has (e.g. the GS1 "00" in front of an SSCC)  -> still a match
 *  - typical OCR misreads (O/0, I/1, S/5, B/8, ...)            -> still a match
 *  - one wrong/missing character                                -> "check": shown side by side
 * The same rules are implemented in the Android app (ListMatcher.kt).
 */

export const Level = Object.freeze({ NONE: 0, NEAR: 1, OCR: 2, FORMAT: 3, EXACT: 4 });

const MIN_CONTAIN_LENGTH = 8;
const MIN_NEAR_LENGTH = 6;
const OCR_FOLD = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };

/** Upper case, letters and digits only. */
export function normalizeCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Maps letters that OCR often confuses with digits onto those digits. */
export function ocrFold(normalized) {
  return normalized.replace(/[OQDILZSBG]/g, (c) => OCR_FOLD[c]);
}

function containsLong(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_CONTAIN_LENGTH && long.includes(short);
}

function withinOneEdit(a, b) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (la > lb) i++;
    else if (lb > la) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/** How well two normalized codes match. */
export function matchLevel(a, b) {
  if (!a || !b) return Level.NONE;
  if (a === b) return Level.EXACT;
  if (containsLong(a, b)) return Level.FORMAT;
  const fa = ocrFold(a);
  const fb = ocrFold(b);
  if (fa === fb || containsLong(fa, fb)) return Level.OCR;
  if (Math.min(a.length, b.length) >= MIN_NEAR_LENGTH && withinOneEdit(fa, fb)) return Level.NEAR;
  return Level.NONE;
}

/** True if the scanned code is on the printed list (format and OCR differences allowed). */
export function isOnList(scannedCode, expectedCodes) {
  const n = normalizeCode(scannedCode);
  return expectedCodes.some((e) => matchLevel(normalizeCode(e), n) >= Level.OCR);
}

/**
 * Pairs every printed-list entry with at most one scanned code (best matches first).
 * @returns {{ matched: {expected: string, scanned: string, level: number}[],
 *             check: {expected: string, scanned: string}[],
 *             missing: string[], extra: string[], allGood: boolean }}
 */
export function comparePallet(expectedCodes, scannedCodes) {
  const expected = expectedCodes.map((raw) => ({ raw, n: normalizeCode(raw), pair: null }));
  const scanned = scannedCodes.map((raw) => ({ raw, n: normalizeCode(raw), taken: false }));

  const byNorm = new Map();
  for (const s of scanned) {
    if (!byNorm.has(s.n)) byNorm.set(s.n, []);
    byNorm.get(s.n).push(s);
  }
  for (const e of expected) {
    const s = byNorm.get(e.n)?.find((x) => !x.taken);
    if (s) {
      s.taken = true;
      e.pair = { s, level: Level.EXACT };
    }
  }
  for (const level of [Level.FORMAT, Level.OCR, Level.NEAR]) {
    for (const e of expected) {
      if (e.pair) continue;
      for (const s of scanned) {
        if (s.taken) continue;
        const found = matchLevel(e.n, s.n);
        if (found >= level) {
          s.taken = true;
          e.pair = { s, level: found };
          break;
        }
      }
    }
  }

  const matched = [];
  const check = [];
  const missing = [];
  for (const e of expected) {
    if (!e.pair) missing.push(e.raw);
    else if (e.pair.level === Level.NEAR) check.push({ expected: e.raw, scanned: e.pair.s.raw });
    else matched.push({ expected: e.raw, scanned: e.pair.s.raw, level: e.pair.level });
  }
  const extra = scanned.filter((s) => !s.taken).map((s) => s.raw);
  return {
    matched,
    check,
    missing,
    extra,
    allGood: expected.length > 0 && missing.length === 0 && extra.length === 0 && check.length === 0,
  };
}

/**
 * Package labels start with 0000, or with one digit 1-9 followed by 0000 (e.g. 0000123456, 30000123456).
 * Barcodes and printed numbers that don't look like this are ignored.
 */
export const PACKAGE_NUMBER = /^[1-9]?0000/;
const MIN_LIST_NUMBER_LENGTH = 8;

export function isPackageNumber(code) {
  return PACKAGE_NUMBER.test(normalizeCode(code));
}

/**
 * Package numbers among the words read from the printed list (live camera OCR).
 * Typical misreads are undone for all-digit numbers (O->0, I->1, S->5, ...), so "OOOO1234567" is read
 * as 00001234567. Words that don't start like a package number (dates, order numbers, quantities) are skipped.
 */
export function extractPackageNumbers(words) {
  const tokens = Array.isArray(words) ? words : String(words).split(/\s+/);
  const out = [];
  const seen = new Set();
  for (const word of tokens) {
    const n = normalizeCode(word);
    if (n.length < MIN_LIST_NUMBER_LENGTH) continue;
    const folded = ocrFold(n);
    const value = /^\d+$/.test(folded) ? folded : n;
    if (!PACKAGE_NUMBER.test(folded) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Splits typed or pasted text into codes (one per line, or separated by spaces, commas, semicolons). */
export function parseTypedCodes(text) {
  return String(text)
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => normalizeCode(t).length >= 3);
}
