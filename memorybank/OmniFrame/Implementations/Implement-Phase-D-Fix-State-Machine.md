---
tags: [type/implementation, status/active, domain/agent, domain/frontend]
created: 2026-05-21
---
# Implement — Phase D Fix State Machine

## Purpose / Context

Phase D of [[Plan-Multi-Session-Agent-Master]] delivers the **one-click Fix state machine** (plan Section 5) for the CustomTkinter master controller. Operators get deterministic recovery across failure modes A–H from each worker tile, with admin-gated destructive actions, fleet-wide network diagnostics, and a SAP GUI restart banner — without changing rust-work-service or the web app.

Slices shipped as D1 (pure tree) → D2 (admin HTTP + Option α token) → D3 (network diag) → D4 (dialogs) → D5 (GUI wiring). This note is the **rollup**; sub-slice detail remains in [[Implement-Phase-D1-Fix-Engine]], [[Implement-Phase-D3-Network-Diagnostic]], and [[Implement-Phase-D5-Master-GUI-Integration]].

## Details

### Decision tree — `fix_engine.py` (D1)

| Mode | Signal | `FixAction` |
|------|--------|-------------|
| **A** | `process_alive == false` | `RESPAWN` |
| **B** | `http_fails >= 3` | `KILL_AND_RESPAWN` |
| **H** | `MasterFixContext.all_workers_ws_down` | `SHOW_NETWORK_DIAGNOSTIC` |
| **F** | `identity_status == "rejected"` | `REREGISTER_KEY` |
| **D/E** | `sap_attached == false` | `SAP_REATTACH` or `REASSIGN_SESSION` if `last_sap_error == "session_index_invalid"` |
| **C** | `ws_connected == false`, `ws_down_seconds < 60` | `WS_RECONNECT` |
| **C₂** | `ws_connected == false`, `ws_down_seconds >= 60` | `KILL_AND_RESPAWN` |
| **G** | `job_age_seconds > 300` and `job_progress_unchanged_seconds > 60` | `ABORT_STALE_JOB` |
| healthy | none of the above | `SHOW_HEALTHY_TOAST` |

Pure entry points: `pick_fix_action`, `requires_admin_confirm`, `all_workers_ws_down`, `detect_sap_restart_banner`, `snapshot_from_runtime`. Thresholds: `_HTTP_FAILS_FOR_KILL=3`, `_WS_DOWN_KILL_SECONDS=60`, `_STALE_JOB_AGE_SECONDS=300`, `_STALE_JOB_PROGRESS_SECONDS=60`, `SAP_BANNER_WINDOW_S=5`, `SAP_BANNER_SUPPRESS_SECONDS=60` (D/E toast latch after banner trigger).

`WorkerRuntimeState` (`state.py`) exposes `http_fails`, `ws_down_seconds`, `last_reconnect_reason`, `to_health_snapshot()` for probes → tree.

### Option α admin token (D2)

Master and workers share one **localhost admin secret** (Option α: env-injected shared token, not per-worker minted browser tokens):

1. **`load_or_create_master_admin_token()`** (`admin_client.py`) — reads `OMNIFRAME_AGENT_ADMIN_TOKEN` if set; else `%USERPROFILE%\.omniframe\master_admin_token.txt` (mint `secrets.token_urlsafe(32)`, restrict via `icacls` on Windows / `chmod 0o600` elsewhere).
2. **`WorkerSupervisor.build_env()`** injects `OMNIFRAME_AGENT_ADMIN_TOKEN` into every spawned worker.
3. **`AdminClient`** POSTs to `http://127.0.0.1:{port}/admin/*` with header `X-Agent-Token`.
4. **Worker** (`omni_agent/agent.py` Phase D2): `_ADMIN_ENV_TOKEN` from env; middleware on `/admin/*` accepts `X-Agent-Token == _ADMIN_ENV_TOKEN` even when `state.agent_token` (browser-minted) differs — browser SPA and master can coexist.

`WorkerAdminClient` remains as a soft-error variant for tests and D1-compat paths.

HTTP executors (injectable factory + callbacks): `execute_ws_reconnect`, `execute_abort_stale_job`, `execute_sap_reattach` in `fix_actions.py`.

### `fix_actions.py` — `FixActionDispatcher`

Wires tree → supervisor + `AdminClient` + `MasterDialogsPort`:

- **`dispatch_fix`** — `pick_fix_action` → admin confirm gate (`fix_admin_confirm_required` from config) → `_execute`.
- **SAP banner guard** — when `sap_restart_banner_active`, `SAP_REATTACH` / `REASSIGN_SESSION` show soft toast instead of firing.
- **`dispatch_reassign_bypass`** — tile **R** skips tree, opens reassign dialog (Phase F persists YAML).
- **`dispatch_kill_and_respawn`** — tile **Rst** → `supervisor.kill_and_respawn` on daemon thread.
- Handlers call `supervisor.respawn` / `kill_and_respawn` or `_safe_admin` wrappers for `/admin/ws/reconnect`, `/admin/sap/reattach`, `/admin/job/abort`.

### `dialogs.py` (D4)

**Pure logic** (no Tk): `should_show_admin_confirm`, `select_healthy_peer_port`, `parse_free_session_tuples`, `build_reregister_url`, `should_suppress_sap_fix_toast`.

**CTk modals** (when `customtkinter` import succeeds): `AdminConfirmDialog`, `ReassignSessionDialog`, `ReregisterKeyDialog`, `NetworkDiagnosticDialog` (runs `network_diag.run_all_checks` in `ThreadPoolExecutor`, applies verdict on main thread).

**`MasterDialogs` facade** (D5) — maps dispatcher callbacks to the D4 classes.

### `network_diag.py` (D3)

Pure DNS (`socket.getaddrinfo`) → TCP 443 → `GET {base}/health` chain; `compose_verdict()` returns operator strings (DNS → IT, TCP → firewall/VPN, health → Railway, all-pass → verify per-agent). Default host from `OMNIFRAME_WORK_SERVICE_URL`.

### SAP restart banner (D5)

`detect_sap_restart_banner`: ≥2 running workers, all `sap_attached=false`, ≥2 detach transitions within 5s. `master_gui.py` tracks `_sap_transitions` on probe patches, shows top-bar warning label, sets `MasterFixContext.sap_restart_banner_active`. Suppresses per-tile SAP recovery toasts while active.

### Integration — `tile.py` / `master_gui.py` / `supervisor.py`

| Surface | Role |
|---------|------|
| **`tile.py`** | Buttons Fix / R / Rst / C; `last_health_snapshot` updated in `apply_state`; `on_action(action_name, worker_id)` callback. |
| **`master_gui.py`** | `AgentMasterApp` builds `AdminClient(supervisor.admin_token)`, `FixActionDispatcher`, `MasterDialogs`; 1s UI tick updates `ws_down_seconds` + fix context; probe queue drained on main thread; `_on_tile_action` routes Fix/R/Rst/C. |
| **`supervisor.py`** | `respawn`, `kill_and_respawn`; token load in `__post_init__`; env injection on spawn. |

Config knob: `master.fix_admin_confirm_required` (default `true` in `master_config.example.yaml`).

### Tests

| File | Focus |
|------|-------|
| `test_fix_engine_decision_tree.py` | 24 tree + admin-gating + banner helpers |
| `test_admin_client_token.py` | Token file create/restrict, supervisor env inject |
| `test_fix_actions_http.py` | D2 executors + mock `AdminClient` |
| `test_dialogs_logic.py` | Pure dialog helpers (no Tk) |
| `test_network_diag.py` | 17 mocked DNS/TCP/health cases |
| `test_sap_banner_mass_fail.py` | Banner + `all_workers_ws_down` |
| `test_probe_health_parsing.py` | Probe → runtime fields for tree |
| `test_state_thread_safety.py` | `MasterRuntimeState` lock semantics |
| `omni_agent/tests/test_phase_d_admin_token.py` | Worker middleware accepts env admin token on `/admin/*` |

Full suite: `python3 -m pytest omni_agent/master/tests/ -v` → **87 passed, 2 skipped** (2026-05-21; supervisor spawn skipped without psutil).

### Backward compatibility

- **Standalone `OmniFrame_Agent.exe`** — unchanged when launched without master; no `OMNIFRAME_AGENT_ADMIN_TOKEN` → admin routes follow existing browser `state.agent_token` or permissive pre-login behaviour.
- **Browser SPA** — `X-Agent-Token` from localStorage still authoritative for non-`/admin/*` routes; master token only bypasses on `/admin/*` when env matches (Phase D2).
- **Phase A contract** — `/admin/ws/reconnect`, `/admin/job/abort`, `/admin/sap/reattach`, extended `/health` unchanged; master is an additional consumer.
- **Deferred** — Phase C console drain, Phase E setup wizard, Phase F reassign YAML persist + orphan adoption, Phase G PyInstaller (`ReassignSessionDialog` / `reassign_session` stub today).

## Related

- [[Plan-Multi-Session-Agent-Master]] — Section 5 spec
- [[Implement-Phase-A-Worker-Hardening]]
- [[Implement-Phase-B-Master-GUI-Skeleton]]
- [[Implement-Phase-D1-Fix-Engine]]
- [[Implement-Phase-D3-Network-Diagnostic]]
- [[Implement-Phase-D5-Master-GUI-Integration]]
- [[Implement-Phase10-Service-Key-First-Rollout]] — reregister deep-link (mode F)
