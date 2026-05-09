import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'tp-settings-v1';
const SETTINGS_VERSION = 3;

/**
 * Canonical column keys we use internally. Each key holds a list of
 * accepted spreadsheet header aliases. All entries are matched case-
 * and whitespace-insensitively at parse time. The list has no
 * "primary" semantic — saving a file uses whatever header text was
 * actually in the loaded file (see `LoadedHeaders`), so user-added
 * aliases here are purely for matching incoming files.
 */
export type CanonicalColumn =
  | 'date'
  | 'city'
  | 'postal_code'
  | 'protection_radius_km'
  | 'protection_time_months';

export const CANONICAL_COLUMNS: readonly CanonicalColumn[] = [
  'date',
  'city',
  'postal_code',
  'protection_radius_km',
  'protection_time_months',
] as const;

/** Human-readable label per canonical key, used in the Settings UI. */
export const COLUMN_LABELS: Record<CanonicalColumn, string> = {
  date: 'DATUM',
  city: 'ORT',
  postal_code: 'PLZ',
  protection_radius_km: 'GEBIETSSCHUTZ',
  protection_time_months: 'MONATSSCHUTZ',
};

export type ColumnAliases = Record<CanonicalColumn, string[]>;

/**
 * Default alias list — exactly one German primary per column.
 * Users can add additional aliases (English variants, project-specific
 * names, …) via the Settings UI. Adding a new alias never removes the
 * old ones until they're explicitly deleted.
 */
export const DEFAULT_COLUMN_ALIASES: ColumnAliases = {
  date: ['Datum'],
  city: ['Ort'],
  postal_code: ['PLZ'],
  protection_radius_km: ['Gebietsschutz'],
  protection_time_months: ['Monatsschutz'],
};

export interface AppSettings {
  /**
   * Schema version — bumped when the shape changes incompatibly so we
   * can fall back to defaults instead of crashing on a stale blob.
   */
  version: number;
  /** Worksheet name used when reading XLSX files. */
  xlsxSheetName: string;
  /** Per-canonical-column list of accepted header names. */
  columnAliases: ColumnAliases;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  xlsxSheetName: 'GBS',
  columnAliases: DEFAULT_COLUMN_ALIASES,
};

function cloneDefaults(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    columnAliases: cloneAliases(DEFAULT_COLUMN_ALIASES),
  };
}

function cloneAliases(src: ColumnAliases): ColumnAliases {
  const out = {} as ColumnAliases;
  for (const key of CANONICAL_COLUMNS) out[key] = [...(src[key] ?? [])];
  return out;
}

function loadFromStorage(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // Hard schema-version gate: drop persisted blobs from older versions
    // so removed canonical columns (e.g. street) don't linger.
    if (parsed.version !== SETTINGS_VERSION) return cloneDefaults();

    const aliases: ColumnAliases = cloneAliases(DEFAULT_COLUMN_ALIASES);
    if (parsed.columnAliases && typeof parsed.columnAliases === 'object') {
      for (const key of CANONICAL_COLUMNS) {
        const arr = (parsed.columnAliases as Partial<ColumnAliases>)[key];
        if (Array.isArray(arr)) {
          aliases[key] = arr.filter(s => typeof s === 'string');
        }
      }
    }
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      columnAliases: aliases,
      version: SETTINGS_VERSION,
    };
  } catch {
    return cloneDefaults();
  }
}

function persist(s: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage full / disabled — non-fatal
  }
}

// Module-level state so every component sees the same instance and
// updates flow through a single subscription channel.
let current: AppSettings = loadFromStorage();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Read the live settings outside of a React component (e.g. in utilities). */
export function getSettings(): AppSettings {
  return current;
}

/** Update one or more settings values. Persists and notifies subscribers. */
export function updateSettings(patch: Partial<AppSettings>): void {
  current = {
    ...current,
    ...patch,
    columnAliases: patch.columnAliases ?? current.columnAliases,
    version: SETTINGS_VERSION,
  };
  persist(current);
  notify();
}

/** Reset to defaults (used by the "Restore defaults" button in the UI). */
export function resetSettings(): void {
  current = cloneDefaults();
  persist(current);
  notify();
}

export function useSettings(): {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => void;
} {
  const [snapshot, setSnapshot] = useState<AppSettings>(current);

  useEffect(() => {
    const cb = () => setSnapshot(current);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    updateSettings(patch);
  }, []);

  const reset = useCallback(() => {
    resetSettings();
  }, []);

  return { settings: snapshot, update, reset };
}
