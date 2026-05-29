"""
Memory Router — Unified APEX Memory Interface
=============================================
Single entry point that routes memory operations to:
  - Pinecone  (vector/semantic search)
  - Supermemory.ai (persistent agent memory)

Usage:
  from src.memory.memory_router import MemoryRouter

  router = MemoryRouter()
  router.health_check_all()
  router.remember_scenario(scenario_id, embedding, ...)
  router.recall(query, top_k=10)

This is the ONLY file other Colossus repos should import for memory.
"""

import os
import json
from datetime import datetime, timezone
from typing import Optional

from .pinecone_client import PineconeClient, store_scenario
from .supermemory_client import SupermemoryClient, record_apex_decision


class MemoryRouter:
    """Unified memory interface for all Colossus APEX agents."""

    def __init__(self):
        self._pinecone: Optional[PineconeClient] = None
        self._supermemory: Optional[SupermemoryClient] = None
        self._init_clients()

    def _init_clients(self):
        errors = []
        try:
            self._pinecone = PineconeClient()
        except Exception as e:
            errors.append(f"Pinecone init failed: {e}")

        try:
            self._supermemory = SupermemoryClient()
        except Exception as e:
            errors.append(f"Supermemory init failed: {e}")

        if errors:
            print(f"[MemoryRouter] WARNINGS: {errors}")

    # ------------------------------------------------------------------ #
    #  Health                                                               #
    # ------------------------------------------------------------------ #

    def health_check_all(self) -> dict:
        """Returns health status for all connected memory backends."""
        results = {
            "router": "memory_router",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "backends": {},
        }
        if self._pinecone:
            results["backends"]["pinecone"] = self._pinecone.health_check()
        else:
            results["backends"]["pinecone"] = {"status": "not_configured"}

        if self._supermemory:
            results["backends"]["supermemory"] = self._supermemory.health_check()
        else:
            results["backends"]["supermemory"] = {"status": "not_configured"}

        all_ok = all(
            b.get("status") == "ok"
            for b in results["backends"].values()
            if b.get("status") != "not_configured"
        )
        results["overall"] = "ok" if all_ok else "degraded"
        return results

    # ------------------------------------------------------------------ #
    #  Write operations                                                     #
    # ------------------------------------------------------------------ #

    def remember_scenario(
        self,
        scenario_id: str,
        embedding: list[float],
        repo: str,
        scenario_name: str,
        result: str,
        metrics: dict,
    ) -> dict:
        """
        Dual-write: persists scenario to Pinecone (vector) + Supermemory (text).
        This means future agents can find it semantically (Pinecone)
        AND in plain-language conversation context (Supermemory).
        """
        pinecone_result = None
        supermemory_result = None

        if self._pinecone:
            pinecone_result = store_scenario(
                self._pinecone, scenario_id, embedding,
                repo, scenario_name, result, metrics,
            )

        if self._supermemory:
            content = (
                f"# Scenario: {scenario_name}\n"
                f"**Repo:** {repo}\n"
                f"**Result:** {result}\n"
                f"**Metrics:** {json.dumps(metrics, indent=2)}\n"
                f"**ID:** {scenario_id}"
            )
            supermemory_result = self._supermemory.write(
                content=content,
                tags=["scenario", repo, result.lower(), scenario_name.replace(" ", "_")],
                space_key="scenarios",
                metadata={"scenario_id": scenario_id, "repo": repo, "result": result},
            )

        return {
            "scenario_id": scenario_id,
            "pinecone": pinecone_result,
            "supermemory": supermemory_result,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def record_decision(
        self,
        agent_id: str,
        decision: str,
        context: str,
        outcome: str,
        repo: str,
    ) -> dict:
        """Record an APEX agent decision into Supermemory ops space."""
        if not self._supermemory:
            return {"status": "supermemory_not_configured"}
        return record_apex_decision(
            self._supermemory, agent_id, decision, context, outcome, repo
        )

    def ingest_document(
        self,
        doc_id: str,
        embedding: list[float],
        text: str,
        namespace: str,
        metadata: dict,
    ) -> dict:
        """Upsert a document embedding into Pinecone + its text into Supermemory."""
        results: dict = {"doc_id": doc_id}

        if self._pinecone:
            results["pinecone"] = self._pinecone.upsert(
                vectors=[{"id": doc_id, "values": embedding,
                          "metadata": {"text": text[:1000], **metadata}}],
                namespace=namespace,
            )

        if self._supermemory:
            space_key = "docs" if namespace in ("docs", "colossus-docs") else "ops"
            results["supermemory"] = self._supermemory.write(
                content=text,
                tags=[namespace, doc_id] + list(metadata.get("tags", [])),
                space_key=space_key,
                metadata=metadata,
            )

        return results

    # ------------------------------------------------------------------ #
    #  Read operations                                                      #
    # ------------------------------------------------------------------ #

    def recall(
        self,
        query: str,
        embedding: Optional[list[float]] = None,
        top_k: int = 10,
        namespace: str = "memory",
        space_key: Optional[str] = None,
    ) -> dict:
        """
        Retrieve memories from both backends and merge results.

        - Pinecone: requires embedding (vector search)
        - Supermemory: text search (no embedding needed)
        """
        results: dict = {"query": query, "backends": {}}

        if self._pinecone and embedding:
            results["backends"]["pinecone"] = self._pinecone.query(
                embedding=embedding, top_k=top_k, namespace=namespace
            )
        if self._supermemory:
            results["backends"]["supermemory"] = self._supermemory.search(
                query=query, top_k=top_k, space_key=space_key
            )

        return results


if __name__ == "__main__":
    router = MemoryRouter()
    print(json.dumps(router.health_check_all(), indent=2))
