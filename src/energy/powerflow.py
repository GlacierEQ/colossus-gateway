"""
xai-colossus-energy: Powerflow Model

Per-rack → per-feeder → facility-level MW accounting.
Consumed by the scenario engine and APEX memory writer.
"""

from __future__ import annotations

import os
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

GRID_LIMIT_MW = float(os.getenv("ENERGY_GRID_LIMIT_MW", "1100"))
FEEDER_COUNT = int(os.getenv("ENERGY_FEEDER_COUNT", "8"))
ALERT_THRESHOLD = float(os.getenv("ENERGY_ALERT_THRESHOLD_PCT", "0.90"))


@dataclass
class RackLoad:
    rack_id: str
    gpu_count: int
    tdp_per_gpu_w: float
    utilization: float = 1.0  # 0.0–1.0
    feeder_id: Optional[str] = None

    @property
    def draw_kw(self) -> float:
        """Actual draw in kW accounting for utilization."""
        return (self.gpu_count * self.tdp_per_gpu_w * self.utilization) / 1000.0

    @property
    def tdp_kw(self) -> float:
        """Nameplate TDP in kW (100% utilization)."""
        return (self.gpu_count * self.tdp_per_gpu_w) / 1000.0


@dataclass
class FeederState:
    feeder_id: str
    capacity_mw: float
    racks: list[RackLoad] = field(default_factory=list)

    @property
    def load_mw(self) -> float:
        return sum(r.draw_kw for r in self.racks) / 1000.0

    @property
    def headroom_mw(self) -> float:
        return self.capacity_mw - self.load_mw

    @property
    def utilization_pct(self) -> float:
        if self.capacity_mw == 0:
            return 0.0
        return self.load_mw / self.capacity_mw

    @property
    def alert(self) -> bool:
        return self.utilization_pct >= ALERT_THRESHOLD


class PowerflowModel:
    """
    Aggregate rack TDP exports into a facility-level power model.

    Usage
    -----
    model = PowerflowModel()
    model.add_rack(RackLoad(rack_id="R-01", gpu_count=8, tdp_per_gpu_w=700,
                            utilization=0.95, feeder_id="F-1"))
    summary = model.summary()
    """

    def __init__(self, grid_limit_mw: float = GRID_LIMIT_MW):
        self.grid_limit_mw = grid_limit_mw
        self._racks: dict[str, RackLoad] = {}
        self._feeders: dict[str, FeederState] = {}
        # Initialise feeders with equal share of grid limit
        per_feeder = grid_limit_mw / FEEDER_COUNT
        for i in range(1, FEEDER_COUNT + 1):
            fid = f"F-{i}"
            self._feeders[fid] = FeederState(feeder_id=fid, capacity_mw=per_feeder)

    # ── Mutations ────────────────────────────────────────────────────────

    def add_rack(self, rack: RackLoad) -> None:
        fid = rack.feeder_id or f"F-{(len(self._racks) % FEEDER_COUNT) + 1}"
        rack.feeder_id = fid
        self._racks[rack.rack_id] = rack
        if fid not in self._feeders:
            per_feeder = self.grid_limit_mw / FEEDER_COUNT
            self._feeders[fid] = FeederState(feeder_id=fid, capacity_mw=per_feeder)
        self._feeders[fid].racks.append(rack)

    def update_utilization(self, rack_id: str, utilization: float) -> None:
        if rack_id in self._racks:
            self._racks[rack_id].utilization = max(0.0, min(1.0, utilization))

    def remove_rack(self, rack_id: str) -> None:
        """Simulate N-1 rack failure."""
        rack = self._racks.pop(rack_id, None)
        if rack and rack.feeder_id in self._feeders:
            self._feeders[rack.feeder_id].racks = [
                r for r in self._feeders[rack.feeder_id].racks if r.rack_id != rack_id
            ]

    # ── Reads ─────────────────────────────────────────────────────────────

    @property
    def total_load_mw(self) -> float:
        return sum(f.load_mw for f in self._feeders.values())

    @property
    def total_headroom_mw(self) -> float:
        return self.grid_limit_mw - self.total_load_mw

    @property
    def grid_utilization_pct(self) -> float:
        return self.total_load_mw / self.grid_limit_mw if self.grid_limit_mw else 0.0

    @property
    def alert(self) -> bool:
        return self.grid_utilization_pct >= ALERT_THRESHOLD

    def feeder_alerts(self) -> list[FeederState]:
        return [f for f in self._feeders.values() if f.alert]

    def summary(self) -> dict:
        feeders = [
            {
                "feeder_id": f.feeder_id,
                "load_mw": round(f.load_mw, 3),
                "capacity_mw": round(f.capacity_mw, 3),
                "headroom_mw": round(f.headroom_mw, 3),
                "utilization_pct": round(f.utilization_pct * 100, 1),
                "alert": f.alert,
            }
            for f in sorted(self._feeders.values(), key=lambda x: x.feeder_id)
        ]
        return {
            "grid_limit_mw": self.grid_limit_mw,
            "total_load_mw": round(self.total_load_mw, 3),
            "total_headroom_mw": round(self.total_headroom_mw, 3),
            "grid_utilization_pct": round(self.grid_utilization_pct * 100, 1),
            "grid_alert": self.alert,
            "feeder_alerts": [f["feeder_id"] for f in feeders if f["alert"]],
            "feeders": feeders,
            "rack_count": len(self._racks),
        }

    def to_json(self) -> str:
        return json.dumps(self.summary(), indent=2)
