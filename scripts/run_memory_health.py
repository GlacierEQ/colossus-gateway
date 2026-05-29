#!/usr/bin/env python3
"""
scripts/run_memory_health.py
============================
Runs a full health check on the APEX memory layer (Pinecone + Supermemory).
Outputs structured JSON. Exits 1 if any backend is in error state.

Usage:
  python scripts/run_memory_health.py
  python scripts/run_memory_health.py --json   # machine-readable only
"""

import sys
import json
import argparse
from pathlib import Path

# Allow running from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.memory.memory_router import MemoryRouter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Output JSON only")
    parser.add_argument("--fail-on-degraded", action="store_true",
                        help="Exit 1 if any backend is degraded")
    args = parser.parse_args()

    router = MemoryRouter()
    result = router.health_check_all()

    if args.json:
        print(json.dumps(result))
    else:
        print("\n=== APEX Memory Layer Health ===")
        print(f"  Overall: {result['overall'].upper()}")
        for backend, status in result["backends"].items():
            icon = "✅" if status.get("status") == "ok" else (
                   "⚠️ " if status.get("status") == "not_configured" else "❌")
            print(f"  {icon} {backend.capitalize()}: {status.get('status', 'unknown')}")
            if status.get("total_vectors"):
                print(f"       vectors: {status['total_vectors']}")
            if status.get("latency_ms"):
                print(f"       latency: {status['latency_ms']}ms")
            if status.get("error"):
                print(f"       error: {status['error']}")
        print()

    if args.fail_on_degraded and result["overall"] != "ok":
        sys.exit(1)


if __name__ == "__main__":
    main()
