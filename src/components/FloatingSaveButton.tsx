import React from 'react';

interface Props {
  /** True when there are unsaved edits AND a path we can write back to. */
  visible: boolean;
  isSaving: boolean;
  saveMessage: string | null;
  saveError: string | null;
  onSave: () => void;
}

/**
 * Compact icon-only save button rendered on top of the map (top-right).
 * Replaces the row that previously took up vertical space in the sidebar.
 *
 * Visibility rules:
 *   - hidden entirely when there's nothing to save AND no recent
 *     toast/error to surface — keeps the map uncluttered.
 *   - shows the 💾 button while there are unsaved changes.
 *   - shows the ↻ spinner glyph during the save round-trip.
 *   - shows an OK chip for the brief auto-clear window after saving.
 *   - shows the error chip until the user makes another edit.
 */
export const FloatingSaveButton: React.FC<Props> = ({
  visible,
  isSaving,
  saveMessage,
  saveError,
  onSave,
}) => {
  if (!visible && !saveMessage && !saveError) return null;

  return (
    <div className="floating-save">
      {visible && (
        <button
          type="button"
          className="floating-save-btn"
          onClick={onSave}
          disabled={isSaving}
          title="Änderungen in Datei speichern"
          aria-label="Änderungen speichern"
        >
          {isSaving ? '↻' : '⤓'}
        </button>
      )}
      {saveMessage && (
        <div className="floating-save-chip floating-save-chip--ok">
          ✓ {saveMessage}
        </div>
      )}
      {saveError && (
        <div className="floating-save-chip floating-save-chip--err" title={saveError}>
          ✕ Fehler
        </div>
      )}
    </div>
  );
};
