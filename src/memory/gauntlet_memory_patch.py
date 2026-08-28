"""
gauntlet_memory_patch.py
------------------------
Drop-in patch that retroactively wraps the run() function of any
existing Colossus gauntlet module with the current gauntlet_memory decorator.

Usage in a gauntlet module's __main__ block:

    if __name__ == "__main__":
        from src.memory.gauntlet_memory_patch import patch_gauntlet
        import sys
        patched = patch_gauntlet(
            module=sys.modules[__name__],
            repo="xai-colossus-energy",
            scenario="feeder_overload_n1",
        )
        sys.exit(0 if patched.run() else 1)
"""

from __future__ import annotations

import importlib
import logging
import types
from typing import Optional

from src.memory.memory_hooks import gauntlet_memory

log = logging.getLogger(__name__)


class PatchedGauntlet:
    """Thin wrapper around a patched gauntlet module."""

    def __init__(
        self,
        module: types.ModuleType,
        repo: str,
        scenario: str,
        tags: Optional[list[str]] = None,
    ):
        self._module = module
        self.repo = repo
        self.scenario = scenario
        self.tags = tags or []

        if not hasattr(module, "run"):
            raise AttributeError(
                f"Module '{module.__name__}' has no run() function. "
                "Colossus gauntlets must expose a top-level run() -> dict."
            )

        original_run = module.run
        module.run = gauntlet_memory(
            scenario_type=scenario,
            tags=[repo, *self.tags],
        )(original_run)
        log.info(
            "[gauntlet_memory_patch] patched %s.run() → memory hooks active for %s/%s",
            module.__name__,
            repo,
            scenario,
        )

    def run(self, *args, **kwargs):
        """Call the patched run() — memory writes happen automatically."""
        return self._module.run(*args, **kwargs)


def patch_gauntlet(
    module,
    repo: str,
    scenario: str,
    tags: Optional[list[str]] = None,
) -> PatchedGauntlet:
    """Wrap a gauntlet module's run() with memory hooks."""
    if isinstance(module, str):
        module = importlib.import_module(module)
    return PatchedGauntlet(module=module, repo=repo, scenario=scenario, tags=tags)


REPO_SCENARIO_MAP = {
    "servers:rack_failure": (
        "xai_colossus_servers.gauntlets.rack_failure",
        "xai-colossus-servers",
        "rack_failure_n1",
        ["hardware", "P1"],
    ),
    "servers:firmware_gauntlet": (
        "xai_colossus_servers.gauntlets.firmware_gauntlet",
        "xai-colossus-servers",
        "firmware_gauntlet",
        ["firmware"],
    ),
    "energy:feeder_overload": (
        "xai_colossus_energy.gauntlets.feeder_overload",
        "xai-colossus-energy",
        "feeder_overload_n1",
        ["grid", "EJ", "P1"],
    ),
    "energy:training_surge": (
        "xai_colossus_energy.gauntlets.training_surge",
        "xai-colossus-energy",
        "training_surge_vs_grid_limit",
        ["grid", "load-shedding"],
    ),
    "cooling:pump_failure": (
        "xai_colossus_cooling.gauntlets.pump_failure",
        "xai-colossus-cooling",
        "pump_failure_hot_aisle",
        ["thermal", "P1"],
    ),
    "cooling:water_restriction": (
        "xai_colossus_cooling.gauntlets.water_restriction",
        "xai-colossus-cooling",
        "water_restriction_memphis",
        ["EJ", "water", "permitting"],
    ),
    "security:config_drift": (
        "xai_colossus_security.gauntlets.config_drift",
        "xai-colossus-security",
        "emissions_limit_config_drift",
        ["legal", "compliance"],
    ),
}


def patch_known_gauntlet(key: str) -> PatchedGauntlet:
    """Patch a gauntlet by its short registry key."""
    if key not in REPO_SCENARIO_MAP:
        raise KeyError(
            f"Unknown gauntlet key '{key}'. Available: {list(REPO_SCENARIO_MAP)}"
        )
    module_path, repo, scenario, tags = REPO_SCENARIO_MAP[key]
    return patch_gauntlet(module_path, repo=repo, scenario=scenario, tags=tags)
