import React from 'react';
import type { TourEvent, ConflictPair, Theme } from '../types';
import { ThemeToggle } from './ThemeToggle';
import { CsvUpload } from './CsvUpload';
import { FolderBrowser } from './FolderBrowser';
import { EventList } from './EventList';
import { ConflictPanel } from './ConflictPanel';
import { TestEventForm } from './TestEventForm';

interface Props {
  events: TourEvent[];
  conflicts: ConflictPair[];
  theme: Theme;
  onThemeToggle: () => void;
  selectedId: string | null;
  testConflictIds: string[];
  hasTestResult: boolean;
  isLoading: boolean;
  loadingMsg: string;
  isChecking: boolean;
  checkError: string | null;
  onFile: (file: File) => void;
  selectedFilePath: string | null;
  onPickFile: (path: string, name: string) => void;
  onSelectEvent: (id: string) => void;
  onHighlightConflict: (ids: [string, string]) => void;
  onCheckTest: (
    city: string,
    postalCode: string,
    date: string,
    street?: string,
    radiusKm?: number,
    months?: number
  ) => void;
  onClearTest: () => void;
}

export const Sidebar: React.FC<Props> = ({
  events,
  conflicts,
  theme,
  onThemeToggle,
  selectedId,
  testConflictIds,
  hasTestResult,
  isLoading,
  loadingMsg,
  isChecking,
  checkError,
  onFile,
  selectedFilePath,
  onPickFile,
  onSelectEvent,
  onHighlightConflict,
  onCheckTest,
  onClearTest,
}) => {
  return (
    <aside className="sidebar">
      {/* ── Header ── */}
      <div className="sidebar-head">
        <div className="sidebar-title-row">
          <h1 className="sidebar-title">TOURPLAN</h1>
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        </div>
        <div className="sidebar-subtitle">CONCERT / EVENT MANAGER</div>
      </div>

      {/* ── CSV Upload ── */}
      <div className="sidebar-section">
        <CsvUpload onFile={onFile} isLoading={isLoading} loadingMsg={loadingMsg} />
      </div>

      {/* ── Folder Browser ── */}
      <div className="sidebar-section">
        <FolderBrowser
          selectedPath={selectedFilePath}
          onPickFile={onPickFile}
        />
      </div>

      {/* ── Stats HUD ── */}
      {events.length > 0 && (
        <div className="hud-row">
          <div className="hud-stat">
            <span className="hud-val hud-ok">{events.length}</span>
            <span className="hud-lbl">EVENTS</span>
          </div>
          <div className="hud-stat">
            <span className="hud-val hud-crit">{conflicts.length}</span>
            <span className="hud-lbl">KONFLIKTE</span>
          </div>
          <div className="hud-stat">
            <span className="hud-val hud-test">{testConflictIds.length}</span>
            <span className="hud-lbl">TEST-HITS</span>
          </div>
        </div>
      )}

      {/* ── Event List ── */}
      <div className="section-label">
        EVENTS <span>{events.length}</span>
      </div>
      <div className="event-list-wrap">
        <EventList
          events={events}
          selectedId={selectedId}
          testConflictIds={testConflictIds}
          onSelect={onSelectEvent}
        />
      </div>

      {/* ── Test Form ── */}
      <div className="sidebar-section sidebar-section--border-top">
        <TestEventForm
          onCheck={onCheckTest}
          onClear={onClearTest}
          isChecking={isChecking}
          conflictCount={testConflictIds.length}
          hasResult={hasTestResult}
          error={checkError}
        />
      </div>

      {/* ── Conflict Panel ── */}
      <ConflictPanel conflicts={conflicts} onHighlight={onHighlightConflict} />
    </aside>
  );
};