import React, { useState, useCallback, useSyncExternalStore } from 'react';
import {
  setPrefetchQueue,
  subscribeCache,
  getCacheState,
} from '../utils/csvCache';

// Mirrors the Rust `CsvNode` enum — the `kind` discriminator is added by
// serde via `#[serde(tag = "kind")]`.
type CsvNode =
  | { kind: 'folder'; name: string; path: string; children: CsvNode[] }
  | { kind: 'file'; name: string; path: string };

interface Props {
  selectedPath: string | null;
  onPickFile: (path: string, name: string) => void;
}

/** Flatten a tree to its leaf file paths, depth-first, alphabetical. */
function flattenFiles(nodes: CsvNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: CsvNode[]) => {
    for (const n of ns) {
      if (n.kind === 'file') out.push(n.path);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// External-store wiring so the tree re-renders when prefetch updates a
// file's cache state. `version` is a monotonically increasing counter
// bumped from `csvCache.subscribeCache`.
let version = 0;
const versionListeners = new Set<() => void>();
subscribeCache(() => {
  version++;
  for (const l of versionListeners) l();
});
function subscribeVersion(cb: () => void): () => void {
  versionListeners.add(cb);
  return () => {
    versionListeners.delete(cb);
  };
}
function getVersion(): number {
  return version;
}
function useCacheVersion(): number {
  return useSyncExternalStore(subscribeVersion, getVersion, getVersion);
}

const TreeNode: React.FC<{
  node: CsvNode;
  depth: number;
  selectedPath: string | null;
  onPickFile: (path: string, name: string) => void;
  expanded: Set<string>;
  toggle: (path: string) => void;
}> = ({ node, depth, selectedPath, onPickFile, expanded, toggle }) => {
  if (node.kind === 'folder') {
    const open = expanded.has(node.path);
    return (
      <div className="ftree-node">
        <button
          type="button"
          className="ftree-row ftree-folder"
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => toggle(node.path)}
          title={node.path}
        >
          <span className="ftree-caret">{open ? '▾' : '▸'}</span>
          <span className="ftree-icon">▣</span>
          <span className="ftree-name">{node.name}</span>
        </button>
        {open && (
          <div className="ftree-children">
            {node.children.map(c => (
              <TreeNode
                key={c.path}
                node={c}
                depth={depth + 1}
                selectedPath={selectedPath}
                onPickFile={onPickFile}
                expanded={expanded}
                toggle={toggle}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = node.path === selectedPath;
  const state = getCacheState(node.path);
  const badge =
    state === 'ready'   ? <span className="ftree-badge ftree-badge--ready"   title="Im Cache">●</span> :
    state === 'pending' ? <span className="ftree-badge ftree-badge--pending" title="Wird geladen…">◐</span> :
    state === 'error'   ? <span className="ftree-badge ftree-badge--error"   title="Fehler beim Laden">!</span> :
    null;

  return (
    <button
      type="button"
      className={`ftree-row ftree-file${isSelected ? ' ftree-file--selected' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onPickFile(node.path, node.name)}
      title={node.path}
    >
      <span className="ftree-caret" />
      <span className="ftree-icon">▤</span>
      <span className="ftree-name">{node.name}</span>
      {badge}
    </button>
  );
};

export const FolderBrowser: React.FC<Props> = ({ selectedPath, onPickFile }) => {
  const [tree, setTree] = useState<CsvNode[]>([]);
  const [rootName, setRootName] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to cache changes so badges in the tree update live.
  useCacheVersion();

  const toggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const pickFolder = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const core = await import('@tauri-apps/api/core');
      const picked = await dialog.open({ directory: true, multiple: false });
      if (typeof picked !== 'string') {
        setBusy(false);
        return;
      }
      const nodes = await core.invoke<CsvNode[]>('scan_csv_folder', { root: picked });
      setTree(nodes);
      setRootName(picked.split(/[\\/]/).pop() || picked);

      // Auto-expand top-level folders so the user sees content immediately.
      const top = new Set<string>();
      for (const n of nodes) if (n.kind === 'folder') top.add(n.path);
      setExpanded(top);

      // Kick off silent background prefetch.
      setPrefetchQueue(flattenFiles(nodes));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const fileCount = flattenFiles(tree).length;

  return (
    <div className="folder-browser">
      <button
        type="button"
        className="upload-btn folder-pick-btn"
        onClick={pickFolder}
        disabled={busy}
      >
        {busy ? '↻  SUCHE…' : '▣  ORDNER WÄHLEN'}
      </button>
      {error && <div className="upload-status upload-status--error">{error}</div>}
      {rootName && (
        <div className="ftree-root-label" title={rootName}>
          <span className="ftree-root-name">{rootName}</span>
          <span className="ftree-root-count">{fileCount} CSV</span>
        </div>
      )}
      {tree.length > 0 && (
        <div className="ftree">
          {tree.map(n => (
            <TreeNode
              key={n.path}
              node={n}
              depth={0}
              selectedPath={selectedPath}
              onPickFile={onPickFile}
              expanded={expanded}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};
