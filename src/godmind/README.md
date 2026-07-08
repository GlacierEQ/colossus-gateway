# GODMIND Colossus Gateway v1

Three-layer Diamond Agent system for case research, document intelligence, and legal analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: Userscript (Gatekeeper UI)                    │
│  src/godmind/userscript.user.js                         │
│  • Runs in browser (Tampermonkey / Violentmonkey)       │
│  • Captures: case pages, docket links, PDF URLs         │
│  • ONLY sends JSON payload — never touches filesystem   │
└──────────────────────┬──────────────────────────────────┘
                       │ POST { caseUrl, caseMeta,
                       │        pdfLinks, mode }
                       ▼
┌─────────────────────────────────────────────────────────┐
│  LAYER 2: Colossus Bridge (Execution Core)              │
│  src/godmind/bridge.ts  →  localhost:7700               │
│                                                         │
│  POST /case/scrape    Downloads PDFs, builds folder     │
│  POST /case/ocr       pdftotext / tesseract OCR         │
│  POST /case/merge     Chronological PDF merge           │
│  POST /case/analyze   Routes to Diamond Agent layer     │
│  POST /agent/route    Direct agent access               │
│  GET  /healthz        Status check                      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  LAYER 3: Diamond Agent Router (Intelligence Layer)     │
│  src/godmind/router.ts                                  │
│                                                         │
│  Gatekeeper → classifies domain, activates agents       │
│  FactMiner → established facts vs allegations           │
│  EvidenceArchitect → exhibit map, chain of custody      │
│  LegalMaster → issues, standards, motion queue          │
│  OSINTRaven → public records, entity map, timeline      │
│  CodeSmith → scripts, bridges, API design               │
│  DocumentForge → motions, affidavits, schedules         │
│  RedTeam → adversarial review before delivery           │
│  Synthesizer → final clean artifact                     │
└─────────────────────────────────────────────────────────┘
```

## Output Structure

```
cases/
  {Judge} — {Attorneys}/
    {CaseNumber}/
      00_manifest.json          ← SHA-256 hashes, file registry
      01_docket.json            ← Docket entries
      02_index.csv              ← File index
      merged_chronological.pdf  ← All filings merged
      filings/                  ← Downloaded PDFs
      ocr_text/                 ← OCR output (.txt files)
      analysis/
        fact_map.md             ← FactMiner output
        timeline.md             ← Chronological events
        evidence_matrix.md      ← Exhibit tracking
        motion_queue.md         ← LegalMaster output
        red_team.md             ← Adversarial review
```

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Set COLOSSUS_BRIDGE_TOKEN, CASES_ROOT, etc.
```

### 3. Start the bridge
```bash
npx ts-node src/godmind/start-bridge.ts
```

### 4. Install userscript
1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey
2. Create a new script and paste the contents of `src/godmind/userscript.user.js`
3. Set your auth token: in the script, update `GM_getValue('colossus_auth_token', 'YOUR_TOKEN')`

### 5. Navigate to a court page
- PACER, CourtListener, CaseText, or any court docket
- Click the ⬡ button (bottom-right)
- Enter case number, judge, attorneys
- Click "🔍 Scan Page" to detect PDFs
- Click "⬡ EXECUTE" to run the full pipeline

## API Reference

### POST /case/scrape
```json
{
  "caseUrl": "https://courtlistener.com/docket/...",
  "caseMeta": {
    "caseNumber": "1FDV-23-0001009",
    "judge": "Smith",
    "attorneys": ["Jones", "Williams"],
    "domain": "legal"
  },
  "pdfLinks": ["https://..."],
  "mode": "full_case_build"
}
```

### POST /case/ocr
```json
{ "caseId": "1FDV-23-0001009", "dryRun": false }
```

### POST /case/merge
```json
{ "caseId": "1FDV-23-0001009", "sortBy": "filename" }
```

### POST /case/analyze
```json
{ "caseId": "1FDV-23-0001009", "domain": "legal", "instructions": "Focus on orders after 2024-01-01" }
```

### POST /agent/route
```json
{ "objective": "Identify all due process violations", "domain": "legal", "facts": ["..."] }
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `7700` | Bridge HTTP port (localhost only) |
| `CASES_ROOT` | `./cases` | Root directory for all case folders |
| `COLOSSUS_BRIDGE_TOKEN` | *(none)* | Auth token — set to secure the bridge |

## System Dependencies

For OCR and PDF merge, install OS-level tools:

```bash
# macOS
brew install poppler tesseract ghostscript

# Ubuntu/Debian  
sudo apt install poppler-utils tesseract-ocr ghostscript
```

## Security Notes

- Bridge binds to `127.0.0.1` only — never exposed to the network
- Always set `COLOSSUS_BRIDGE_TOKEN` in production
- The userscript never stores auth tokens in the page DOM
- All downloaded files are hashed (SHA-256) and recorded in the manifest
- `DRY_RUN` flag available on all mutating endpoints
