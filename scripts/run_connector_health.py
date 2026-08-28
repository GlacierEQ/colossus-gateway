#!/usr/bin/env python3
"""
Run health checks on all 13 Colossus platform connectors.

Usage:
    python scripts/run_connector_health.py
    python scripts/run_connector_health.py --fail-on-error
    python scripts/run_connector_health.py --json
"""

import sys
import json
import argparse
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.integrations.connector_registry import health_check_all

BLUE = "\033[94m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"
BOLD = "\033[1m"

ICON = {"ok": "✅", "skipped": "⚠️ ", "error": "❌"}
COLOR = {"ok": GREEN, "skipped": YELLOW, "error": RED}


def main():
    parser = argparse.ArgumentParser(description="Colossus connector health check")
    parser.add_argument(
        "--fail-on-error",
        action="store_true",
        help="Exit 1 if any connector has status=error",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        help="Output raw JSON instead of pretty-print",
    )
    args = parser.parse_args()

    results = health_check_all(skip_on_missing_env=True)

    if args.as_json:
        print(json.dumps(results, indent=2))
        sys.exit(0)

    print(f"\n{BOLD}{'─' * 55}{RESET}")
    print(f"{BOLD}  Colossus Platform Connector Health Check{RESET}")
    print(f"{BOLD}{'─' * 55}{RESET}")

    counts = {"ok": 0, "skipped": 0, "error": 0}
    for name, r in sorted(results.items()):
        status = r.get("status", "error")
        counts[status] = counts.get(status, 0) + 1
        icon = ICON.get(status, "?")
        color = COLOR.get(status, RESET)
        lat = f"  {r['latency_ms']:.0f}ms" if "latency_ms" in r else ""
        detail = r.get("reason") or r.get("error") or ""
        detail_str = f"  {detail}" if detail else ""
        print(f"  {icon} {color}{name:<20}{RESET}  {status}{lat}{detail_str}")

    print(f"{BOLD}{'─' * 55}{RESET}")
    print(
        f"  {GREEN}{counts['ok']} ok{RESET}  "
        f"{YELLOW}{counts['skipped']} skipped{RESET}  "
        f"{RED}{counts['error']} error{RESET}"
    )
    print()

    if args.fail_on_error and counts["error"] > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
