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

/** Length + digits-only/alphanumeric, after undoing OCR misreads (so "34O1..." counts as digits). */
function shapeOf(normalized) {
  const folded = ocrFold(normalized);
  return `${folded.length}:${/^\d+$/.test(folded) ? "D" : "A"}`;
}

/**
 * Picks the package-number candidates out of OCR text from a photo of the printed list.
 * Every token with 5+ letters/digits (at least 3 digits) is a candidate; the ones that look like
 * package numbers are pre-selected:
 *  - candidates matching an already scanned package, plus everything with the same length/format;
 *  - otherwise the most common length/format on the page (the package-number column).
 * @returns {{ code: string, normalized: string, selected: boolean, alreadyOnList: boolean }[]}
 */
export function extractCandidates(text, { scanned = [], existing = [] } = {}) {
  const seen = new Set();
  const candidates = [];
  for (const line of String(text).split(/\r?\n/)) {
    for (const token of line.split(/\s+/)) {
      const n = normalizeCode(token);
      if (n.length < 5 || (n.match(/\d/g) || []).length < 3 || seen.has(n)) continue;
      seen.add(n);
      const code = token.toUpperCase().replace(/^[^A-Z0-9(]+|[^A-Z0-9)]+$/g, "");
      candidates.push({ code, normalized: n, selected: false, alreadyOnList: false });
    }
  }

  const scannedN = scanned.map(normalizeCode).filter(Boolean);
  const existingN = existing.map(normalizeCode);
  const matchesScan = (n) => scannedN.some((s) => matchLevel(n, s) >= Level.NEAR);

  let preferred = new Set(candidates.filter((c) => scannedN.some((s) => matchLevel(c.normalized, s) >= Level.OCR)).map((c) => shapeOf(c.normalized)));
  if (preferred.size === 0) {
    const counts = new Map();
    for (const c of candidates) counts.set(shapeOf(c.normalized), (counts.get(shapeOf(c.normalized)) || 0) + 1);
    let best = null;
    let bestCount = 1;
    for (const [shape, count] of counts) {
      if (count > bestCount) {
        best = shape;
        bestCount = count;
      }
    }
    preferred = best ? new Set([best]) : null;
  }

  for (const c of candidates) {
    c.alreadyOnList = existingN.some((e) => matchLevel(e, c.normalized) >= Level.OCR);
    const looksRight = preferred ? preferred.has(shapeOf(c.normalized)) : c.normalized.length >= 8;
    c.selected = !c.alreadyOnList && (looksRight || matchesScan(c.normalized));
  }
  return candidates;
}

/** Splits typed or pasted text into codes (one per line, or separated by spaces, commas, semicolons). */
export function parseTypedCodes(text) {
  return String(text)
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => normalizeCode(t).length >= 3);
}
