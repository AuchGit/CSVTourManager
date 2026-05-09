import React, { useEffect, useState, useCallback } from 'react';
import {
  type AppSettings,
  type ColumnAliases,
  type CanonicalColumn,
  CANONICAL_COLUMNS,
  COLUMN_LABELS,
} from '../hooks/useSettings';

interface Props {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
}

interface InnerProps {
  settings: AppSettings;
  onClose: () => void;
  onUpdate: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
}

interface AliasEditorProps {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
}

/**
 * Chip-list editor for one canonical column's accepted header names.
 *
 * - First chip is the "primary" — used when writing the file back. Its
 *   chip is styled differently to make this obvious.
 * - Add by typing into the input and hitting Enter or clicking +.
 * - Remove via the × on each chip.
 * - Click any non-primary chip to promote it to primary.
 */
const AliasEditor: React.FC<AliasEditorProps> = React.memo(({
  label, values, onChange,
}) => {
  const [draft, setDraft] = useState('');

  const add = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    if (values.some(v => v.toLowerCase() === next.toLowerCase())) {
      // Already in the list — just clear the input.
      setDraft('');
      return;
    }
    onChange([...values, next]);
    setDraft('');
  }, [draft, values, onChange]);

  const remove = useCallback(
    (i: number) => onChange(values.filter((_, idx) => idx !== i)),
    [values, onChange]
  );

  const promote = useCallback(
    (i: number) => {
      if (i === 0) return;
      const next = [...values];
      const [item] = next.splice(i, 1);
      next.unshift(item);
      onChange(next);
    },
    [values, onChange]
  );

  return (
    <div className="alias-editor">
      <div className="alias-editor-label">{label}</div>
      <div className="alias-chips">
        {values.length === 0 && (
          <span className="alias-chip-empty">Keine Feldnamen — beim Import wird diese Spalte ignoriert.</span>
        )}
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className={`alias-chip${i === 0 ? ' alias-chip--primary' : ''}`}
            title={
              i === 0
                ? 'Primärer Feldname — wird beim Speichern verwendet.'
                : 'Klicken, um als primären Feldnamen festzulegen.'
            }
            onClick={() => promote(i)}
          >
            {v}
            <button
              type="button"
              className="alias-chip-remove"
              aria-label={`"${v}" entfernen`}
              onClick={e => {
                e.stopPropagation();
                remove(i);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="alias-add">
        <input
          type="text"
          className="alias-add-input"
          value={draft}
          placeholder="Neuer Feldname…"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="alias-add-btn"
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Hinzufügen"
        >
          +
        </button>
      </div>
    </div>
  );
});

/**
 * Inner component holds the editable draft. Mounted only when the dialog
 * is open and re-mounted (via the parent's `key`) whenever settings
 * change from outside.
 */
const SettingsModalInner: React.FC<InnerProps> = ({
  settings,
  onClose,
  onUpdate,
  onReset,
}) => {
  const [draft, setDraft] = useState<AppSettings>(settings);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const updateAliases = useCallback((key: CanonicalColumn, next: string[]) => {
    setDraft(prev => {
      const aliases: ColumnAliases = { ...prev.columnAliases, [key]: next };
      return { ...prev, columnAliases: aliases };
    });
  }, []);

  const save = () => {
    onUpdate({
      xlsxSheetName: draft.xlsxSheetName.trim() || 'GBS',
      columnAliases: draft.columnAliases,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-labelledby="settings-title"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="settings-title" className="modal-title">EINSTELLUNGEN</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <section className="settings-section">
            <h3 className="settings-section-title">XLSX-IMPORT</h3>
            <div className="form-field">
              <label htmlFor="settings-sheet-name">
                STANDARD-ARBEITSBLATT
              </label>
              <input
                id="settings-sheet-name"
                type="text"
                value={draft.xlsxSheetName}
                placeholder="GBS"
                onChange={e =>
                  setDraft(d => ({ ...d, xlsxSheetName: e.target.value }))
                }
              />
              <div className="settings-hint">
                Name des Tabellenblatts in XLSX-Dateien. Falls dieses Blatt
                nicht existiert, wird das erste verfügbare Blatt verwendet.
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">SPALTEN-NAMEN (CSV &amp; XLSX)</h3>
            <div className="settings-hint settings-hint--top">
              Welche Spaltenüberschriften in der Datei der jeweiligen
              Eigenschaft entsprechen. Mehrere Aliase pro Spalte sind
              erlaubt — der erste Eintrag wird beim Speichern als primärer
              Spaltenname geschrieben.
            </div>
            {CANONICAL_COLUMNS.map(key => (
              <AliasEditor
                key={key}
                label={COLUMN_LABELS[key]}
                values={draft.columnAliases[key] ?? []}
                onChange={next => updateAliases(key, next)}
              />
            ))}
          </section>
        </div>

        <div className="modal-foot">
          <button
            type="button"
            className="clear-btn"
            onClick={onReset}
            title="Auf Standardwerte zurücksetzen"
          >
            ZURÜCKSETZEN
          </button>
          <div className="modal-foot-spacer" />
          <button type="button" className="clear-btn" onClick={onClose}>
            ABBRECHEN
          </button>
          <button type="button" className="check-btn" onClick={save}>
            SPEICHERN
          </button>
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<Props> = ({
  open,
  settings,
  onClose,
  onUpdate,
  onReset,
}) => {
  if (!open) return null;
  // Mount the inner with a key bound to the current settings reference —
  // a hard reset (e.g. user clicked "Zurücksetzen") swaps the reference
  // and the inner remounts with a fresh draft.
  return (
    <SettingsModalInner
      key={settings.version + ':' + settings.xlsxSheetName}
      settings={settings}
      onClose={onClose}
      onUpdate={onUpdate}
      onReset={onReset}
    />
  );
};
