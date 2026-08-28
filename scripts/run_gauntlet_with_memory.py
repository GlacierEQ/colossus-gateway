#!/usr/bin/env python3
"""
run_gauntlet_with_memory.py
===========================
CLI runner: execute a named Colossus gauntlet and persist results to memory.

Usage:
    python scripts/run_gauntlet_with_memory.py --gauntlet energy.feeder_overload
    python scripts/run_gauntlet_with_memory.py --gauntlet servers.rack_failure --params '{"rack": "rack-07"}'
    python scripts/run_gauntlet_with_memory.py --list
    python scripts/run_gauntlet_with_memory.py --patch-status

Options:
    --gauntlet NAME     Run the named gauntlet (format: repo.gauntlet_name)
    --params JSON       JSON string of parameters to pass to the gauntlet
    --list              List all registered gauntlets
    --patch-status      Show which gauntlet patches are applied
    --fail-on-fail      Exit code 1 if gauntlet result is FAIL or ERROR
    --dry-run           Run the gauntlet but do not write to memory
"""

import argparse
import json
import sys
from src.memory.gauntlet_patch import (
    patch_all,
    patch_report,
)
from src.memory.memory_hooks import GauntletSession


GAUNTLET_MAP = {
    "energy.feeder_overload": (
        "xai_colossus_energy.gauntlets.feeder",
        "run_feeder_overload",
    ),
    "energy.training_surge": (
        "xai_colossus_energy.gauntlets.training",
        "run_training_surge",
    ),
    "energy.turbine_trip": (
        "xai_colossus_energy.gauntlets.turbine",
        "run_turbine_trip",
    ),
    "servers.rack_failure": ("xai_colossus_servers.gauntlets.rack", "run_rack_failure"),
    "servers.firmware": (
        "xai_colossus_servers.gauntlets.firmware",
        "run_firmware_gauntlet",
    ),
    "cooling.hot_aisle": (
        "xai_colossus_cooling.gauntlets.hot_aisle",
        "run_hot_aisle_overtemp",
    ),
    "cooling.pump_failure": ("xai_colossus_cooling.gauntlets.pump", "run_pump_failure"),
    "cooling.water_restriction": (
        "xai_colossus_cooling.gauntlets.water",
        "run_water_restriction",
    ),
    "security.config_drift": (
        "xai_colossus_security.gauntlets.config",
        "run_config_drift_check",
    ),
    "apex.orchestration": ("doctor_strange.apex.orchestrator", "run_apex_loop"),
}


def list_gauntlets():
    print("Registered gauntlets:")
    for name, (module, func) in GAUNTLET_MAP.items():
        print(f"  {name:<35}  →  {module}.{func}")


def show_patch_status():
    results = patch_all(fail_silent=True)
    print(patch_report(results))


def run_gauntlet(name: str, params: dict, fail_on_fail: bool, dry_run: bool):
    if name not in GAUNTLET_MAP:
        print(f"ERROR: Unknown gauntlet '{name}'. Use --list to see options.")
        sys.exit(1)

    module_path, func_name = GAUNTLET_MAP[name]
    repo = name.split(".")[0]

    # dynamic import
    try:
        import importlib

        mod = importlib.import_module(module_path)
        func = getattr(mod, func_name)
    except (ImportError, AttributeError) as exc:
        print(f"ERROR: Could not load {module_path}.{func_name}: {exc}")
        print("Hint: the target repo may not be installed yet. pip install -e <repo>")
        sys.exit(2)

    print(f"Running gauntlet: {name}")
    print(f"  Module : {module_path}.{func_name}")
    print(f"  Params : {json.dumps(params)}")
    print(f"  Memory : {'disabled (dry-run)' if dry_run else 'enabled'}")
    print()

    if dry_run:
        result = func(**params)
    else:
        with GauntletSession(scenario_type=repo, tags=[name]) as session:
            result = func(**params)
            session.record(result)

    # print result
    if isinstance(result, dict):
        print(json.dumps(result, indent=2))
    else:
        print(result)

    status = result.get("status", "UNKNOWN") if isinstance(result, dict) else "UNKNOWN"
    print(f"\nStatus: {status}")

    if fail_on_fail and status not in ("PASS", "OK", "SUCCESS"):
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Colossus gauntlet runner with memory")
    parser.add_argument("--gauntlet", help="Gauntlet name (repo.gauntlet)")
    parser.add_argument("--params", default="{}", help="JSON params")
    parser.add_argument("--list", action="store_true", help="List gauntlets")
    parser.add_argument("--patch-status", action="store_true", help="Show patch status")
    parser.add_argument("--fail-on-fail", action="store_true", help="Exit 1 on FAIL")
    parser.add_argument("--dry-run", action="store_true", help="Skip memory writes")
    args = parser.parse_args()

    if args.list:
        list_gauntlets()
        return

    if args.patch_status:
        show_patch_status()
        return

    if not args.gauntlet:
        parser.print_help()
        sys.exit(1)

    params = json.loads(args.params)
    run_gauntlet(args.gauntlet, params, args.fail_on_fail, args.dry_run)


if __name__ == "__main__":
    main()
