/**
 * On-startup auto-update check.
 *
 * Pulls `latest.json` from the configured GitHub release endpoint, verifies
 * the bundle signature against the pinned public key in `tauri.conf.json`,
 * and — on user confirmation — downloads, installs, and relaunches.
 *
 * Silently no-ops outside the Tauri runtime (e.g. `vite dev` in a plain
 * browser), so importing this module is always safe.
 */
export async function checkForUpdates(): Promise<void> {
  // Only run inside the Tauri runtime. Dynamic imports keep the browser
  // dev-server happy (the @tauri-apps/plugin-* packages throw on import
  // when there's no IPC bridge).
  let check: typeof import('@tauri-apps/plugin-updater').check;
  let relaunch: typeof import('@tauri-apps/plugin-process').relaunch;
  try {
    ({ check } = await import('@tauri-apps/plugin-updater'));
    ({ relaunch } = await import('@tauri-apps/plugin-process'));
  } catch {
    return;
  }

  try {
    const update = await check();
    if (!update) return;

    const ok = window.confirm(
      `Eine neue Version ist verfügbar: ${update.version}\n\n` +
        (update.body ? `${update.body}\n\n` : '') +
        'Jetzt herunterladen und installieren?'
    );
    if (!ok) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (err) {
    console.warn('Update check failed:', err);
  }
}
