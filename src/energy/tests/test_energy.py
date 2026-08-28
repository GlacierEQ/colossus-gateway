"""
Unit tests: xai-colossus-energy powerflow + scenario engine
"""

from src.energy.powerflow import PowerflowModel, RackLoad, FEEDER_COUNT
from src.energy.scenario_engine import EnergyScenarioEngine


def _small_cluster(rack_count: int = 8, utilization: float = 0.85) -> list[RackLoad]:
    return [
        RackLoad(
            rack_id=f"R-{i + 1:02d}",
            gpu_count=8,
            tdp_per_gpu_w=700.0,
            utilization=utilization,
            feeder_id=f"F-{(i % FEEDER_COUNT) + 1}",
        )
        for i in range(rack_count)
    ]


# ── PowerflowModel ────────────────────────────────────────────────────────


class TestPowerflowModel:
    def test_load_calculation(self):
        m = PowerflowModel(grid_limit_mw=1100.0)
        m.add_rack(
            RackLoad(
                rack_id="R-01",
                gpu_count=8,
                tdp_per_gpu_w=700.0,
                utilization=1.0,
                feeder_id="F-1",
            )
        )
        # 8 * 700W = 5600W = 5.6 kW = 0.0056 MW
        assert abs(m.total_load_mw - 0.0056) < 0.0001

    def test_headroom(self):
        m = PowerflowModel(grid_limit_mw=1100.0)
        m.add_rack(
            RackLoad(
                rack_id="R-01",
                gpu_count=8,
                tdp_per_gpu_w=700.0,
                utilization=1.0,
                feeder_id="F-1",
            )
        )
        assert m.total_headroom_mw < 1100.0
        assert m.total_headroom_mw > 0

    def test_no_alert_at_low_utilization(self):
        m = PowerflowModel(grid_limit_mw=1100.0)
        for i in range(8):
            m.add_rack(
                RackLoad(
                    rack_id=f"R-{i}",
                    gpu_count=8,
                    tdp_per_gpu_w=700.0,
                    utilization=0.3,
                    feeder_id="F-1",
                )
            )
        assert not m.alert

    def test_n1_remove_rack(self):
        m = PowerflowModel(grid_limit_mw=1100.0)
        m.add_rack(
            RackLoad(
                rack_id="R-01",
                gpu_count=8,
                tdp_per_gpu_w=700.0,
                utilization=1.0,
                feeder_id="F-1",
            )
        )
        load_before = m.total_load_mw
        m.remove_rack("R-01")
        assert m.total_load_mw < load_before

    def test_summary_structure(self):
        m = PowerflowModel(grid_limit_mw=1100.0)
        s = m.summary()
        assert "total_load_mw" in s
        assert "feeders" in s
        assert isinstance(s["feeders"], list)


# ── EnergyScenarioEngine ─────────────────────────────────────────────────


class TestEnergyScenarioEngine:
    def setup_method(self):
        self.engine = EnergyScenarioEngine(
            rack_loads=_small_cluster(rack_count=8, utilization=0.85),
            grid_limit_mw=1100.0,
        )

    def test_baseline_runs(self):
        r = self.engine.scenario_baseline()
        assert r.scenario_name == "baseline"
        assert r.peak_load_mw > 0

    def test_training_surge_higher_than_baseline(self):
        baseline = self.engine.scenario_baseline()
        surge = self.engine.scenario_training_surge()
        assert surge.peak_load_mw >= baseline.peak_load_mw

    def test_n1_feeder_runs(self):
        r = self.engine.scenario_n1_feeder()
        assert r.scenario_name == "n1_feeder_loss"

    def test_n2_feeder_runs(self):
        r = self.engine.scenario_n2_feeder()
        assert r.scenario_name == "n2_feeder_loss"

    def test_memphis_heatwave_lower_than_surge(self):
        surge = self.engine.scenario_training_surge()
        heat = self.engine.scenario_memphis_heatwave(cooling_derating=0.15)
        # Heatwave throttles, so load should be <= surge
        assert heat.peak_load_mw <= surge.peak_load_mw

    def test_substation_overload_shed_rec(self):
        # With full cluster at 85% util + 20% grid restriction,
        # some shedding may be recommended depending on cluster size.
        r = self.engine.scenario_substation_overload()
        assert r.shed_recommendation_mw >= 0

    def test_run_all_returns_six(self):
        results = self.engine.run_all()
        assert len(results) == 6

    def test_memory_payload_shape(self):
        r = self.engine.scenario_baseline()
        payload = r.to_memory_payload()
        assert "scenario" in payload
        assert "status" in payload
        assert "peak_load_mw" in payload
        assert "shed_recommendation_mw" in payload
