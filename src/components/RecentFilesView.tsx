import React, { useState, useCallback, useMemo } from 'react';
import type { RecentFileEntry } from '../types';

type SortKey = 'opened' | 'modified';

interface Props {
  files: RecentFileEntry[];
  selectedPath: string | null;
  onPickFile: (path: string, name: string) => void;
  onRename: (path: string, displayName: string) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
  /** Reveal a file in the OS file manager (Explorer / Finder). */
  onRevealInFolder: (path: string) => void;
  /** Open a file with the OS default app (Excel for xlsx etc.). */
  onOpenInDefaultApp: (path: string) => void;
}

const SORT_STORAGE_KEY = 'tp-recent-sort-v1';

function loadSort(): SortKey {
  const v = localStorage.getItem(SORT_STORAGE_KEY);
  return v === 'modified' ? 'modified' : 'opened';
}
function saveSort(v: SortKey): void {
  try { localStorage.setItem(SORT_STORAGE_KEY, v); } catch { /* non-fatal */ }
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'gerade eben';
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} Std`;
  const day = Math.round(hr / 24);
  if (day < 30) return `vor ${day} Tg`;
  return new Date(ms).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function fmtAbs(ms: number): string {
  return new Date(ms).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const RecentFileRow: React.FC<{
  entry: RecentFileEntry;
  isSelected: boolean;
  onPick: () => void;
  onRename: (next: string) => void;
  onRemove: () => void;
  onRevealInFolder: () => void;
  onOpenInDefaultApp: () => void;
}> = ({ entry, isSelected, onPick, onRename, onRemove, onRevealInFolder, onOpenInDefaultApp }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.displayName);

  const startEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(entry.displayName);
    setEditing(true);
  }, [entry.displayName]);

  const commit = useCallback(() => {
    setEditing(false);
    onRename(draft);
  }, [draft, onRename]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(entry.displayName);
  }, [entry.displayName]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  };

  return (
    <div
      className={`recent-row${isSelected ? ' recent-row--selected' : ''}`}
      onClick={onPick}
      title={entry.path}
    >
      <div className="recent-main">
        {editing ? (
          <input
            className="recent-name-input"
            value={draft}
            autoFocus
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKey}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <div className="recent-name">{entry.displayName}</div>
        )}
        <div className="recent-sub">
          <span title={entry.fileName}>{entry.fileName}</span>
        </div>
        <div className="recent-meta">
          <span title={`Geöffnet: ${fmtAbs(entry.lastOpenedAt)}`}>
            ↑ {fmtRelative(entry.lastOpenedAt)}
          </span>
          {entry.lastModifiedAt !== undefined && (
            <span title={`Geändert: ${fmtAbs(entry.lastModifiedAt)}`}>
              ✎ {fmtRelative(entry.lastModifiedAt)}
            </span>
          )}
        </div>
      </div>
      <div className="recent-actions">
        <button
          type="button"
          className="recent-action-btn"
          title="Im Dateimanager anzeigen"
          aria-label="Im Dateimanager anzeigen"
          onClick={e => {
            e.stopPropagation();
            onRevealInFolder();
          }}
        >
          ▣
        </button>
        <button
          type="button"
          className="recent-action-btn"
          title="Mit Standard-App öffnen (z. B. Excel)"
          aria-label="Mit Standard-App öffnen"
          onClick={e => {
            e.stopPropagation();
            onOpenInDefaultApp();
          }}
        >
          ↗
        </button>
        <button
          type="button"
          className="recent-action-btn"
          title="Umbenennen"
          aria-label="Umbenennen"
          onClick={startEdit}
        >
          ✎
        </button>
        <button
          type="button"
          className="recent-action-btn recent-action-btn--danger"
          title="Aus Liste entfernen"
          aria-label="Aus Liste entfernen"
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
};

export const RecentFilesView: React.FC<Props> = ({
  files,
  selectedPath,
  onPickFile,
  onRename,
  onRemove,
  onClear,
  onRevealInFolder,
  onOpenInDefaultApp,
}) => {
  const [sort, setSort] = useState<SortKey>(() => loadSort());

  const sortedFiles = useMemo(() => {
    if (sort === 'opened') {
      return [...files].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    }
    return [...files].sort(
      (a, b) => (b.lastModifiedAt ?? 0) - (a.lastModifiedAt ?? 0)
    );
  }, [files, sort]);

  const toggleSort = useCallback(() => {
    setSort(prev => {
      const next: SortKey = prev === 'opened' ? 'modified' : 'opened';
      saveSort(next);
      return next;
    });
  }, []);

  if (files.length === 0) {
    return (
      <div className="empty-state">
        Noch keine zuletzt geöffneten Dateien.
        <br />
        Eine CSV oder XLSX laden, um die Liste zu füllen.
      </div>
    );
  }

  return (
    <div className="recent-list">
      <div className="recent-list-head">
        <button
          type="button"
          className="recent-sort-btn"
          onClick={toggleSort}
          title={
            sort === 'opened'
              ? 'Sortiert nach: zuletzt geöffnet — klicken für „zuletzt bearbeitet“'
              : 'Sortiert nach: zuletzt bearbeitet — klicken für „zuletzt geöffnet“'
          }
        >
          ⇅ {sort === 'opened' ? 'Geöffnet' : 'Bearbeitet'}
        </button>
        <span className="recent-count">
          {files.length} Eintr{files.length === 1 ? 'ag' : 'äge'}
        </span>
        <button
          type="button"
          className="recent-clear-btn"
          onClick={onClear}
          title="Liste leeren"
        >
          Leeren
        </button>
      </div>
      {sortedFiles.map(f => (
        <RecentFileRow
          key={f.path}
          entry={f}
          isSelected={f.path === selectedPath}
          onPick={() => onPickFile(f.path, f.fileName)}
          onRename={next => onRename(f.path, next)}
          onRemove={() => onRemove(f.path)}
          onRevealInFolder={() => onRevealInFolder(f.path)}
          onOpenInDefaultApp={() => onOpenInDefaultApp(f.path)}
        />
      ))}
    </div>
  );
};
