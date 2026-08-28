"""
xai-colossus-energy: Scenario Engine

Simulates:
  - Training surge vs. grid limit
  - N-1 / N-2 feeder loss
  - Memphis heatwave (sustained high-util)
  - Substation overload + shedding recommendation

Each ScenarioResult is written to memory via MemoryRouter.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from .powerflow import PowerflowModel, RackLoad, GRID_LIMIT_MW

logger = logging.getLogger(__name__)


@dataclass
class ScenarioResult:
    scenario_name: str
    passed: bool
    peak_load_mw: float
    grid_limit_mw: float
    headroom_mw: float
    feeder_alerts: list[str]
    shed_recommendation_mw: float
    details: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    @property
    def status(self) -> str:
        return "PASS" if self.passed else "FAIL"

    def to_memory_payload(self) -> dict:
        """Shape for MemoryRouter.remember_scenario()."""
        return {
            "scenario": self.scenario_name,
            "status": self.status,
            "peak_load_mw": self.peak_load_mw,
            "grid_limit_mw": self.grid_limit_mw,
            "headroom_mw": self.headroom_mw,
            "feeder_alerts": self.feeder_alerts,
            "shed_recommendation_mw": self.shed_recommendation_mw,
            "details": self.details,
            "ts": self.timestamp,
        }


class EnergyScenarioEngine:
    """
    Run gauntlet scenarios against a PowerflowModel.

    Usage
    -----
    engine = EnergyScenarioEngine(rack_loads)
    results = engine.run_all()
    for r in results:
        print(r.status, r.scenario_name, r.peak_load_mw, "MW")
    """

    def __init__(
        self,
        rack_loads: list[RackLoad],
        grid_limit_mw: float = GRID_LIMIT_MW,
    ):
        self.rack_loads = rack_loads
        self.grid_limit_mw = grid_limit_mw

    # ── Helpers ───────────────────────────────────────────────────────────

    def _fresh_model(self) -> PowerflowModel:
        m = PowerflowModel(grid_limit_mw=self.grid_limit_mw)
        for rack in self.rack_loads:
            m.add_rack(
                RackLoad(
                    rack_id=rack.rack_id,
                    gpu_count=rack.gpu_count,
                    tdp_per_gpu_w=rack.tdp_per_gpu_w,
                    utilization=rack.utilization,
                    feeder_id=rack.feeder_id,
                )
            )
        return m

    def _shed_needed(self, model: PowerflowModel) -> float:
        overage = model.total_load_mw - model.grid_limit_mw
        return round(max(0.0, overage), 3)

    # ── Scenarios ─────────────────────────────────────────────────────────

    def scenario_baseline(self) -> ScenarioResult:
        """All racks at configured utilization."""
        m = self._fresh_model()
        s = m.summary()
        return ScenarioResult(
            scenario_name="baseline",
            passed=not s["grid_alert"],
            peak_load_mw=s["total_load_mw"],
            grid_limit_mw=s["grid_limit_mw"],
            headroom_mw=s["total_headroom_mw"],
            feeder_alerts=s["feeder_alerts"],
            shed_recommendation_mw=self._shed_needed(m),
            details={"grid_utilization_pct": s["grid_utilization_pct"]},
        )

    def scenario_training_surge(self, surge_utilization: float = 1.0) -> ScenarioResult:
        """All racks ramp to 100% utilization (full training workload)."""
        m = self._fresh_model()
        for rack_id in list(m._racks.keys()):
            m.update_utilization(rack_id, surge_utilization)
        s = m.summary()
        return ScenarioResult(
            scenario_name="training_surge",
            passed=not s["grid_alert"],
            peak_load_mw=s["total_load_mw"],
            grid_limit_mw=s["grid_limit_mw"],
            headroom_mw=s["total_headroom_mw"],
            feeder_alerts=s["feeder_alerts"],
            shed_recommendation_mw=self._shed_needed(m),
            details={"surge_utilization": surge_utilization},
        )

    def scenario_n1_feeder(self) -> ScenarioResult:
        """Lose the most-loaded feeder; remaining feeders absorb load."""
        m = self._fresh_model()
        # find the heaviest feeder
        heaviest = max(m._feeders.values(), key=lambda f: f.load_mw, default=None)
        lost_feeder = heaviest.feeder_id if heaviest else None
        if lost_feeder:
            racks_lost = [r.rack_id for r in heaviest.racks]
            for rid in racks_lost:
                m.remove_rack(rid)
        s = m.summary()
        return ScenarioResult(
            scenario_name="n1_feeder_loss",
            passed=not s["grid_alert"],
            peak_load_mw=s["total_load_mw"],
            grid_limit_mw=s["grid_limit_mw"],
            headroom_mw=s["total_headroom_mw"],
            feeder_alerts=s["feeder_alerts"],
            shed_recommendation_mw=self._shed_needed(m),
            details={"lost_feeder": lost_feeder},
        )

    def scenario_n2_feeder(self) -> ScenarioResult:
        """Lose the two most-loaded feeders."""
        m = self._fresh_model()
        sorted_feeders = sorted(
            m._feeders.values(), key=lambda f: f.load_mw, reverse=True
        )
        lost = []
        for feeder in sorted_feeders[:2]:
            lost.append(feeder.feeder_id)
            for r in feeder.racks:
                m.remove_rack(r.rack_id)
        s = m.summary()
        return ScenarioResult(
            scenario_name="n2_feeder_loss",
            passed=not s["grid_alert"],
            peak_load_mw=s["total_load_mw"],
            grid_limit_mw=s["grid_limit_mw"],
            headroom_mw=s["total_headroom_mw"],
            feeder_alerts=s["feeder_alerts"],
            shed_recommendation_mw=self._shed_needed(m),
            details={"lost_feeders": lost},
        )

    def scenario_memphis_heatwave(
        self, cooling_derating: float = 0.15
    ) -> ScenarioResult:
        """
        Simulate sustained Memphis summer heat: cooling capacity drops 15%,
        requiring GPU throttling to compensate.
        GPUs derate to (1 - cooling_derating) utilization cap.
        """
        m = self._fresh_model()
        cap = 1.0 - cooling_derating
        for rack_id in list(m._racks.keys()):
            new_util = min(m._racks[rack_id].utilization, cap)
            m.update_utilization(rack_id, new_util)
        s = m.summary()
        return ScenarioResult(
            scenario_name="memphis_heatwave",
            passed=not s["grid_alert"],
            peak_load_mw=s["total_load_mw"],
            grid_limit_mw=s["grid_limit_mw"],
            headroom_mw=s["total_headroom_mw"],
            feeder_alerts=s["feeder_alerts"],
            shed_recommendation_mw=self._shed_needed(m),
            details={"cooling_derating_pct": cooling_derating * 100},
        )

    def scenario_substation_overload(self) -> ScenarioResult:
        """
        Grid limit cut by 20% (simulates substation capacity restriction).
        Returns shed recommendation so APEX can act.
        """
        restricted_limit = self.grid_limit_mw * 0.80
        m = PowerflowModel(grid_limit_mw=restricted_limit)
        for rack in self.rack_loads:
            m.add_rack(
                RackLoad(
                    rack_id=rack.rack_id,
                    gpu_count=rack.gpu_count,
                    tdp_per_gpu_w=rack.tdp_per_gpu_w,
                    utilization=rack.utilization,
                    feeder_id=rack.feeder_id,
                )
            )
        s = m.summary()
        return ScenarioResult(
            scenario_name="substation_overload",
            passed=not s["grid_alert"],
            peak_load_mw=s["total_load_mw"],
            grid_limit_mw=restricted_limit,
            headroom_mw=s["total_headroom_mw"],
            feeder_alerts=s["feeder_alerts"],
            shed_recommendation_mw=self._shed_needed(m),
            details={"original_limit_mw": self.grid_limit_mw, "restriction_pct": 20},
        )

    # ── Gauntlet ──────────────────────────────────────────────────────────

    def run_all(self) -> list[ScenarioResult]:
        return [
            self.scenario_baseline(),
            self.scenario_training_surge(),
            self.scenario_n1_feeder(),
            self.scenario_n2_feeder(),
            self.scenario_memphis_heatwave(),
            self.scenario_substation_overload(),
        ]
