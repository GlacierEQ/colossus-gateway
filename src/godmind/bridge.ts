// GODMIND Colossus Gateway — Local Bridge (Layer 2: Execution Core)
// Express server exposing: POST /case/scrape, /case/ocr, /case/merge,
//   /case/analyze, /agent/route   GET /healthz
//
// Runs at localhost:7700 — never exposed to public internet.
// Auth: COLOSSUS_BRIDGE_TOKEN env var checked on every mutating request.

import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream/promises';
import {
  ScrapeRequest, OCRRequest, MergeRequest, AnalyzeRequest, AgentRouteRequest,
  BridgeResponse, CaseManifest, FileRecord, DocketEntry, UserscriptPayload
} from './types.js';
import { routeAgents } from './router.js';
import { buildCasePath, sanitizeCaseId } from './utils.js';

const PORT = parseInt(process.env.BRIDGE_PORT ?? '7700', 10);
const CASES_ROOT = process.env.CASES_ROOT ?? path.join(process.cwd(), 'cases');
const AUTH_TOKEN = process.env.COLOSSUS_BRIDGE_TOKEN;
const BRIDGE_VERSION = '1.0.0';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── CORS for localhost userscript ──────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Auth-Token');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ── Auth middleware ────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!AUTH_TOKEN) { next(); return; } // token not configured → open
  const provided =
    req.headers['x-auth-token'] ||
    req.headers['authorization']?.replace('Bearer ', '') ||
    (req.body as Record<string, unknown>)?.authToken;
  if (provided !== AUTH_TOKEN) {
    res.status(401).json({ ok: false, errors: ['Unauthorized'], timestamp: ts() });
    return;
  }
  next();
}

// ── Request logger ─────────────────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[${ts()}] ${req.method} ${req.path}`);
  next();
});

// ── Helpers ────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString(); }

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fss.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const file = fss.createWriteStream(destPath);
  await new Promise<void>((resolve, reject) => {
    const getter = url.startsWith('https') ? https : http;
    getter.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
        return;
      }
      pipeline(res as unknown as NodeJS.ReadableStream, file)
        .then(resolve).catch(reject);
    }).on('error', reject);
  });
}

async function readManifest(caseDir: string): Promise<CaseManifest | null> {
  const p = path.join(caseDir, '00_manifest.json');
  if (!fss.existsSync(p)) return null;
  return JSON.parse(await fs.readFile(p, 'utf8')) as CaseManifest;
}

async function writeManifest(caseDir: string, manifest: CaseManifest): Promise<void> {
  manifest.updatedAt = ts();
  await fs.writeFile(
    path.join(caseDir, '00_manifest.json'),
    JSON.stringify(manifest, null, 2), 'utf8'
  );
}

async function initCaseDir(caseId: string, payload: UserscriptPayload): Promise<string> {
  const caseDir = buildCasePath(CASES_ROOT, caseId, payload.caseMeta);
  await fs.mkdir(path.join(caseDir, 'filings'), { recursive: true });
  await fs.mkdir(path.join(caseDir, 'ocr_text'), { recursive: true });
  await fs.mkdir(path.join(caseDir, 'analysis'), { recursive: true });

  const manifestPath = path.join(caseDir, '00_manifest.json');
  if (!fss.existsSync(manifestPath)) {
    const manifest: CaseManifest = {
      version: '1.0.0',
      caseNumber: caseId,
      caseMeta: payload.caseMeta,
      createdAt: ts(),
      updatedAt: ts(),
      files: [],
      hashAlgorithm: 'sha256',
      bridgeVersion: BRIDGE_VERSION,
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  // Seed empty docket if not present
  const docketPath = path.join(caseDir, '01_docket.json');
  if (!fss.existsSync(docketPath)) {
    await fs.writeFile(docketPath, JSON.stringify({ caseId, entries: [] }, null, 2), 'utf8');
  }

  return caseDir;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /healthz
// ─────────────────────────────────────────────────────────────────────────
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'colossus-bridge',
    version: BRIDGE_VERSION,
    casesRoot: CASES_ROOT,
    authRequired: !!AUTH_TOKEN,
    timestamp: ts(),
  });
});

// ─────────────────────────────────────────────────────────────────────────
// POST /case/scrape
// Receives userscript payload, downloads all PDFs, builds case folder.
// ─────────────────────────────────────────────────────────────────────────
app.post('/case/scrape', requireAuth, async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as ScrapeRequest;

  if (!body.caseUrl || !body.caseMeta) {
    res.status(400).json({
      ok: false, errors: ['caseUrl and caseMeta are required'], timestamp: ts()
    });
    return;
  }

  const caseId = sanitizeCaseId(
    body.caseMeta.caseNumber ?? `case_${Date.now()}`
  );

  try {
    const caseDir = await initCaseDir(caseId, body);
    const manifest = (await readManifest(caseDir))!;
    const downloaded: FileRecord[] = [];
    const errors: string[] = [];
    const dryRun = false;

    if (!dryRun && body.pdfLinks?.length) {
      for (const url of body.pdfLinks) {
        const filename = `${Date.now()}_${path.basename(new URL(url).pathname) || 'doc.pdf'}`
          .replace(/[^a-zA-Z0-9._-]/g, '_');
        const destPath = path.join(caseDir, 'filings', filename);
        try {
          await downloadFile(url, destPath);
          const stat = await fs.stat(destPath);
          const hash = await sha256File(destPath);
          const record: FileRecord = {
            filename,
            path: `filings/${filename}`,
            sha256: hash,
            sizeBytes: stat.size,
            ingestedAt: ts(),
            source: 'download',
          };
          downloaded.push(record);
          manifest.files.push(record);
        } catch (err) {
          errors.push(`Failed to download ${url}: ${(err as Error).message}`);
        }
      }
      await writeManifest(caseDir, manifest);

      // Write index.csv
      const csvLines = [
        'filename,sha256,sizeBytes,ingestedAt,source',
        ...manifest.files.map(f =>
          `"${f.filename}",${f.sha256},${f.sizeBytes},${f.ingestedAt},${f.source}`
        )
      ];
      await fs.writeFile(path.join(caseDir, '02_index.csv'), csvLines.join('\n'), 'utf8');
    }

    const response: BridgeResponse<{ downloaded: FileRecord[]; caseDir: string }> = {
      ok: errors.length === 0,
      caseId,
      casePath: caseDir,
      data: { downloaded, caseDir },
      errors: errors.length ? errors : undefined,
      durationMs: Date.now() - start,
      timestamp: ts(),
    };
    res.status(errors.length && downloaded.length === 0 ? 500 : 200).json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, errors: [(err as Error).message], timestamp: ts() });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// POST /case/ocr
// Runs OCR on all PDFs in filings/ (or a specified subset).
// Requires: tesseract or pdf2text available on PATH.
// ─────────────────────────────────────────────────────────────────────────
app.post('/case/ocr', requireAuth, async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as OCRRequest;

  if (!body.caseId) {
    res.status(400).json({ ok: false, errors: ['caseId required'], timestamp: ts() });
    return;
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  // Find caseDir — search under CASES_ROOT
  const caseDir = await findCaseDir(body.caseId);
  if (!caseDir) {
    res.status(404).json({ ok: false, errors: [`Case ${body.caseId} not found`], timestamp: ts() });
    return;
  }

  const filingsDir = path.join(caseDir, 'filings');
  const ocrDir = path.join(caseDir, 'ocr_text');
  await fs.mkdir(ocrDir, { recursive: true });

  const allPdfs = (await fs.readdir(filingsDir))
    .filter(f => f.toLowerCase().endsWith('.pdf'));
  const targets = body.files ?? allPdfs;
  const results: { file: string; status: 'ok' | 'error'; outputFile?: string; error?: string }[] = [];

  for (const filename of targets) {
    if (body.dryRun) {
      results.push({ file: filename, status: 'ok', outputFile: `[DRY RUN] ${filename}.txt` });
      continue;
    }
    const pdfPath = path.join(filingsDir, filename);
    const outBase = path.join(ocrDir, filename.replace(/\.pdf$/i, ''));
    try {
      // Try pdftotext first (fast, accurate for text PDFs)
      try {
        await execFileAsync('pdftotext', ['-layout', pdfPath, `${outBase}.txt`]);
      } catch {
        // Fall back to tesseract for scanned images
        await execFileAsync('tesseract', [pdfPath, outBase, '-l', 'eng', 'txt']);
      }
      results.push({ file: filename, status: 'ok', outputFile: `${path.basename(outBase)}.txt` });
    } catch (err) {
      results.push({ file: filename, status: 'error', error: (err as Error).message });
    }
  }

  res.json({
    ok: true,
    caseId: body.caseId,
    data: { processed: results },
    dryRun: body.dryRun,
    durationMs: Date.now() - start,
    timestamp: ts(),
  } as BridgeResponse);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /case/merge
// Merges all PDFs in filings/ into merged_chronological.pdf.
// Requires: pdfunite or ghostscript on PATH.
// ─────────────────────────────────────────────────────────────────────────
app.post('/case/merge', requireAuth, async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as MergeRequest;

  if (!body.caseId) {
    res.status(400).json({ ok: false, errors: ['caseId required'], timestamp: ts() });
    return;
  }

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const caseDir = await findCaseDir(body.caseId);
  if (!caseDir) {
    res.status(404).json({ ok: false, errors: [`Case ${body.caseId} not found`], timestamp: ts() });
    return;
  }

  const filingsDir = path.join(caseDir, 'filings');
  const outputFilename = body.outputFilename ?? 'merged_chronological.pdf';
  const outputPath = path.join(caseDir, outputFilename);

  const sortBy = body.sortBy ?? 'filename';
  let pdfs = (await fs.readdir(filingsDir))
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  if (sortBy === 'filename') pdfs.sort();
  else if (sortBy === 'date') pdfs.sort(); // real impl: parse date from filename/manifest

  if (pdfs.length === 0) {
    res.status(400).json({ ok: false, errors: ['No PDFs found in filings/'], timestamp: ts() });
    return;
  }

  if (body.dryRun) {
    res.json({ ok: true, caseId: body.caseId, data: { outputPath, fileCount: pdfs.length, dryRun: true }, timestamp: ts() });
    return;
  }

  const fullPaths = pdfs.map(f => path.join(filingsDir, f));
  try {
    // Try pdfunite (poppler-utils)
    await execFileAsync('pdfunite', [...fullPaths, outputPath]);
  } catch {
    // Fall back to ghostscript
    try {
      await execFileAsync('gs', [
        '-dBATCH', '-dNOPAUSE', '-q', '-sDEVICE=pdfwrite',
        `-sOutputFile=${outputPath}`,
        ...fullPaths
      ]);
    } catch (err) {
      res.status(500).json({ ok: false, errors: [`PDF merge failed: ${(err as Error).message}`], timestamp: ts() });
      return;
    }
  }

  const stat = await fs.stat(outputPath);
  const hash = await sha256File(outputPath);

  res.json({
    ok: true,
    caseId: body.caseId,
    data: { outputPath, outputFilename, sizeBytes: stat.size, sha256: hash, filesmerged: pdfs.length },
    durationMs: Date.now() - start,
    timestamp: ts(),
  } as BridgeResponse);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /case/analyze
// Routes case data through Diamond Agent layer, writes analysis/ outputs.
// ─────────────────────────────────────────────────────────────────────────
app.post('/case/analyze', requireAuth, async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as AnalyzeRequest;

  if (!body.caseId) {
    res.status(400).json({ ok: false, errors: ['caseId required'], timestamp: ts() });
    return;
  }

  const caseDir = await findCaseDir(body.caseId);
  if (!caseDir) {
    res.status(404).json({ ok: false, errors: [`Case ${body.caseId} not found`], timestamp: ts() });
    return;
  }

  const manifest = await readManifest(caseDir);
  const analysisDir = path.join(caseDir, 'analysis');
  await fs.mkdir(analysisDir, { recursive: true });

  // Read all OCR text
  const ocrDir = path.join(caseDir, 'ocr_text');
  let ocrContent = '';
  if (fss.existsSync(ocrDir)) {
    const ocrFiles = await fs.readdir(ocrDir);
    for (const f of ocrFiles.filter(f => f.endsWith('.txt'))) {
      ocrContent += await fs.readFile(path.join(ocrDir, f), 'utf8');
    }
  }

  if (body.dryRun) {
    res.json({ ok: true, caseId: body.caseId, data: { dryRun: true, analysisDir }, timestamp: ts() });
    return;
  }

  // Route through Diamond Agents
  const routeResult = await routeAgents({
    objective: body.instructions ?? `Full case analysis for ${body.caseId}`,
    domain: body.domain ?? manifest?.caseMeta?.domain ?? 'legal',
    facts: [ocrContent.slice(0, 8000)],
    artifacts: manifest?.files.map(f => f.filename) ?? [],
    activateAgents: body.agents,
    caseId: body.caseId,
    dryRun: false,
    authToken: body.authToken,
  });

  // Write analysis files
  const fileMap: Record<string, string> = {
    'fact_map.md': routeResult.factMap,
    'timeline.md': routeResult.timeline,
    'evidence_matrix.md': routeResult.evidenceMatrix,
    'motion_queue.md': routeResult.motionQueue,
    'red_team.md': routeResult.redTeam,
  };

  const written: string[] = [];
  for (const [filename, content] of Object.entries(fileMap)) {
    if (content) {
      await fs.writeFile(path.join(analysisDir, filename), content, 'utf8');
      written.push(filename);
    }
  }

  res.json({
    ok: true,
    caseId: body.caseId,
    casePath: caseDir,
    data: { analysisFiles: written, routing: routeResult.routing },
    durationMs: Date.now() - start,
    timestamp: ts(),
  } as BridgeResponse);
});

// ─────────────────────────────────────────────────────────────────────────
// POST /agent/route
// Direct access to Diamond Agent Router — no filesystem deps.
// ─────────────────────────────────────────────────────────────────────────
app.post('/agent/route', requireAuth, async (req: Request, res: Response) => {
  const start = Date.now();
  const body = req.body as AgentRouteRequest;

  if (!body.objective || !body.domain) {
    res.status(400).json({ ok: false, errors: ['objective and domain required'], timestamp: ts() });
    return;
  }

  try {
    const result = await routeAgents(body);
    res.json({
      ok: true,
      data: result,
      durationMs: Date.now() - start,
      timestamp: ts(),
    } as BridgeResponse);
  } catch (err) {
    res.status(500).json({ ok: false, errors: [(err as Error).message], timestamp: ts() });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
async function findCaseDir(caseId: string): Promise<string | null> {
  const safe = sanitizeCaseId(caseId);
  // Walk up to 3 levels deep under CASES_ROOT looking for a dir whose basename matches
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > 3) return null;
    let entries: string[] = [];
    try { entries = await fs.readdir(dir); } catch { return null; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat?.isDirectory()) continue;
      if (entry === safe) return full;
      const sub = await walk(full, depth + 1);
      if (sub) return sub;
    }
    return null;
  }
  return walk(CASES_ROOT, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────────────────
export function startBridge() {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[GODMIND BRIDGE] Listening on http://127.0.0.1:${PORT}`);
    console.log(`[GODMIND BRIDGE] CASES_ROOT: ${CASES_ROOT}`);
    console.log(`[GODMIND BRIDGE] Auth: ${AUTH_TOKEN ? 'ENABLED' : 'DISABLED (set COLOSSUS_BRIDGE_TOKEN)'}`)
  });
}

export default app;
