export type EventStatus = 'ok' | 'conflict';
export type Theme = 'dark' | 'light';

export interface TourEvent {
  id: string;
  date: string; // YYYY-MM-DD
  city: string;
  street?: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  protection_radius_km: number;
  protection_time_months: number;
  status: EventStatus;
  conflictingIds: string[];
}

export interface ConflictPair {
  id: string;
  eventAId: string;
  eventBId: string;
  cityA: string;
  cityB: string;
  dateA: string;
  dateB: string;
  distanceKm: number;
}

export interface TestEventState {
  latitude: number;
  longitude: number;
  city: string;
  date: string;
  /** Optional: when provided, a protection circle is drawn on the map. */
  protection_radius_km?: number;
  /** Optional: when provided, time-window overlap is checked bidirectionally. */
  protection_time_months?: number;
}