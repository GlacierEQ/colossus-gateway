// GODMIND Connector Registry
// Single import point for all connectors. The registry auto-builds from env.

export { GooglePhotosConnector } from './google-photos.js';
export { GitHubConnector }       from './github.js';
export { NotionConnector }       from './notion.js';
export { SupabaseConnector }     from './supabase.js';
export { PineconeConnector }     from './pinecone.js';
export { QdrantConnector }       from './qdrant.js';
export { MotherDuckConnector }   from './motherduck.js';
export { ClickUpConnector }      from './clickup.js';
export { NeonConnector }         from './neon.js';
export { AirtableConnector }     from './airtable.js';
export { OneDriveConnector, DropboxConnector } from './cloud-storage.js';
export * from './types.js';

import { GooglePhotosConnector } from './google-photos.js';
import { GitHubConnector }       from './github.js';
import { NotionConnector }       from './notion.js';
import { SupabaseConnector }     from './supabase.js';
import { PineconeConnector }     from './pinecone.js';
import { QdrantConnector }       from './qdrant.js';
import { MotherDuckConnector }   from './motherduck.js';
import { ClickUpConnector }      from './clickup.js';
import { NeonConnector }         from './neon.js';
import { AirtableConnector }     from './airtable.js';
import { OneDriveConnector, DropboxConnector } from './cloud-storage.js';
import type { ConnectorBase, ConnectorHealth } from './types.js';

export interface ConnectorRegistry {
  googlePhotos: GooglePhotosConnector;
  github:       GitHubConnector;
  notion:       NotionConnector;
  supabase:     SupabaseConnector;
  pinecone:     PineconeConnector;
  qdrant:       QdrantConnector;
  motherDuck:   MotherDuckConnector;
  clickUp:      ClickUpConnector;
  neon:         NeonConnector;
  airtable:     AirtableConnector;
  oneDrive:     OneDriveConnector;
  dropbox:      DropboxConnector;
}

let _registry: ConnectorRegistry | null = null;

/** Build all connectors from environment variables. Call once at startup. */
export function buildConnectorRegistry(): ConnectorRegistry {
  if (_registry) return _registry;
  _registry = {
    googlePhotos: new GooglePhotosConnector(),
    github:       new GitHubConnector(),
    notion:       new NotionConnector(),
    supabase:     new SupabaseConnector(),
    pinecone:     new PineconeConnector(),
    qdrant:       new QdrantConnector(),
    motherDuck:   new MotherDuckConnector(),
    clickUp:      new ClickUpConnector(),
    neon:         new NeonConnector(),
    airtable:     new AirtableConnector(),
    oneDrive:     new OneDriveConnector(),
    dropbox:      new DropboxConnector(),
  };
  return _registry;
}

/** Run health checks on all connectors in parallel. */
export async function healthCheckAll(): Promise<Record<string, ConnectorHealth>> {
  const registry = buildConnectorRegistry();
  const entries = Object.entries(registry) as [string, ConnectorBase][];
  const results = await Promise.allSettled(
    entries.map(([key, connector]) =>
      connector.healthCheck().then(h => [key, h] as [string, ConnectorHealth])
    )
  );
  const out: Record<string, ConnectorHealth> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const [key, health] = r.value;
      out[key] = health;
    }
  }
  return out;
}

/** Get a single connector by name. */
export function getConnector<K extends keyof ConnectorRegistry>(
  name: K
): ConnectorRegistry[K] {
  return buildConnectorRegistry()[name];
}
