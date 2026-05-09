import { useEffect, useMemo, useRef } from 'react';
import type { TourEvent, TestEventState, LoadedHeaders } from '../types';

const STORAGE_KEY = 'tp-session-v1';
const SESSION_VERSION = 2;
const SAVE_DEBOUNCE_MS = 500;

/**
 * Working-state snapshot persisted across app restarts. The "static"
 * preferences (theme, settings, geocode cache, recent files) live in
 * their own storage keys so wiping a stale session never drops them.
 *
 * Versioned so we can change the shape later without crashing on a
 * stale blob — `loadSession` returns null when the version doesn't
 * match and the app falls back to defaults.
 */
export interface SessionState {
  version: number;
  events: TourEvent[];
  selectedFilePath: string | null;
  selectedFileName: string | null;
  /** Header text that was present in the loaded file, by canonical key. */
  loadedHeaders: LoadedHeaders;
  testEvent: TestEventState | null;
  selectedId: string | null;
  sidebarCollapsed: boolean;
}

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionState;
    if (parsed?.version !== SESSION_VERSION) return null;
    if (!Array.isArray(parsed.events)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

/**
 * Persist the supplied session blob whenever it changes, debounced so
 * slider drags don't trigger one localStorage write per frame. A
 * `beforeunload` listener flushes the latest value via the same effect
 * closure so a quick edit-and-quit doesn't lose work.
 */
export function useSessionAutoSave(state: SessionState): void {
  // Sync latest state into a ref inside an effect (writing during render
  // is not allowed). The flush handlers always read from the ref.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  // Debounced write on every change.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current));
      } catch {
        // localStorage full / disabled — non-fatal
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state]);

  // Final flush on window close so a quick edit-and-quit isn't lost.
  useEffect(() => {
    const flush = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(latest.current));
      } catch {
        // non-fatal
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);
}

/** Compose a SessionState memo from the individual pieces of App state. */
export function useSessionState(args: Omit<SessionState, 'version'>): SessionState {
  return useMemo<SessionState>(
    () => ({
      version: SESSION_VERSION,
      events: args.events,
      selectedFilePath: args.selectedFilePath,
      selectedFileName: args.selectedFileName,
      loadedHeaders: args.loadedHeaders,
      testEvent: args.testEvent,
      selectedId: args.selectedId,
      sidebarCollapsed: args.sidebarCollapsed,
    }),
    [
      args.events,
      args.selectedFilePath,
      args.selectedFileName,
      args.loadedHeaders,
      args.testEvent,
      args.selectedId,
      args.sidebarCollapsed,
    ]
  );
}
