import { useEffect, useRef } from 'react';

/**
 * Lightweight polling-based external-file watcher.
 *
 * We avoid the `tauri-plugin-fs` watcher to keep the dependency surface
 * small — a 2.5s `mtime` poll is fine for human edit cadence and cheap
 * (a single `stat` call per tick). Outside of Tauri the hook is a
 * no-op, so `vite dev` keeps working.
 *
 * The callback only fires when the file's last-modified timestamp is
 * STRICTLY greater than the previously observed value, so the first
 * poll after mounting just captures the baseline without re-firing.
 */
export function useExternalFileWatch(
  path: string | null,
  enabled: boolean,
  onExternalChange: () => void,
  intervalMs = 2500
): void {
  // Stable ref so changing the callback doesn't restart the poller.
  const cb = useRef(onExternalChange);
  useEffect(() => {
    cb.current = onExternalChange;
  }, [onExternalChange]);

  useEffect(() => {
    if (!path || !enabled) return;
    let cancelled = false;
    let lastMtime: number | undefined;

    const tick = async () => {
      if (cancelled || !path) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const meta = await invoke<{ last_modified_ms: number | null }>(
          'get_file_metadata',
          { path }
        );
        if (cancelled) return;
        const mtime = meta.last_modified_ms ?? undefined;
        if (mtime === undefined) return;
        if (lastMtime === undefined) {
          lastMtime = mtime;
          return;
        }
        if (mtime > lastMtime) {
          lastMtime = mtime;
          cb.current();
        }
      } catch {
        // Outside Tauri or transient FS error — silently ignore.
      }
    };

    void tick(); // baseline immediately
    const id = window.setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [path, enabled, intervalMs]);
}
