// GODMIND Colossus Gateway — Utility helpers
import path from 'path';
import { CaseMeta } from './types.js';

/**
 * Sanitize a case ID to be safe as a filesystem directory name.
 * Strips everything except alphanum, hyphens, underscores, and dots.
 */
export function sanitizeCaseId(raw: string): string {
  return raw
    .trim()
    .replace(/[\s/\\:*?"<>|]+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 120);
}

/**
 * Build the canonical case directory path:
 *   {casesRoot}/{Judge} — {Attorneys}/{CaseNumber}/
 *
 * Falls back gracefully if judge/attorneys are missing.
 */
export function buildCasePath(casesRoot: string, caseId: string, meta?: CaseMeta): string {
  const judge = sanitizeName(meta?.judge ?? 'Unknown_Judge');
  const attorneys = meta?.attorneys?.length
    ? meta.attorneys.map(sanitizeName).join('_')  
    : 'Unknown_Attorneys';
  const folder = `${judge} — ${attorneys}`;
  return path.join(casesRoot, folder, sanitizeCaseId(caseId));
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9 ._-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Truncate a string with ellipsis if over maxLen.
 */
export function truncate(s: string, maxLen = 200): string {
  return s.length <= maxLen ? s : s.slice(0, maxLen - 3) + '...';
}
