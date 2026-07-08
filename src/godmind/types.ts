// GODMIND Colossus Gateway — Shared Types
// Layer boundary contracts between Userscript, Bridge, and Agent Router

export type Domain = 'legal' | 'technical' | 'osint' | 'documents' | 'code' | 'strategy' | 'memory' | 'data';

export type AgentName =
  | 'Gatekeeper'
  | 'FactMiner'
  | 'EvidenceArchitect'
  | 'OSINTRaven'
  | 'LegalMaster'
  | 'CodeSmith'
  | 'DocumentForge'
  | 'RedTeam'
  | 'Synthesizer';

export type BuildMode = 'full_case_build' | 'scrape_only' | 'ocr_only' | 'analyze_only' | 'route_only';

/** Payload sent by the Userscript (Layer 1) to the Bridge (Layer 2) */
export interface UserscriptPayload {
  caseUrl: string;
  caseMeta: CaseMeta;
  pdfLinks: string[];
  mode: BuildMode;
  authToken?: string;
}

export interface CaseMeta {
  caseNumber?: string;
  judge?: string;
  parties?: string[];
  attorneys?: string[];
  court?: string;
  filedDate?: string;
  domain?: Domain;
  notes?: string;
}

/** Manifest written to 00_manifest.json */
export interface CaseManifest {
  version: '1.0.0';
  caseNumber: string;
  caseMeta: CaseMeta;
  createdAt: string;
  updatedAt: string;
  files: FileRecord[];
  hashAlgorithm: 'sha256';
  bridgeVersion: string;
}

export interface FileRecord {
  filename: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  ingestedAt: string;
  source: 'download' | 'ocr' | 'generated';
  pageCount?: number;
}

/** Docket entry for 01_docket.json */
export interface DocketEntry {
  entryNumber: string | number;
  date: string;
  description: string;
  filedBy?: string;
  documentLinks?: string[];
  localFilename?: string;
  flags?: string[];
}

/** Request body for POST /case/scrape */
export interface ScrapeRequest extends UserscriptPayload {}

/** Request body for POST /case/ocr */
export interface OCRRequest {
  caseId: string;
  files?: string[];  // specific filenames; if omitted, OCR all PDFs in filings/
  dryRun?: boolean;
  authToken?: string;
}

/** Request body for POST /case/merge */
export interface MergeRequest {
  caseId: string;
  sortBy?: 'date' | 'docket_number' | 'filename';
  outputFilename?: string;
  dryRun?: boolean;
  authToken?: string;
}

/** Request body for POST /case/analyze */
export interface AnalyzeRequest {
  caseId: string;
  agents?: AgentName[];
  domain?: Domain;
  instructions?: string;
  dryRun?: boolean;
  authToken?: string;
}

/** Request body for POST /agent/route */
export interface AgentRouteRequest {
  objective: string;
  domain: Domain;
  facts?: string[];
  artifacts?: string[];
  activateAgents?: AgentName[];
  caseId?: string;
  dryRun?: boolean;
  authToken?: string;
}

/** Standard bridge response envelope */
export interface BridgeResponse<T = unknown> {
  ok: boolean;
  caseId?: string;
  casePath?: string;
  data?: T;
  errors?: string[];
  warnings?: string[];
  dryRun?: boolean;
  durationMs?: number;
  timestamp: string;
}

/** Agent activation decision */
export interface RoutingDecision {
  objective: string;
  domain: Domain;
  activatedAgents: AgentName[];
  reasoning: Record<AgentName, string>;
  connectors: string[];
}
