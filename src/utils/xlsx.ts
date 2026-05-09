import * as XLSX from 'xlsx';
import type { ParsedFile, LoadedHeaders, TourEvent } from '../types';
import { parseCSVText, eventsToTable } from './csv';

/**
 * `.xlsx`, `.xlsm` and `.xlsb` all parse through the same SheetJS reader.
 */
export function isXLSXFileName(name: string): boolean {
  return /\.(xlsx|xlsm|xlsb)$/i.test(name);
}

/**
 * Parse an XLSX/XLSM/XLSB workbook.
 *
 * The `sheetName` is the user-configurable preference (defaults to "GBS").
 * If that sheet doesn't exist we fall back to the first non-empty sheet so
 * the user always gets *something* — and surface a friendly progress
 * message so they know we substituted.
 *
 * Internally we let SheetJS render the worksheet to CSV and then reuse
 * the existing CSV parser, so all date / PLZ / column-alias normalisation
 * lives in exactly one place.
 *
 * Input is a Uint8Array (not ArrayBuffer) — SheetJS's `type: 'array'`
 * mode expects a byte array, and ArrayBuffer doesn't quack like one.
 */
export async function parseXLSXBuffer(
  data: Uint8Array,
  sheetName: string,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  let workbook: XLSX.WorkBook;
  try {
    // `cellDates: true` converts Excel serial dates into JS Date objects
    // so `dateNF` below can stamp them as ISO yyyy-mm-dd.
    workbook = XLSX.read(data, { type: 'array', cellDates: true });
  } catch (err) {
    throw new Error(
      `XLSX-Datei konnte nicht gelesen werden: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const sheets = workbook.SheetNames;
  if (sheets.length === 0) {
    throw new Error('XLSX-Datei enthält keine Arbeitsblätter.');
  }

  // Case-insensitive lookup so "gbs", "GBS" and "Gbs" all match — Excel
  // sheets are sometimes inconsistently capitalised across templates.
  const normalized = sheetName.trim().toLowerCase();
  const targetName =
    sheets.find(s => s.toLowerCase() === normalized) ?? sheets[0];

  if (targetName !== sheetName) {
    onProgress?.(
      `Sheet "${sheetName}" nicht gefunden — verwende "${targetName}".`
    );
  }

  const worksheet = workbook.Sheets[targetName];
  if (!worksheet) {
    throw new Error(`Arbeitsblatt "${targetName}" konnte nicht gelesen werden.`);
  }

  // Render to CSV (semicolon delimiter matches German Excel) and reuse
  // parseCSVText so the column-alias logic only lives in one place.
  const csv = XLSX.utils.sheet_to_csv(worksheet, {
    FS: ';',
    dateNF: 'yyyy-mm-dd',
  });

  return parseCSVText(csv, onProgress);
}

/** Read a workbook from an absolute filesystem path via Tauri. */
export async function parseXLSXFromPath(
  path: string,
  sheetName: string,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = await invoke<number[]>('read_binary_file', { path });
  return parseXLSXBuffer(new Uint8Array(bytes), sheetName, onProgress);
}

/** Read an XLSX File handed in from a browser drag-and-drop / file picker. */
export async function parseXLSXFile(
  file: File,
  sheetName: string,
  onProgress?: (msg: string) => void
): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  return parseXLSXBuffer(new Uint8Array(buf), sheetName, onProgress);
}

/**
 * Write the in-memory events back out as an XLSX workbook on disk. The
 * sheet name comes from the user's setting (so opening in Excel still
 * shows the data under e.g. "GBS"). Column headers come from the loaded
 * file's actual headers via `eventsToTable`, mirroring the CSV path.
 */
export function eventsToXLSXBytes(
  events: TourEvent[],
  sheetName: string,
  headers: LoadedHeaders
): Uint8Array {
  const aoa = eventsToTable(events, headers);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out as ArrayBuffer);
}
