// GODMIND Colossus Gateway — Connector Type Contracts
// All connectors implement ConnectorBase. The registry discovers them at runtime.

export interface ConnectorBase {
  readonly name: string;
  readonly version: string;
  readonly category: ConnectorCategory;
  healthCheck(): Promise<ConnectorHealth>;
}

export type ConnectorCategory =
  | 'storage'      // Google Photos, OneDrive, Dropbox
  | 'database'     // Supabase, Neon, MotherDuck
  | 'vector'       // Pinecone, Qdrant
  | 'code'         // GitHub
  | 'docs'         // Notion
  | 'project'      // ClickUp, Airtable
  | 'messaging';   // future: Slack, email

export interface ConnectorHealth {
  ok: boolean;
  connector: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
  error?: string;
  checkedAt: string;
}

// ── Google Photos ───────────────────────────────────────────────────
export interface GooglePhotosConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;           // OAuth2 refresh token
  accessToken?: string;           // cached, auto-refreshed
  tokenExpiry?: number;           // unix ms
}

export interface PhotoMediaItem {
  id: string;
  filename: string;
  mimeType: string;
  productUrl: string;             // album view URL
  baseUrl: string;                // download base (append =d to force download)
  creationTime: string;           // ISO8601
  width?: number;
  height?: number;
  description?: string;
  albumId?: string;
}

export interface PhotoAlbum {
  id: string;
  title: string;
  productUrl: string;
  coverPhotoBaseUrl?: string;
  mediaItemsCount?: string;
  isWriteable?: boolean;
}

export interface PhotoSearchFilter {
  albumId?: string;
  dateFilter?: { startDate: string; endDate: string }; // YYYY-MM-DD
  contentFilter?: string[];
  pageSize?: number;
  pageToken?: string;
}

// ── GitHub ─────────────────────────────────────────────────────────────────
export interface GitHubConfig {
  token: string;
  defaultOwner?: string;
  defaultRepo?: string;
  baseUrl?: string;               // GHE support
}

// ── Notion ─────────────────────────────────────────────────────────────────
export interface NotionConfig {
  apiKey: string;
  defaultDatabaseId?: string;
  casesDatabaseId?: string;
  evidenceDatabaseId?: string;
}

// ── Supabase ────────────────────────────────────────────────────────────────
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;        // for admin ops
  storageUrl?: string;
}

// ── Vector DBs ───────────────────────────────────────────────────────────
export interface PineconeConfig {
  apiKey: string;
  indexName: string;
  namespace?: string;
  region?: string;
}

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collectionName: string;
  vectorSize?: number;            // default 1536 (OpenAI ada-002)
}

export interface VectorRecord {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

// ── MotherDuck / DuckDB ──────────────────────────────────────────────────
export interface MotherDuckConfig {
  token: string;
  database?: string;              // motherduck:my_db or local path
  readOnly?: boolean;
}

// ── ClickUp ────────────────────────────────────────────────────────────────
export interface ClickUpConfig {
  apiToken: string;
  defaultWorkspaceId?: string;
  defaultListId?: string;
  caseListId?: string;            // list where cases become tasks
  evidenceListId?: string;
}

// ── Neon (Postgres) ─────────────────────────────────────────────────────────
export interface NeonConfig {
  connectionString: string;       // postgres://... (pooled or direct)
  projectId?: string;
  branchId?: string;
  readOnly?: boolean;
}

// ── Airtable ───────────────────────────────────────────────────────────────
export interface AirtableConfig {
  apiKey: string;                 // or personal access token
  baseId: string;
  caseTableId?: string;
  evidenceTableId?: string;
  timelineTableId?: string;
}

// ── OneDrive ───────────────────────────────────────────────────────────────
export interface OneDriveConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;               // 'common' for personal accounts
  refreshToken: string;
  accessToken?: string;
  tokenExpiry?: number;
  rootFolderPath?: string;        // default: /colossus-cases
}

// ── Dropbox ────────────────────────────────────────────────────────────────
export interface DropboxConfig {
  accessToken: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
  rootPath?: string;              // default: /colossus-cases
}
