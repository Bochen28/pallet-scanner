const pad = (n) => String(n).padStart(2, "0");

/** Makes control characters inside a code (e.g. the GS1 group separator) visible. */
export function displayCode(raw) {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0);
    if (c === 0x1d) out += "<GS>";
    else if (c < 0x20 || c === 0x7f) out += `<${c.toString(16).toUpperCase().padStart(2, "0")}>`;
    else out += ch;
  }
  return out;
}

export function formatTime(epochMillis) {
  const d = new Date(epochMillis);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDateTime(epochMillis) {
  const d = new Date(epochMillis);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Plain-text report: header with the total, the comparison with the printed list (if there is one),
 * then one numbered code per line in scan order.
 */
export function buildReport(packages, now = Date.now(), comparison = null, expectedCount = 0) {
  const lines = [`Pallet scan ${formatDateTime(now)}`, `Total packages: ${packages.length}`];
  if (comparison) {
    if (comparison.allGood) {
      lines.push(`Printed list: ${expectedCount} numbers - ALL MATCH`);
    } else {
      lines.push(
        `Printed list: ${expectedCount} numbers - matched ${comparison.matched.length}, ` +
          `missing ${comparison.missing.length}, not on list ${comparison.extra.length}, ` +
          `to check ${comparison.check.length}`,
      );
      if (comparison.missing.length) {
        lines.push("", `MISSING FROM PALLET (${comparison.missing.length}):`);
        comparison.missing.forEach((c) => lines.push(`- ${displayCode(c)}`));
      }
      if (comparison.extra.length) {
        lines.push("", `SCANNED BUT NOT ON PRINTED LIST (${comparison.extra.length}):`);
        comparison.extra.forEach((c) => lines.push(`- ${displayCode(c)}`));
      }
      if (comparison.check.length) {
        lines.push("", `CHECK - ONE CHARACTER DIFFERENT (${comparison.check.length}):`);
        comparison.check.forEach((c) => lines.push(`- list ${displayCode(c.expected)} / scanned ${displayCode(c.scanned)}`));
      }
    }
  }
  lines.push("", "SCANNED PACKAGES:");
  packages.forEach((p, i) => lines.push(`${i + 1}. ${displayCode(p.code)}`));
  return lines.join("\n") + "\n";
}
