import React, { useRef } from 'react';

interface Props {
  onFile: (file: File) => void;
  isLoading: boolean;
  loadingMsg: string;
}

export const CsvUpload: React.FC<Props> = ({ onFile, isLoading, loadingMsg }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFile(file);
      e.target.value = ''; // allow re-upload of same file
    }
  };

  return (
    <div className="csv-upload">
      <input
        type="file"
        accept=".csv,text/csv"
        ref={inputRef}
        onChange={handleChange}
        style={{ display: 'none' }}
        aria-hidden
      />
      <button
        className="upload-btn"
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
      >
        {isLoading ? '↻  LÄDT…' : '↑  CSV LADEN'}
      </button>
      {isLoading && loadingMsg && (
        <div className="upload-status">{loadingMsg}</div>
      )}
    </div>
  );
};
