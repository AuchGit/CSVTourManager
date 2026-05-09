import Papa from 'papaparse';
import type { TourEvent, ParsedFile, LoadedHeaders } from '../types';
import { geocodeDetailed } from './geo';
import { decodeBytes, parseNumberLoose } from './encoding';
import {
  CANONICAL_COLUMNS,
  getSettings,
  type CanonicalColumn,
} from '../hooks/useSettings';

/** Normalise a header for alias lookup: lowercase, trim, collapse whitespace. */
function normaliseHeader(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Built-in compatibility aliases that the parser ALWAYS recognises,
 * separate from the user-editable list in Settings. Keeps the Settings
 * UI clean (the user only sees their own additions + the German
 * primaries) while still loading any file the previous version of the
 * app could load.
 *
 * Adding a new alias here is enough — no Settings migration needed.
 */
const BUILTIN_ALIASES: Record<CanonicalColumn, readonly string[]> = {
  date: ['datum', 'date', 'tag', 'day'],
  city: ['ort', 'city', 'stadt', 'town', 'ortschaft', 'location'],
  postal_code: [
    'plz',
    'postal_code',
    'postal code',
    'zip',
    'zip code',
    'postcode',
    'post code',
    'postleitzahl',
  ],
  protection_radius_km: [
    'gebietsschutz',
    'gebietsschutz (km)',
    'gebietsschutz km',
    'protection_radius_km',
    'protection radius',
    'radius',
    'radius (km)',
    'radius km',
    'umkreis',
    'umkreis (km)',
    'umkreis km',
    'schutzradius',
  ],
  protection_time_months: [
    'monatsschutz',
    'protection_time_months',
    'protection time',
    'monate',
    'monate schutz',
    'months',
    'zeitschutz',
  ],
};

/**
 * Build a lookup `normalised header → canonical column` from the
 * built-in compat aliases plus the user's Settings aliases. User entries
 * win on conflicts (later writes override earlier ones).
 *
 * Re-built per parse so editing aliases in Settings takes effect
 * immediately on the next file load.
 */
function buildHeaderMap(): Record<string, CanonicalColumn> {
  const out: Record<string, CanonicalColumn> = {};
  // 1. Built-ins first.
  for (const key of CANONICAL_COLUMNS) {
    for (const name of BUILTIN_ALIASES[key]) {
      const k = normaliseHeader(name);
      if (k) out[k] = key;
    }
  }
  // 2. User-configured aliases override the built-ins on collision.
  const aliases = getSettings().columnAliases;
  for (const key of CANONICAL_COLUMNS) {
    for (const name of aliases[key]) {
      const k = normaliseHeader(name);
      if (k) out[k] = key;
    }
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
 */
export function normalizePostalCode(raw: unknown): string {
  const s = (typeof raw === 'number' ? String(raw) : String(raw ?? ''))
    .trim()
    .replace(/^'/, '');
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
 */
function normalizeDate(raw: string): string {
  let s = raw.trim();
  if (!s) return '';

  // Excel "serial date" numbers — XLSX cells whose number format isn't a
  // recognised date format come through SheetJS as bare integers like
  // "46327" (= 2026-10-30). The cell is genuinely a date in Excel; only
  // the on-disk number-format string is "General" instead of e.g.
  // "dd.mm.yyyy", which is why `cellDates: true` doesn't catch it.
  // Range we accept: 1 (1900-01-01) … 2958465 (9999-12-31).
  // Comma decimals are tolerated for German-locale exports ("46327,5").
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    const n = parseFloat(s.replace(',', '.'));
    if (Number.isFinite(n) && n >= 1 && n < 2958466) {
      const iso = excelSerialToISODate(n);
      if (iso) return iso;
    }
  }

  // Strip a trailing time component if present — Excel datetime cells get
  // exported as e.g. "2024-05-15 00:00:00" or "15.05.2024 12:30", which
  // the date-only regexes below would otherwise reject.
  s = s
    .replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(\s*(?:Z|[+-]\d{2}:?\d{2}))?$/, '')
    .trim();

  const expandYear = (y: string): string => {
    if (y.length === 4) return y;
    const n = parseInt(y, 10);
    return String(n <= 69 ? 2000 + n : 1900 + n);
  };

  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (dmy) {
    const yyyy = expandYear(dmy[3]);
    const mm   = dmy[2].padStart(2, '0');
    const dd   = dmy[1].padStart(2, '0');
    return isValidYMD(yyyy, mm, dd) ? `${yyyy}-${mm}-${dd}` : '';
  }

  const ymd = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
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

/**
 * Convert an Excel-serial date number to an ISO `yyyy-mm-dd` string.
 *
 * Excel's serial-date system uses 1900-01-01 as day 1 and erroneously
 * treats 1900 as a leap year (the "Lotus 1-2-3 bug" Excel preserves for
 * compatibility). Standard correction:
 *
 *   serial 1..59  → 1900-01-01..02-28        (no offset)
 *   serial 60     → fake 1900-02-29; we map it onto Feb 28
 *   serial 61+    → real Gregorian dates     (offset by -1 day)
 *
 * The fractional part of the serial would carry a time-of-day, but we
 * floor it because the app only ever stores date-precision values.
 */
function excelSerialToISODate(serial: number): string {
  if (!Number.isFinite(serial) || serial < 1 || serial >= 2958466) return '';
  const offset = serial >= 60 ? Math.floor(serial) - 1 : Math.floor(serial);
  const d = new Date(Date.UTC(1900, 0, offset));
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ── Encoding-safe file reader (for drag-and-drop / manual upload) ─────────────
async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return decodeBytes(new Uint8Array(buf));
}

// ── Core CSV parsing (works on pre-decoded text) ──────────────────────────────
/**
 * Parse a decoded CSV string into a ParsedFile (events + the header
 * names that were actually present in the file).
 *
 * ALL coordinates are resolved via Nominatim — lat/lng columns are ignored.
 */
export async function parseCSVText(
  text: string,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      // Papa auto-detects comma vs semicolon vs tab when delimiter is left
      // unset — that's what we want for cross-locale compatibility.
      skipEmptyLines: 'greedy',
      transformHeader: h => h.trim(),
      complete: async ({ data, meta }) => {
        type Pending = {
          dateStr: string;
          cityStr: string;
          postalCode: string;
          radius: number;
          months: number;
          label: string;
        };
        const pending: Pending[] = [];
        const headerMap = buildHeaderMap();

        // Capture the FIRST raw header that mapped to each canonical key
        // so saving can write the file back with its original column
        // names. Walk Papa's reported field list (preserves order).
        const loadedHeaders: LoadedHeaders = {};
        const fields = (meta.fields ?? []).map(f => f.trim());
        for (const field of fields) {
          const canonical = headerMap[normaliseHeader(field)];
          if (canonical && !(canonical in loadedHeaders)) {
            loadedHeaders[canonical] = field;
          }
        }

        // Surface up-front which canonical columns the file is missing so
        // the user gets a usable error instead of "0 events" if the load
        // ends up empty further down.
        const requiredCanonical: CanonicalColumn[] = [
          'date',
          'city',
          'postal_code',
          'protection_radius_km',
          'protection_time_months',
        ];
        const missing = requiredCanonical.filter(k => !(k in loadedHeaders));

        // Collect a few representative rejection reasons so we can surface
        // a useful error message instead of just "0 rows".
        const rejections: string[] = [];
        const reject1 = (rowNum: number, reason: string) => {
          if (rejections.length < 3) rejections.push(`Zeile ${rowNum}: ${reason}`);
        };

        for (let rowIdx = 0; rowIdx < data.length; rowIdx++) {
          const raw = data[rowIdx];
          const rowNum = rowIdx + 2; // +1 for 1-based, +1 for the header row
          // Map raw row → canonical-keyed row.
          const row: Partial<Record<CanonicalColumn, string>> = {};
          for (const [k, v] of Object.entries(raw)) {
            const mapped = headerMap[normaliseHeader(k)];
            if (mapped) row[mapped] = v;
          }

          const dateRaw    = (row.date ?? '').trim();
          const cityStr    = (row.city ?? '').trim();
          const postalRaw  = row.postal_code ?? '';
          const radiusRaw  = row.protection_radius_km;
          const monthsRaw  = row.protection_time_months;

          const dateStr    = normalizeDate(dateRaw);
          const postalCode = normalizePostalCode(postalRaw);

          if (!dateStr) {
            reject1(rowNum, dateRaw
              ? `Datum nicht erkannt: "${dateRaw}"`
              : 'Datum fehlt');
            continue;
          }
          if (!cityStr) {
            reject1(rowNum, 'Ort fehlt');
            continue;
          }
          if (!postalCode) {
            reject1(rowNum, 'PLZ fehlt');
            continue;
          }

          const radius = parseNumberLoose(radiusRaw);
          const months = parseNumberLoose(monthsRaw);
          if (isNaN(radius)) {
            reject1(rowNum, `Gebietsschutz (km) nicht numerisch: "${radiusRaw ?? ''}"`);
            continue;
          }
          if (isNaN(months)) {
            reject1(rowNum, `Monatsschutz nicht numerisch: "${monthsRaw ?? ''}"`);
            continue;
          }

          const label = `${postalCode} ${cityStr}`;
          pending.push({ dateStr, cityStr, postalCode, radius, months, label });
        }

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

            const r = await geocodeDetailed(p.postalCode, p.cityStr);
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
              postal_code: p.postalCode,
              latitude: r.lat,
              longitude: r.lng,
              protection_radius_km: p.radius,
              protection_time_months: p.months,
              status: 'ok',
              conflictingIds: [],
              original: {
                protection_radius_km: p.radius,
                protection_time_months: p.months,
              },
            };
          }
        };

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
        );

        if (rateLimitedCount > 0 && rateLimitedCount >= pending.length / 2) {
          reject(new Error(
            `Geocoding-Server hat zu viele Anfragen abgelehnt (${rateLimitedCount}/${pending.length}). ` +
            `Bitte ein paar Minuten warten und erneut versuchen. Detail: ${lastRateLimitReason}`
          ));
          return;
        }

        const events = results.filter((e): e is TourEvent => e !== null);

        // The file had rows but none survived validation — tell the user
        // exactly why instead of silently showing an empty list. Most
        // common causes: missing columns, exotic date format, comma-typed
        // numbers in the radius/months columns.
        if (events.length === 0 && data.length > 0) {
          if (missing.length > 0) {
            console.warn(
              '[csv] missing canonical columns:',
              missing,
              'detected headers:',
              fields,
              'mapped:',
              loadedHeaders
            );
            reject(new Error(
              `Spalte${missing.length === 1 ? '' : 'n'} fehlt: ${missing
                .map(k => k.replace(/_/g, ' '))
                .join(', ')}. ` +
              `In den Einstellungen unter SPALTEN-NAMEN den passenden Header eintragen.`
            ));
            return;
          }
          console.warn(
            '[csv] all rows rejected. headers:',
            loadedHeaders,
            'first row:',
            data[0],
            'rejections:',
            rejections
          );
          reject(new Error(
            `Datei enthält ${data.length} Zeile${
              data.length === 1 ? '' : 'n'
            }, aber keine konnte gelesen werden. ` +
            (rejections.length > 0
              ? rejections.join(' · ')
              : 'Bitte Datums-, PLZ- und Zahlenformate prüfen.')
          ));
          return;
        }

        resolve({ events, headers: loadedHeaders });
      },
      error: reject,
    });
  });
}

// ── File-upload entry point (handles encoding, then delegates to parseCSVText) ─
export async function parseCSVFile(
  file: File,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  const text = await readFileText(file);
  return parseCSVText(text, onProgress);
}

// ── CSV serialisation ────────────────────────────────────────────────────────
/**
 * Serialise edited events back into a CSV string. Header names come from
 * the file the user loaded (`headers`), so a roundtrip preserves whatever
 * column names that file used. Canonical columns that weren't present in
 * the loaded file are NOT written — we don't invent columns.
 *
 * Falls back to the German defaults only when `headers` is empty (e.g.
 * brand-new dataset entered manually).
 */
export function eventsToCSV(events: TourEvent[], headers: LoadedHeaders): string {
  const useFallback =
    !headers.date &&
    !headers.city &&
    !headers.postal_code &&
    !headers.protection_radius_km &&
    !headers.protection_time_months;

  const fallback: Required<LoadedHeaders> = {
    date: 'Datum',
    city: 'Ort',
    postal_code: 'PLZ',
    protection_radius_km: 'Gebietsschutz',
    protection_time_months: 'Monatsschutz',
  };

  const colDefs: { key: CanonicalColumn; header: string }[] = [];
  for (const key of CANONICAL_COLUMNS) {
    const h = headers[key] ?? (useFallback ? fallback[key] : undefined);
    if (h) colDefs.push({ key, header: h });
  }

  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const rows = sorted.map(e =>
    colDefs.map(c => {
      switch (c.key) {
        case 'date':                   return formatDateDE(e.date);
        case 'city':                   return e.city;
        case 'postal_code':            return e.postal_code;
        case 'protection_radius_km':   return String(e.protection_radius_km);
        case 'protection_time_months': return String(e.protection_time_months);
      }
    })
  );

  return Papa.unparse(
    { fields: colDefs.map(c => c.header), data: rows },
    { delimiter: ';' }
  );
}

/** Serialise events into a 2-D array (rows incl. header) — used by XLSX. */
export function eventsToTable(
  events: TourEvent[],
  headers: LoadedHeaders
): string[][] {
  const useFallback =
    !headers.date &&
    !headers.city &&
    !headers.postal_code &&
    !headers.protection_radius_km &&
    !headers.protection_time_months;

  const fallback: Required<LoadedHeaders> = {
    date: 'Datum',
    city: 'Ort',
    postal_code: 'PLZ',
    protection_radius_km: 'Gebietsschutz',
    protection_time_months: 'Monatsschutz',
  };

  const colDefs: { key: CanonicalColumn; header: string }[] = [];
  for (const key of CANONICAL_COLUMNS) {
    const h = headers[key] ?? (useFallback ? fallback[key] : undefined);
    if (h) colDefs.push({ key, header: h });
  }

  const sorted = [...events].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const out: string[][] = [colDefs.map(c => c.header)];
  for (const e of sorted) {
    out.push(
      colDefs.map(c => {
        switch (c.key) {
          case 'date':                   return formatDateDE(e.date);
          case 'city':                   return e.city;
          case 'postal_code':            return e.postal_code;
          case 'protection_radius_km':   return String(e.protection_radius_km);
          case 'protection_time_months': return String(e.protection_time_months);
        }
      })
    );
  }
  return out;
}

/** YYYY-MM-DD → DD.MM.YYYY (matches the import-side German default). */
function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
