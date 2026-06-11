---
tags: [type/implementation, status/active, domain/agent]
created: 2026-05-21
---
# Implement — Phase F2 Orphan Adoption

## Purpose / Context

On master restart, reattach to already-running `OmniFrame_Agent.exe` workers instead of spawning duplicates. Console pipes stay unavailable until `restart_adopted`.

## Details

### New modules

- `omni_agent/master/orphan_adoption.py` — `adopt_running_workers()`, dataclasses `AdoptedWorker`, `NotAdoptedReason`, `AdoptionResult`, helper `apply_adoptions_to_supervisor()`.
- Tests: `test_orphan_adoption.py` (6), `test_supervisor_orphan_kill.py` (4).

### Adoption probe per worker

1. TCP `127.0.0.1:{health_port}` — 0.5s timeout (`port_not_listening` if closed).
2. `GET /health` — 1.0s, must be HTTP 200.
3. Identity: `body.agent_id == worker.id`, else fallback `body.self_id`.
4. `psutil` scan: `OMNIFRAME_AGENT_PORT={port}` in environ/cmdline, or agent exe name in cmdline/name. Multiple matches → warning log, first PID ≠ master PID.

### Supervisor seams

- `ManagedWorker.is_adopted` — `adopted_pid` set and no `popen`.
- `register_adopted(worker_id, pid)` — replaces `adopt_orphan`.
- `kill_adopted` / `restart_adopted` — 5s terminate→kill ladder via `_kill_pid`.
- `spawn_worker` — skips console spawn when adopted worker still alive.

## Related

- [[Implement-Phase-B-Master-GUI-Skeleton]]
- [[Implement-Phase-C-Console-Streaming]]
- [[Plan-Multi-Session-Agent-Master]]
