export type EventStatus = 'ok' | 'conflict';
export type Theme = 'dark' | 'light';
export type FileFormat = 'csv' | 'xlsx';

export interface TourEvent {
  id: string;
  date: string; // YYYY-MM-DD
  city: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  protection_radius_km: number;
  /** Symmetric protection window in months — applied before AND after the date. */
  protection_time_months: number;
  status: EventStatus;
  conflictingIds: string[];
  /**
   * Snapshot of the values at import time, used by the unsaved-change
   * indicator to know whether a row was edited after loading.
   */
  original?: {
    protection_radius_km: number;
    protection_time_months: number;
  };
  /**
   * True for events created in-app (e.g. via the "test event → save"
   * flow) but not yet persisted to disk. Counts as dirty so the save
   * button enables.
   */
  isNew?: boolean;
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
  /** Postal code of the test event, kept so we can persist it when the
   *  user clicks "Add to file". */
  postal_code: string;
  date: string;
  /** Optional: when provided, a protection circle is drawn on the map. */
  protection_radius_km?: number;
  /** Optional: months — bidirectional time-window check. */
  protection_time_months?: number;
}

/** A single recent-files entry persisted to localStorage. */
export interface RecentFileEntry {
  /** Absolute filesystem path (also acts as the unique key). */
  path: string;
  /** Original file basename — never edited. */
  fileName: string;
  /** User-editable display label shown in the UI. */
  displayName: string;
  /** Unix-ms timestamp of the last open. */
  lastOpenedAt: number;
  /** Unix-ms timestamp from the filesystem, when available. */
  lastModifiedAt?: number;
  format: FileFormat;
}

/**
 * Header text that was actually present in the loaded file, keyed by
 * canonical column. Used on save to round-trip the file with the same
 * column names the user already had — no settings lookup involved.
 */
export type LoadedHeaders = Partial<{
  date: string;
  city: string;
  postal_code: string;
  protection_radius_km: string;
  protection_time_months: string;
}>;

export interface ParsedFile {
  events: TourEvent[];
  /** Header names as they appeared in the file. */
  headers: LoadedHeaders;
}
