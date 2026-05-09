import React, { useState, useCallback } from 'react';
import type { TourEvent, ConflictPair, Theme, RecentFileEntry } from '../types';
import { ThemeToggle } from './ThemeToggle';
import { CsvUpload } from './CsvUpload';
import { EventList } from './EventList';
import { ConflictPanel } from './ConflictPanel';
import { RecentFilesView } from './RecentFilesView';

type SidebarView = 'events' | 'recent';

interface Props {
  events: TourEvent[];
  conflicts: ConflictPair[];
  theme: Theme;
  onThemeToggle: () => void;
  selectedId: string | null;
  testConflictIds: string[];
  isLoading: boolean;
  loadingMsg: string;
  onPath: (path: string) => void;
  onFile: (file: File) => void;
  selectedFilePath: string | null;
  onPickFile: (path: string, name: string) => void;
  onSelectEvent: (id: string) => void;
  onEventChange: (id: string, patch: Partial<TourEvent>) => void;
  onHighlightConflict: (ids: [string, string]) => void;
  onOpenSettings: () => void;
  recentFiles: RecentFileEntry[];
  onRenameRecent: (path: string, displayName: string) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
  onRevealInFolder: (path: string) => void;
  onOpenInDefaultApp: (path: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export const Sidebar: React.FC<Props> = ({
  events,
  conflicts,
  theme,
  onThemeToggle,
  selectedId,
  testConflictIds,
  isLoading,
  loadingMsg,
  onPath,
  onFile,
  selectedFilePath,
  onPickFile,
  onSelectEvent,
  onEventChange,
  onHighlightConflict,
  onOpenSettings,
  recentFiles,
  onRenameRecent,
  onRemoveRecent,
  onClearRecent,
  onRevealInFolder,
  onOpenInDefaultApp,
  collapsed,
  onToggleCollapsed,
}) => {
  const [view, setView] = useState<SidebarView>('events');
  const switchView = useCallback((next: SidebarView) => setView(next), []);

  if (collapsed) {
    return (
      <aside className="sidebar sidebar--collapsed">
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title="Sidebar einblenden"
          aria-label="Expand sidebar"
        >
          ▸
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      {/* ── Header ── */}
      <div className="sidebar-head">
        <div className="sidebar-title-row">
          <h1 className="sidebar-title">TOURPLAN</h1>
          <div className="sidebar-head-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={onOpenSettings}
              title="Einstellungen"
              aria-label="Einstellungen öffnen"
            >
              ⚙
            </button>
            <ThemeToggle theme={theme} onToggle={onThemeToggle} />
            <button
              type="button"
              className="theme-toggle"
              onClick={onToggleCollapsed}
              title="Sidebar einklappen"
              aria-label="Collapse sidebar"
            >
              ◂
            </button>
          </div>
        </div>
        <div className="sidebar-subtitle">CONCERT / EVENT MANAGER</div>
      </div>

      {/* ── File upload ── */}
      <div className="sidebar-section">
        <CsvUpload
          onPath={onPath}
          onFile={onFile}
          isLoading={isLoading}
          loadingMsg={loadingMsg}
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

      {/* ── View toggle ── */}
      <div className="sidebar-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'events'}
          className={`sidebar-tab${view === 'events' ? ' sidebar-tab--active' : ''}`}
          onClick={() => switchView('events')}
        >
          EVENTS <span className="sidebar-tab-count">{events.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'recent'}
          className={`sidebar-tab${view === 'recent' ? ' sidebar-tab--active' : ''}`}
          onClick={() => switchView('recent')}
        >
          ZULETZT <span className="sidebar-tab-count">{recentFiles.length}</span>
        </button>
      </div>

      {/* ── Body: events or recent files ── */}
      <div className="sidebar-body">
        {view === 'events' ? (
          <EventList
            events={events}
            selectedId={selectedId}
            testConflictIds={testConflictIds}
            onSelect={onSelectEvent}
            onChange={onEventChange}
          />
        ) : (
          <RecentFilesView
            files={recentFiles}
            selectedPath={selectedFilePath}
            onPickFile={onPickFile}
            onRename={onRenameRecent}
            onRemove={onRemoveRecent}
            onClear={onClearRecent}
            onRevealInFolder={onRevealInFolder}
            onOpenInDefaultApp={onOpenInDefaultApp}
          />
        )}
      </div>

      {/* ── Conflict Panel ── */}
      <ConflictPanel conflicts={conflicts} onHighlight={onHighlightConflict} />
    </aside>
  );
};
