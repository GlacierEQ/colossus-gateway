#!/usr/bin/env python3
"""
Colossus Energy Gauntlet

Runs all energy scenarios against a synthetic baseline cluster,
writes results to memory, and prints a PASS/FAIL table.

Usage
-----
  python scripts/run_energy_gauntlet.py
  python scripts/run_energy_gauntlet.py --fail-on-critical
  python scripts/run_energy_gauntlet.py --json
"""

import argparse
import json
import os
import sys

# Allow running from repo root without install
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.energy.powerflow import RackLoad, GRID_LIMIT_MW, FEEDER_COUNT
from src.energy.scenario_engine import EnergyScenarioEngine
from src.energy.energy_connector import EnergyConnector


def build_synthetic_cluster(
    rack_count: int = 32,
    gpu_per_rack: int = 8,
    tdp_per_gpu_w: float = 700.0,
    utilization: float = 0.85,
) -> list[RackLoad]:
    """Build a realistic H100 cluster baseline."""
    racks = []
    for i in range(rack_count):
        feeder_id = f"F-{(i % FEEDER_COUNT) + 1}"
        racks.append(
            RackLoad(
                rack_id=f"R-{i + 1:03d}",
                gpu_count=gpu_per_rack,
                tdp_per_gpu_w=tdp_per_gpu_w,
                utilization=utilization,
                feeder_id=feeder_id,
            )
        )
    return racks


def main() -> int:
    parser = argparse.ArgumentParser(description="Colossus Energy Gauntlet")
    parser.add_argument(
        "--fail-on-critical",
        action="store_true",
        help="Exit non-zero if any CRITICAL scenario fails (training_surge, substation_overload)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit results as JSON array to stdout",
    )
    parser.add_argument("--rack-count", type=int, default=32)
    parser.add_argument("--gpu-per-rack", type=int, default=8)
    parser.add_argument("--tdp-per-gpu-w", type=float, default=700.0)
    parser.add_argument("--utilization", type=float, default=0.85)
    args = parser.parse_args()

    # Build cluster
    racks = build_synthetic_cluster(
        rack_count=args.rack_count,
        gpu_per_rack=args.gpu_per_rack,
        tdp_per_gpu_w=args.tdp_per_gpu_w,
        utilization=args.utilization,
    )

    # Run gauntlet
    engine = EnergyScenarioEngine(rack_loads=racks, grid_limit_mw=GRID_LIMIT_MW)
    results = engine.run_all()

    # Write to memory + Supabase
    connector = EnergyConnector()
    connector.register()
    connector.record_scenario_results(results)
    connector.heartbeat(
        extra={
            "rack_count": len(racks),
            "total_load_mw": round(sum(r.draw_kw for r in racks) / 1000, 3),
        }
    )

    # Output
    if args.json:
        print(json.dumps([r.to_memory_payload() for r in results], indent=2))
    else:
        CRITICAL_SCENARIOS = {"training_surge", "substation_overload"}
        col_w = [30, 8, 10, 10, 10, 12]
        header = [
            "Scenario",
            "Status",
            "Load MW",
            "Limit MW",
            "Headroom",
            "Shed Rec MW",
        ]
        sep = "-" * sum(col_w)
        print("\n╔═ COLOSSUS ENERGY GAUNTLET ═══════════════════════════════╗")
        print(
            f"  Grid limit: {GRID_LIMIT_MW} MW  |  Feeders: {FEEDER_COUNT}  |  Racks: {len(racks)}"
        )
        print("═" * 62)
        print("  " + "  ".join(h.ljust(w) for h, w in zip(header, col_w)))
        print("  " + sep)
        for r in results:
            tag = (
                " ⚠ CRITICAL"
                if not r.passed and r.scenario_name in CRITICAL_SCENARIOS
                else ""
            )
            row = [
                r.scenario_name,
                r.status,
                f"{r.peak_load_mw:.1f}",
                f"{r.grid_limit_mw:.1f}",
                f"{r.headroom_mw:.1f}",
                f"{r.shed_recommendation_mw:.1f}",
            ]
            print("  " + "  ".join(v.ljust(w) for v, w in zip(row, col_w)) + tag)
        print("╚" + "═" * 61 + "╝\n")

    # Exit code
    if args.fail_on_critical:
        CRITICAL_SCENARIOS = {"training_surge", "substation_overload"}
        failed_critical = [
            r for r in results if not r.passed and r.scenario_name in CRITICAL_SCENARIOS
        ]
        if failed_critical:
            names = ", ".join(r.scenario_name for r in failed_critical)
            print(f"[FAIL] Critical scenarios failed: {names}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
