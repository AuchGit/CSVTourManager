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
 * In-memory cache for Nominatim results.
 * Key: the exact query string sent to the API.
 * Value: resolved coordinates, or null if geocoding failed.
 */
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

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

  if (geocodeCache.has(q)) {
    return geocodeCache.get(q)!;
  }

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;

  try {
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'de',
        'User-Agent': 'TourManager/1.0',
      },
    });

    if (!res.ok) {
      geocodeCache.set(q, null);
      return null;
    }

    const data: Array<{ lat: string; lon: string }> = await res.json();

    if (data.length > 0) {
      const coords = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
      geocodeCache.set(q, coords);
      return coords;
    }
  } catch {
    // silently skip — caller handles null
  }

  geocodeCache.set(q, null);
  return null;
}