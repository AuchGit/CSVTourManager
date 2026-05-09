import { useState, useCallback, useEffect, useMemo } from 'react';
import type { TourEvent, TestEventState, LoadedHeaders } from './types';
import { normalizePostalCode } from './utils/csv';
import { detectConflicts, getTestConflicts } from './utils/conflicts';
import { geocode } from './utils/geo';
import { checkForUpdates } from './utils/updater';
import { parseAnyFile, parseAnyPath, saveEventsToPath } from './utils/fileIO';
import { useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import { useRecentFiles } from './hooks/useRecentFiles';
import { loadSession, useSessionAutoSave, useSessionState } from './hooks/useSession';
import { useExternalFileWatch } from './hooks/useFileWatch';
import { Sidebar } from './components/Sidebar';
import { MapPanel } from './components/MapPanel';
import { BottomBar } from './components/BottomBar';
import { SettingsModal } from './components/SettingsModal';
import { FloatingSaveButton } from './components/FloatingSaveButton';

function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const { settings, update: updateSettings, reset: resetSettings } = useSettings();
  // Destructure individually so each callback we hand off has a stable
  // reference; the returned object literal would change every render.
  const {
    files: recentFilesList,
    recordOpen: recordRecentFile,
    updateDisplayName: renameRecentFile,
    remove: removeRecentFile,
    clear: clearRecentFiles,
  } = useRecentFiles();

  // ── Session restore ────────────────────────────────────────────────────────
  // Load the previous session's working state once on first render. Static
  // preferences (theme, settings, geocode cache, recent files) live in
  // their own storage keys; this is just the dynamic per-session state.
  const restored = useMemo(() => loadSession(), []);

  // ── Core data ──────────────────────────────────────────────────────────────
  // `events` holds the raw, user-editable values. Status and conflictingIds
  // are derived by the memo below — never stored — so a slider edit gives
  // an instantly accurate map without juggling cascading effects.
  const [events, setEvents] = useState<TourEvent[]>(() => restored?.events ?? []);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    () => restored?.selectedFilePath ?? null
  );
  const [selectedFileName, setSelectedFileName] = useState<string | null>(
    () => restored?.selectedFileName ?? null
  );
  // Headers as they appeared in the loaded file — used on save so we
  // round-trip the user's actual column names instead of inventing them
  // from settings.
  const [loadedHeaders, setLoadedHeaders] = useState<LoadedHeaders>(
    () => restored?.loadedHeaders ?? {}
  );

  // ── UI state ───────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId]   = useState<string | null>(
    () => restored?.selectedId ?? null
  );
  const [isLoading, setIsLoading]     = useState(false);
  const [loadingMsg, setLoadingMsg]   = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => restored?.sidebarCollapsed ?? false
  );

  // ── Test event ─────────────────────────────────────────────────────────────
  const [testEvent, setTestEvent]   = useState<TestEventState | null>(
    () => restored?.testEvent ?? null
  );
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Persist working state across app restarts. Debounced inside the hook
  // so slider drags don't burn one localStorage write per frame.
  const sessionState = useSessionState({
    events,
    selectedFilePath,
    selectedFileName,
    loadedHeaders,
    testEvent,
    selectedId,
    sidebarCollapsed,
  });
  useSessionAutoSave(sessionState);

  // ── Conflict highlight (when a sidebar conflict is clicked) ──────────────
  const [highlightedConflictIds, setHighlightedConflictIds] =
    useState<[string, string] | null>(null);

  // ── External-reload toast ─────────────────────────────────────────────────
  const [externalReloadMsg, setExternalReloadMsg] = useState<string | null>(null);

  // ── Save state ────────────────────────────────────────────────────────────
  const [isSaving, setIsSaving]       = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError]     = useState<string | null>(null);

  // ── Derived: conflict-decorated events + test conflicts ──────────────────
  const detection = useMemo(() => detectConflicts(events), [events]);
  const decoratedEvents = detection.updatedEvents;
  const conflicts = detection.conflicts;

  const testConflictIds = useMemo(() => {
    if (!testEvent) return [];
    return getTestConflicts(
      testEvent.date,
      testEvent.latitude,
      testEvent.longitude,
      decoratedEvents,
      testEvent.protection_radius_km,
      testEvent.protection_time_months
    );
  }, [testEvent, decoratedEvents]);

  const hasUnsavedChanges = useMemo(
    () =>
      events.some(e => {
        if (e.isNew) return true;
        if (!e.original) return false;
        return (
          e.original.protection_radius_km !== e.protection_radius_km ||
          e.original.protection_time_months !== e.protection_time_months
        );
      }),
    [events]
  );

  // ── Auto-update check (runs once at startup, no-op outside Tauri) ─────────
  useEffect(() => {
    void checkForUpdates();
  }, []);

  /** Reset transient state before importing a new dataset. */
  const resetTransient = useCallback(() => {
    setSelectedId(null);
    setTestEvent(null);
    setCheckError(null);
    setSaveMessage(null);
    setSaveError(null);
    // Headers from the previous file would lie about the new one.
    setLoadedHeaders({});
  }, []);

  // ── Manual file upload via browser file picker (no path available) ───────
  const handleFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setLoadingMsg(`${file.name} wird gelesen…`);
      resetTransient();
      // Browser File has no on-disk path we can save back to, so clear it.
      setSelectedFilePath(null);
      setSelectedFileName(file.name);
      try {
        const parsed = await parseAnyFile(file, settings.xlsxSheetName, msg =>
          setLoadingMsg(msg)
        );
        setEvents(parsed.events);
        setLoadedHeaders(parsed.headers);
      } catch (err) {
        console.error('Import error:', err);
        const detail =
          err instanceof Error ? err.message : 'Fehler beim Lesen der Datei.';
        setLoadingMsg(detail);
        await new Promise(r => setTimeout(r, 6000));
      } finally {
        setIsLoading(false);
        setLoadingMsg('');
      }
    },
    [settings.xlsxSheetName, resetTransient]
  );

  /** Path-based load — used by the Tauri dialog, recent files and "open with". */
  const loadFromPath = useCallback(
    async (path: string, name: string) => {
      setSelectedFilePath(path);
      setSelectedFileName(name);
      setIsLoading(true);
      setLoadingMsg(`${name} wird geladen…`);
      resetTransient();

      try {
        const parsed = await parseAnyPath(path, settings.xlsxSheetName, msg =>
          setLoadingMsg(msg)
        );
        setEvents(parsed.events);
        setLoadedHeaders(parsed.headers);
        await recordRecentFile(path, name);
      } catch (err) {
        console.error('Load error:', err);
        const detail =
          err instanceof Error ? err.message : 'Fehler beim Lesen der Datei.';
        setLoadingMsg(detail);
        await new Promise(r => setTimeout(r, 9000));
      } finally {
        setIsLoading(false);
        setLoadingMsg('');
      }
    },
    [settings.xlsxSheetName, resetTransient, recordRecentFile]
  );

  /** Wraps a Tauri-dialog file path: derive the display name and load it. */
  const handleOpenPath = useCallback(
    (path: string) => {
      const name = path.split(/[\\/]/).pop() ?? path;
      void loadFromPath(path, name);
    },
    [loadFromPath]
  );

  // ── "Open With" — runs once on startup when launched via file association ──
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const filePath = await invoke<string | null>('get_open_file_path');
        if (!filePath) return;
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        await loadFromPath(filePath, name);
      } catch {
        // Not running inside Tauri (e.g. plain browser dev) — silently skip
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectEvent = useCallback((id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  /** Map-marker click: always select (no toggle-off), so the matching
   *  row in the sidebar list expands and scrolls into view. */
  const handleMarkerClick = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleHighlightConflict = useCallback(
    (ids: [string, string]) => {
      // Clear the single-event highlight so it doesn't compete with the
      // pair markers, then set the pair — the map controller fits both
      // points into the viewport.
      setSelectedId(null);
      setHighlightedConflictIds(ids);
    },
    []
  );

  // Drop the conflict highlight as soon as either event no longer exists
  // (e.g. external reload removed a row). Derived rather than stored, so
  // we don't trigger a setState-during-effect cascade.
  const effectiveHighlightedIds = useMemo<[string, string] | null>(() => {
    if (!highlightedConflictIds) return null;
    const [a, b] = highlightedConflictIds;
    const ok = events.some(e => e.id === a) && events.some(e => e.id === b);
    return ok ? highlightedConflictIds : null;
  }, [highlightedConflictIds, events]);

  /** Reveal a recent-files entry in the OS file manager. No-op outside Tauri. */
  const handleRevealInFolder = useCallback(async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('reveal_in_folder', { path });
    } catch (err) {
      console.warn('reveal_in_folder failed:', err);
    }
  }, []);

  /** Open a recent-files entry with the OS default app (Excel etc.). */
  const handleOpenInDefaultApp = useCallback(async (path: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_with_default_app', { path });
    } catch (err) {
      console.warn('open_with_default_app failed:', err);
    }
  }, []);

  /** Per-event slider edit. Updates the events array immutably. */
  const handleEventChange = useCallback(
    (id: string, patch: Partial<TourEvent>) => {
      setEvents(prev =>
        prev.map(e => (e.id === id ? { ...e, ...patch } : e))
      );
      setSaveMessage(null);
      setSaveError(null);
    },
    []
  );

  const handleCheckTest = useCallback(
    async (
      city: string,
      postalCode: string,
      date: string,
      radiusKm: number,
      months: number
    ) => {
      setIsChecking(true);
      setCheckError(null);
      setTestEvent(null);

      const normalizedPostal = normalizePostalCode(postalCode || '');
      const coords = await geocode(normalizedPostal, city);
      if (!coords) {
        setCheckError(`Ort "${city || postalCode}" konnte nicht gefunden werden.`);
        setIsChecking(false);
        return;
      }

      setTestEvent({
        latitude: coords.lat,
        longitude: coords.lng,
        city,
        postal_code: normalizedPostal,
        date,
        protection_radius_km: radiusKm,
        protection_time_months: months,
      });
      setIsChecking(false);
    },
    []
  );

  /** Live patch of the existing test event — driven by bottom-bar sliders. */
  const handleUpdateTest = useCallback((patch: Partial<TestEventState>) => {
    setTestEvent(prev => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const handleClearTest = useCallback(() => {
    setTestEvent(null);
    setCheckError(null);
  }, []);

  /** Append the current test event to the events list as a new (dirty) row. */
  const handleAddTestToFile = useCallback(() => {
    if (!testEvent) return;
    const radius = testEvent.protection_radius_km ?? 50;
    const months = testEvent.protection_time_months ?? 6;
    const newEvent: TourEvent = {
      id: crypto.randomUUID(),
      date: testEvent.date,
      city: testEvent.city,
      postal_code: testEvent.postal_code,
      latitude: testEvent.latitude,
      longitude: testEvent.longitude,
      protection_radius_km: radius,
      protection_time_months: months,
      status: 'ok',
      conflictingIds: [],
      isNew: true,
    };
    setEvents(prev => [...prev, newEvent]);
    setTestEvent(null);
    setSaveMessage(null);
    setSaveError(null);
  }, [testEvent]);

  // ── Save changes back to the original file ───────────────────────────────
  const canSave = selectedFilePath !== null;
  const handleSave = useCallback(async () => {
    if (!selectedFilePath) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      await saveEventsToPath(
        selectedFilePath,
        events,
        settings.xlsxSheetName,
        loadedHeaders
      );
      // Snapshot the current values as the new baseline so the dirty
      // markers go back to clean. `isNew` rows graduate to "saved" too.
      setEvents(prev =>
        prev.map(e => ({
          ...e,
          isNew: false,
          original: {
            protection_radius_km: e.protection_radius_km,
            protection_time_months: e.protection_time_months,
          },
        }))
      );
      setSaveMessage('Gespeichert');
      if (selectedFileName) {
        await recordRecentFile(selectedFilePath, selectedFileName);
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedFilePath,
    selectedFileName,
    events,
    settings.xlsxSheetName,
    loadedHeaders,
    recordRecentFile,
  ]);

  // Auto-clear the save toast after a few seconds.
  useEffect(() => {
    if (!saveMessage) return;
    const t = setTimeout(() => setSaveMessage(null), 3000);
    return () => clearTimeout(t);
  }, [saveMessage]);

  // ── External-file watcher: silent reload when another app saves ──────────
  /**
   * Re-parse the on-disk file without resetting transient UI state. Used
   * by the external-change watcher so a save in Excel etc. shows up in
   * place — the user keeps their selection, test event, scroll position.
   */
  const silentReloadFromDisk = useCallback(async () => {
    if (!selectedFilePath) return;
    try {
      const parsed = await parseAnyPath(selectedFilePath, settings.xlsxSheetName);
      setEvents(parsed.events);
      setLoadedHeaders(parsed.headers);
    } catch (err) {
      console.warn('silent reload failed:', err);
    }
  }, [selectedFilePath, settings.xlsxSheetName]);

  useExternalFileWatch(
    selectedFilePath,
    !isLoading && !isSaving,
    useCallback(() => {
      if (hasUnsavedChanges) {
        // Don't blow away the user's edits — surface a hint instead.
        setExternalReloadMsg(
          'Datei wurde extern geändert (ungespeicherte Änderungen, kein Auto-Reload).'
        );
        return;
      }
      void silentReloadFromDisk();
      setExternalReloadMsg('Datei wurde extern aktualisiert');
    }, [hasUnsavedChanges, silentReloadFromDisk])
  );

  // Auto-clear the external-reload toast.
  useEffect(() => {
    if (!externalReloadMsg) return;
    const t = setTimeout(() => setExternalReloadMsg(null), 3500);
    return () => clearTimeout(t);
  }, [externalReloadMsg]);

  // ── Window title: "<displayName> - <fileName>" with dirty marker ─────────
  useEffect(() => {
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        if (!selectedFileName) {
          await win.setTitle('TourManager');
          return;
        }
        const recent = recentFilesList.find(
          r => r.path === selectedFilePath
        );
        const display = recent?.displayName ?? selectedFileName;
        const dirtyPrefix = hasUnsavedChanges ? '● ' : '';
        const composed =
          display && display !== selectedFileName
            ? `${dirtyPrefix}${display} — ${selectedFileName}`
            : `${dirtyPrefix}${selectedFileName}`;
        await win.setTitle(`${composed} — TourManager`);
      } catch {
        // Outside Tauri (vite dev): best-effort document.title.
        if (selectedFileName) {
          document.title = `${
            hasUnsavedChanges ? '● ' : ''
          }${selectedFileName} — TourManager`;
        } else {
          document.title = 'TourManager';
        }
      }
    })();
  }, [selectedFilePath, selectedFileName, recentFilesList, hasUnsavedChanges]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`app${sidebarCollapsed ? ' app--sidebar-collapsed' : ''}`}>
      <Sidebar
        events={decoratedEvents}
        conflicts={conflicts}
        theme={theme}
        onThemeToggle={toggleTheme}
        selectedId={selectedId}
        testConflictIds={testConflictIds}
        isLoading={isLoading}
        loadingMsg={loadingMsg}
        onPath={handleOpenPath}
        onFile={handleFile}
        selectedFilePath={selectedFilePath}
        onPickFile={loadFromPath}
        onSelectEvent={handleSelectEvent}
        onEventChange={handleEventChange}
        onHighlightConflict={handleHighlightConflict}
        onOpenSettings={() => setSettingsOpen(true)}
        recentFiles={recentFilesList}
        onRenameRecent={renameRecentFile}
        onRemoveRecent={removeRecentFile}
        onClearRecent={clearRecentFiles}
        onRevealInFolder={handleRevealInFolder}
        onOpenInDefaultApp={handleOpenInDefaultApp}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
      />
      <div className="main-pane">
        <MapPanel
          events={decoratedEvents}
          testConflictIds={testConflictIds}
          testEvent={testEvent}
          selectedId={selectedId}
          theme={theme}
          highlightedConflictIds={effectiveHighlightedIds}
          sidebarCollapsed={sidebarCollapsed}
          onSelectEvent={handleMarkerClick}
        />
        <FloatingSaveButton
          visible={canSave && hasUnsavedChanges}
          isSaving={isSaving}
          saveMessage={saveMessage}
          saveError={saveError}
          onSave={handleSave}
        />
        {externalReloadMsg && (
          <div className="external-reload-toast" role="status">
            {externalReloadMsg}
          </div>
        )}
        <BottomBar
          testEvent={testEvent}
          isChecking={isChecking}
          error={checkError}
          hasFileOpen={selectedFilePath !== null}
          onCheck={handleCheckTest}
          onUpdate={handleUpdateTest}
          onClear={handleClearTest}
          onSaveToFile={handleAddTestToFile}
        />
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onUpdate={updateSettings}
        onReset={resetSettings}
      />
    </div>
  );
}

export default App;
