import type { TourEvent, ConflictPair } from '../types';
import { haversine } from './geo';

/** Shift a YYYY-MM-DD date by N months, return a unix-ms timestamp. */
function shiftMonthsMs(dateStr: string, months: number): number {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/**
 * Run conflict detection across all events.
 * Two events conflict when:
 *   1. Distance ≤ protection_radius_km of either event, AND
 *   2. Their protection time windows overlap.
 *
 * Performance notes:
 *   - Window start/end timestamps are pre-computed once per event so the
 *     inner pair loop is pure arithmetic — no Date allocations per pair.
 *   - Events whose `status` and `conflictingIds` are unchanged keep their
 *     original object reference, which lets `React.memo`'d list items
 *     skip re-rendering when an unrelated event is edited.
 */
export function detectConflicts(events: TourEvent[]): {
  updatedEvents: TourEvent[];
  conflicts: ConflictPair[];
} {
  const n = events.length;

  // Pre-compute coordinates and time windows once.
  const lats     = new Float64Array(n);
  const lngs     = new Float64Array(n);
  const winStart = new Float64Array(n);
  const winEnd   = new Float64Array(n);
  const radii    = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const e = events[i];
    lats[i]     = e.latitude;
    lngs[i]     = e.longitude;
    radii[i]    = e.protection_radius_km;
    winStart[i] = shiftMonthsMs(e.date, -e.protection_time_months);
    winEnd[i]   = shiftMonthsMs(e.date,  e.protection_time_months);
  }

  // Aggregate which IDs each event ends up conflicting with.
  const newConflictIds: string[][] = Array.from({ length: n }, () => []);
  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Time overlap is cheap — check it first.
      if (winStart[i] > winEnd[j] || winStart[j] > winEnd[i]) continue;
      const distKm = haversine(lats[i], lngs[i], lats[j], lngs[j]);
      if (distKm > radii[i] && distKm > radii[j]) continue;

      const a = events[i];
      const b = events[j];
      newConflictIds[i].push(b.id);
      newConflictIds[j].push(a.id);
      conflicts.push({
        id: `${a.id}::${b.id}`,
        eventAId: a.id,
        eventBId: b.id,
        cityA: a.city,
        cityB: b.city,
        dateA: a.date,
        dateB: b.date,
        distanceKm: Math.round(distKm),
      });
    }
  }

  // Build the decorated list, but reuse the original object reference when
  // the status & conflicting-id list are unchanged. This is what keeps
  // memoised event rows from re-rendering on unrelated edits.
  const updatedEvents: TourEvent[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = events[i];
    const ids = newConflictIds[i];
    const status = ids.length > 0 ? 'conflict' : 'ok';
    if (e.status === status && sameIds(e.conflictingIds, ids)) {
      updatedEvents[i] = e;
    } else {
      updatedEvents[i] = { ...e, status, conflictingIds: ids };
    }
  }

  return { updatedEvents, conflicts };
}

/** Order-independent equality check for short id-string arrays. */
function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  // Linear probe — these arrays are small (typical conflict count).
  for (const id of a) if (!b.includes(id)) return false;
  return true;
}

/**
 * Check which existing events conflict with a hypothetical new test event.
 *
 * When testRadius + testMonths are provided, the check is fully bidirectional
 * — identical to detectConflicts:
 *   - geo:  dist ≤ ev.radius  OR  dist ≤ testRadius
 *   - time: ev's window overlaps with test event's window
 *
 * When the protection inputs are omitted, falls back to the original
 * one-sided check (test date must fall inside each existing event's window).
 */
export function getTestConflicts(
  testDate: string,
  testLat: number,
  testLng: number,
  events: TourEvent[],
  testRadius?: number,
  testMonths?: number
): string[] {
  const hasTestZone = testRadius !== undefined && testMonths !== undefined;
  const testTime = new Date(testDate + 'T00:00:00').getTime();
  const testStart = hasTestZone ? shiftMonthsMs(testDate, -testMonths!) : 0;
  const testEnd   = hasTestZone ? shiftMonthsMs(testDate,  testMonths!) : 0;

  const out: string[] = [];
  for (const ev of events) {
    const dist = haversine(testLat, testLng, ev.latitude, ev.longitude);
    const inEvZone   = dist <= ev.protection_radius_km;
    const inTestZone = hasTestZone && dist <= testRadius!;
    if (!inEvZone && !inTestZone) continue;

    if (hasTestZone) {
      const evStart = shiftMonthsMs(ev.date, -ev.protection_time_months);
      const evEnd   = shiftMonthsMs(ev.date,  ev.protection_time_months);
      if (testStart > evEnd || evStart > testEnd) continue;
    } else {
      const start = shiftMonthsMs(ev.date, -ev.protection_time_months);
      const end   = shiftMonthsMs(ev.date,  ev.protection_time_months);
      if (testTime < start || testTime > end) continue;
    }
    out.push(ev.id);
  }
  return out;
}
