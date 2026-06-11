---
tags: [type/implementation, status/active, domain/backend]
created: 2026-05-21
---
# Implement Phase D1 Fix Engine

## Purpose / Context
Phase D1 of [[Plan-Multi-Session-Agent-Master]] — pure Section 5 decision tree
with no I/O. Master GUI/supervisor wire actions in later phases.

## Details
- `omni_agent/master/fix_engine.py` — `HealthSnapshot`, `MasterFixContext`,
  `FixAction` (modes A–H + `SHOW_HEALTHY_TOAST`), `pick_fix_action`,
  `requires_admin_confirm`. Helpers retained for D2: `all_workers_ws_down`,
  `detect_sap_restart_banner`, `is_sap_recovery_action`.
- `WorkerRuntimeState` — `ws_down_seconds`, `last_reconnect_reason`,
  `last_action_at`, `http_fails` property, `to_health_snapshot()`.
- Tests: `omni_agent/master/tests/test_fix_engine_decision_tree.py` (24 cases).

Run:
```bash
python3 -m pytest omni_agent/master/tests/test_fix_engine_decision_tree.py -v
```

## Related
- [[Plan-Multi-Session-Agent-Master]]
- [[Implement-Phase-A-Worker-Hardening]]
