// ==UserScript==
// @name         GODMIND Colossus Gatekeeper
// @namespace    https://github.com/GlacierEQ/colossus-gateway
// @version      1.0.0
// @description  Layer 1 Gatekeeper UI — captures case pages, docket links, PDF links,
//               and selected text. Sends a clean JSON payload to the local Colossus Bridge.
//               NEVER handles filesystem, OCR, or PDF operations directly.
// @author       GlacierEQ
// @match        *://pacer.uscourts.gov/*
// @match        *://ecf.*.uscourts.gov/*
// @match        *://courtlistener.com/*
// @match        *://www.courtlistener.com/*
// @match        *://casetext.com/*
// @match        *://scholar.google.com/scholar_case*
// @match        *://*.courts.state.hi.us/*
// @match        *://localhost/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const BRIDGE_URL  = 'http://127.0.0.1:7700';
  const AUTH_TOKEN  = GM_getValue('colossus_auth_token', '');
  const VERSION     = '1.0.0';

  // ── State ─────────────────────────────────────────────────────────────────
  let panelVisible = false;
  let lastStatus   = null;

  // ── Styles ────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #colossus-panel {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 380px; background: #0f1117; border: 1px solid #2a2d3a;
      border-radius: 12px; color: #e2e8f0; font-family: 'SF Mono', monospace;
      font-size: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.6);
      transition: all 0.2s ease; overflow: hidden;
    }
    #colossus-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; background: #1a1d27; border-bottom: 1px solid #2a2d3a;
      cursor: pointer;
    }
    #colossus-header .logo { color: #4f98a3; font-weight: bold; font-size: 13px; }
    #colossus-header .ver  { color: #64748b; font-size: 10px; }
    #colossus-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    #colossus-body.hidden { display: none; }
    .cg-field label { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
    .cg-field input, .cg-field select, .cg-field textarea {
      width: 100%; margin-top: 4px; background: #1e2130; border: 1px solid #2a2d3a;
      color: #e2e8f0; border-radius: 6px; padding: 6px 8px; font-size: 11px;
      font-family: inherit; box-sizing: border-box;
    }
    .cg-field textarea { height: 60px; resize: vertical; }
    .cg-pdf-list { max-height: 100px; overflow-y: auto; }
    .cg-pdf-item { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
    .cg-pdf-item input[type=checkbox] { flex-shrink: 0; }
    .cg-pdf-item span { color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .cg-btn {
      padding: 8px 14px; border-radius: 6px; border: none; cursor: pointer;
      font-family: inherit; font-size: 11px; font-weight: 600;
      transition: all 0.15s ease;
    }
    .cg-btn-primary { background: #01696f; color: white; }
    .cg-btn-primary:hover { background: #0c4e54; }
    .cg-btn-sm { background: #1e2130; color: #94a3b8; padding: 5px 10px; font-size: 10px; }
    .cg-btn-sm:hover { color: #e2e8f0; }
    .cg-row { display: flex; gap: 8px; }
    .cg-row .cg-btn { flex: 1; }
    #colossus-status {
      padding: 8px 14px; font-size: 10px; border-top: 1px solid #2a2d3a;
      color: #64748b; min-height: 28px;
    }
    #colossus-status.ok  { color: #6daa45; }
    #colossus-status.err { color: #dd6974; }
    #colossus-status.loading { color: #4f98a3; }
    #colossus-toggle-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 999998;
      width: 44px; height: 44px; border-radius: 50%; background: #01696f;
      border: none; cursor: pointer; color: white; font-size: 18px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5); display: flex; align-items: center;
      justify-content: center; transition: all 0.15s ease;
    }
    #colossus-toggle-btn:hover { background: #0c4e54; transform: scale(1.05); }
  `);

  // ── DOM builder ───────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'colossus-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
      <div id="colossus-header">
        <span class="logo">⬡ GODMIND COLOSSUS</span>
        <span class="ver">v${VERSION}</span>
      </div>
      <div id="colossus-body">
        <div class="cg-field">
          <label>Case Number</label>
          <input id="cg-case-number" type="text" placeholder="e.g. 1FDV-23-0001009" />
        </div>
        <div class="cg-field">
          <label>Judge</label>
          <input id="cg-judge" type="text" placeholder="Last name" />
        </div>
        <div class="cg-field">
          <label>Attorneys (comma-separated)</label>
          <input id="cg-attorneys" type="text" placeholder="Smith, Jones" />
        </div>
        <div class="cg-field">
          <label>Domain</label>
          <select id="cg-domain">
            <option value="legal" selected>Legal</option>
            <option value="technical">Technical</option>
            <option value="osint">OSINT</option>
            <option value="documents">Documents</option>
            <option value="strategy">Strategy</option>
            <option value="data">Data</option>
          </select>
        </div>
        <div class="cg-field">
          <label>Mode</label>
          <select id="cg-mode">
            <option value="full_case_build" selected>Full Case Build</option>
            <option value="scrape_only">Scrape Only</option>
            <option value="ocr_only">OCR Only</option>
            <option value="analyze_only">Analyze Only</option>
          </select>
        </div>
        <div class="cg-field">
          <label>Notes / Instructions</label>
          <textarea id="cg-notes" placeholder="Focus on orders after [date]..."></textarea>
        </div>
        <div class="cg-field">
          <label>PDF Links Found (<span id="cg-pdf-count">0</span>)</label>
          <div id="cg-pdf-list" class="cg-pdf-list"></div>
        </div>
        <div class="cg-row">
          <button class="cg-btn cg-btn-sm" id="cg-scan-btn">🔍 Scan Page</button>
          <button class="cg-btn cg-btn-sm" id="cg-health-btn">💚 Health</button>
        </div>
        <div class="cg-row">
          <button class="cg-btn cg-btn-primary" id="cg-fire-btn">⬡ EXECUTE</button>
        </div>
      </div>
      <div id="colossus-status">Ready — scan page to detect PDF links</div>
    `;
    document.body.appendChild(panel);

    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'colossus-toggle-btn';
    toggleBtn.innerHTML = '⬡';
    toggleBtn.title = 'GODMIND Colossus';
    document.body.appendChild(toggleBtn);

    // Header collapse toggle
    document.getElementById('colossus-header').onclick = () => {
      const body = document.getElementById('colossus-body');
      body.classList.toggle('hidden');
    };

    toggleBtn.onclick = () => {
      panelVisible = !panelVisible;
      panel.style.display = panelVisible ? 'block' : 'none';
      toggleBtn.style.display = panelVisible ? 'none' : 'flex';
    };

    document.getElementById('cg-scan-btn').onclick = scanPage;
    document.getElementById('cg-health-btn').onclick = checkHealth;
    document.getElementById('cg-fire-btn').onclick = firePayload;

    // Auto-populate from page
    autoPopulate();
    scanPage();
  }

  // ── Auto-populate ─────────────────────────────────────────────────────────
  function autoPopulate() {
    const url = window.location.href;
    // Extract case number from URL patterns
    const caseMatch = url.match(/case[_-]?(\d[^/&?]+)/i) ||
      document.title.match(/(\d{1,2}[A-Z]{2,4}[-_]\d{2}[-_]\d{4,10})/i);
    if (caseMatch) {
      const el = document.getElementById('cg-case-number');
      if (el && !el.value) el.value = caseMatch[1];
    }
  }

  // ── Page scanner ─────────────────────────────────────────────────────────
  function scanPage() {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(href => /\.pdf(\?|$)/i.test(href) || href.includes('/doc/') || href.includes('pdf'))
      .filter((v, i, arr) => arr.indexOf(v) === i) // dedupe
      .slice(0, 50);

    const list = document.getElementById('cg-pdf-list');
    const count = document.getElementById('cg-pdf-count');
    list.innerHTML = '';
    count.textContent = links.length.toString();

    if (links.length === 0) {
      list.innerHTML = '<span style="color:#64748b">No PDF links detected</span>';
      return;
    }

    links.forEach(url => {
      const item = document.createElement('div');
      item.className = 'cg-pdf-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true; cb.value = url;
      const label = document.createElement('span');
      label.title = url;
      label.textContent = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? url).slice(0, 40);
      item.append(cb, label);
      list.appendChild(item);
    });
    setStatus('ok', `Found ${links.length} PDF link(s)`);
  }

  // ── Build payload ─────────────────────────────────────────────────────────
  function buildPayload() {
    const caseNumber  = document.getElementById('cg-case-number').value.trim();
    const judge       = document.getElementById('cg-judge').value.trim();
    const attorneys   = document.getElementById('cg-attorneys').value.trim()
      .split(',').map(s => s.trim()).filter(Boolean);
    const domain      = document.getElementById('cg-domain').value;
    const mode        = document.getElementById('cg-mode').value;
    const notes       = document.getElementById('cg-notes').value.trim();

    const pdfLinks = Array.from(
      document.querySelectorAll('#cg-pdf-list input[type=checkbox]:checked')
    ).map(cb => cb.value);

    return {
      caseUrl:  window.location.href,
      caseMeta: { caseNumber, judge, attorneys, domain, notes },
      pdfLinks,
      mode,
      authToken: AUTH_TOKEN || undefined,
    };
  }

  // ── Fire payload ──────────────────────────────────────────────────────────
  function firePayload() {
    const payload = buildPayload();
    const mode = payload.mode;

    const endpoint = {
      full_case_build: '/case/scrape',
      scrape_only:     '/case/scrape',
      ocr_only:        '/case/ocr',
      analyze_only:    '/case/analyze',
      route_only:      '/agent/route',
    }[mode] ?? '/case/scrape';

    setStatus('loading', `Sending to bridge → ${endpoint}...`);

    GM_xmlhttpRequest({
      method: 'POST',
      url: `${BRIDGE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        ...(AUTH_TOKEN ? { 'X-Auth-Token': AUTH_TOKEN } : {}),
      },
      data: JSON.stringify(payload),
      onload: (res) => {
        try {
          const json = JSON.parse(res.responseText);
          if (json.ok) {
            setStatus('ok', `✓ ${json.caseId ? `Case ${json.caseId}` : 'Success'} — ${json.data ? JSON.stringify(json.data).slice(0, 80) : 'done'}`);
          } else {
            setStatus('err', `✗ ${(json.errors ?? ['Unknown error']).join('; ')}`);
          }
        } catch {
          setStatus('err', `✗ Parse error: ${res.responseText.slice(0, 100)}`);
        }
      },
      onerror: () => setStatus('err', '✗ Bridge unreachable — is it running on port 7700?'),
      ontimeout: () => setStatus('err', '✗ Timeout'),
      timeout: 30000,
    });
  }

  // ── Health check ──────────────────────────────────────────────────────────
  function checkHealth() {
    setStatus('loading', 'Checking bridge...');
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${BRIDGE_URL}/healthz`,
      onload: (res) => {
        try {
          const json = JSON.parse(res.responseText);
          setStatus('ok', `Bridge v${json.version} ✓ — cases: ${json.casesRoot}`);
        } catch {
          setStatus('err', '✗ Bridge responded but returned unexpected data');
        }
      },
      onerror: () => setStatus('err', '✗ Bridge not running — start with: npx ts-node src/godmind/start-bridge.ts'),
      timeout: 5000,
    });
  }

  // ── Status helper ─────────────────────────────────────────────────────────
  function setStatus(type, msg) {
    const el = document.getElementById('colossus-status');
    if (!el) return;
    el.className = type;
    el.textContent = msg;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
})();
