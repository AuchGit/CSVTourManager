import Papa from 'papaparse';
import type { TourEvent } from '../types';
import { geocode } from './geo';

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

// ── Date normalisation ────────────────────────────────────────────────────────
function normalizeDate(raw: string): string {
  const s = raw.trim();
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) return `${dot[3]}-${dot[2].padStart(2, '0')}-${dot[1].padStart(2, '0')}`;
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s;
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
        const events: TourEvent[] = [];

        for (let i = 0; i < data.length; i++) {
          const row = normaliseRow(data[i]);

          const dateStr   = normalizeDate(row.date?.trim() ?? '');
          const cityStr   = row.city?.trim();
          const postalCode = row.postal_code?.trim() ?? '';
          if (!dateStr || !cityStr || !postalCode) continue;
          if (isNaN(Date.parse(dateStr))) continue;

          const radius = parseFloat(row.protection_radius_km ?? '');
          const months = parseFloat(row.protection_time_months ?? '');
          if (isNaN(radius) || isNaN(months)) continue;

          const street = row.street?.trim() || undefined;
          const label  = street
            ? `${street}, ${postalCode} ${cityStr}`
            : `${postalCode} ${cityStr}`;
          onProgress?.(`Geocoding ${i + 1}/${data.length}: ${label}…`);

          const coords = await geocode(street, postalCode, cityStr);
          if (!coords) {
            onProgress?.(`Skipped (geocoding failed): ${label}`);
            continue;
          }

          events.push({
            id: crypto.randomUUID(),
            date: dateStr,
            city: cityStr,
            ...(street !== undefined ? { street } : {}),
            postal_code: postalCode,
            latitude: coords.lat,
            longitude: coords.lng,
            protection_radius_km: radius,
            protection_time_months: months,
            status: 'ok',
            conflictingIds: [],
          });
        }

        resolve(events);
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