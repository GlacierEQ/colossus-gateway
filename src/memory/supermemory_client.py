"""
Supermemory.ai Client — APEX Persistent Agent Memory
=====================================================
Persists APEX agent decisions, connector health history,
gauntlet outcomes, and cross-session context so every
new agent session resumes with full situational awareness.

API reference: https://api.supermemory.ai

Contract:
  health_check() -> dict
  write(content, tags, space_id) -> dict
  search(query, top_k, space_id) -> list[dict]
  delete(memory_id) -> dict

Spaces map to Colossus domains:
  colossus-ops       -> runtime decisions, connector health
  colossus-scenarios -> gauntlet results
  colossus-legal     -> EJ, CAA, case artifacts
  colossus-docs      -> architecture, APEX matrices
"""

import os
import json
import time
from datetime import datetime, timezone
from typing import Optional

try:
    import httpx
except ImportError:
    httpx = None


SUPERMEMORY_API_KEY = os.getenv("SUPERMEMORY_API_KEY", "")
SUPERMEMORY_BASE = os.getenv("SUPERMEMORY_BASE_URL", "https://api.supermemory.ai/v3")

_SPACES = {
    "ops": os.getenv("SUPERMEMORY_SPACE_OPS", ""),
    "scenarios": os.getenv("SUPERMEMORY_SPACE_SCENARIOS", ""),
    "legal": os.getenv("SUPERMEMORY_SPACE_LEGAL", ""),
    "docs": os.getenv("SUPERMEMORY_SPACE_DOCS", ""),
}


class SupermemoryClient:
    """Thin wrapper around Supermemory.ai REST v3 API."""

    def __init__(self, timeout: float = 15.0):
        if not SUPERMEMORY_API_KEY:
            raise EnvironmentError("SUPERMEMORY_API_KEY not set")
        if httpx is None:
            raise ImportError("pip install httpx")
        self._headers = {
            "Authorization": f"Bearer {SUPERMEMORY_API_KEY}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout
        self._base = SUPERMEMORY_BASE

    def _post(self, path: str, payload: dict) -> dict:
        with httpx.Client(timeout=self._timeout) as client:
            r = client.post(
                f"{self._base}{path}",
                headers=self._headers,
                json=payload,
            )
            r.raise_for_status()
            return r.json()

    def _get(self, path: str, params: dict = None) -> dict:
        with httpx.Client(timeout=self._timeout) as client:
            r = client.get(
                f"{self._base}{path}",
                headers=self._headers,
                params=params or {},
            )
            r.raise_for_status()
            return r.json()

    def _delete(self, path: str) -> dict:
        with httpx.Client(timeout=self._timeout) as client:
            r = client.delete(f"{self._base}{path}", headers=self._headers)
            r.raise_for_status()
            return r.json() if r.content else {"status": "deleted"}

    # ------------------------------------------------------------------ #
    #  Public contract                                                      #
    # ------------------------------------------------------------------ #

    def health_check(self) -> dict:
        t0 = time.monotonic()
        try:
            resp = self._get("/memories", {"limit": 1})
            latency = round((time.monotonic() - t0) * 1000)
            return {
                "platform": "supermemory",
                "status": "ok",
                "latency_ms": latency,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            return {"platform": "supermemory", "status": "error", "error": str(e)}

    def write(
        self,
        content: str,
        tags: Optional[list[str]] = None,
        space_key: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> dict:
        """
        Write a memory entry.

        Args:
            content:   The text to store (markdown supported).
            tags:      List of string tags for filtering.
            space_key: One of 'ops', 'scenarios', 'legal', 'docs'.
                       Maps to the configured space ID in env.
            metadata:  Arbitrary key-value pairs attached to the memory.

        Returns dict with {memory_id, status, timestamp}.
        """
        payload: dict = {"content": content}
        if tags:
            payload["tags"] = tags
        if space_key and _SPACES.get(space_key):
            payload["spaces"] = [_SPACES[space_key]]
        if metadata:
            payload["metadata"] = metadata

        resp = self._post("/memories", payload)
        return {
            "platform": "supermemory",
            "memory_id": resp.get("id"),
            "status": "written",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def search(
        self,
        query: str,
        top_k: int = 10,
        space_key: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> list[dict]:
        """
        Semantic search over stored memories.

        Returns list of {id, score, content, metadata, tags}.
        """
        params: dict = {"q": query, "limit": top_k}
        if space_key and _SPACES.get(space_key):
            params["spaces"] = _SPACES[space_key]
        if tags:
            params["tags"] = ",".join(tags)

        resp = self._get("/search", params)
        results = resp.get("results", resp.get("memories", []))
        return [
            {
                "id": m.get("id"),
                "score": m.get("score", 0.0),
                "content": m.get("content", ""),
                "metadata": m.get("metadata", {}),
                "tags": m.get("tags", []),
            }
            for m in results
        ]

    def delete(self, memory_id: str) -> dict:
        return self._delete(f"/memories/{memory_id}")


# ------------------------------------------------------------------ #
#  Convenience: persist APEX decision into ops space                   #
# ------------------------------------------------------------------ #


def record_apex_decision(
    client: SupermemoryClient,
    agent_id: str,
    decision: str,
    context: str,
    outcome: str,
    repo: str,
) -> dict:
    """
    Writes a structured APEX agent decision into supermemory ops space.
    Future sessions can search "what did agent X decide when Y happened".
    """
    content = f"""# APEX Decision\n\n**Agent:** {agent_id}\n**Repo:** {repo}\n**Decision:** {decision}\n**Context:** {context}\n**Outcome:** {outcome}\n**Timestamp:** {datetime.now(timezone.utc).isoformat()}"""
    return client.write(
        content=content,
        tags=["apex", "decision", repo, agent_id, outcome.lower()],
        space_key="ops",
        metadata={"agent_id": agent_id, "repo": repo, "outcome": outcome},
    )


if __name__ == "__main__":
    c = SupermemoryClient()
    print(json.dumps(c.health_check(), indent=2))
