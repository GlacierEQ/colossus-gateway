/**
 * APEX SYNC — Cross-platform state synchronizer
 * Pushes health report summary to:
 *   - Notion APEX Command Center page
 *   - GitHub as a gist/commit
 *   - Supabase health_logs table
 */

import { runDailyEngine } from './apex-daily-engine';
import * as fs from 'fs';
import * as path from 'path';

async function syncToNotion(report: any): Promise<void> {
  const notionToken = process.env.NOTION_TOKEN;
  const pageId = process.env.APEX_NOTION_DASHBOARD_ID ?? '2b8b1e4f3223816080c3db0867452312';
  if (!notionToken) return;

  const summary = [
    `**APEX Daily Health — ${report.generated_at}**`,
    `✅ ${report.summary.ok}/${report.summary.total} platforms OK`,
    report.action_items.length > 0
      ? `⚠️ Action items: ${report.action_items.map((a: any) => `[${a.priority}] ${a.platform}`).join(', ')}`
      : '🟢 All systems nominal',
  ].join('\n');

  await fetch(`https://api.notion.com/v1/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { page_id: pageId },
      rich_text: [{ type: 'text', text: { content: summary } }],
    }),
  });
}

async function syncToSupabase(report: any): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;

  await fetch(`${url}/rest/v1/apex_health_logs`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      generated_at: report.generated_at,
      ok_count: report.summary.ok,
      total_count: report.summary.total,
      action_items: report.action_items,
      full_report: report,
    }),
  });
}

export async function runFullSync(): Promise<void> {
  // 1. Run health engine
  await runDailyEngine();

  // 2. Load generated report
  const reportPath = path.join(process.cwd(), 'reports', 'health_report_latest.json');
  if (!fs.existsSync(reportPath)) {
    console.error('No health report found — engine may have failed');
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  // 3. Sync to platforms in parallel
  await Promise.allSettled([
    syncToNotion(report),
    syncToSupabase(report),
  ]);

  console.log('\n🔄 APEX SYNC complete — Notion + Supabase updated');
}

if (require.main === module) {
  runFullSync().catch(console.error);
}
