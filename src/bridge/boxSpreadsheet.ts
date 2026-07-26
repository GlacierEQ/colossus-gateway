import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { BoxApiError } from './boxClient.js';

export interface CellUpdate {
  cell?: string;
  row?: number;
  column?: number;
  value: string | number | boolean | null;
  sheet?: string | number;
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

export function stringifyDelimited(rows: unknown[][], delimiter: string): string {
  return rows.map((row) => row.map((value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /["\r\n,\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(delimiter)).join('\n') + '\n';
}

export function columnNumber(cell: string): { row: number; column: number } {
  const match = /^([A-Za-z]+)([1-9][0-9]*)$/.exec(cell.trim());
  if (!match) throw new Error(`Invalid spreadsheet cell: ${cell}`);
  let column = 0;
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}

function columnLetters(column: number): string {
  if (!Number.isInteger(column) || column < 1) throw new Error(`Invalid spreadsheet column: ${column}`);
  let value = column;
  let letters = '';
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function relationshipTarget(files: Record<string, Uint8Array>, selector: string | number): { sheetName: string; path: string } {
  const workbookBytes = files['xl/workbook.xml'];
  const relationshipsBytes = files['xl/_rels/workbook.xml.rels'];
  if (!workbookBytes || !relationshipsBytes) throw new BoxApiError('XLSX workbook metadata is incomplete', 422);

  const parser = new DOMParser();
  const workbook = parser.parseFromString(strFromU8(workbookBytes), 'application/xml');
  const sheets = Array.from(workbook.getElementsByTagName('sheet')) as Element[];
  const selected = typeof selector === 'number'
    ? sheets[selector - 1]
    : sheets.find((sheet) => sheet.getAttribute('name') === selector);
  if (!selected) throw new BoxApiError(`Worksheet not found: ${selector}`, 404);

  const relationId = selected.getAttribute('r:id') || selected.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relationId) throw new BoxApiError('Worksheet relationship ID is missing', 422);

  const relationships = parser.parseFromString(strFromU8(relationshipsBytes), 'application/xml');
  const relationship = (Array.from(relationships.getElementsByTagName('Relationship')) as Element[])
    .find((entry) => entry.getAttribute('Id') === relationId);
  if (!relationship) throw new BoxApiError(`Worksheet relationship not found: ${relationId}`, 422);
  const target = relationship.getAttribute('Target');
  if (!target) throw new BoxApiError('Worksheet relationship target is missing', 422);

  const normalized = target.startsWith('/')
    ? target.replace(/^\//, '')
    : `xl/${target.replace(/^\.\//, '')}`;
  return { sheetName: selected.getAttribute('name') || String(selector), path: normalized.replace(/\/+/g, '/') };
}

function removeChildren(node: any): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setCellValue(document: any, cell: any, value: CellUpdate['value']): void {
  removeChildren(cell);
  cell.removeAttribute('s');
  if (value === null) {
    cell.removeAttribute('t');
    return;
  }
  if (typeof value === 'string') {
    cell.setAttribute('t', 'inlineStr');
    const inline = document.createElement('is');
    const text = document.createElement('t');
    if (/^\s|\s$/.test(value)) text.setAttribute('xml:space', 'preserve');
    text.appendChild(document.createTextNode(value));
    inline.appendChild(text);
    cell.appendChild(inline);
    return;
  }
  const node = document.createElement('v');
  if (typeof value === 'boolean') {
    cell.setAttribute('t', 'b');
    node.appendChild(document.createTextNode(value ? '1' : '0'));
  } else {
    cell.removeAttribute('t');
    node.appendChild(document.createTextNode(String(value)));
  }
  cell.appendChild(node);
}

export function updateXlsx(bytes: Uint8Array, updates: CellUpdate[], defaultSheet: string | number = 1): Buffer {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new BoxApiError('The XLSX file is not a valid Open XML archive', 422);
  }

  const grouped = new Map<string, { path: string; updates: CellUpdate[] }>();
  for (const update of updates) {
    const selector = update.sheet ?? defaultSheet;
    const resolved = relationshipTarget(files, selector);
    const bucket = grouped.get(resolved.path) || { path: resolved.path, updates: [] };
    bucket.updates.push(update);
    grouped.set(resolved.path, bucket);
  }

  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  for (const { path, updates: sheetUpdates } of grouped.values()) {
    const worksheetBytes = files[path];
    if (!worksheetBytes) throw new BoxApiError(`Worksheet part not found: ${path}`, 422);
    const document = parser.parseFromString(strFromU8(worksheetBytes), 'application/xml');
    const sheetData = document.getElementsByTagName('sheetData')[0];
    if (!sheetData) throw new BoxApiError(`Worksheet sheetData is missing: ${path}`, 422);

    for (const update of sheetUpdates) {
      const location = update.cell ? columnNumber(update.cell) : { row: update.row || 0, column: update.column || 0 };
      if (location.row < 1 || location.column < 1) throw new BoxApiError('Spreadsheet row and column are 1-based', 400);
      const address = `${columnLetters(location.column)}${location.row}`;

      let row = (Array.from(sheetData.getElementsByTagName('row')) as Element[])
        .find((candidate) => Number(candidate.getAttribute('r')) === location.row);
      if (!row) {
        row = document.createElement('row');
        row.setAttribute('r', String(location.row));
        const next = (Array.from(sheetData.getElementsByTagName('row')) as Element[])
          .find((candidate) => Number(candidate.getAttribute('r')) > location.row);
        if (next) sheetData.insertBefore(row, next);
        else sheetData.appendChild(row);
      }

      let cell = (Array.from(row.getElementsByTagName('c')) as Element[])
        .find((candidate) => candidate.getAttribute('r') === address);
      if (!cell) {
        cell = document.createElement('c');
        cell.setAttribute('r', address);
        const next = (Array.from(row.getElementsByTagName('c')) as Element[]).find((candidate) => {
          const ref = candidate.getAttribute('r');
          if (!ref) return false;
          try { return columnNumber(ref).column > location.column; } catch { return false; }
        });
        if (next) row.insertBefore(cell, next);
        else row.appendChild(cell);
      }
      setCellValue(document, cell, update.value);
    }

    files[path] = strToU8(serializer.serializeToString(document));
  }

  return Buffer.from(zipSync(files, { level: 6 }));
}
