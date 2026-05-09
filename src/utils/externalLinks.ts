/**
 * Send any clicked external `<a href>` (http/https/mailto) to the OS
 * browser instead of letting the Tauri WebView navigate. Keeps the
 * desktop app feeling like a desktop app — links to OpenStreetMap,
 * Carto, GitHub etc. open in Chrome/Safari/etc., not inside our
 * window.
 *
 * Called once at startup from `main.tsx`. Outside Tauri we fall back to
 * `window.open` so `vite dev` still works.
 */
export function installExternalLinkInterceptor(): void {
  document.addEventListener('click', async (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const target = e.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute('href') ?? '';
    if (!/^(https?:|mailto:)/i.test(href)) return;
    // In-page anchors / framework routing: let those through.
    if (anchor.target === '_self') return;

    e.preventDefault();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_external_url', { url: href });
    } catch {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  });
}
