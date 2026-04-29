import type { TourEvent } from '../types';
import { parseCSVText } from './csv';

/**
 * Per-file event cache and silent prefetch queue for the folder browser.
 *
 * Keyed by the absolute filesystem path returned by the Rust scanner.
 * Once a file has been parsed (either via the foreground path when the
 * user clicks it, or via the background prefetch worker), the resulting
 * TourEvent[] is held here so that switching back to it is instant —
 * no re-read, no re-geocode.
 *
 * The geocoding queue inside `geo.ts` already enforces Nominatim's
 * ≤1 req/sec rule globally, so the prefetcher does not need its own
 * throttle: it simply parses one file at a time and the queue inside
 * `geocode()` paces the network.
 */

type CacheEntry =
  | { state: 'pending'; promise: Promise<TourEvent[]> }
  | { state: 'ready'; events: TourEvent[] }
  | { state: 'error'; error: string };

const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function subscribeCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCacheState(
  path: string
): 'pending' | 'ready' | 'error' | 'unknown' {
  return cache.get(path)?.state ?? 'unknown';
}

export function getCachedEvents(path: string): TourEvent[] | null {
  const e = cache.get(path);
  return e && e.state === 'ready' ? e.events : null;
}

async function readAndParse(path: string): Promise<TourEvent[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const text = await invoke<string>('read_csv_file', { path });
  return parseCSVText(text);
}

/**
 * Ensure `path` is parsed and cached. If a parse is already in flight,
 * the existing promise is returned (dedup). On error the entry is
 * removed so a later retry can succeed.
 */
export function ensureCached(path: string): Promise<TourEvent[]> {
  const existing = cache.get(path);
  if (existing?.state === 'ready') return Promise.resolve(existing.events);
  if (existing?.state === 'pending') return existing.promise;

  const promise = readAndParse(path)
    .then(events => {
      cache.set(path, { state: 'ready', events });
      notify();
      return events;
    })
    .catch(err => {
      cache.set(path, { state: 'error', error: String(err) });
      notify();
      throw err;
    });

  cache.set(path, { state: 'pending', promise });
  notify();
  return promise;
}

// ── Background prefetch ─────────────────────────────────────────────────────
let queue: string[] = [];
let isRunning = false;
let paused = false;

/**
 * Pause/resume the background prefetcher. The foreground load path
 * pauses it before reading a user-requested file so the user's click
 * gets the next geocoding-queue slot, then resumes it.
 */
export function pausePrefetch() {
  paused = true;
}
export function resumePrefetch() {
  paused = false;
  if (!isRunning) drain();
}

export function setPrefetchQueue(paths: string[]) {
  queue = paths.filter(p => {
    const s = cache.get(p)?.state;
    return s !== 'ready' && s !== 'pending';
  });
  if (!isRunning && !paused) drain();
}

async function drain() {
  isRunning = true;
  while (queue.length > 0) {
    if (paused) {
      // Wait briefly and re-check; the foreground path will set paused=false.
      await new Promise(r => setTimeout(r, 250));
      continue;
    }
    const path = queue.shift()!;
    const s = cache.get(path)?.state;
    if (s === 'ready' || s === 'pending') continue;
    try {
      await ensureCached(path);
    } catch {
      // Already recorded as 'error' inside ensureCached — keep going so
      // one bad file doesn't stop the rest of the prefetch.
    }
  }
  isRunning = false;
}

export function clearCache() {
  cache.clear();
  queue = [];
  notify();
}
