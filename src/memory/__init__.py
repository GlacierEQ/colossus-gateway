"""Colossus AI Memory Layer — Pinecone + Supermemory dual-write."""

from src.memory.memory_router import MemoryRouter
from src.memory.pinecone_client import PineconeClient
from src.memory.supermemory_client import SupermemoryClient
from src.memory.memory_hooks import (
    GauntletResult,
    GauntletMemoryContext,
    gauntlet_memory_hook,
)
from src.memory.gauntlet_memory_patch import (
    patch_gauntlet,
    patch_known_gauntlet,
    REPO_SCENARIO_MAP,
)

__all__ = [
    "MemoryRouter",
    "PineconeClient",
    "SupermemoryClient",
    "GauntletResult",
    "GauntletMemoryContext",
    "gauntlet_memory_hook",
    "patch_gauntlet",
    "patch_known_gauntlet",
    "REPO_SCENARIO_MAP",
]
