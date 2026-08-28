"""
Connector Registry — all 14 platform integrations for the Colossus APEX stack.
Each connector follows the same interface:
  .health()      → dict with status, latency_ms
  .read(...)     → fetch data
  .write(...)    → push data
  .sync_to_apex(...)  → write to godmind_memory / connector_jobs in Supabase
"""

from __future__ import annotations
import os
import time
import httpx
from typing import Any, Optional


# ─────────────────────────────────────────────
# Base
# ─────────────────────────────────────────────
class BaseConnector:
    name: str = "base"

    def health(self) -> dict:
        raise NotImplementedError

    def _ok(self, latency_ms: float) -> dict:
        return {
            "connector": self.name,
            "status": "ok",
            "latency_ms": round(latency_ms, 1),
        }

    def _err(self, msg: str) -> dict:
        return {"connector": self.name, "status": "error", "error": msg}


# ─────────────────────────────────────────────
# 1. GitHub
# ─────────────────────────────────────────────
class GitHubConnector(BaseConnector):
    name = "github"

    def __init__(self):
        self.token = os.environ["GITHUB_TOKEN"]
        self.base = "https://api.github.com"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
        }

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(f"{self.base}/user", headers=self.headers, timeout=8)
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def list_issues(self, owner: str, repo: str, state: str = "open") -> list:
        r = httpx.get(
            f"{self.base}/repos/{owner}/{repo}/issues",
            headers=self.headers,
            params={"state": state, "per_page": 100},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()

    def create_issue(
        self, owner: str, repo: str, title: str, body: str = "", labels: list = []
    ) -> dict:
        r = httpx.post(
            f"{self.base}/repos/{owner}/{repo}/issues",
            headers=self.headers,
            json={"title": title, "body": body, "labels": labels},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 2. Notion
# ─────────────────────────────────────────────
class NotionConnector(BaseConnector):
    name = "notion"

    def __init__(self):
        self.token = os.environ["NOTION_API_KEY"]
        self.base = "https://api.notion.com/v1"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
        }

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(f"{self.base}/users/me", headers=self.headers, timeout=8)
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def search(self, query: str) -> list:
        r = httpx.post(
            f"{self.base}/search",
            headers=self.headers,
            json={"query": query},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("results", [])

    def create_page(self, parent_id: str, title: str, body_md: str = "") -> dict:
        payload = {
            "parent": {"database_id": parent_id},
            "properties": {"title": {"title": [{"text": {"content": title}}]}},
        }
        if body_md:
            payload["children"] = [
                {
                    "object": "block",
                    "type": "paragraph",
                    "paragraph": {
                        "rich_text": [
                            {"type": "text", "text": {"content": body_md[:2000]}}
                        ]
                    },
                }
            ]
        r = httpx.post(
            f"{self.base}/pages", headers=self.headers, json=payload, timeout=15
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 3. Vercel
# ─────────────────────────────────────────────
class VercelConnector(BaseConnector):
    name = "vercel"

    def __init__(self):
        self.token = os.environ["VERCEL_TOKEN"]
        self.base = "https://api.vercel.com"
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(f"{self.base}/v2/user", headers=self.headers, timeout=8)
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def list_deployments(self, limit: int = 10) -> list:
        r = httpx.get(
            f"{self.base}/v6/deployments",
            headers=self.headers,
            params={"limit": limit},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("deployments", [])

    def get_env(self, project_id: str) -> list:
        r = httpx.get(
            f"{self.base}/v9/projects/{project_id}/env",
            headers=self.headers,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("envs", [])


# ─────────────────────────────────────────────
# 4. Supabase
# ─────────────────────────────────────────────
class SupabaseConnector(BaseConnector):
    name = "supabase"

    def __init__(self):
        self.url = os.environ["SUPABASE_URL"]
        self.key = os.environ["SUPABASE_SERVICE_KEY"]
        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(
            f"{self.url}/rest/v1/connector_jobs",
            headers=self.headers,
            params={"limit": "1"},
            timeout=8,
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def insert(self, table: str, row: dict) -> dict:
        r = httpx.post(
            f"{self.url}/rest/v1/{table}",
            headers=self.headers,
            json=row,
            timeout=15,
        )
        r.raise_for_status()
        return r.json()

    def select(self, table: str, filters: str = "") -> list:
        url = f"{self.url}/rest/v1/{table}"
        if filters:
            url += f"?{filters}"
        r = httpx.get(url, headers=self.headers, timeout=15)
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 5. MotherDuck (DuckDB cloud)
# ─────────────────────────────────────────────
class MotherDuckConnector(BaseConnector):
    name = "motherduck"

    def __init__(self):
        self.token = os.environ["MOTHERDUCK_TOKEN"]
        # Lazy import to avoid hard dep at module load
        import duckdb

        self._duckdb = duckdb
        self._conn: Any = None

    def _get_conn(self):
        if self._conn is None:
            self._conn = self._duckdb.connect(
                f"md:colossus?motherduck_token={self.token}"
            )
        return self._conn

    def health(self) -> dict:
        t0 = time.monotonic()
        self._get_conn().execute("SELECT 1").fetchone()
        return self._ok((time.monotonic() - t0) * 1000)

    def query(self, sql: str) -> list:
        rows = self._get_conn().execute(sql).fetchall()
        return [list(r) for r in rows]

    def execute(self, sql: str) -> None:
        self._get_conn().execute(sql)


# ─────────────────────────────────────────────
# 6. Airtable
# ─────────────────────────────────────────────
class AirtableConnector(BaseConnector):
    name = "airtable"

    def __init__(self):
        self.token = os.environ["AIRTABLE_API_KEY"]
        self.base_id = os.environ.get("AIRTABLE_BASE_ID", "")
        self.base = "https://api.airtable.com/v0"
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(
            "https://api.airtable.com/v0/meta/bases",
            headers=self.headers,
            params={"pageSize": 1},
            timeout=8,
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def list_records(self, table: str, max_records: int = 100) -> list:
        r = httpx.get(
            f"{self.base}/{self.base_id}/{table}",
            headers=self.headers,
            params={"maxRecords": max_records},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("records", [])

    def create_record(self, table: str, fields: dict) -> dict:
        r = httpx.post(
            f"{self.base}/{self.base_id}/{table}",
            headers={**self.headers, "Content-Type": "application/json"},
            json={"fields": fields},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 7. ClickUp
# ─────────────────────────────────────────────
class ClickUpConnector(BaseConnector):
    name = "clickup"

    def __init__(self):
        self.token = os.environ["CLICKUP_API_KEY"]
        self.team_id = os.environ.get("CLICKUP_TEAM_ID", "")
        self.base = "https://api.clickup.com/api/v2"
        self.headers = {"Authorization": self.token, "Content-Type": "application/json"}

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(f"{self.base}/user", headers=self.headers, timeout=8)
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def create_task(
        self, list_id: str, name: str, description: str = "", priority: int = 3
    ) -> dict:
        r = httpx.post(
            f"{self.base}/list/{list_id}/task",
            headers=self.headers,
            json={"name": name, "description": description, "priority": priority},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()

    def get_tasks(self, list_id: str) -> list:
        r = httpx.get(
            f"{self.base}/list/{list_id}/task",
            headers=self.headers,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("tasks", [])


# ─────────────────────────────────────────────
# 8. Google Docs
# ─────────────────────────────────────────────
class GoogleDocsConnector(BaseConnector):
    name = "google_docs"

    def __init__(self):
        self.token = os.environ["GOOGLE_OAUTH_TOKEN"]
        self.base = "https://docs.googleapis.com/v1"
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def health(self) -> dict:
        # Light check against Drive API (same OAuth scope)
        t0 = time.monotonic()
        r = httpx.get(
            "https://www.googleapis.com/drive/v3/about",
            headers=self.headers,
            params={"fields": "user"},
            timeout=8,
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def get_doc(self, doc_id: str) -> dict:
        r = httpx.get(
            f"{self.base}/documents/{doc_id}", headers=self.headers, timeout=15
        )
        r.raise_for_status()
        return r.json()

    def append_text(self, doc_id: str, text: str) -> dict:
        payload = {
            "requests": [{"insertText": {"location": {"index": 1}, "text": text}}]
        }
        r = httpx.post(
            f"{self.base}/documents/{doc_id}:batchUpdate",
            headers={**self.headers, "Content-Type": "application/json"},
            json=payload,
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 9. Google Sheets
# ─────────────────────────────────────────────
class GoogleSheetsConnector(BaseConnector):
    name = "google_sheets"

    def __init__(self):
        self.token = os.environ["GOOGLE_OAUTH_TOKEN"]
        self.base = "https://sheets.googleapis.com/v4/spreadsheets"
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(
            "https://www.googleapis.com/drive/v3/about",
            headers=self.headers,
            params={"fields": "user"},
            timeout=8,
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def read_range(self, sheet_id: str, range_: str) -> list:
        r = httpx.get(
            f"{self.base}/{sheet_id}/values/{range_}",
            headers=self.headers,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("values", [])

    def append_rows(self, sheet_id: str, range_: str, rows: list) -> dict:
        r = httpx.post(
            f"{self.base}/{sheet_id}/values/{range_}:append",
            headers={**self.headers, "Content-Type": "application/json"},
            params={"valueInputOption": "USER_ENTERED"},
            json={"values": rows},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 10. Microsoft OneNote
# ─────────────────────────────────────────────
class OneNoteConnector(BaseConnector):
    name = "onenote"

    def __init__(self):
        self.token = os.environ["MICROSOFT_GRAPH_TOKEN"]
        self.base = "https://graph.microsoft.com/v1.0/me/onenote"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(
            f"{self.base}/notebooks",
            headers=self.headers,
            params={"$top": 1},
            timeout=8,
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def list_pages(self, section_id: str) -> list:
        r = httpx.get(
            f"{self.base}/sections/{section_id}/pages",
            headers=self.headers,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("value", [])

    def create_page(self, section_id: str, title: str, html_content: str) -> dict:
        r = httpx.post(
            f"{self.base}/sections/{section_id}/pages",
            headers={**self.headers, "Content-Type": "text/html"},
            content=f"<html><head><title>{title}</title></head><body>{html_content}</body></html>".encode(),
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# 11. Pinecone
# ─────────────────────────────────────────────
class PineconeConnector(BaseConnector):
    name = "pinecone"

    def __init__(self):
        self.api_key = os.environ["PINECONE_API_KEY"]
        self.index_name = os.environ.get("PINECONE_INDEX", "colossus-apex")
        self.base = "https://api.pinecone.io"
        self.headers = {"Api-Key": self.api_key, "Content-Type": "application/json"}

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(
            f"{self.base}/indexes/{self.index_name}", headers=self.headers, timeout=8
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def upsert(self, vectors: list, namespace: str = "colossus-scenarios") -> dict:
        """
        vectors: [{"id": str, "values": [float,...], "metadata": dict}]
        """
        r = httpx.post(
            f"{self.base}/vectors/upsert",
            headers=self.headers,
            json={"vectors": vectors, "namespace": namespace},
            timeout=20,
        )
        r.raise_for_status()
        return r.json()

    def query(
        self, vector: list, top_k: int = 5, namespace: str = "colossus-scenarios"
    ) -> list:
        r = httpx.post(
            f"{self.base}/query",
            headers=self.headers,
            json={
                "vector": vector,
                "topK": top_k,
                "namespace": namespace,
                "includeMetadata": True,
            },
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("matches", [])


# ─────────────────────────────────────────────
# 12. Qdrant
# ─────────────────────────────────────────────
class QdrantConnector(BaseConnector):
    name = "qdrant"

    def __init__(self):
        self.url = os.environ["QDRANT_URL"]  # e.g. https://abc.qdrant.io:6333
        self.api_key = os.environ.get("QDRANT_API_KEY", "")
        self.collection = os.environ.get("QDRANT_COLLECTION", "colossus")
        self.headers = {"api-key": self.api_key, "Content-Type": "application/json"}

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(f"{self.url}/healthz", headers=self.headers, timeout=8)
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def upsert(self, points: list) -> dict:
        """
        points: [{"id": int|str, "vector": [float,...], "payload": dict}]
        """
        r = httpx.put(
            f"{self.url}/collections/{self.collection}/points",
            headers=self.headers,
            json={"points": points},
            timeout=20,
        )
        r.raise_for_status()
        return r.json()

    def search(
        self, vector: list, limit: int = 5, filter_: Optional[dict] = None
    ) -> list:
        payload: dict = {"vector": vector, "limit": limit, "with_payload": True}
        if filter_:
            payload["filter"] = filter_
        r = httpx.post(
            f"{self.url}/collections/{self.collection}/points/search",
            headers=self.headers,
            json=payload,
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("result", [])


# ─────────────────────────────────────────────
# 13. Sentry
# ─────────────────────────────────────────────
class SentryConnector(BaseConnector):
    name = "sentry"

    def __init__(self):
        self.token = os.environ["SENTRY_AUTH_TOKEN"]
        self.org = os.environ.get("SENTRY_ORG", "glaciereq")
        self.base = "https://sentry.io/api/0"
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def health(self) -> dict:
        t0 = time.monotonic()
        r = httpx.get(
            f"{self.base}/organizations/{self.org}/", headers=self.headers, timeout=8
        )
        r.raise_for_status()
        return self._ok((time.monotonic() - t0) * 1000)

    def get_issues(self, project: str, limit: int = 25) -> list:
        r = httpx.get(
            f"{self.base}/projects/{self.org}/{project}/issues/",
            headers=self.headers,
            params={"limit": limit, "query": "is:unresolved"},
            timeout=15,
        )
        r.raise_for_status()
        return r.json()

    def create_alert_rule(
        self, project: str, name: str, conditions: list, actions: list
    ) -> dict:
        r = httpx.post(
            f"{self.base}/projects/{self.org}/{project}/alert-rules/",
            headers=self.headers,
            json={
                "name": name,
                "conditions": conditions,
                "actions": actions,
                "actionMatch": "all",
            },
            timeout=15,
        )
        r.raise_for_status()
        return r.json()


# ─────────────────────────────────────────────
# Registry factory
# ─────────────────────────────────────────────
CONNECTOR_MAP = {
    "github": GitHubConnector,
    "notion": NotionConnector,
    "vercel": VercelConnector,
    "supabase": SupabaseConnector,
    "motherduck": MotherDuckConnector,
    "airtable": AirtableConnector,
    "clickup": ClickUpConnector,
    "google_docs": GoogleDocsConnector,
    "google_sheets": GoogleSheetsConnector,
    "onenote": OneNoteConnector,
    "pinecone": PineconeConnector,
    "qdrant": QdrantConnector,
    "sentry": SentryConnector,
}


def get_connector(name: str) -> BaseConnector:
    """Return an initialized connector by name."""
    cls = CONNECTOR_MAP.get(name)
    if cls is None:
        raise ValueError(
            f"Unknown connector: {name!r}. Available: {list(CONNECTOR_MAP.keys())}"
        )
    return cls()


def health_check_all(skip_on_missing_env: bool = True) -> dict:
    """Run health() on every registered connector. Returns pass/warn/fail per connector."""
    results = {}
    for name, cls in CONNECTOR_MAP.items():
        try:
            conn = cls()
            results[name] = conn.health()
        except KeyError as e:
            if skip_on_missing_env:
                results[name] = {
                    "connector": name,
                    "status": "skipped",
                    "reason": f"missing env: {e}",
                }
            else:
                raise
        except Exception as exc:
            results[name] = {"connector": name, "status": "error", "error": str(exc)}
    return results
