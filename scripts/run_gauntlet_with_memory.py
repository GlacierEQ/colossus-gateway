#!/usr/bin/env python3
"""
run_gauntlet_with_memory.py
---------------------------
CLI entrypoint: load any Colossus gauntlet module, patch its run()
with memory hooks, execute it, and report the memory write status.

Usage:
    python scripts/run_gauntlet_with_memory.py \
        --module xai_colossus_energy.gauntlets.feeder_overload \
        --repo xai-colossus-energy \
        --scenario feeder_overload_n1 \
        --tags grid EJ P1

    # Or use a pre-mapped key:
    python scripts/run_gauntlet_with_memory.py --key energy:feeder_overload

    # Fail if memory write fails (useful in CI):
    python scripts/run_gauntlet_with_memory.py --key energy:feeder_overload --fail-on-memory-error
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("run_gauntlet_with_memory")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a Colossus gauntlet with memory hooks.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--key", help="Short key from REPO_SCENARIO_MAP, e.g. energy:feeder_overload")
    group.add_argument("--module", help="Dotted module path, e.g. xai_colossus_energy.gauntlets.feeder_overload")
    parser.add_argument("--repo", help="Repo name (required with --module)")
    parser.add_argument("--scenario", help="Scenario name (required with --module)")
    parser.add_argument("--tags", nargs="*", default=[], help="Extra tags")
    parser.add_argument("--fail-on-memory-error", action="store_true", default=False)
    args = parser.parse_args()

    from src.memory.gauntlet_memory_patch import patch_gauntlet, patch_known_gauntlet

    try:
        if args.key:
            g = patch_known_gauntlet(args.key)
        else:
            if not args.repo or not args.scenario:
                parser.error("--repo and --scenario are required with --module")
            g = patch_gauntlet(
                module=args.module,
                repo=args.repo,
                scenario=args.scenario,
                tags=args.tags,
            )
    except (KeyError, AttributeError, ImportError) as exc:
        log.error("Patch failed: %s", exc)
        return 2

    t0 = time.monotonic()
    log.info("Running %s/%s ...", g.repo, g.scenario)

    try:
        result = g.run()
    except SystemExit as exc:
        # Some gauntlets call sys.exit() directly
        return int(exc.code) if exc.code is not None else 0
    except Exception as exc:  # noqa: BLE001
        log.error("Gauntlet raised uncaught exception: %s", exc)
        return 1

    elapsed = time.monotonic() - t0
    passed = bool(result.get("passed", False)) if isinstance(result, dict) else False
    status = "PASS" if passed else "FAIL"

    log.info("[%s] %s/%s completed in %.2fs", status, g.repo, g.scenario, elapsed)

    if not passed:
        failures = result.get("failures", []) if isinstance(result, dict) else []
        for f in failures:
            log.error("  FAIL: %s", f)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
