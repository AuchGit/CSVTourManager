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
 * Persistent geocode cache backed by localStorage.
 *
 * Successful Nominatim results survive app restarts, so any location the app
 * has seen before resolves instantly — no network round-trip, no 1-req/sec
 * wait. Transient failures are deliberately NOT cached so a blip during one
 * import doesn't block future lookups of the same address.
 *
 * Cap: 2 000 entries (≈ 200 KB). When the cap is hit the oldest 20 % are
 * evicted so the cache doesn't grow unboundedly on large tour datasets.
 */
const GEO_CACHE_KEY = 'tm_geocode_v1';
const GEO_CACHE_MAX = 2000;
const GEO_CACHE_EVICT = 400; // how many to drop when cap is hit

type CacheEntry = { lat: number; lng: number };

function loadGeocodeCache(): Map<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return new Map();
    return new Map(Object.entries(JSON.parse(raw) as Record<string, CacheEntry>));
  } catch {
    return new Map();
  }
}

function saveGeocodeCache(cache: Map<string, CacheEntry>): void {
  try {
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // localStorage full or unavailable — not critical, next lookup just re-fetches
  }
}

function cacheSet(cache: Map<string, CacheEntry>, key: string, value: CacheEntry): void {
  if (cache.size >= GEO_CACHE_MAX) {
    // Evict oldest entries (Map preserves insertion order).
    let evicted = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++evicted >= GEO_CACHE_EVICT) break;
    }
  }
  cache.set(key, value);
  saveGeocodeCache(cache);
}

const geocodeCache = loadGeocodeCache();

/**
 * In-flight request dedup: when several CSV rows resolve to the same query
 * (same street/PLZ/city), share a single HTTP round-trip instead of firing
 * one per caller. Cleared as soon as the request settles.
 */
const inflight = new Map<string, Promise<GeoResult>>();

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

/**
 * Result of a single geocode request.
 *   ok        → coordinates found
 *   notfound  → server responded but had no match
 *   ratelimit → 429 / transport error; caller should back off and retry
 */
export type GeoResult =
  | { kind: 'ok'; lat: number; lng: number }
  | { kind: 'notfound' }
  | { kind: 'ratelimit'; reason: string };

/**
 * Nominatim's public usage policy is ≤1 request/second. We enforce this
 * globally by chaining every uncached request behind the previous one with
 * a minimum spacing. Cache hits and in-flight dedup never enter this queue,
 * so re-imports remain instant.
 */
const NOMINATIM_MIN_SPACING_MS = 1100;
let lastRequestAt = 0;
let queueTail: Promise<unknown> = Promise.resolve();

function scheduleRequest<T>(work: () => Promise<T>): Promise<T> {
  const job = queueTail.then(async () => {
    const wait = Math.max(0, lastRequestAt + NOMINATIM_MIN_SPACING_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return work();
  });
  queueTail = job.catch(() => undefined);
  return job;
}

async function runGeocodeOnce(query: string): Promise<GeoResult> {
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
      if (coords) return { kind: 'ok', lat: coords.lat, lng: coords.lng };
      return { kind: 'notfound' };
    } catch (err) {
      const msg = String(err);
      console.warn('geocode invoke failed:', msg);
      return { kind: 'ratelimit', reason: msg };
    }
  }

  // ── Browser-dev fallback (no Tauri runtime available) ──────────────────
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
    query
  )}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    if (res.status === 429 || res.status === 403) {
      return { kind: 'ratelimit', reason: `HTTP ${res.status}` };
    }
    if (!res.ok) return { kind: 'ratelimit', reason: `HTTP ${res.status}` };
    const data: Array<{ lat: string; lon: string }> = await res.json();
    if (data.length > 0) {
      return { kind: 'ok', lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return { kind: 'notfound' };
  } catch (err) {
    return { kind: 'ratelimit', reason: String(err) };
  }
}

/**
 * Serialized + retried geocode. On rate-limit/transport errors we back off
 * exponentially (2 s → 4 s → 8 s) up to 3 retries, then give up and return
 * the failure so the caller can surface a meaningful error.
 */
async function runGeocode(query: string): Promise<GeoResult> {
  let backoff = 2000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await scheduleRequest(() => runGeocodeOnce(query));
    if (r.kind !== 'ratelimit') return r;
    if (attempt === 3) return r;
    await new Promise(res => setTimeout(res, backoff));
    backoff *= 2;
  }
  // Unreachable but keeps TS happy.
  return { kind: 'ratelimit', reason: 'exhausted' };
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
 * Returns a structured GeoResult so callers can distinguish "not found"
 * from a transient rate-limit / network failure.
 */
export async function geocodeDetailed(
  street: string | undefined,
  postalCode: string,
  city: string
): Promise<GeoResult> {
  const q = buildQuery(street, postalCode, city);

  const cached = geocodeCache.get(q);
  if (cached) return { kind: 'ok', lat: cached.lat, lng: cached.lng };

  const pending = inflight.get(q);
  if (pending) return pending;

  const promise = runGeocode(q).then(result => {
    if (result.kind === 'ok') {
      cacheSet(geocodeCache, q, { lat: result.lat, lng: result.lng });
    }
    inflight.delete(q);
    return result;
  });
  inflight.set(q, promise);
  return promise;
}

/**
 * Backwards-compatible wrapper: returns coords on success, null on any
 * other outcome. Use `geocodeDetailed` when callers need to differentiate
 * "not found" from a rate-limit so they can surface a meaningful error.
 */
export async function geocode(
  street: string | undefined,
  postalCode: string,
  city: string
): Promise<{ lat: number; lng: number } | null> {
  const r = await geocodeDetailed(street, postalCode, city);
  return r.kind === 'ok' ? { lat: r.lat, lng: r.lng } : null;
}