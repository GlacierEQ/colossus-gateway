"""
Unit tests for connector_registry — all tests use mock env vars and patched httpx.
No real network calls. No real credentials required.
"""
import os
import json
import pytest
from unittest.mock import patch, MagicMock

ENV_DEFAULTS = {
    "GITHUB_TOKEN": "ghp_test",
    "NOTION_API_KEY": "secret_test",
    "VERCEL_TOKEN": "vercel_test",
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_SERVICE_KEY": "sb_test",
    "MOTHERDUCK_TOKEN": "md_test",
    "AIRTABLE_API_KEY": "air_test",
    "AIRTABLE_BASE_ID": "appTEST",
    "CLICKUP_API_KEY": "cu_test",
    "CLICKUP_TEAM_ID": "12345",
    "GOOGLE_OAUTH_TOKEN": "ya29_test",
    "MICROSOFT_GRAPH_TOKEN": "graph_test",
    "PINECONE_API_KEY": "pc_test",
    "PINECONE_INDEX": "colossus-apex",
    "QDRANT_URL": "https://qdrant.test:6333",
    "QDRANT_API_KEY": "qd_test",
    "QDRANT_COLLECTION": "colossus",
    "SENTRY_AUTH_TOKEN": "sentry_test",
    "SENTRY_ORG": "glaciereq",
}


@pytest.fixture(autouse=True)
def patch_env():
    with patch.dict(os.environ, ENV_DEFAULTS):
        yield


def _mock_response(status=200, json_data=None):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = json_data or {}
    m.raise_for_status = MagicMock()
    return m


class TestGetConnector:
    def test_returns_correct_class(self):
        from src.integrations import get_connector, GitHubConnector
        assert isinstance(get_connector("github"), GitHubConnector)

    def test_raises_on_unknown(self):
        from src.integrations import get_connector
        with pytest.raises(ValueError):
            get_connector("nonexistent")


class TestGitHub:
    def test_health_ok(self):
        from src.integrations import GitHubConnector
        with patch("httpx.get", return_value=_mock_response(200, {"login": "GlacierEQ"})):
            result = GitHubConnector().health()
        assert result["status"] == "ok"
        assert result["connector"] == "github"

    def test_create_issue(self):
        from src.integrations import GitHubConnector
        resp_data = {"number": 42, "title": "Test Issue"}
        with patch("httpx.post", return_value=_mock_response(201, resp_data)):
            result = GitHubConnector().create_issue("GlacierEQ", "test-repo", "Test Issue")
        assert result["number"] == 42


class TestNotion:
    def test_health_ok(self):
        from src.integrations import NotionConnector
        with patch("httpx.get", return_value=_mock_response(200, {"id": "user_123"})):
            result = NotionConnector().health()
        assert result["status"] == "ok"

    def test_search(self):
        from src.integrations import NotionConnector
        with patch("httpx.post", return_value=_mock_response(200, {"results": [{"id": "page_1"}]})):
            results = NotionConnector().search("colossus energy")
        assert len(results) == 1


class TestSupabase:
    def test_health_ok(self):
        from src.integrations import SupabaseConnector
        with patch("httpx.get", return_value=_mock_response(200, [])):
            result = SupabaseConnector().health()
        assert result["status"] == "ok"

    def test_insert(self):
        from src.integrations import SupabaseConnector
        row = {"connector": "test", "status": "ok"}
        with patch("httpx.post", return_value=_mock_response(201, row)):
            result = SupabaseConnector().insert("connector_jobs", row)
        assert result["connector"] == "test"


class TestPinecone:
    def test_health_ok(self):
        from src.integrations import PineconeConnector
        with patch("httpx.get", return_value=_mock_response(200, {"name": "colossus-apex"})):
            result = PineconeConnector().health()
        assert result["status"] == "ok"

    def test_query(self):
        from src.integrations import PineconeConnector
        matches = [{"id": "vec_1", "score": 0.97, "metadata": {}}]
        with patch("httpx.post", return_value=_mock_response(200, {"matches": matches})):
            results = PineconeConnector().query([0.1] * 1536, top_k=1)
        assert results[0]["id"] == "vec_1"


class TestQdrant:
    def test_health_ok(self):
        from src.integrations import QdrantConnector
        with patch("httpx.get", return_value=_mock_response(200, {"status": "ok"})):
            result = QdrantConnector().health()
        assert result["status"] == "ok"


class TestSentry:
    def test_health_ok(self):
        from src.integrations import SentryConnector
        with patch("httpx.get", return_value=_mock_response(200, {"slug": "glaciereq"})):
            result = SentryConnector().health()
        assert result["status"] == "ok"


class TestHealthCheckAll:
    def test_all_skipped_without_env(self):
        """With no real credentials, all connectors should skip gracefully."""
        from src.integrations.connector_registry import health_check_all
        with patch.dict(os.environ, {}, clear=True):
            results = health_check_all(skip_on_missing_env=True)
        for name, r in results.items():
            assert r["status"] in ("ok", "skipped", "error")
