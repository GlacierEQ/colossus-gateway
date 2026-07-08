// GODMIND Connector — Google Photos
// Uses Google Photos Library API (REST v1) via OAuth2.
// Supports: list albums, search media, download items, ingest as evidence.

import {
  ConnectorBase, ConnectorHealth,
  GooglePhotosConfig, PhotoMediaItem, PhotoAlbum, PhotoSearchFilter
} from './types.js';

const PHOTOS_BASE   = 'https://photoslibrary.googleapis.com/v1';
const TOKEN_URL     = 'https://oauth2.googleapis.com/token';

export class GooglePhotosConnector implements ConnectorBase {
  readonly name     = 'google-photos';
  readonly version  = '1.0.0';
  readonly category = 'storage' as const;

  private cfg: GooglePhotosConfig;

  constructor(cfg?: Partial<GooglePhotosConfig>) {
    this.cfg = {
      clientId:     cfg?.clientId     ?? process.env.GOOGLE_PHOTOS_CLIENT_ID     ?? '',
      clientSecret: cfg?.clientSecret ?? process.env.GOOGLE_PHOTOS_CLIENT_SECRET ?? '',
      refreshToken: cfg?.refreshToken ?? process.env.GOOGLE_PHOTOS_REFRESH_TOKEN ?? '',
      accessToken:  cfg?.accessToken  ?? process.env.GOOGLE_PHOTOS_ACCESS_TOKEN,
      tokenExpiry:  cfg?.tokenExpiry,
    };
  }

  // ── OAuth2 token refresh ───────────────────────────────────────────────────
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cfg.accessToken && this.cfg.tokenExpiry && now < this.cfg.tokenExpiry - 60_000) {
      return this.cfg.accessToken;
    }
    if (!this.cfg.refreshToken) throw new Error('[google-photos] No refresh token configured');

    const body = new URLSearchParams({
      client_id:     this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: this.cfg.refreshToken,
      grant_type:    'refresh_token',
    });

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`[google-photos] Token refresh failed: ${res.status}`);

    const data = await res.json() as { access_token: string; expires_in: number };
    this.cfg.accessToken  = data.access_token;
    this.cfg.tokenExpiry  = now + data.expires_in * 1000;
    return this.cfg.accessToken;
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.getAccessToken()}`,
      'Content-Type': 'application/json',
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${PHOTOS_BASE}${path}`, { headers: await this.headers() });
    if (!res.ok) throw new Error(`[google-photos] GET ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${PHOTOS_BASE}${path}`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`[google-photos] POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  // ── Albums ─────────────────────────────────────────────────────────────────
  async listAlbums(pageToken?: string): Promise<{ albums: PhotoAlbum[]; nextPageToken?: string }> {
    const qs = pageToken ? `?pageToken=${pageToken}&pageSize=50` : '?pageSize=50';
    const data = await this.get<{ albums?: PhotoAlbum[]; nextPageToken?: string }>(`/albums${qs}`);
    return { albums: data.albums ?? [], nextPageToken: data.nextPageToken };
  }

  async getAllAlbums(): Promise<PhotoAlbum[]> {
    const all: PhotoAlbum[] = [];
    let pageToken: string | undefined;
    do {
      const { albums, nextPageToken } = await this.listAlbums(pageToken);
      all.push(...albums);
      pageToken = nextPageToken;
    } while (pageToken);
    return all;
  }

  async getAlbum(albumId: string): Promise<PhotoAlbum> {
    return this.get<PhotoAlbum>(`/albums/${albumId}`);
  }

  // ── Media items ───────────────────────────────────────────────────────────
  async searchMedia(filter: PhotoSearchFilter): Promise<{ mediaItems: PhotoMediaItem[]; nextPageToken?: string }> {
    const body: Record<string, unknown> = { pageSize: filter.pageSize ?? 100 };
    if (filter.pageToken)  body.pageToken  = filter.pageToken;
    if (filter.albumId)    body.albumId    = filter.albumId;
    if (filter.dateFilter) body.filters = {
      dateFilter: {
        ranges: [{
          startDate: this.parseDate(filter.dateFilter.startDate),
          endDate:   this.parseDate(filter.dateFilter.endDate),
        }]
      }
    };
    const data = await this.post<{ mediaItems?: PhotoMediaItem[]; nextPageToken?: string }>(
      '/mediaItems:search', body
    );
    return { mediaItems: data.mediaItems ?? [], nextPageToken: data.nextPageToken };
  }

  async getMediaItem(mediaItemId: string): Promise<PhotoMediaItem> {
    return this.get<PhotoMediaItem>(`/mediaItems/${mediaItemId}`);
  }

  /** Get all media in an album, paginating automatically */
  async getAlbumMedia(albumId: string): Promise<PhotoMediaItem[]> {
    const all: PhotoMediaItem[] = [];
    let pageToken: string | undefined;
    do {
      const { mediaItems, nextPageToken } = await this.searchMedia({ albumId, pageToken });
      all.push(...mediaItems);
      pageToken = nextPageToken;
    } while (pageToken);
    return all;
  }

  /**
   * Get the download URL for a media item.
   * Append =d to baseUrl for full-resolution download.
   * For videos, append =dv.
   */
  getDownloadUrl(item: PhotoMediaItem, forVideo = false): string {
    return `${item.baseUrl}=${forVideo ? 'dv' : 'd'}`;
  }

  /**
   * Download a media item to a local path.
   * Returns the local file path.
   */
  async downloadItem(item: PhotoMediaItem, destPath: string): Promise<string> {
    const { createWriteStream } = await import('fs');
    const { mkdir } = await import('fs/promises');
    const path = await import('path');
    await mkdir(path.default.dirname(destPath), { recursive: true });

    const isVideo = item.mimeType.startsWith('video/');
    const url = this.getDownloadUrl(item, isVideo);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[google-photos] Download failed: ${res.status}`);

    const writer = createWriteStream(destPath);
    const reader = res.body!.getReader();
    await new Promise<void>((resolve, reject) => {
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { writer.end(); return; }
          writer.write(Buffer.from(value), (err) => {
            if (err) { reject(err); return; }
            pump();
          });
        }).catch(reject);
      }
      writer.on('finish', resolve);
      writer.on('error', reject);
      pump();
    });
    return destPath;
  }

  /**
   * Ingest media from a Google Photos album into a case's evidence folder.
   * Useful for importing photo evidence captured at a scene.
   */
  async ingestAlbumToCase(albumId: string, caseEvidenceDir: string): Promise<{
    downloaded: string[];
    skipped: string[];
    errors: string[];
  }> {
    const path = await import('path');
    const { existsSync } = await import('fs');

    const items = await this.getAlbumMedia(albumId);
    const downloaded: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const item of items) {
      const ext = item.mimeType.split('/')[1] ?? 'jpg';
      const safeName = item.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const dest = path.default.join(caseEvidenceDir, safeName);

      if (existsSync(dest)) { skipped.push(safeName); continue; }

      try {
        await this.downloadItem(item, dest);
        downloaded.push(safeName);
      } catch (err) {
        errors.push(`${safeName}: ${(err as Error).message}`);
      }
    }
    return { downloaded, skipped, errors };
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.listAlbums();
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }

  private parseDate(d: string): { year: number; month: number; day: number } {
    const [year, month, day] = d.split('-').map(Number);
    return { year, month, day };
  }
}
