/**
 * Decode a raw byte buffer into a JS string regardless of where the file
 * came from. Order:
 *
 *   1. UTF-8 BOM   (EF BB BF) — German Excel UTF-8 export
 *   2. UTF-16 LE BOM (FF FE)  — Windows "Unicode" save
 *   3. UTF-16 BE BOM (FE FF)  — older mac / Java exporters
 *   4. UTF-8 strict — works for any modern, BOM-less UTF-8 file
 *   5. Windows-1252 fallback — old German Excel without BOM
 *
 * Strict UTF-8 with `fatal: true` is what lets us tell the difference
 * between a clean UTF-8 file and a windows-1252 file masquerading as one
 * — the strict decoder throws on a malformed byte sequence, which is the
 * signal to fall back.
 */
export function decodeBytes(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (bytes.length >= 3 &&
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 &&
      bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 &&
      bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Tolerant numeric parser for spreadsheet values.
 *
 * Accepts:
 *   "5"      → 5
 *   "5,5"    → 5.5  (German comma decimal)
 *   "5.5"    → 5.5  (US dot decimal)
 *   "1.234,5" → 1234.5  (German thousands + decimal)
 *   "1,234.5" → 1234.5  (US thousands + decimal)
 *   " 50 km "→ 50    (trims units / whitespace)
 *
 * Returns NaN on anything we can't make sense of, just like parseFloat.
 */
export function parseNumberLoose(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw == null) return NaN;
  let s = String(raw).trim();
  if (!s) return NaN;
  // Strip a leading apostrophe (Excel "force as text" marker) and trailing
  // unit text — just keep the leading numeric prefix.
  s = s.replace(/^'/, '');
  const m = s.match(/^[-+]?[\d.,]+/);
  if (!m) return NaN;
  let token = m[0];

  const hasComma = token.includes(',');
  const hasDot   = token.includes('.');
  if (hasComma && hasDot) {
    // Whichever appears LAST is the decimal separator.
    if (token.lastIndexOf(',') > token.lastIndexOf('.')) {
      token = token.replace(/\./g, '').replace(',', '.');
    } else {
      token = token.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Multiple commas → treat them all as thousands separators (e.g. "1,234").
    // Single comma → could be decimal ("5,5") or thousands ("1,234").
    // Heuristic: if the segment after the last comma is exactly 3 digits,
    // it's a thousands separator; otherwise a decimal.
    const parts = token.split(',');
    if (parts.length === 2 && parts[1].length !== 3) {
      token = parts.join('.');
    } else {
      token = parts.join('');
    }
  }
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : NaN;
}
