/**
 * Haversine distance between two lat/lng points, returns km.
 */
export function haversine(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r;
  const dLng = (lng2 - lng1) * d2r;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * In-memory cache for successful Nominatim results.
 * Transient failures (network/HTTP) are deliberately NOT cached so a single
 * blip during CSV import doesn't poison every later lookup of the same query.
 */
const geocodeCache = new Map<string, { lat: number; lng: number }>();

/**
 * Lazily-resolved Tauri `invoke`. Resolves to null when running in a plain
 * browser (e.g. `vite dev` outside Tauri), in which case we fall back to a
 * direct fetch — fine for development, never used in the packaged app.
 */
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeCache: Invoke | null | undefined;
async function getInvoke(): Promise<Invoke | null> {
  if (invokeCache !== undefined) return invokeCache;
  try {
    const mod = await import('@tauri-apps/api/core');
    invokeCache = mod.invoke as Invoke;
  } catch {
    invokeCache = null;
  }
  return invokeCache;
}

async function runGeocode(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const invoke = await getInvoke();

  // ── Tauri path: Rust handles the HTTP request with a proper User-Agent
  //    (browser fetch silently drops the UA header — that's why the same
  //    query worked on Windows/WebView2 but failed on macOS/WKWebView).
  if (invoke) {
    try {
      const coords = await invoke<{ lat: number; lng: number } | null>(
        'geocode',
        { query }
      );
      return coords;
    } catch (err) {
      // Hard transport error from Rust → treat as transient, return null
      // without caching.
      console.warn('geocode invoke failed:', err);
      return null;
    }
  }

  // ── Browser-dev fallback (no Tauri runtime available) ──────────────────
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    if (!res.ok) return null;
    const data: Array<{ lat: string; lon: string }> = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a deterministic Nominatim query string using the unified rules:
 *   - If street is present → "street, postalCode, city"
 *   - If street is absent  → "postalCode, city"
 *
 * "Germany" is always appended to constrain results.
 */
function buildQuery(
  street: string | undefined,
  postalCode: string,
  city: string
): string {
  const parts: string[] = [];

  if (street && street.trim() !== '') {
    parts.push(street.trim());
  }

  parts.push(postalCode.trim(), city.trim(), 'Germany');

  return parts.join(', ');
}

/**
 * Geocode a location via OpenStreetMap Nominatim.
 *
 * Resolution rules (single source of truth):
 *   - street present → street + postalCode + city  (street-level precision)
 *   - street absent  → postalCode + city            (city-level precision)
 *
 * Results are cached in-memory by query string to avoid redundant requests.
 * Returns null if geocoding fails or yields no results.
 */
export async function geocode(
  street: string | undefined,
  postalCode: string,
  city: string
): Promise<{ lat: number; lng: number } | null> {
  const q = buildQuery(street, postalCode, city);

  const cached = geocodeCache.get(q);
  if (cached) return cached;

  const coords = await runGeocode(q);
  if (coords) geocodeCache.set(q, coords);
  return coords;
}