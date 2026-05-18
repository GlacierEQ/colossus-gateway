/**
 * APEX CONTROL PLANE REGISTRY
 * Single source of truth for all active integrations.
 * Every platform, repo, database, connector in one place.
 */

export interface ControlPlaneEntry {
  id: string;
  name: string;
  category: 'code' | 'knowledge' | 'deploy' | 'data' | 'memory' | 'observability' | 'tasks' | 'vector';
  status: 'active' | 'degraded' | 'deprecated' | 'pending';
  auth_method: 'bearer_token' | 'api_key' | 'oauth' | 'anon_key' | 'dsn' | 'url_only';
  env_key: string;
  endpoint: string;
  blast_radius_tier: 0 | 1 | 2 | 3; // 0=read-only, 1=branch-safe, 2=PR-only, 3=manual-approve
  primary_repo?: string;
  notion_page?: string;
  rollback_method?: string;
  notes?: string;
}

export const CONTROL_PLANE_REGISTRY: ControlPlaneEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    category: 'code',
    status: 'active',
    auth_method: 'bearer_token',
    env_key: 'GITHUB_TOKEN',
    endpoint: 'https://api.github.com',
    blast_radius_tier: 3,
    primary_repo: 'GlacierEQ/colossus-gateway',
    rollback_method: 'git revert + force push to branch',
    notes: '569 public + 323 private repos. GlacierEQ operator.'
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'knowledge',
    status: 'active',
    auth_method: 'bearer_token',
    env_key: 'NOTION_TOKEN',
    endpoint: 'https://api.notion.com/v1',
    blast_radius_tier: 3,
    notion_page: 'https://www.notion.so/2ffb1e4f3223811daa83eac1aa9413b5',
    rollback_method: 'Notion page history restore',
    notes: '13-database APEX system. Case 1FDV-23-0001009 primary KB.'
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'deploy',
    status: 'active',
    auth_method: 'bearer_token',
    env_key: 'VERCEL_TOKEN',
    endpoint: 'https://api.vercel.com',
    blast_radius_tier: 2,
    primary_repo: 'GlacierEQ/colossus-gateway',
    rollback_method: 'Vercel deployment rollback via dashboard or CLI',
    notes: 'colossus-gateway deployed. Instant rollback available.'
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'data',
    status: 'active',
    auth_method: 'anon_key',
    env_key: 'SUPABASE_ANON_KEY',
    endpoint: 'process.env.SUPABASE_URL',
    blast_radius_tier: 3,
    primary_repo: 'GlacierEQ/colossus-gateway',
    rollback_method: 'Supabase point-in-time recovery',
    notes: 'Primary persistent store. supabase/ directory in colossus-gateway.'
  },
  {
    id: 'sentry',
    name: 'Sentry',
    category: 'observability',
    status: 'active',
    auth_method: 'dsn',
    env_key: 'SENTRY_DSN',
    endpoint: 'https://sentry.io',
    blast_radius_tier: 0,
    primary_repo: 'GlacierEQ/mastermind',
    rollback_method: 'Read-only — no rollback needed',
    notes: 'Error tracking for mastermind + 1FDV-23-0001009-FEDERAL-WARFARE pipelines.'
  },
  {
    id: 'motherduck',
    name: 'MotherDuck',
    category: 'data',
    status: 'active',
    auth_method: 'bearer_token',
    env_key: 'MOTHERDUCK_TOKEN',
    endpoint: 'https://api.motherduck.com',
    blast_radius_tier: 1,
    primary_repo: 'GlacierEQ/Z-BACKUP-apex-orchestrator',
    rollback_method: 'DuckDB file restore from Dropbox/OneDrive backup',
    notes: 'Analytics layer. Case evidence queries. Low blast radius.'
  },
  {
    id: 'supermemory',
    name: 'Supermemory.ai',
    category: 'memory',
    status: 'active',
    auth_method: 'bearer_token',
    env_key: 'SUPERMEMORY_API_KEY',
    endpoint: 'https://api.supermemory.ai/v1',
    blast_radius_tier: 2,
    primary_repo: 'GlacierEQ/quantum-memory-orchestrator',
    rollback_method: 'Memory export + reimport from AspenGrove backup',
    notes: 'Mem0 + Supermemory dual memory layer. AspenGrove quantum memory.'
  },
  {
    id: 'pinecone',
    name: 'Pinecone',
    category: 'vector',
    status: 'active',
    auth_method: 'api_key',
    env_key: 'PINECONE_API_KEY',
    endpoint: 'https://api.pinecone.io',
    blast_radius_tier: 1,
    rollback_method: 'Pinecone index snapshot restore',
    notes: 'Primary cloud vector DB. Complementary to Qdrant local layer.'
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    category: 'vector',
    status: 'active',
    auth_method: 'url_only',
    env_key: 'QDRANT_URL',
    endpoint: 'process.env.QDRANT_URL',
    blast_radius_tier: 1,
    notion_page: 'https://www.notion.so/7ae8f612bd074c96b022c8cbf4b5fef5',
    rollback_method: 'Qdrant snapshot restore',
    notes: 'Local/self-hosted vector DB. Python client deployed. Case evidence embeddings.'
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    category: 'tasks',
    status: 'active',
    auth_method: 'bearer_token',
    env_key: 'CLICKUP_TOKEN',
    endpoint: 'https://api.clickup.com/api/v2',
    blast_radius_tier: 1,
    rollback_method: 'ClickUp task restore from history',
    notes: 'Task management layer alongside Linear. Both active.'
  },
];

export function getRegistry(): ControlPlaneEntry[] {
  return CONTROL_PLANE_REGISTRY;
}

export function getByCategory(cat: ControlPlaneEntry['category']): ControlPlaneEntry[] {
  return CONTROL_PLANE_REGISTRY.filter(e => e.category === cat);
}

export function getActiveOnly(): ControlPlaneEntry[] {
  return CONTROL_PLANE_REGISTRY.filter(e => e.status === 'active');
}
