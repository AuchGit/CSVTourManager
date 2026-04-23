import type { TourEvent, ConflictPair } from '../types';
import { haversine } from './geo';

/** Shift a YYYY-MM-DD date by N months, return a Date object. */
function shiftMonths(dateStr: string, months: number): Date {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Two time windows overlap when:
 *   [dateA - monthsA, dateA + monthsA] intersects [dateB - monthsB, dateB + monthsB]
 */
function windowsOverlap(
  dateA: string, monthsA: number,
  dateB: string, monthsB: number
): boolean {
  const startA = shiftMonths(dateA, -monthsA);
  const endA   = shiftMonths(dateA,  monthsA);
  const startB = shiftMonths(dateB, -monthsB);
  const endB   = shiftMonths(dateB,  monthsB);
  return startA <= endB && startB <= endA;
}

/**
 * Run conflict detection across all events.
 * Two events conflict when:
 *   1. Distance ≤ protection_radius_km of either event, AND
 *   2. Their protection time windows overlap.
 */
export function detectConflicts(events: TourEvent[]): {
  updatedEvents: TourEvent[];
  conflicts: ConflictPair[];
} {
  const updated: TourEvent[] = events.map(e => ({
    ...e,
    status: 'ok' as const,
    conflictingIds: [] as string[],
  }));

  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < updated.length; i++) {
    for (let j = i + 1; j < updated.length; j++) {
      const a = updated[i];
      const b = updated[j];

      const distKm = haversine(a.latitude, a.longitude, b.latitude, b.longitude);

      const geoConflict =
        distKm <= a.protection_radius_km || distKm <= b.protection_radius_km;
      if (!geoConflict) continue;

      const timeConflict = windowsOverlap(
        a.date, a.protection_time_months,
        b.date, b.protection_time_months
      );
      if (!timeConflict) continue;

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

      updated[i] = {
        ...updated[i],
        status: 'conflict',
        conflictingIds: [...updated[i].conflictingIds, b.id],
      };
      updated[j] = {
        ...updated[j],
        status: 'conflict',
        conflictingIds: [...updated[j].conflictingIds, a.id],
      };
    }
  }

  return { updatedEvents: updated, conflicts };
}

/**
 * Check which existing events conflict with a hypothetical new test event.
 *
 * When testRadius + testMonths are provided (from the test form), the check
 * is fully bidirectional — identical to detectConflicts:
 *   - geo:  dist ≤ ev.radius  OR  dist ≤ testRadius
 *   - time: ev's window overlaps with test event's window
 *
 * When they are omitted, falls back to the original one-sided check
 * (test date must fall inside each existing event's window).
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
  const testD = new Date(testDate + 'T00:00:00');

  return events
    .filter(ev => {
      const dist = haversine(testLat, testLng, ev.latitude, ev.longitude);

      // ── Geographic check ──────────────────────────────────────────────────
      const inEvZone   = dist <= ev.protection_radius_km;
      const inTestZone = hasTestZone && dist <= testRadius!;
      if (!inEvZone && !inTestZone) return false;

      // ── Time check ────────────────────────────────────────────────────────
      if (hasTestZone) {
        // Bidirectional window overlap
        return windowsOverlap(testDate, testMonths!, ev.date, ev.protection_time_months);
      } else {
        // Original: test date must fall within existing event's window
        const start = shiftMonths(ev.date, -ev.protection_time_months);
        const end   = shiftMonths(ev.date,  ev.protection_time_months);
        return testD >= start && testD <= end;
      }
    })
    .map(ev => ev.id);
}