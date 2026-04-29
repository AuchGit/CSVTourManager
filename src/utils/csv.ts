import Papa from 'papaparse';
import type { TourEvent } from '../types';
import { geocodeDetailed } from './geo';

// ── Column-name normalisation ─────────────────────────────────────────────────
const COL_MAP: Record<string, string> = {
  date: 'date', datum: 'date',
  city: 'city', ort: 'city',
  postal_code: 'postal_code', plz: 'postal_code',
  street: 'street', 'straße': 'street', strasse: 'street',
  protection_radius_km: 'protection_radius_km',
  'gebietsschutz (km)': 'protection_radius_km',
  gebietsschutz: 'protection_radius_km',
  protection_time_months: 'protection_time_months',
  monatsschutz: 'protection_time_months',
};

function normaliseRow(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const mapped = COL_MAP[k.toLowerCase().trim()];
    if (mapped) out[mapped] = v;
  }
  return out;
}

// ── Postal code normalisation ─────────────────────────────────────────────────
/**
 * Normalise a German postal code that may have come from Excel or a manual
 * form input.
 *
 * Excel treats a column of digits as a number and silently strips leading
 * zeros — so "01067" (Dresden) becomes the number 1067 on save, which
 * Papa-Parse hands us back as the string "1067". German PLZs are always
 * 5 digits, so we left-pad any 4-digit value (numeric type *or* string)
 * with a zero. Surrounding whitespace and an `'` apostrophe-prefix
 * (Excel's "force-as-text" marker) are stripped first.
 *
 * Non-numeric or already-5-digit values are returned untouched (after the
 * trim) so we don't mangle anything we don't recognise.
 */
export function normalizePostalCode(raw: unknown): string {
  // Accept numbers as well as strings — depending on how the CSV was written
  // and how the consumer hands it in, we may receive either type.
  const s = (typeof raw === 'number' ? String(raw) : String(raw ?? ''))
    .trim()
    .replace(/^'/, ''); // Excel's text-forcing apostrophe
  if (/^\d{4}$/.test(s)) return '0' + s;
  return s;
}

// ── Date normalisation ────────────────────────────────────────────────────────
/**
 * Accepts the date formats Excel may emit on either Windows or macOS:
 *   dd.mm.yyyy   dd.mm.yy   dd/mm/yyyy   dd/mm/yy   dd-mm-yyyy
 *   yyyy-mm-dd   yyyy/mm/dd   yyyy.mm.dd
 *
 * 2-digit years are expanded with the standard pivot (00–69 ⇒ 2000–2069,
 * 70–99 ⇒ 1970–1999) — same rule Excel uses internally.
 *
 * Returns the canonical ISO form `YYYY-MM-DD`, or '' if the input does not
 * look like a valid date. Empty return signals the caller to drop the row,
 * so we never end up displaying a half-parsed value (e.g. `undefined.undefined.04.27`).
 */
function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';

  const expandYear = (y: string): string => {
    if (y.length === 4) return y;
    const n = parseInt(y, 10);
    return String(n <= 69 ? 2000 + n : 1900 + n);
  };

  // dd[./-]mm[./-]yy(yy)
  const dmy = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/);
  if (dmy) {
    const yyyy = expandYear(dmy[3]);
    const mm   = dmy[2].padStart(2, '0');
    const dd   = dmy[1].padStart(2, '0');
    return isValidYMD(yyyy, mm, dd) ? `${yyyy}-${mm}-${dd}` : '';
  }

  // yyyy[-./]mm[-./]dd
  const ymd = s.match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
  if (ymd) {
    const yyyy = ymd[1];
    const mm   = ymd[2].padStart(2, '0');
    const dd   = ymd[3].padStart(2, '0');
    return isValidYMD(yyyy, mm, dd) ? `${yyyy}-${mm}-${dd}` : '';
  }

  return '';
}

function isValidYMD(yyyy: string, mm: string, dd: string): boolean {
  const y = +yyyy, m = +mm, d = +dd;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ── Encoding-safe file reader (for drag-and-drop / manual upload) ─────────────
async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      const hasBOM = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      const payload = hasBOM ? bytes.slice(3) : bytes;
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(payload));
      } catch {
        resolve(new TextDecoder('windows-1252').decode(payload));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ── Core CSV parsing (works on pre-decoded text) ──────────────────────────────
/**
 * Parse a decoded CSV string into TourEvent[].
 * Used by both the file-upload path and the Tauri "open with" path.
 * ALL coordinates are resolved via Nominatim — lat/lng columns are ignored.
 */
export async function parseCSVText(
  text: string,
  onProgress?: (msg: string) => void
): Promise<TourEvent[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        // First pass: validate rows synchronously, collect what needs geocoding.
        type Pending = {
          dateStr: string;
          cityStr: string;
          postalCode: string;
          street: string | undefined;
          radius: number;
          months: number;
          label: string;
        };
        const pending: Pending[] = [];

        for (const raw of data) {
          const row = normaliseRow(raw);

          const dateStr    = normalizeDate(row.date?.trim() ?? '');
          const cityStr    = row.city?.trim();
          const postalCode = normalizePostalCode(row.postal_code ?? '');
          if (!dateStr || !cityStr || !postalCode) continue;

          const radius = parseFloat(row.protection_radius_km ?? '');
          const months = parseFloat(row.protection_time_months ?? '');
          if (isNaN(radius) || isNaN(months)) continue;

          const street = row.street?.trim() || undefined;
          const label  = street
            ? `${street}, ${postalCode} ${cityStr}`
            : `${postalCode} ${cityStr}`;

          pending.push({ dateStr, cityStr, postalCode, street, radius, months, label });
        }

        // Second pass: geocode. Throughput is governed by the global
        // 1-req/sec queue inside geo.ts (Nominatim's public policy), so
        // running multiple workers here doesn't speed cold lookups but
        // *does* let cache hits and inflight-dedup return immediately
        // while a cold lookup is waiting its turn.
        const CONCURRENCY = 4;
        const results: (TourEvent | null)[] = new Array(pending.length).fill(null);
        let nextIdx = 0;
        let done = 0;
        let rateLimitedCount = 0;
        let lastRateLimitReason = '';

        const worker = async () => {
          while (true) {
            const i = nextIdx++;
            if (i >= pending.length) return;
            const p = pending[i];

            const r = await geocodeDetailed(p.street, p.postalCode, p.cityStr);
            done++;

            if (r.kind === 'ratelimit') {
              rateLimitedCount++;
              lastRateLimitReason = r.reason;
              onProgress?.(`Rate-Limit (${done}/${pending.length}): ${p.label}`);
              continue;
            }
            if (r.kind === 'notfound') {
              onProgress?.(`Nicht gefunden (${done}/${pending.length}): ${p.label}`);
              continue;
            }

            onProgress?.(`Geocoding ${done}/${pending.length}: ${p.label}…`);
            results[i] = {
              id: crypto.randomUUID(),
              date: p.dateStr,
              city: p.cityStr,
              ...(p.street !== undefined ? { street: p.street } : {}),
              postal_code: p.postalCode,
              latitude: r.lat,
              longitude: r.lng,
              protection_radius_km: p.radius,
              protection_time_months: p.months,
              status: 'ok',
              conflictingIds: [],
            };
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
        );

        // If most rows failed because of rate-limiting, raise it instead of
        // silently returning a near-empty list — that's the real cause when
        // "alles übersprungen" appears in the UI.
        if (rateLimitedCount > 0 && rateLimitedCount >= pending.length / 2) {
          reject(new Error(
            `Geocoding-Server hat zu viele Anfragen abgelehnt (${rateLimitedCount}/${pending.length}). ` +
            `Bitte ein paar Minuten warten und erneut versuchen. Detail: ${lastRateLimitReason}`
          ));
          return;
        }

        resolve(results.filter((e): e is TourEvent => e !== null));
      },
      error: reject,
    });
  });
}

// ── File-upload entry point (handles encoding, then delegates to parseCSVText) ─
/**
 * Parse a browser File object (from drag-and-drop / file picker).
 * Handles UTF-8 BOM, plain UTF-8, and windows-1252 encoding automatically.
 */
export async function parseCSVFile(
  file: File,
  onProgress?: (msg: string) => void
): Promise<TourEvent[]> {
  const text = await readFileText(file);
  return parseCSVText(text, onProgress);
}