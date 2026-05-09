import type { TourEvent, FileFormat, ParsedFile, LoadedHeaders } from '../types';
import { parseCSVText, parseCSVFile, eventsToCSV } from './csv';
import {
  parseXLSXFromPath,
  parseXLSXFile,
  isXLSXFileName,
  eventsToXLSXBytes,
} from './xlsx';
import { decodeBytes } from './encoding';

/**
 * High-level dispatch helpers that route to CSV or XLSX based on the file
 * suffix. Centralised here so individual UI components don't have to
 * know about the on-disk format — they just hand us a path or a File.
 */

export function detectFormat(name: string): FileFormat {
  return isXLSXFileName(name) ? 'xlsx' : 'csv';
}

/**
 * Parse a file picked via the OS file dialog (drag-and-drop / file picker).
 * The browser already gave us a File object, so we don't need Tauri.
 */
export async function parseAnyFile(
  file: File,
  xlsxSheetName: string,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  if (detectFormat(file.name) === 'xlsx') {
    return parseXLSXFile(file, xlsxSheetName, onProgress);
  }
  return parseCSVFile(file, onProgress);
}

/**
 * Parse a file by absolute path, going through the Tauri backend. Used by
 * the folder browser, the recent-files list and the OS "Open With"
 * association handler.
 */
export async function parseAnyPath(
  path: string,
  xlsxSheetName: string,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  if (detectFormat(path) === 'xlsx') {
    return parseXLSXFromPath(path, xlsxSheetName, onProgress);
  }
  // Read as bytes so windows-1252 / UTF-16 / BOM-prefixed files all decode
  // through the same JS path used by drag-and-drop. The Rust `read_csv_file`
  // command would only succeed on UTF-8.
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<number[]>('read_binary_file', { path });
  const text = decodeBytes(new Uint8Array(bytes));
  return parseCSVText(text, onProgress);
}

/**
 * Write the in-memory events back to the same file the user opened,
 * preserving the original file format. `headers` carry the column names
 * the loaded file actually used, so the roundtrip keeps the user's
 * column naming.
 *
 * Tauri-only — `vite dev` outside Tauri can't write to the filesystem.
 */
export async function saveEventsToPath(
  path: string,
  events: TourEvent[],
  xlsxSheetName: string,
  headers: LoadedHeaders
): Promise<void> {
  let invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  try {
    const mod = await import('@tauri-apps/api/core');
    invoke = mod.invoke as typeof invoke;
  } catch {
    throw new Error('Speichern ist nur in der Desktop-App möglich.');
  }

  if (detectFormat(path) === 'xlsx') {
    const bytes = eventsToXLSXBytes(events, xlsxSheetName, headers);
    await invoke('write_binary_file', {
      path,
      contents: Array.from(bytes),
    });
  } else {
    const text = eventsToCSV(events, headers);
    // Prepend a UTF-8 BOM so German Excel opens it as UTF-8 instead of
    // guessing windows-1252 — same convention the upstream files use.
    await invoke('write_text_file', {
      path,
      contents: '﻿' + text,
    });
  }
}
