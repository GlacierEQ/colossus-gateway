// lib/executor.ts
// Shared execution logic — used by both api/mcp.ts (HTTP) and src/index.ts (stdio)
import { Dropbox } from 'dropbox';
import { Client as NotionClient } from '@notionhq/client';
import { Octokit } from 'octokit';
import { aspenIngest, supabase } from './supabase.js';
import crypto from 'crypto';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'GlacierEQ';
// CASE_ID is read from env; never hardcode case identifiers in source.
const CASE_ID = process.env.CASE_ID;
if (!CASE_ID) {
  // Lazy-fail: only matters for apex.* tools. Other tools still work.
  console.warn('[colossus] CASE_ID env not set — apex.* tools will be unavailable.');
}

function getClients() {
  return {
    octokit: new Octokit({ auth: process.env.GITHUB_TOKEN }),
    notion:  new NotionClient({ auth: process.env.NOTION_TOKEN! }),
    dbx:     new Dropbox({ accessToken: process.env.DROPBOX_TOKEN! }),
  };
}

/**
 * Deterministic canonical JSON serializer.
 * Recursively sorts object keys at every depth so that semantically
 * identical objects always serialize to the same string.
 * Arrays preserve order. Primitives serialize as JSON.
 */
export function canonicalize(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

export async function createHash(data: any): Promise<string> {
  const str = canonicalize(data);
  return crypto.createHash('sha256').update(str).digest('hex');
}

function requireCaseId(): string {
  if (!CASE_ID) {
    throw new Error('CASE_ID env var is required for apex.* tools. Set it in Vercel project settings.');
  }
  return CASE_ID;
}

export async function executeUniversal(toolName: string, payload: any = {}) {
  const { octokit, notion, dbx } = getClients();
  let result: any;

  // ── GitHub ───────────────────────────────────────
  if (toolName === 'github.write_file') {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner:   GITHUB_OWNER,
      repo:    payload.repo || 'mastermind-colossus',
      path:    payload.path,
      message: payload.message || `Colossus Gateway v2.1 — ${new Date().toISOString()}`,
      content: Buffer.from(payload.content || '').toString('base64'),
      ...(payload.sha ? { sha: payload.sha } : {}),
    });
    result = { url: data.content?.html_url, sha: data.content?.sha };

  } else if (toolName === 'github.list_repos') {
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({ per_page: 50 });
    result = data.map(r => ({ name: r.name, url: r.html_url, private: r.private, updated: r.updated_at }));

  } else if (toolName === 'github.get_file') {
    const { data } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER,
      repo:  payload.repo,
      path:  payload.path,
    });
    result = data;

  // ── Notion ───────────────────────────────────────
  } else if (toolName === 'notion.create_page') {
    result = await notion.pages.create(payload);

  } else if (toolName === 'notion.query_db') {
    result = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID!,
      ...payload,
    });

  } else if (toolName === 'notion.update_page') {
    result = await notion.pages.update({ page_id: payload.page_id, properties: payload.properties });

  // ── Dropbox ──────────────────────────────────────
  } else if (toolName === 'dropbox.upload') {
    result = await dbx.filesUpload({ path: payload.path, contents: payload.contents });

  } else if (toolName === 'dropbox.list') {
    result = await dbx.filesListFolder({ path: payload.path || '' });

  } else if (toolName === 'dropbox.get_link') {
    result = await dbx.sharingCreateSharedLinkWithSettings({ path: payload.path });

  // ── Apex / Supabase ────────────────────────────────
  } else if (toolName === 'apex.timeline') {
    const caseId = requireCaseId();
    const { data } = await supabase
      .from('apex_integration_events')
      .select('*')
      .eq('case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(payload.limit || 50);
    result = data;

  } else if (toolName === 'apex.ingest') {
    const caseId = requireCaseId();
    const pointer = await aspenIngest(
      payload.type    || 'manual',
      payload.title   || 'Manual ingest',
      payload.metadata || {},
    );
    result = { pointer, status: 'ingested', case: caseId };

  } else if (toolName === 'apex.search') {
    const caseId = requireCaseId();
    const { data } = await supabase
      .from('apex_integration_events')
      .select('*')
      .eq('case_id', caseId)
      .ilike('title', `%${payload.q}%`)
      .order('created_at', { ascending: false })
      .limit(20);
    result = data;

  } else {
    result = { error: `Unknown toolName: ${toolName}. Valid tools: github.write_file, github.list_repos, github.get_file, notion.create_page, notion.query_db, notion.update_page, dropbox.upload, dropbox.list, dropbox.get_link, apex.timeline, apex.ingest, apex.search` };
  }

  // ── Forensic hash + Aspen log (every call) ────────────────────
  const hash    = await createHash(result);
  const pointer = await aspenIngest(toolName, `Operation: ${toolName}`, { result, payload });

  return {
    success:      true,
    result,
    forensicHash: hash,
    aspenPointer: pointer,
    message:      '✅ Operation complete. Logged to Aspen Grove + Supabase.',
  };
}
