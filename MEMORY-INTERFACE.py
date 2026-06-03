#!/usr/bin/env python3
"""
APEX Memory Interface — colossus-gateway
Universal MCP Bridge. All calls logged. Same anomaly logic as Pro-Gateway.
from colossus_gateway.memory_interface import log_call, recall_connector_history
"""
import sys, os
PRO_MEMORY_PATH = os.environ.get("PRO_MEMORY_PATH", "../Pro-Memory")
if PRO_MEMORY_PATH not in sys.path:
    sys.path.insert(0, PRO_MEMORY_PATH)
from MEM0_MASTER import APEXMemoryRouter
ANOMALY_THRESHOLD = int(os.environ.get("APEX_ANOMALY_THRESHOLD", "5"))
_router = None
def get_router():
    global _router
    if _router is None: _router = APEXMemoryRouter()
    return _router
def log_call(connector, method, status, latency_ms, payload_summary=""):
    r = get_router()
    r.remember("gateway",
        f"MCP: {connector} | {method} | {status} | {latency_ms}ms | {payload_summary}",
        category="tech_config",
        metadata={"connector": connector, "method": method, "status": status}
    )
    if status not in ("ok", "200", 200):
        history = r.recall("gateway", f"failed calls to {connector}")
        if len(history) >= ANOMALY_THRESHOLD:
            r.remember("security", f"ANOMALY: {connector} — {len(history)} failures",
                category="tech_config", metadata={"connector": connector, "severity": "HIGH"})
def recall_connector_history(connector):
    return get_router().recall("gateway", f"calls to {connector}")
