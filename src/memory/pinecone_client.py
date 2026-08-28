"""
Pinecone Memory Client — Colossus APEX Memory Layer
=====================================================
Handles semantic vector storage for:
  - Design docs (APEX_SYSTEM_MATRIX, architecture specs)
  - Legal / EJ findings
  - Incident & gauntlet reports
  - Scenario outcomes

Contract:
  health_check() -> dict
  upsert(vectors: list[dict]) -> dict
  query(text: str, top_k: int, filter: dict) -> list[dict]
  delete(ids: list[str]) -> dict
"""

import os
import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

try:
    from pinecone import Pinecone, ServerlessSpec
except ImportError:
    Pinecone = None  # graceful degradation


PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "colossus-apex")
PINECONE_ENV = os.getenv(
    "PINECONE_ENVIRONMENT", "us-east-1"
)  # AWS region for serverless
EMBED_DIM = int(
    os.getenv("PINECONE_EMBED_DIM", "1536")
)  # text-embedding-3-small default


class PineconeClient:
    """Thin wrapper around Pinecone v3 SDK with Colossus-specific conventions."""

    NAMESPACES = {
        "docs": "colossus-docs",  # architecture, APEX matrices
        "legal": "colossus-legal",  # EJ findings, CAA, 42 USC 1983
        "incident": "colossus-incidents",  # gauntlet failures, alerts
        "scenario": "colossus-scenarios",  # APEX scenario outcomes
        "memory": "colossus-memory",  # agent short-term bridging
    }

    def __init__(self):
        if not PINECONE_API_KEY:
            raise EnvironmentError("PINECONE_API_KEY not set")
        if Pinecone is None:
            raise ImportError("pip install pinecone-client")
        self._pc = Pinecone(api_key=PINECONE_API_KEY)
        self._index = self._get_or_create_index()

    def _get_or_create_index(self):
        existing = [i.name for i in self._pc.list_indexes().indexes]
        if PINECONE_INDEX not in existing:
            self._pc.create_index(
                name=PINECONE_INDEX,
                dimension=EMBED_DIM,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region=PINECONE_ENV),
            )
        return self._pc.Index(PINECONE_INDEX)

    # ------------------------------------------------------------------ #
    #  Public contract                                                      #
    # ------------------------------------------------------------------ #

    def health_check(self) -> dict:
        """Returns platform, status, and index stats."""
        try:
            stats = self._index.describe_index_stats()
            return {
                "platform": "pinecone",
                "status": "ok",
                "index": PINECONE_INDEX,
                "total_vectors": stats.total_vector_count,
                "namespaces": list(stats.namespaces.keys()),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            return {"platform": "pinecone", "status": "error", "error": str(e)}

    def upsert(
        self,
        vectors: list[dict],
        namespace: str = "memory",
    ) -> dict:
        """
        Upsert vectors into Pinecone.

        Each vector dict must have:
          id: str
          values: list[float]  (len == EMBED_DIM)
          metadata: dict       (arbitrary KV, keep < 40KB)

        Optional auto-id: if 'id' is missing, we hash the first 256 chars of
        metadata['text'] to produce a deterministic ID.
        """
        ns = self.NAMESPACES.get(namespace, namespace)
        prepared = []
        for v in vectors:
            if "id" not in v:
                text_key = str(v.get("metadata", {}).get("text", ""))[:256]
                v["id"] = hashlib.sha256(text_key.encode()).hexdigest()[:32]
            prepared.append(v)

        result = self._index.upsert(vectors=prepared, namespace=ns)
        return {
            "platform": "pinecone",
            "namespace": ns,
            "upserted": result.upserted_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def query(
        self,
        embedding: list[float],
        top_k: int = 10,
        namespace: str = "memory",
        filter: Optional[dict] = None,
        include_metadata: bool = True,
    ) -> list[dict]:
        """
        Semantic nearest-neighbor search.

        Returns list of {id, score, metadata} sorted by descending score.
        """
        ns = self.NAMESPACES.get(namespace, namespace)
        resp = self._index.query(
            vector=embedding,
            top_k=top_k,
            namespace=ns,
            filter=filter,
            include_metadata=include_metadata,
        )
        return [
            {"id": m.id, "score": m.score, "metadata": m.metadata or {}}
            for m in resp.matches
        ]

    def delete(self, ids: list[str], namespace: str = "memory") -> dict:
        ns = self.NAMESPACES.get(namespace, namespace)
        self._index.delete(ids=ids, namespace=ns)
        return {"platform": "pinecone", "deleted": len(ids), "namespace": ns}


# ------------------------------------------------------------------ #
#  Convenience: store an APEX scenario result                           #
# ------------------------------------------------------------------ #


def store_scenario(
    client: PineconeClient,
    scenario_id: str,
    embedding: list[float],
    repo: str,
    scenario_name: str,
    result: str,
    metrics: dict,
) -> dict:
    """
    Persists a scenario run into the 'scenario' namespace with rich metadata
    so future agents can retrieve "what happened last time we ran X".
    """
    metadata = {
        "scenario_id": scenario_id,
        "repo": repo,
        "scenario_name": scenario_name,
        "result": result,  # PASS | FAIL | DEGRADED
        "metrics": json.dumps(metrics),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    return client.upsert(
        vectors=[{"id": scenario_id, "values": embedding, "metadata": metadata}],
        namespace="scenario",
    )


if __name__ == "__main__":
    # Quick smoke test — needs real PINECONE_API_KEY in env
    c = PineconeClient()
    print(json.dumps(c.health_check(), indent=2))
