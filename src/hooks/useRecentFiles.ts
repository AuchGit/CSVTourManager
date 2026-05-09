import { useCallback, useEffect, useState } from 'react';
import type { RecentFileEntry, FileFormat } from '../types';

const STORAGE_KEY = 'tp-recent-files-v1';
const MAX_ENTRIES = 30;

function load(): RecentFileEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentFileEntry =>
        e &&
        typeof e.path === 'string' &&
        typeof e.fileName === 'string' &&
        typeof e.displayName === 'string' &&
        typeof e.lastOpenedAt === 'number' &&
        (e.format === 'csv' || e.format === 'xlsx')
    );
  } catch {
    return [];
  }
}

function persist(items: RecentFileEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full / disabled — non-fatal
  }
}

// Module-level state shared across hook consumers, so renaming a label in
// one place updates every list at once.
let entries: RecentFileEntry[] = load();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function commit(next: RecentFileEntry[]) {
  // Always sort newest-first and cap so the list stays tidy.
  next.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES;
  entries = next;
  persist(entries);
  notify();
}

/** Determine the file format from a path or filename. Defaults to csv. */
export function fileFormatFromName(name: string): FileFormat {
  return /\.(xlsx|xlsm|xlsb)$/i.test(name) ? 'xlsx' : 'csv';
}

/**
 * Best-effort filesystem stat via the Tauri backend. Silently returns
 * `undefined` outside Tauri so the UI keeps working in `vite dev`.
 */
async function readLastModified(path: string): Promise<number | undefined> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const meta = await invoke<{ last_modified_ms: number | null; size: number }>(
      'get_file_metadata',
      { path }
    );
    return meta.last_modified_ms ?? undefined;
  } catch {
    return undefined;
  }
}

export function useRecentFiles() {
  const [snapshot, setSnapshot] = useState<RecentFileEntry[]>(entries);

  useEffect(() => {
    const cb = () => setSnapshot(entries);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  /** Record an open. Auto-detects format from the filename suffix. */
  const recordOpen = useCallback(async (path: string, fileName: string) => {
    const now = Date.now();
    const lastModifiedAt = await readLastModified(path);
    const format = fileFormatFromName(fileName);
    const existing = entries.find(e => e.path === path);
    const next: RecentFileEntry = existing
      ? {
          ...existing,
          lastOpenedAt: now,
          ...(lastModifiedAt !== undefined ? { lastModifiedAt } : {}),
          fileName,
          format,
        }
      : {
          path,
          fileName,
          displayName: fileName,
          lastOpenedAt: now,
          ...(lastModifiedAt !== undefined ? { lastModifiedAt } : {}),
          format,
        };
    commit([next, ...entries.filter(e => e.path !== path)]);
  }, []);

  const updateDisplayName = useCallback((path: string, displayName: string) => {
    const idx = entries.findIndex(e => e.path === path);
    if (idx < 0) return;
    const trimmed = displayName.trim() || entries[idx].fileName;
    if (entries[idx].displayName === trimmed) return;
    const next = [...entries];
    next[idx] = { ...next[idx], displayName: trimmed };
    commit(next);
  }, []);

  const remove = useCallback((path: string) => {
    commit(entries.filter(e => e.path !== path));
  }, []);

  const clear = useCallback(() => {
    commit([]);
  }, []);

  return {
    files: snapshot,
    recordOpen,
    updateDisplayName,
    remove,
    clear,
  };
}
