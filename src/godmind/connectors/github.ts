// GODMIND Connector — GitHub
// Wraps Octokit REST for case-aware repository operations.
// Handles: push evidence files, create issues (as case tasks), search code,
// list commits, create PRs, and sync case manifests to a designated repo.

import { ConnectorBase, ConnectorHealth, GitHubConfig } from './types.js';

const GH_BASE = 'https://api.github.com';

export class GitHubConnector implements ConnectorBase {
  readonly name     = 'github';
  readonly version  = '1.0.0';
  readonly category = 'code' as const;

  private cfg: GitHubConfig;

  constructor(cfg?: Partial<GitHubConfig>) {
    this.cfg = {
      token:        cfg?.token        ?? process.env.GITHUB_TOKEN ?? '',
      defaultOwner: cfg?.defaultOwner ?? process.env.GITHUB_DEFAULT_OWNER,
      defaultRepo:  cfg?.defaultRepo  ?? process.env.GITHUB_DEFAULT_REPO,
      baseUrl:      cfg?.baseUrl      ?? GH_BASE,
    };
  }

  private headers() {
    return {
      Authorization:        `Bearer ${this.cfg.token}`,
      Accept:               'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type':       'application/json',
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`[github] ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async getAuthenticatedUser(): Promise<{ login: string; name: string; email: string }> {
    return this.req('GET', '/user');
  }

  async listRepos(owner: string, perPage = 30): Promise<{ name: string; full_name: string; private: boolean }[]> {
    return this.req('GET', `/users/${owner}/repos?per_page=${perPage}&sort=updated`);
  }

  async getFile(owner: string, repo: string, path: string, ref?: string): Promise<{ content: string; sha: string; encoding: string }> {
    const qs = ref ? `?ref=${ref}` : '';
    return this.req('GET', `/repos/${owner}/${repo}/contents/${path}${qs}`);
  }

  async pushFile(owner: string, repo: string, filePath: string, content: string, message: string, sha?: string): Promise<{ commit: { sha: string } }> {
    const encoded = Buffer.from(content, 'utf8').toString('base64');
    return this.req('PUT', `/repos/${owner}/${repo}/contents/${filePath}`, {
      message, content: encoded, ...(sha ? { sha } : {})
    });
  }

  /** Push case manifest JSON to a designated evidence repo */
  async syncCaseManifest(manifest: Record<string, unknown>, owner: string, repo: string): Promise<string> {
    const caseId = manifest.case as string ?? 'unknown';
    const filePath = `cases/${caseId}/manifest.json`;
    const content = JSON.stringify(manifest, null, 2);
    try {
      const existing = await this.getFile(owner, repo, filePath);
      await this.pushFile(owner, repo, filePath, content, `chore: update manifest for ${caseId}`, existing.sha);
    } catch {
      await this.pushFile(owner, repo, filePath, content, `feat: add manifest for ${caseId}`);
    }
    return filePath;
  }

  async createIssue(owner: string, repo: string, title: string, body: string, labels?: string[]): Promise<{ number: number; html_url: string }> {
    return this.req('POST', `/repos/${owner}/${repo}/issues`, { title, body, labels });
  }

  async searchCode(query: string, owner?: string, repo?: string): Promise<{ total_count: number; items: { path: string; html_url: string; repository: { full_name: string } }[] }> {
    const scoped = [query, owner && `user:${owner}`, repo && `repo:${owner}/${repo}`].filter(Boolean).join(' ');
    return this.req('GET', `/search/code?q=${encodeURIComponent(scoped)}`);
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const start = Date.now();
    try {
      await this.getAuthenticatedUser();
      return { ok: true, connector: this.name, latencyMs: Date.now() - start, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, connector: this.name, error: (err as Error).message, checkedAt: new Date().toISOString() };
    }
  }
}
