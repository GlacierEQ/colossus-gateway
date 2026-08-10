"""Top-level surface for elite operate — re-exports memory.memory_router (no httpx)."""
from __future__ import annotations
from memory.memory_router import *  # noqa: F401,F403
import memory.memory_router as _mr
globals().update({k: getattr(_mr, k) for k in dir(_mr) if not k.startswith("__")})
