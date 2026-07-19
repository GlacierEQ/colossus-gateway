import { createHash } from 'node:crypto';
import { columnNumber, parseDelimited, stringifyDelimited, updateXlsx, type CellUpdate } from './boxSpreadsheet.js';

const BOX_API = process.env.BOX_API_BASE || 'https://api.box.com/2.0';
const BOX_UPLOAD_API = process.env.BOX_UPLOAD_API_BASE || 'https://upload.box.com/api/2.0';
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export class BoxApiError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) {
    super(message);
    this.name = 'BoxApiError';
  }
}

function ensureToken(token?: string): string {
  const resolved = token || process.env.BOX_ACCESS_TOKEN;
  if (!resolved) throw new BoxApiError('BOX_NOT_CONNECTED: provide BOX_ACCESS_TOKEN or x-box-access-token', 503);
  return resolved;
}

async function readError(response: Response): Promise<unknown> {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text.slice(0, 4000); }
}

export class BoxClient {
  private readonly token: string;

  constructor(token?: string) {
    this.token = ensureToken(token);
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BOX_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new BoxApiError(`Box API ${method} ${path} failed`, response.status, await readError(response));
    return response.json() as Promise<T>;
  }

  async search(args: { query: string; type?: 'file' | 'folder' | 'web_link'; ancestor_folder_id?: string; limit?: number; file_extensions?: string[] }) {
    const params = new URLSearchParams({
      query: args.query,
      limit: String(Math.min(Math.max(args.limit || 25, 1), 200)),
      fields: 'id,type,name,size,sha1,extension,parent,path_collection,modified_at,created_at,owned_by',
    });
    if (args.type) params.set('type', args.type);
    if (args.ancestor_folder_id) params.set('ancestor_folder_ids', args.ancestor_folder_id);
    if (args.file_extensions?.length) params.set('file_extensions', args.file_extensions.join(','));
    const data = await this.json<any>('GET', `/search?${params}`);
    return { total_count: data.total_count, entries: data.entries || [] };
  }

  async get(args: { item_id: string; item_type?: 'file' | 'folder' }) {
    const fields = 'id,type,name,size,sha1,extension,parent,path_collection,modified_at,created_at,owned_by,permissions,description,tags,file_version';
    if (args.item_type === 'folder') return this.json('GET', `/folders/${encodeURIComponent(args.item_id)}?fields=${fields}`);
    if (args.item_type === 'file') return this.json('GET', `/files/${encodeURIComponent(args.item_id)}?fields=${fields}`);
    try { return await this.json('GET', `/files/${encodeURIComponent(args.item_id)}?fields=${fields}`); }
    catch (error) {
      if (error instanceof BoxApiError && error.status === 404) return this.json('GET', `/folders/${encodeURIComponent(args.item_id)}?fields=${fields}`);
      throw error;
    }
  }

  async downloadRaw(fileId: string, maxBytes = MAX_DOWNLOAD_BYTES): Promise<{ bytes: Buffer; contentType: string; fileName: string; sha256: string }> {
    const meta: any = await this.get({ item_id: fileId, item_type: 'file' });
    const first = await fetch(`${BOX_API}/files/${encodeURIComponent(fileId)}/content`, {
      headers: { Authorization: `Bearer ${this.token}` },
      redirect: 'manual',
    });
    let response = first;
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location');
      if (!location) throw new BoxApiError('Box download redirect did not contain a location', first.status);
      response = await fetch(location, { redirect: 'follow' });
    }
    if (!response.ok) throw new BoxApiError('Box download failed', response.status, await readError(response));
    const declared = Number(response.headers.get('content-length') || meta.size || 0);
    if (declared > maxBytes) throw new BoxApiError(`File exceeds ${maxBytes} byte gateway limit`, 413);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new BoxApiError(`File exceeds ${maxBytes} byte gateway limit`, 413);
    return {
      bytes,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      fileName: meta.name || `box-${fileId}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  static async downloadCapability(url: string, fileName = 'box-file', maxBytes = MAX_DOWNLOAD_BYTES) {
    const parsed = new URL(url);
    if (!/(^|\.)boxcloud\.com$/.test(parsed.hostname) && !/(^|\.)box\.com$/.test(parsed.hostname)) {
      throw new BoxApiError('Delegated download URL must be a Box domain', 400);
    }
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new BoxApiError('Delegated Box download failed', response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new BoxApiError(`File exceeds ${maxBytes} byte gateway limit`, 413);
    return {
      bytes,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async createFolder(name: string, parentFolderId = '0') {
    return this.json('POST', '/folders', { name, parent: { id: parentFolderId } });
  }

  private async uploadBytes(fileName: string, bytes: Uint8Array, parentFolderId = '0', contentType = 'application/octet-stream') {
    const form = new FormData();
    form.append('attributes', JSON.stringify({ name: fileName, parent: { id: parentFolderId } }));
    const payload = Buffer.from(bytes);
    const arrayBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
    form.append('file', new Blob([arrayBuffer], { type: contentType }), fileName);
    const response = await fetch(`${BOX_UPLOAD_API}/files/content`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!response.ok) throw new BoxApiError('Box upload failed', response.status, await readError(response));
    return response.json();
  }

  async createDocument(args: { file_name: string; content: string; parent_folder_id?: string; content_type?: string }) {
    return this.uploadBytes(args.file_name, Buffer.from(args.content, 'utf8'), args.parent_folder_id || '0', args.content_type || 'text/plain; charset=utf-8');
  }

  async upload(args: { file_name: string; parent_folder_id?: string; content_base64?: string; text_content?: string; content_type?: string }) {
    const bytes = args.content_base64 ? Buffer.from(args.content_base64, 'base64') : Buffer.from(args.text_content || '', 'utf8');
    if (!bytes.length) throw new BoxApiError('Upload content is empty', 400);
    return this.uploadBytes(args.file_name, bytes, args.parent_folder_id || '0', args.content_type || 'application/octet-stream');
  }

  async rename(args: { item_id: string; item_type: 'file' | 'folder'; new_name: string }) {
    return this.json('PUT', `/${args.item_type}s/${encodeURIComponent(args.item_id)}`, { name: args.new_name });
  }

  async move(args: { item_id: string; item_type: 'file' | 'folder'; parent_folder_id: string; new_name?: string }) {
    return this.json('PUT', `/${args.item_type}s/${encodeURIComponent(args.item_id)}`, {
      parent: { id: args.parent_folder_id },
      ...(args.new_name ? { name: args.new_name } : {}),
    });
  }

  private async uploadNewVersion(fileId: string, fileName: string, bytes: Uint8Array, contentType: string) {
    const form = new FormData();
    const payload = Buffer.from(bytes);
    const arrayBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
    form.append('file', new Blob([arrayBuffer], { type: contentType }), fileName);
    const response = await fetch(`${BOX_UPLOAD_API}/files/${encodeURIComponent(fileId)}/content`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!response.ok) throw new BoxApiError('Box file-version upload failed', response.status, await readError(response));
    return response.json();
  }

  async updateSpreadsheet(args: { file_id: string; updates: CellUpdate[]; sheet?: string | number }) {
    if (!args.updates.length) throw new BoxApiError('At least one spreadsheet update is required', 400);
    const meta: any = await this.get({ item_id: args.file_id, item_type: 'file' });
    const extension = String(meta.extension || meta.name?.split('.').pop() || '').toLowerCase();
    const downloaded = await this.downloadRaw(args.file_id, MAX_DOWNLOAD_BYTES);
    let output: Buffer;
    let contentType = downloaded.contentType;

    if (extension === 'csv' || extension === 'tsv') {
      const delimiter = extension === 'tsv' ? '\t' : ',';
      const rows = parseDelimited(downloaded.bytes.toString('utf8'), delimiter);
      for (const update of args.updates) {
        const location = update.cell ? columnNumber(update.cell) : { row: update.row || 0, column: update.column || 0 };
        if (location.row < 1 || location.column < 1) throw new BoxApiError('Spreadsheet row and column are 1-based', 400);
        while (rows.length < location.row) rows.push([]);
        while (rows[location.row - 1].length < location.column) rows[location.row - 1].push('');
        rows[location.row - 1][location.column - 1] = update.value === null ? '' : String(update.value);
      }
      output = Buffer.from(stringifyDelimited(rows, delimiter), 'utf8');
      contentType = extension === 'tsv' ? 'text/tab-separated-values' : 'text/csv';
    } else if (extension === 'xlsx') {
      output = updateXlsx(downloaded.bytes, args.updates, args.sheet ?? 1);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      throw new BoxApiError('Spreadsheet update supports .csv, .tsv, and .xlsx files', 415);
    }

    const uploaded = await this.uploadNewVersion(args.file_id, meta.name, output, contentType);
    return {
      file_id: args.file_id,
      file_name: meta.name,
      extension,
      updates_applied: args.updates.length,
      input_sha256: downloaded.sha256,
      output_sha256: createHash('sha256').update(output).digest('hex'),
      box_response: uploaded,
    };
  }
}
