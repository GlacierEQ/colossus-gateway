"""Top-level discover entry for colossus-gateway nested modules."""
from __future__ import annotations
import importlib
import importlib.util
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))


class GatewaySurfaceTests(unittest.TestCase):
    def test_src_tree_has_python(self) -> None:
        pys = list((ROOT / "src").rglob("*.py"))
        self.assertGreater(len(pys), 5)

    def test_memory_router_importable(self) -> None:
        errors = []
        for name in ("memory.memory_router", "src.memory.memory_router"):
            try:
                importlib.import_module(name)
                return
            except Exception as e:
                errors.append(f"{name}: {e}")
        candidates = list((ROOT / "src").rglob("memory_router.py"))
        self.assertTrue(candidates, "; ".join(errors) or "no memory_router.py")
        spec = importlib.util.spec_from_file_location("cg_memory_router", candidates[0])
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        self.assertTrue(any(not n.startswith("_") for n in dir(mod)))


if __name__ == "__main__":
    unittest.main()
