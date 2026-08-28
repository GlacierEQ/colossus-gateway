"""
xai-colossus-energy: APEX Connector

Registers with DOCTOR-STRANGE connector registry, writes heartbeat +
scenario results to Supabase + MemoryRouter after each gauntlet run.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy imports so the module loads even without optional deps
try:
    from supabase import create_client, Client as SupabaseClient

    _SUPABASE_AVAILABLE = True
except ImportError:
    _SUPABASE_AVAILABLE = False

try:
    from src.memory.memory_router import MemoryRouter

    _MEMORY_AVAILABLE = True
except ImportError:
    _MEMORY_AVAILABLE = False


CONNECTOR_NAME = "xai-colossus-energy"
CONNECTOR_VERSION = "0.1.0"
CONNECTOR_TASK_TYPES = ["powerflow", "scenario_gauntlet", "feeder_check"]


class EnergyConnector:
    """
    Thin APEX integration layer for the energy module.

    Usage
    -----
    connector = EnergyConnector()
    connector.register()
    # ... run scenarios ...
    connector.record_scenario_results(results)
    connector.heartbeat()
    """

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
    ):
        self._supabase: Optional[SupabaseClient] = None
        self._memory: Optional[MemoryRouter] = None
        self._registered = False

        if _SUPABASE_AVAILABLE:
            url = supabase_url or os.getenv("SUPABASE_URL", "")
            key = supabase_key or os.getenv("SUPABASE_KEY", "")
            if url and key:
                try:
                    self._supabase = create_client(url, key)
                except Exception as exc:
                    logger.warning("Supabase init failed: %s", exc)

        if _MEMORY_AVAILABLE:
            try:
                self._memory = MemoryRouter()
            except Exception as exc:
                logger.warning("MemoryRouter init failed: %s", exc)

    # ── Registration ──────────────────────────────────────────────────────

    def register(self) -> bool:
        """Register this connector in the APEX connector registry."""
        if not self._supabase:
            logger.info(
                "[EnergyConnector] Supabase unavailable — skipping registration"
            )
            return False
        try:
            self._supabase.table("connector_registry").upsert(
                {
                    "name": CONNECTOR_NAME,
                    "version": CONNECTOR_VERSION,
                    "task_types": json.dumps(CONNECTOR_TASK_TYPES),
                    "status": "active",
                    "registered_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
                on_conflict="name",
            ).execute()
            self._registered = True
            logger.info("[EnergyConnector] Registered with APEX")
            return True
        except Exception as exc:
            logger.error("[EnergyConnector] Registration failed: %s", exc)
            return False

    # ── Heartbeat ─────────────────────────────────────────────────────────

    def heartbeat(self, extra: Optional[dict] = None) -> bool:
        if not self._supabase:
            return False
        try:
            payload = {
                "connector": CONNECTOR_NAME,
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "status": "alive",
            }
            if extra:
                payload.update(extra)
            self._supabase.table("connector_jobs").insert(payload).execute()
            return True
        except Exception as exc:
            logger.warning("[EnergyConnector] Heartbeat failed: %s", exc)
            return False

    # ── Scenario results → memory ─────────────────────────────────────────

    def record_scenario_results(self, results: list) -> int:
        """
        Write ScenarioResult list to MemoryRouter + Supabase.
        Returns the count of successfully written records.
        """
        written = 0
        for result in results:
            payload = result.to_memory_payload()

            # Write to vector + structured memory
            if self._memory:
                try:
                    self._memory.remember_scenario(  # type: ignore[attr-defined]
                        scenario_id=f"energy_{result.scenario_name}_{int(result.timestamp)}",
                        data=payload,
                        namespace="colossus-scenarios",
                    )
                    written += 1
                except AttributeError:
                    # MemoryRouter may use a different method name
                    try:
                        self._memory.write(  # type: ignore[union-attr]
                            key=f"energy_{result.scenario_name}_{int(result.timestamp)}",
                            value=payload,
                            namespace="colossus-scenarios",
                        )
                        written += 1
                    except Exception as exc:
                        logger.warning("[EnergyConnector] Memory write failed: %s", exc)
                except Exception as exc:
                    logger.warning("[EnergyConnector] Memory write failed: %s", exc)

            # Also persist raw JSON to Supabase for audit trail
            if self._supabase:
                try:
                    self._supabase.table("godmind_memory").insert(
                        {
                            "source": CONNECTOR_NAME,
                            "key": f"energy_{result.scenario_name}",
                            "value": json.dumps(payload),
                            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        }
                    ).execute()
                except Exception as exc:
                    logger.warning("[EnergyConnector] Supabase write failed: %s", exc)

        logger.info(
            "[EnergyConnector] Recorded %d/%d scenario results", written, len(results)
        )
        return written
