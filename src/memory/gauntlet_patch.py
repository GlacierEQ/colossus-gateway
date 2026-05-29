"""
gauntlet_patch.py — Memory Hook Patches for Colossus Gauntlets
===============================================================
Applies @gauntlet_memory hooks to existing gauntlet entry points across
xai-colossus-energy, xai-colossus-servers, and DOCTOR-STRANGE.

Two usage modes:

  MODE 1: Import-time patch (recommended for new code)
  -----------------------------------------------------
  from src.memory.gauntlet_patch import patch_all
  patch_all()   # call once at app startup

  MODE 2: Explicit per-repo decorators (copy into each repo)
  ----------------------------------------------------------
  See the patched_* functions below as drop-in replacements.

Patch catalogue:
  - energy_feeder_overload_gauntlet      → scenario_type="energy"
  - energy_training_surge_gauntlet       → scenario_type="energy"
  - energy_turbine_trip_gauntlet         → scenario_type="energy"
  - servers_rack_failure_gauntlet        → scenario_type="servers"
  - servers_firmware_gauntlet            → scenario_type="servers"
  - cooling_hot_aisle_gauntlet           → scenario_type="cooling"
  - cooling_pump_failure_gauntlet        → scenario_type="cooling"
  - cooling_water_restriction_gauntlet   → scenario_type="cooling"
  - apex_orchestration_loop              → scenario_type="apex"
  - security_config_drift_check          → scenario_type="security"
"""

from __future__ import annotations

import importlib
import types
from typing import Any, Dict, List, Optional

from src.memory.memory_hooks import gauntlet_memory, ej_event, apex_decision


# ---------------------------------------------------------------------------
# Patch registry
# ---------------------------------------------------------------------------

# Each entry: (module_path, function_name, scenario_type, tags)
PATCH_REGISTRY: List[tuple] = [
    # xai-colossus-energy
    ("xai_colossus_energy.gauntlets.feeder",     "run_feeder_overload",     "energy",   ["feeder", "N-1", "grid"]),
    ("xai_colossus_energy.gauntlets.training",   "run_training_surge",      "energy",   ["training", "surge", "grid"]),
    ("xai_colossus_energy.gauntlets.turbine",    "run_turbine_trip",        "energy",   ["turbine", "generation", "grid"]),
    ("xai_colossus_energy.gauntlets.solar",      "run_solar_curtailment",   "energy",   ["solar", "renewables"]),

    # xai-colossus-servers
    ("xai_colossus_servers.gauntlets.rack",      "run_rack_failure",        "servers",  ["rack", "hardware", "N-1"]),
    ("xai_colossus_servers.gauntlets.firmware",  "run_firmware_gauntlet",   "servers",  ["firmware", "security"]),
    ("xai_colossus_servers.gauntlets.thermal",   "run_thermal_runaway",     "servers",  ["thermal", "emergency"]),

    # xai-colossus-cooling
    ("xai_colossus_cooling.gauntlets.hot_aisle", "run_hot_aisle_overtemp",  "cooling",  ["thermal", "hot-aisle"]),
    ("xai_colossus_cooling.gauntlets.pump",      "run_pump_failure",        "cooling",  ["pump", "N-1"]),
    ("xai_colossus_cooling.gauntlets.water",     "run_water_restriction",   "cooling",  ["water", "ej", "permitting"]),

    # xai-colossus-security
    ("xai_colossus_security.gauntlets.config",   "run_config_drift_check",  "security", ["config", "drift", "audit"]),
    ("xai_colossus_security.gauntlets.access",   "run_access_audit",        "security", ["access", "iam"]),

    # DOCTOR-STRANGE / APEX
    ("doctor_strange.apex.orchestrator",         "run_apex_loop",           "apex",     ["orchestration", "swarm"]),
    ("doctor_strange.apex.gap_detector",         "run_gap_scan",            "apex",     ["gaps", "coverage"]),
]


def patch_all(fail_silent: bool = True) -> Dict[str, bool]:
    """
    Attempt to patch all registered gauntlet functions with @gauntlet_memory.
    Returns a dict of {"module.function": True/False} indicating which patches
    succeeded. Modules that aren't installed yet are silently skipped.

    Args:
        fail_silent: If False, raises on the first missing module.
    """
    results: Dict[str, bool] = {}

    for module_path, func_name, scenario_type, tags in PATCH_REGISTRY:
        key = f"{module_path}.{func_name}"
        try:
            mod = importlib.import_module(module_path)
            original = getattr(mod, func_name)
            patched = gauntlet_memory(
                scenario_type=scenario_type,
                tags=tags,
            )(original)
            setattr(mod, func_name, patched)
            results[key] = True
        except (ImportError, AttributeError) as exc:
            results[key] = False
            if not fail_silent:
                raise
            # Module not yet installed — expected during incremental rollout
            _ = exc

    _print_patch_summary(results)
    return results


def patch_report(results: Dict[str, bool]) -> str:
    """Return a human-readable patch summary string."""
    passed = [k for k, v in results.items() if v]
    failed = [k for k, v in results.items() if not v]
    lines = [f"Gauntlet memory patch: {len(passed)}/{len(results)} applied"]
    if passed:
        lines += [f"  ✓ {k}" for k in passed]
    if failed:
        lines += [f"  ✗ {k} (module not installed yet)" for k in failed]
    return "\n".join(lines)


def _print_patch_summary(results: Dict[str, bool]) -> None:
    print(patch_report(results))


# ---------------------------------------------------------------------------
# Stand-alone patched gauntlet stubs
# (copy these into each repo as drop-in replacements when modules are ready)
# ---------------------------------------------------------------------------

@gauntlet_memory(scenario_type="energy", tags=["feeder", "N-1", "grid"])
def patched_energy_feeder_overload(params: Dict[str, Any], prior_context=None) -> Dict:
    """
    Stub: replace with actual feeder overload logic from xai-colossus-energy.
    prior_context is injected automatically by @gauntlet_memory.
    """
    if prior_context:
        print(f"[gauntlet] Prior feeder context: {prior_context}")
    raise NotImplementedError(
        "Replace this stub with xai_colossus_energy.gauntlets.feeder.run_feeder_overload"
    )


@gauntlet_memory(scenario_type="cooling", tags=["pump", "N-1"])
def patched_cooling_pump_failure(params: Dict[str, Any], prior_context=None) -> Dict:
    """
    Stub: replace with actual pump failure logic from xai-colossus-cooling.
    """
    if prior_context:
        print(f"[gauntlet] Prior cooling context: {prior_context}")
    raise NotImplementedError(
        "Replace this stub with xai_colossus_cooling.gauntlets.pump.run_pump_failure"
    )


@gauntlet_memory(scenario_type="servers", tags=["rack", "hardware", "N-1"])
def patched_servers_rack_failure(params: Dict[str, Any], prior_context=None) -> Dict:
    """
    Stub: replace with actual rack failure logic from xai-colossus-servers.
    """
    if prior_context:
        print(f"[gauntlet] Prior servers context: {prior_context}")
    raise NotImplementedError(
        "Replace this stub with xai_colossus_servers.gauntlets.rack.run_rack_failure"
    )


@gauntlet_memory(scenario_type="apex", tags=["orchestration", "swarm"])
def patched_apex_loop(params: Dict[str, Any], prior_context=None) -> Dict:
    """
    Stub: replace with actual APEX loop from DOCTOR-STRANGE.
    """
    if prior_context:
        print(f"[gauntlet] Prior APEX context: {prior_context}")
    raise NotImplementedError(
        "Replace this stub with doctor_strange.apex.orchestrator.run_apex_loop"
    )
