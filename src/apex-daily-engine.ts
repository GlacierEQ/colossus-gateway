/**
 * APEX DAILY ENGINE v2
 * GlacierEQ — colossus-gateway
 * Runs a full health probe across all 10 active platforms,
 * writes control_plane_registry.json + health_report.json
 * Schedule: daily at 04:30 HST via cron or Vercel cron job
 */

import * as fs from 'fs';
import * as path from 'path';

const PLATFORMS = [
  { name: 'GitHub',       env: 'GITHUB_TOKEN',        probe: probeGitHub },
  { name: 'Notion',       env: 'NOTION_TOKEN',         probe: probeNotion },
  { name: 'Vercel',       env: 'VERCEL_TOKEN',         probe: probeVercel },
  { name: 'Supabase',     env: 'SUPABASE_ANON_KEY',    probe: probeSupabase },
  { name: 'Sentry',       env: 'SENTRY_DSN',           probe: probeSentry },
  { name: 'MotherDuck',   env: 'MOTHERDUCK_TOKEN',     probe: probeMotherDuck },
  { name: 'Supermemory',  env: 'SUPERMEMORY_API_KEY',  probe: probeSupermemory },
  { name: 'Pinecone',     env: 'PINECONE_API_KEY',     probe: probePinecone },
  { name: 'Qdrant',       env: 'QDRANT_URL',           probe: probeQdrant },
  { name: 'ClickUp',      env: 'CLICKUP_TOKEN',        probe: probeClickUp },
];

interface PlatformStatus {
  name: string;
  status: 'OK' | 'DEGRADED' | 'DOWN' | 'NO_CREDS';
  latency_ms: number | null;
  last_verified: string;
  error?: string;
  blast_radius_tier: 0 | 1 | 2 | 3;
}

async function timed(fn: () => Promise<void>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, ms: Date.now() - start, error: e?.message ?? String(e) };
  }
}

async function probeGitHub() {
  const r = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'APEX-Daily-Engine' }
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
}

async function probeNotion() {
  const r = await fetch('https://api.notion.com/v1/users/me', {
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28' }
  });
  if (!r.ok) throw new Error(`Notion ${r.status}`);
}

async function probeVercel() {
  const r = await fetch('https://api.vercel.com/v2/user', {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }
  });
  if (!r.ok) throw new Error(`Vercel ${r.status}`);
}

async function probeSupabase() {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error('SUPABASE_URL not set');
  const r = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY ?? '', Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` }
  });
  if (r.status >= 500) throw new Error(`Supabase ${r.status}`);
}

async function probeSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) throw new Error('SENTRY_DSN not set');
  // Validate DSN format
  const url = new URL(dsn);
  if (!url.hostname.includes('sentry')) throw new Error('Invalid Sentry DSN');
}

async function probeMotherDuck() {
  const token = process.env.MOTHERDUCK_TOKEN;
  if (!token) throw new Error('MOTHERDUCK_TOKEN not set');
  const r = await fetch('https://api.motherduck.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error(`MotherDuck ${r.status}`);
}

async function probeSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error('SUPERMEMORY_API_KEY not set');
  const r = await fetch('https://api.supermemory.ai/v1/memories', {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (r.status === 401) throw new Error('Supermemory auth failure');
}

async function probePinecone() {
  const key = process.env.PINECONE_API_KEY;
  if (!key) throw new Error('PINECONE_API_KEY not set');
  const r = await fetch('https://api.pinecone.io/indexes', {
    headers: { 'Api-Key': key }
  });
  if (!r.ok) throw new Error(`Pinecone ${r.status}`);
}

async function probeQdrant() {
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
  const r = await fetch(`${url}/collections`);
  if (!r.ok) throw new Error(`Qdrant ${r.status}`);
}

async function probeClickUp() {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) throw new Error('CLICKUP_TOKEN not set');
  const r = await fetch('https://api.clickup.com/api/v2/user', {
    headers: { Authorization: token }
  });
  if (!r.ok) throw new Error(`ClickUp ${r.status}`);
}

const BLAST_RADIUS: Record<string, 0|1|2|3> = {
  GitHub: 3, Notion: 3, Vercel: 2, Supabase: 3,
  Sentry: 0, MotherDuck: 1, Supermemory: 2,
  Pinecone: 1, Qdrant: 1, ClickUp: 1,
};

export async function runDailyEngine(): Promise<void> {
  const timestamp = new Date().toISOString();
  const results: PlatformStatus[] = [];

  console.log(`\n🔥 APEX DAILY ENGINE — ${timestamp}\n`);

  for (const p of PLATFORMS) {
    const cred = process.env[p.env];
    if (!cred) {
      results.push({
        name: p.name,
        status: 'NO_CREDS',
        latency_ms: null,
        last_verified: timestamp,
        error: `${p.env} not found in environment`,
        blast_radius_tier: BLAST_RADIUS[p.name] ?? 0,
      });
      console.log(`❌ ${p.name.padEnd(14)} NO_CREDS — ${p.env} missing`);
      continue;
    }

    const { ok, ms, error } = await timed(p.probe);
    const status: PlatformStatus['status'] = ok ? 'OK' : (ms > 5000 ? 'DEGRADED' : 'DOWN');
    results.push({
      name: p.name,
      status,
      latency_ms: ms,
      last_verified: timestamp,
      ...(error ? { error } : {}),
      blast_radius_tier: BLAST_RADIUS[p.name] ?? 0,
    });
    console.log(`${ok ? '✅' : '🔴'} ${p.name.padEnd(14)} ${status.padEnd(10)} ${ms}ms${error ? ` — ${error}` : ''}`);
  }

  const ok_count = results.filter(r => r.status === 'OK').length;
  const report = {
    generated_at: timestamp,
    engine_version: '2.0.0',
    operator: 'GlacierEQ',
    summary: {
      total: results.length,
      ok: ok_count,
      degraded: results.filter(r => r.status === 'DEGRADED').length,
      down: results.filter(r => r.status === 'DOWN').length,
      no_creds: results.filter(r => r.status === 'NO_CREDS').length,
    },
    platforms: results,
    action_items: results
      .filter(r => r.status !== 'OK')
      .map(r => ({
        platform: r.name,
        issue: r.error ?? r.status,
        priority: r.blast_radius_tier >= 3 ? 'P0' : r.blast_radius_tier >= 2 ? 'P1' : 'P2',
      })),
  };

  const outDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'health_report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'health_report_latest.json'), JSON.stringify(report, null, 2));

  console.log(`\n📊 ${ok_count}/${results.length} platforms healthy`);
  console.log(`📁 Report → reports/health_report.json`);

  if (ok_count < results.length) {
    console.log('\n⚠️  ACTION ITEMS:');
    report.action_items.forEach(a => console.log(`  [${a.priority}] ${a.platform}: ${a.issue}`));
  }
}

// Run if executed directly
if (require.main === module) {
  runDailyEngine().catch(console.error);
}
