// GODMIND Connectors — OneDrive + Dropbox
// Cloud backup and sync for case evidence folders.

import { ConnectorBase, ConnectorHealth, OneDriveConfig, DropboxConfig } from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// OneDrive (Microsoft Graph)
// ─────────────────────────────────────────────────────────────────────────
const GRAPH_BASE  = 'https://graph.microsoft.com/v1.0';
const MS_TOKEN_URL = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

export class OneDriveConnector implements ConnectorBase {
  readonly name     = 'onedrive';
  readonly version  = '1.0.0';
  readonly category = 'storage' as const;

  private cfg: OneDriveConfig;

  constructor(cfg?: Partial<OneDriveConfig>) {
    this.cfg = {
      clientId:      cfg?.clientId      ?? process.env.ONEDRIVE_CLIENT_ID      ?? '',
      clientSecret:  cfg?.clientSecret  ?? process.env.ONEDRIVE_CLIENT_SECRET  ?? '',
      tenantId:      cfg?.tenantId      ?? process.env.ONEDRIVE_TENANT_ID      ?? 'common',
      refreshToken:  cfg?.refreshToken  ?? process.env.ONEDRIVE_REFRESH_TOKEN  ?? '',
      accessToken:   cfg?.accessToken   ?? process.env.ONEDRIVE_ACCESS_TOKEN,
      tokenExpiry:   cfg?.tokenExpiry,
      rootFolderPath: cfg?.rootFolderPath ?? process.env.ONEDRIVE_ROOT_FOLDER ?? '/colossus-cases',
    };
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cfg.accessToken && this.cfg.tokenExpiry && now < this.cfg.tokenExpiry - 60_000) {
      return this.cfg.accessToken;
    }
    const body = new URLSearchParams({
      client_id:     this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken,
      grant_type:    'refresh_token',
      scope:         'https://graph.microsoft.com/Files.ReadWrite offline_access',
    });
    const res = await fetch(MS_TOKEN_URL(this.cfg.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`[onedrive] Token refresh failed: ${res.status}`);
    const data = await res.json() as { access_token: string; expires_in: number };
    this.cfg.accessToken = data.access_token;
    this.cfg.tokenExpiry = now + data.expires_in * 1000;
    return this.cfg.accessToken;
  }

  private async headers() {
    return { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' };
  }

  async uploadFile(localPath: string, remoteFolder: string, filename: string): Promise<{ id: string; webUrl: string }> {
    const { readFile } = await import('fs/promises');
    const data = await readFile(localPath);
    const token = await this.getToken();
    const folder = `${this.cfg.rootFolderPath}/${remoteFolder}`.replace(/\/\//g, '/');
    const uploadUrl = `${GRAPH_BASE}/me/drive/root:${folder}/${filename}:/content`;
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    if (!res.ok) throw new Error(`[onedrive] Upload failed: ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ id: string; webUrl: string }>;
  }

  async createFolder(folderPath: string): Promise<{ id: string }> {
    const token = await this.getToken();
    const parts = folderPath.split('/');
    const name = parts.pop()!;
    const parentPath = parts.join('/') || this.cfg.rootFolderPath!;
    const res = await fetch(`${GRAPH_BASE}/me/drive/root:${parentPath}:/children`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' }),
    });
    if (!res.ok) throw new Error(`[onedrive] createFolder failed: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }

  async listFolder(folderPath: string): Promise<{ name: string; id: string; webUrl: string }[]> {
    const token = await this.getToken();
    const res = await fetch(`${GRAPH_BASE}/me/drive/root:${folderPath}:/children`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`[onedrive] listFolder failed: ${res.status}`);
    const data = await res.json() as { value: { name: string; id: string; webUrl: string }[] };
    return data.value;
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      const token = await this.getToken();
      const res = await fetch(`${GRAPH_BASE}/me/drive`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Dropbox
// ─────────────────────────────────────────────────────────────────────────
const DBX_CONTENT_BASE = 'https://content.dropboxapi.com/2';
const DBX_API_BASE     = 'https://api.dropboxapi.com/2';

export class DropboxConnector implements ConnectorBase {
  readonly name     = 'dropbox';
  readonly version  = '1.0.0';
  readonly category = 'storage' as const;

  private cfg: DropboxConfig;

  constructor(cfg?: Partial<DropboxConfig>) {
    this.cfg = {
      accessToken:  cfg?.accessToken  ?? process.env.DROPBOX_ACCESS_TOKEN  ?? '',
      refreshToken: cfg?.refreshToken ?? process.env.DROPBOX_REFRESH_TOKEN,
      appKey:       cfg?.appKey       ?? process.env.DROPBOX_APP_KEY,
      appSecret:    cfg?.appSecret    ?? process.env.DROPBOX_APP_SECRET,
      rootPath:     cfg?.rootPath     ?? process.env.DROPBOX_ROOT_PATH ?? '/colossus-cases',
    };
  }

  private headers(contentType = 'application/json') {
    return { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': contentType };
  }

  async uploadFile(localPath: string, remotePath: string): Promise<{ id: string; path_display: string }> {
    const { readFile } = await import('fs/promises');
    const data = await readFile(localPath);
    const fullRemote = `${this.cfg.rootPath}/${remotePath}`.replace(/\/\//g, '/');
    const res = await fetch(`${DBX_CONTENT_BASE}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization:       `Bearer ${this.cfg.accessToken}`,
        'Content-Type':      'application/octet-stream',
        'Dropbox-API-Arg':   JSON.stringify({ path: fullRemote, mode: 'overwrite', autorename: false }),
      },
      body: data,
    });
    if (!res.ok) throw new Error(`[dropbox] Upload failed: ${res.status}: ${await res.text()}`);
    return res.json() as Promise<{ id: string; path_display: string }>;
  }

  async listFolder(remotePath: string): Promise<{ name: string; path_display: string; '.tag': string }[]> {
    const fullPath = `${this.cfg.rootPath}/${remotePath}`.replace(/\/\//g, '/');
    const res = await fetch(`${DBX_API_BASE}/files/list_folder`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ path: fullPath }),
    });
    if (!res.ok) throw new Error(`[dropbox] listFolder failed: ${res.status}: ${await res.text()}`);
    const data = await res.json() as { entries: { name: string; path_display: string; '.tag': string }[] };
    return data.entries;
  }

  async createSharedLink(remotePath: string): Promise<{ url: string }> {
    const res = await fetch(`${DBX_API_BASE}/sharing/create_shared_link_with_settings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ path: remotePath }),
    });
    if (!res.ok) throw new Error(`[dropbox] Shared link failed: ${res.status}`);
    return res.json() as Promise<{ url: string }>;
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      const res = await fetch(`${DBX_API_BASE}/users/get_current_account`, {
        method: 'POST',
        headers: this.headers(),
        body: 'null',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
