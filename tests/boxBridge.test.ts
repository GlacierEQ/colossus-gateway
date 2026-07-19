import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { columnNumber, parseDelimited, stringifyDelimited, updateXlsx } from '../src/bridge/boxSpreadsheet.js';
import { TOOL_DEFINITIONS } from '../src/bridge/toolBridge.js';

describe('Box bridge contract', () => {
  it('exposes the requested active tools', () => {
    const names = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const name of [
      'box_search', 'box_get', 'box_download', 'box_create_folder', 'box_create_document',
      'box_rename', 'box_move', 'box_upload', 'box_spreadsheet_update', 'audit_log',
      'knowledge_retrieve', 'action_record',
    ]) expect(names.has(name)).toBe(true);
  });

  it('parses and rewrites quoted CSV safely', () => {
    const rows = parseDelimited('name,note\nCasey,"one,two"\n', ',');
    expect(rows).toEqual([['name', 'note'], ['Casey', 'one,two']]);
    rows[1][1] = 'three\nlines';
    expect(stringifyDelimited(rows, ',')).toContain('"three\nlines"');
  });

  it('resolves A1 coordinates', () => {
    expect(columnNumber('AA12')).toEqual({ row: 12, column: 27 });
  });

  it('updates XLSX cell values without a heavyweight workbook runtime', () => {
    const fixture = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
      'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>old</t></is></c></row></sheetData></worksheet>'),
    });
    const updated = updateXlsx(fixture, [
      { cell: 'A1', value: 'new' },
      { cell: 'B2', value: 42 },
      { cell: 'C3', value: true },
    ]);
    const files = unzipSync(updated);
    const worksheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(worksheet).toContain('r="A1"');
    expect(worksheet).toContain('>new<');
    expect(worksheet).toContain('r="B2"');
    expect(worksheet).toContain('>42<');
    expect(worksheet).toContain('r="C3"');
    expect(worksheet).toContain('t="b"');
  });
});
