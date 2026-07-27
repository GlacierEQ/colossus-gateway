import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { auditLedger } from '../src/bridge/audit.js';
import { columnNumber, parseDelimited, stringifyDelimited, updateXlsx } from '../src/bridge/boxSpreadsheet.js';
import { executeTool, TOOL_DEFINITIONS } from '../src/bridge/toolBridge.js';

describe('Box bridge contract', () => {
  beforeEach(() => {
    vi.spyOn(auditLedger, 'record').mockResolvedValue({
      request_id: 'vitest-audit',
      supabase: 'mocked',
      notion: 'mocked',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the requested active tools', () => {
    const names = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
    for (const name of [
      'box_search', 'box_get', 'box_download', 'box_create_folder', 'box_create_document',
      'box_rename', 'box_move', 'box_upload', 'box_spreadsheet_update', 'audit_log',
      'knowledge_retrieve', 'action_record',
    ]) expect(names.has(name)).toBe(true);
  });

  it('accepts a SHA-bound approved connector file handoff', async () => {
    const content = Buffer.from('approved Box connector file result\n', 'utf8');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const result = await executeTool('box_get', {
      item_id: '123456789',
      item_type: 'file',
      include_content: true,
      max_bytes: 1024 * 1024,
      delegated_download_url: null,
      delegated_file_name: null,
      connector_content_base64: content.toString('base64'),
      connector_file_name: 'fixture.txt',
      connector_content_type: 'text/plain',
      connector_sha256: sha256,
      connector_source: 'box-approved-api',
    }, { actor: 'test', source: 'vitest' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.result as any;
    expect(payload.content.text).toBe(content.toString('utf8'));
    expect(payload.content.sha256).toBe(sha256);
    expect(payload.content.connector_handoff).toBe(true);
  });

  it('blocks a connector handoff whose content does not match its claimed SHA', async () => {
    const result = await executeTool('box_download', {
      file_id: '123456789',
      max_bytes: 1024 * 1024,
      delegated_download_url: null,
      delegated_file_name: null,
      connector_content_base64: Buffer.from('tampered', 'utf8').toString('base64'),
      connector_file_name: 'fixture.txt',
      connector_content_type: 'text/plain',
      connector_sha256: '0'.repeat(64),
      connector_source: 'box-approved-api',
    }, { actor: 'test', source: 'vitest' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.status).toBe(412);
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
