import React, { useCallback, useRef } from 'react';

interface Props {
  /** Called with an absolute filesystem path (Tauri dialog). */
  onPath: (path: string) => void;
  /** Called with a browser File when running outside Tauri. */
  onFile: (file: File) => void;
  isLoading: boolean;
  loadingMsg: string;
}

/**
 * File-upload button. In Tauri it opens the native file dialog so we get
 * a real filesystem path — which feeds Save and Recent Files. In a plain
 * browser (vite dev) it falls back to an `<input type="file">` File.
 */
export const CsvUpload: React.FC<Props> = ({ onPath, onFile, isLoading, loadingMsg }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(async () => {
    try {
      const dialog = await import('@tauri-apps/plugin-dialog');
      const picked = await dialog.open({
        multiple: false,
        filters: [
          { name: 'Tabellen', extensions: ['csv', 'xlsx', 'xlsm', 'xlsb'] },
          { name: 'CSV', extensions: ['csv'] },
          { name: 'Excel', extensions: ['xlsx', 'xlsm', 'xlsb'] },
        ],
      });
      if (typeof picked === 'string') {
        onPath(picked);
      }
      return;
    } catch {
      // No Tauri dialog available — fall back to the browser file input.
    }
    inputRef.current?.click();
  }, [onPath]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFile(file);
      e.target.value = '';
    }
  };

  return (
    <div className="csv-upload">
      <input
        type="file"
        accept=".csv,text/csv,.xlsx,.xlsm,.xlsb,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ref={inputRef}
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-hidden
      />
      <button
        className="upload-btn"
        onClick={handleClick}
        disabled={isLoading}
      >
        {isLoading ? '↻  LÄDT…' : '↑  DATEI LADEN'}
      </button>
      {isLoading && loadingMsg && (
        <div className="upload-status">{loadingMsg}</div>
      )}
    </div>
  );
};
