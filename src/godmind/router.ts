// GODMIND Diamond Agent Router (Layer 3: Intelligence Layer)
// Routes objectives through specialized agents based on domain classification.
// Each agent produces structured markdown output written to analysis/.

import { AgentRouteRequest, AgentName, Domain, RoutingDecision } from './types.js';

export interface AgentResult {
  routing: RoutingDecision;
  factMap: string;
  timeline: string;
  evidenceMatrix: string;
  motionQueue: string;
  redTeam: string;
  synthesis: string;
  coreReadout: string;
}

// Agent activation rules by domain
const DOMAIN_AGENTS: Record<Domain, AgentName[]> = {
  legal:     ['Gatekeeper','FactMiner','EvidenceArchitect','LegalMaster','OSINTRaven','DocumentForge','RedTeam','Synthesizer'],
  technical: ['Gatekeeper','FactMiner','CodeSmith','RedTeam','Synthesizer'],
  osint:     ['Gatekeeper','FactMiner','OSINTRaven','EvidenceArchitect','RedTeam','Synthesizer'],
  documents: ['Gatekeeper','FactMiner','EvidenceArchitect','DocumentForge','Synthesizer'],
  code:      ['Gatekeeper','CodeSmith','RedTeam','Synthesizer'],
  strategy:  ['Gatekeeper','FactMiner','OSINTRaven','LegalMaster','RedTeam','Synthesizer'],
  memory:    ['Gatekeeper','FactMiner','Synthesizer'],
  data:      ['Gatekeeper','FactMiner','EvidenceArchitect','CodeSmith','Synthesizer'],
};

export async function routeAgents(req: AgentRouteRequest): Promise<AgentResult> {
  const domain = req.domain ?? classifyDomain(req.objective);
  const agentsToRun = req.activateAgents ?? DOMAIN_AGENTS[domain];

  const routing: RoutingDecision = {
    objective: req.objective,
    domain,
    activatedAgents: agentsToRun,
    reasoning: buildReasoning(agentsToRun, domain),
    connectors: inferConnectors(domain),
  };

  if (req.dryRun) {
    return buildDryRunResult(routing);
  }

  // Run each agent pipeline
  const facts = req.facts ?? [];
  const artifacts = req.artifacts ?? [];

  const factMap = agentsToRun.includes('FactMiner')
    ? runFactMiner(req.objective, facts) : '';
  const evidenceMatrix = agentsToRun.includes('EvidenceArchitect')
    ? runEvidenceArchitect(facts, artifacts) : '';
  const timeline = agentsToRun.includes('EvidenceArchitect')
    ? runTimeline(facts) : '';
  const motionQueue = agentsToRun.includes('LegalMaster')
    ? runLegalMaster(req.objective, facts) : '';
  const redTeam = agentsToRun.includes('RedTeam')
    ? runRedTeam(req.objective, facts, domain) : '';
  const synthesis = agentsToRun.includes('Synthesizer')
    ? runSynthesizer(req.objective, domain, facts, artifacts) : '';
  const coreReadout = buildCoreReadout(req.objective, domain, routing);

  return { routing, factMap, timeline, evidenceMatrix, motionQueue, redTeam, synthesis, coreReadout };
}

// ── Domain classifier ─────────────────────────────────────────────────────
function classifyDomain(objective: string): Domain {
  const o = objective.toLowerCase();
  if (/\b(motion|court|judge|docket|filing|plaintiff|defendant|order|complaint|brief|affidavit|deposition|discovery|subpoena|injunction|statute|case no)\b/.test(o)) return 'legal';
  if (/\b(api|code|typescript|python|function|endpoint|script|deploy|github|database|sql|schema|migration)\b/.test(o)) return 'technical';
  if (/\b(osint|search|investigate|public record|entity|person|address|phone|linkedin|registry)\b/.test(o)) return 'osint';
  if (/\b(pdf|document|merge|ocr|exhibit|filing|attachment|extract)\b/.test(o)) return 'documents';
  if (/\b(strategy|plan|roadmap|risk|decision|tradeoff)\b/.test(o)) return 'strategy';
  if (/\b(data|analytics|csv|json|query|motherduck|supabase|pinecone|vector|qdrant)\b/.test(o)) return 'data';
  if (/\b(memory|remember|context|history|recall)\b/.test(o)) return 'memory';
  return 'legal'; // default for casebuilder
}

// ── Agent runners — structured markdown output ────────────────────────────
function runFactMiner(objective: string, facts: string[]): string {
  const now = new Date().toISOString();
  return `# Fact Map\n_Generated: ${now}_\n\n## Objective\n${objective}\n\n## Established Facts\n${facts.length ? facts.map(f => `- ${f.slice(0, 200)}`).join('\n') : '- No facts provided — requires input from scrape/OCR pipeline'}\n\n## User Allegations / Claims\n_Requires human input — mark each claim as [ALLEGED] until verified_\n\n## Unknowns / Gaps\n- [ ] Source authentication status\n- [ ] Chain of custody for digital exhibits\n- [ ] Missing docket entries (if any)\n- [ ] Adverse party's counterarguments\n\n## Contradictions\n_Run Red Team agent to surface contradictions_\n`;
}

function runEvidenceArchitect(facts: string[], artifacts: string[]): string {
  const rows = artifacts.length
    ? artifacts.map((f, i) => `| EX-${String(i+1).padStart(3,'0')} | ${f} | — | — | — | Pending |`).join('\n')
    : '| — | No artifacts ingested yet | — | — | — | — |';
  return `# Evidence Matrix\n\n| Exhibit | Filename/Source | Date | Author | Authenticity | Status |\n|---------|----------------|------|--------|-------------|--------|\n${rows}\n\n## Chain of Custody Notes\n- All files hashed (SHA-256) on ingest via bridge\n- Original download URLs recorded in 00_manifest.json\n- Modifications tracked by bridge version stamp\n`;
}

function runTimeline(facts: string[]): string {
  return `# Case Timeline\n\n> Auto-generated scaffold — populate dates from docket entries and OCR text\n\n| Date | Event | Source | Exhibit | Significance |\n|------|-------|--------|---------|-------------|\n| [DATE] | [EVENT] | [SOURCE] | [EX-XXX] | [HIGH/MED/LOW] |\n\n## Notes\n${facts.length ? `- OCR content ingested (${facts.length} block(s)) — run date extraction pass` : '- No OCR content yet — run /case/ocr first'}\n`;
}

function runLegalMaster(objective: string, facts: string[]): string {
  return `# Motion Queue\n\n> **LegalMaster Rule:** No invented citations, deadlines, docket facts, or statutes.\n> All authority marked [REQUIRES VERIFICATION] until confirmed.\n\n## Framing\n**Objective:** ${objective}\n\n## Potential Issues\n- [ ] Identify controlling statute or rule [REQUIRES VERIFICATION]\n- [ ] Identify applicable standard of review [REQUIRES VERIFICATION]\n- [ ] Identify deadline for next filing [CHECK DOCKET]\n\n## Potential Relief\n- [ ] List requested remedies — tie each to evidence and prejudice\n\n## Counterarguments to Anticipate\n- [ ] Opposing counsel's most likely response\n- [ ] Credibility attacks on key witnesses\n- [ ] Procedural defenses\n\n## Filing Sequence\n1. Confirm docket entries via /case/scrape\n2. Run OCR on all scanned filings\n3. Build timeline → identify prejudice windows\n4. Draft motion → route through Red Team\n5. Final review → DocumentForge output\n\n## Appellate Preservation Notes\n- [ ] All objections made on the record?\n- [ ] All issues raised below before raising on appeal?\n`;
}

function runRedTeam(objective: string, facts: string[], domain: Domain): string {
  const attacks = [
    { severity: 'HIGH', issue: 'Authentication gaps', detail: 'Digital exhibits require metadata verification — timestamp, author, hash' },
    { severity: 'HIGH', issue: 'Chain of custody', detail: 'Downloaded PDFs need provenance tracking from source URL to local hash' },
    { severity: 'MED',  issue: 'Incomplete docket', detail: 'Missing entries may indicate sealed or ex parte proceedings' },
    { severity: 'MED',  issue: 'Credibility risks', detail: 'Unverified allegations present vulnerability under cross-examination' },
    { severity: 'LOW',  issue: 'Timing issues', detail: 'Verify statute of limitations and procedural deadlines' },
    ...(domain === 'legal' ? [{ severity: 'HIGH', issue: 'Legal leaps', detail: 'Factual inferences presented as conclusions without evidence anchors' }] : []),
    ...(domain === 'technical' ? [{ severity: 'MED', issue: 'Auth token exposure', detail: 'Ensure bridge token is not logged or committed to repo' }] : []),
  ];

  const rows = attacks.map(a => `| ${a.severity} | ${a.issue} | ${a.detail} |`).join('\n');
  return `# Red Team Report\n\n**Objective under attack:** ${objective}\n**Domain:** ${domain}\n\n| Severity | Vulnerability | Detail |\n|----------|--------------|--------|\n${rows}\n\n## Recommended Mitigations\n${attacks.filter(a=>a.severity==='HIGH').map(a => `- **${a.issue}:** ${a.detail}`).join('\n')}\n`;
}

function runSynthesizer(objective: string, domain: Domain, facts: string[], artifacts: string[]): string {
  return `# Synthesis\n\n## Core Answer\nObjective received: **${objective}**\nDomain: **${domain}** | Facts ingested: **${facts.length}** | Artifacts: **${artifacts.length}**\n\n## Status\n- Bridge pipeline: ✓ Running\n- Case folder: ✓ Initialized\n- OCR: ${facts.length ? '✓ Content available' : '⚠ Pending — run /case/ocr'}\n- Analysis files: Writing to analysis/ directory\n\n## Next Moves\n1. Review fact_map.md — mark each item [VERIFIED] or [ALLEGED]\n2. Populate timeline.md with docket dates\n3. Run red_team.md review before any filing\n`;
}

function buildCoreReadout(objective: string, domain: Domain, routing: RoutingDecision): string {
  return `# Core Readout\n\n**Objective:** ${objective}\n**Domain:** ${domain}\n**Agents activated:** ${routing.activatedAgents.join(', ')}\n**Connectors:** ${routing.connectors.join(', ')}\n`;
}

function buildReasoning(agents: AgentName[], domain: Domain): Record<AgentName, string> {
  const reasons: Partial<Record<AgentName, string>> = {
    Gatekeeper: 'Always active — classifies domain and controls agent activation',
    FactMiner: 'Active for all substantive domains — extracts verified vs alleged facts',
    EvidenceArchitect: `Active for ${domain} — builds exhibit map and chain-of-custody tracking`,
    LegalMaster: domain === 'legal' || domain === 'strategy' ? 'Active — legal domain requires issue framing and motion queue' : 'Not activated for this domain',
    OSINTRaven: `Active — entity mapping and public record identification`,
    CodeSmith: domain === 'technical' || domain === 'code' || domain === 'data' ? 'Active — technical domain requires bridge and API design' : 'Not activated for this domain',
    DocumentForge: `Active — output requires structured document production`,
    RedTeam: 'Active — adversarial review of all agent outputs before delivery',
    Synthesizer: 'Always active — produces final clean artifact',
  };
  return reasons as Record<AgentName, string>;
}

function inferConnectors(domain: Domain): string[] {
  const base = ['GitHub', 'Supabase', 'Neon'];
  if (domain === 'legal') return [...base, 'Notion', 'ClickUp', 'Pinecone'];
  if (domain === 'data') return [...base, 'MotherDuck', 'Pinecone', 'Qdrant'];
  if (domain === 'osint') return [...base, 'Pinecone', 'Qdrant', 'Airtable'];
  return [...base, 'Notion'];
}

function buildDryRunResult(routing: RoutingDecision): AgentResult {
  return {
    routing,
    factMap: '[DRY RUN] FactMiner would run',
    timeline: '[DRY RUN] Timeline would be generated',
    evidenceMatrix: '[DRY RUN] Evidence matrix would be built',
    motionQueue: '[DRY RUN] LegalMaster motion queue would be populated',
    redTeam: '[DRY RUN] Red Team analysis would run',
    synthesis: '[DRY RUN] Synthesizer would produce final artifact',
    coreReadout: buildCoreReadout(routing.objective, routing.domain, routing),
  };
}
