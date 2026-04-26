import { useState, useCallback, useEffect } from 'react';
import type { TourEvent, ConflictPair, TestEventState } from './types';
import { parseCSVFile, parseCSVText } from './utils/csv';
import { detectConflicts, getTestConflicts } from './utils/conflicts';
import { geocode } from './utils/geo';
import { checkForUpdates } from './utils/updater';
import { useTheme } from './hooks/useTheme';
import { Sidebar } from './components/Sidebar';
import { MapPanel } from './components/MapPanel';

function App() {
  const { theme, toggle: toggleTheme } = useTheme();

  // ── Core data ──────────────────────────────────────────────────────────────
  const [events, setEvents]       = useState<TourEvent[]>([]);
  const [conflicts, setConflicts] = useState<ConflictPair[]>([]);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [loadingMsg, setLoadingMsg]   = useState('');

  // ── Test event ─────────────────────────────────────────────────────────────
  const [testEvent, setTestEvent]             = useState<TestEventState | null>(null);
  const [testConflictIds, setTestConflictIds] = useState<string[]>([]);
  const [isChecking, setIsChecking]           = useState(false);
  const [checkError, setCheckError]           = useState<string | null>(null);

  // ── Shared CSV processing (used by both file-upload and "open with") ───────
  const processCSVText = useCallback(
    async (text: string, label: string) => {
      setIsLoading(true);
      setLoadingMsg(`${label} wird gelesen…`);
      setSelectedId(null);
      setTestEvent(null);
      setTestConflictIds([]);
      setCheckError(null);
      try {
        const parsed = await parseCSVText(text, msg => setLoadingMsg(msg));
        const { updatedEvents, conflicts: detected } = detectConflicts(parsed);
        setEvents(updatedEvents);
        setConflicts(detected);
      } catch (err) {
        console.error('CSV error:', err);
        setLoadingMsg('Fehler beim Lesen der Datei.');
      } finally {
        setIsLoading(false);
        setLoadingMsg('');
      }
    },
    []
  );

  // ── Auto-update check (runs once at startup, no-op outside Tauri) ─────────
  useEffect(() => {
    void checkForUpdates();
  }, []);

  // ── "Open With" — runs once on startup when launched via file association ──
  useEffect(() => {
    (async () => {
      try {
        // Dynamic import keeps the browser dev-server working without Tauri
        // Tauri v2: '@tauri-apps/api/core'
        // Tauri v1: '@tauri-apps/api/tauri'
        const { invoke } = await import('@tauri-apps/api/core');

        const filePath = await invoke<string | null>('get_open_file_path');
        if (!filePath) return;

        const text = await invoke<string>('read_csv_file', { path: filePath });
        const name = filePath.split(/[\\/]/).pop() ?? filePath;
        await processCSVText(text, name);
      } catch {
        // Not running inside Tauri (e.g. plain browser dev) — silently skip
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Manual file upload (drag-and-drop / file picker) ─────────────────────
  const handleFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setLoadingMsg('CSV wird gelesen…');
    setSelectedId(null);
    setTestEvent(null);
    setTestConflictIds([]);
    setCheckError(null);
    try {
      const parsed = await parseCSVFile(file, msg => setLoadingMsg(msg));
      const { updatedEvents, conflicts: detected } = detectConflicts(parsed);
      setEvents(updatedEvents);
      setConflicts(detected);
    } catch (err) {
      console.error('CSV error:', err);
      setLoadingMsg('Fehler beim Lesen der Datei.');
    } finally {
      setIsLoading(false);
      setLoadingMsg('');
    }
  }, []);

  const handleSelectEvent = useCallback((id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  const handleHighlightConflict = useCallback(([idA]: [string, string]) => {
    setSelectedId(idA);
  }, []);

  const handleCheckTest = useCallback(
    async (
      city: string,
      postalCode: string,
      date: string,
      street?: string,
      radiusKm?: number,
      months?: number
    ) => {
      setIsChecking(true);
      setCheckError(null);
      setTestEvent(null);
      setTestConflictIds([]);

      const coords = await geocode(street, postalCode || '', city);
      if (!coords) {
        setCheckError(`Ort "${city || postalCode}" konnte nicht gefunden werden.`);
        setIsChecking(false);
        return;
      }

      const conflictIds = getTestConflicts(
        date, coords.lat, coords.lng, events, radiusKm, months
      );
      setTestEvent({
        latitude: coords.lat,
        longitude: coords.lng,
        city,
        date,
        ...(radiusKm !== undefined ? { protection_radius_km: radiusKm } : {}),
        ...(months   !== undefined ? { protection_time_months: months  } : {}),
      });
      setTestConflictIds(conflictIds);
      setIsChecking(false);
    },
    [events]
  );

  const handleClearTest = useCallback(() => {
    setTestEvent(null);
    setTestConflictIds([]);
    setCheckError(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <Sidebar
        events={events}
        conflicts={conflicts}
        theme={theme}
        onThemeToggle={toggleTheme}
        selectedId={selectedId}
        testConflictIds={testConflictIds}
        hasTestResult={testEvent !== null}
        isLoading={isLoading}
        loadingMsg={loadingMsg}
        isChecking={isChecking}
        checkError={checkError}
        onFile={handleFile}
        onSelectEvent={handleSelectEvent}
        onHighlightConflict={handleHighlightConflict}
        onCheckTest={handleCheckTest}
        onClearTest={handleClearTest}
      />
      <MapPanel
        events={events}
        testConflictIds={testConflictIds}
        testEvent={testEvent}
        selectedId={selectedId}
        theme={theme}
      />
    </div>
  );
}

export default App;