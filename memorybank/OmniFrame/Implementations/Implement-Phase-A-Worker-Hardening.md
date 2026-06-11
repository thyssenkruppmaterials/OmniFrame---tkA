---
tags: [type/implementation, status/active, domain/agent, domain/backend]
created: 2026-05-21
---
# Implement — Phase A Worker Hardening

## Purpose / Context

Phase A of [[Plan-Multi-Session-Agent-Master]] hardens the existing headless SAP worker (`omni_agent/agent.py`) so a future **AgentMaster** GUI can supervise up to six `OmniFrame_Agent.exe` processes on one Windows host without inventing new IPC. All changes are **additive**: new env vars, richer `/health`, and three localhost admin routes. No change to the browser→agent HTTP contract when launched standalone.

Baseline before this phase: `AGENT_VERSION = "2.0.0"`, hardcoded `AGENT_PORT = 8765`, `_agent_self_id()` format `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`, `/health` returns `sap_connected` only (no WS/SAP-attach/job-age/identity probes). See [[Omni-Agent-System-Topology]] for the full stack map.

## Details

### Changes in `omni_agent/agent.py`

| Area | Change |
|------|--------|
| **Version** | `AGENT_VERSION` bumped to **`2.1.0`**. |
| **Listen port** | `_read_int_env("OMNIFRAME_AGENT_PORT", 8765)` at module load; `uvicorn.run(..., port=AGENT_PORT)` and boot port guard use the resolved value. |
| **Stable identity override** | `_agent_self_id()` checks `OMNIFRAME_AGENT_SELF_ID_OVERRIDE` first (e.g. `CITRIX01-W3`); only if unset computes `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`. |
| **SAP session seeding** | `_seed_sap_indices_from_env()` runs before `_restore_pinned_session_indexes()`. When `OMNIFRAME_SAP_CONN_IDX` / `OMNIFRAME_SAP_SESS_IDX` are set, master-spawned workers pin the assigned COM child before config.json pin restore. Env wins over persisted pin indices. |
| **`/health` enrichment** | Adds master-probe fields (see below). Existing keys (`ok`, `version`, `sap_connected`, `capabilities`, …) unchanged. |
| **Admin control plane** | Three new `POST` routes under `/admin/*` for master Fix state machine (Section 5 of master plan). |
| **Job progress clock** | `AgentState.active_job_progress_at` set on claim and bumped on dispatch + lease bump; drives `job_progress_unchanged_seconds`. |
| **Identity probe** | `_health_identity_status()` derives `"ok"` / `"rejected"` / `"unknown"` from `state.work_service_jwt` and `_work_service_jwt_state["failures"]`. |
| **SAP error tokens** | `state.last_sap_error` set on attach failures (`sapgui_getobject_failed`, `no_active_session`, etc.). |
| **Capabilities** | Eight new capability ids (see below). |

**`POST /admin/ws/reconnect`** — calls `WorkServiceWsClient.stop()` then `.start()` (or bootstraps via `_start_work_service_ws_client()` when no client exists). Returns `{ok, ws_connected, last_message_received_at}`.

**`POST /admin/job/abort`** — when `state.active_job_id` is set, invokes `jobs_fail(..., step="master-abort")`. Returns `{ok, aborted, already_terminal?, job_id, rows_affected}`. Idempotent when the row is already terminal (`rows_affected=0`).

**`POST /admin/sap/reattach`** — thin wrapper around `sap_connect()`. Returns `{ok, conn_idx?, sess_idx?, error?}`. Normalizes `GetObject SAPGUI failed` to a typed master-readable token.

### Environment variable matrix

| Variable | Default | Read when | Effect |
|----------|---------|-----------|--------|
| `OMNIFRAME_AGENT_PORT` | `8765` | Module load | TCP bind port for FastAPI/uvicorn. Workers W1–W6 use `8765`–`8770` when spawned by master. |
| `OMNIFRAME_AGENT_SELF_ID_OVERRIDE` | *(unset)* | First `_agent_self_id()` call | Stable fleet id (`<HOST>-W<N>`). Overrides default slug. |
| `OMNIFRAME_SAP_CONN_IDX` | `0` | Module load + `_seed_sap_indices_from_env()` | Seeds global `_sap_conn_idx`. |
| `OMNIFRAME_SAP_SESS_IDX` | `0` | Module load + `_seed_sap_indices_from_env()` | Seeds global `_sap_sess_idx`. |

**Not introduced in Phase A** (master sets in later phases):

| Variable | Set by master (Phase B+) | Notes |
|----------|--------------------------|-------|
| `OMNIFRAME_AGENT_SERVICE_KEY_PATH` | Per-worker key path | Already honoured in v2.0.0. |
| `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY` | `1` for master-spawned workers | Hard-fail exit 78 if key missing. |

Invalid env values (non-numeric port/indices) log a boot warning and fall back to defaults.

### `/health` field additions

| Field | Type | Source |
|-------|------|--------|
| `ws_connected` | `bool` | `WorkServiceWsClient.is_connected()` from `_work_ws_state["client"]` |
| `sap_attached` | `bool` | `state.sap_connected` |
| `job_age_seconds` | `int \| null` | `now - state.active_job_started_at` when job active |
| `job_progress_unchanged_seconds` | `int \| null` | `now - (active_job_progress_at or active_job_started_at)` |
| `identity_status` | `string` | `"ok"` \| `"rejected"` \| `"unknown"` |
| `last_sap_error` | `string \| null` | Last COM attach failure token |

Existing `sap_connected` retained for backward compatibility.

### Three new admin endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/ws/reconnect` | Failure mode **C** — force WS client restart |
| `POST` | `/admin/job/abort` | Failure mode **G** — fail stale lease with `step=master-abort` |
| `POST` | `/admin/sap/reattach` | Failure modes **D/E** — re-run SAP GUI attach |

### New capabilities

- `master-controller-supported`
- `admin-ws-reconnect`
- `admin-job-abort`
- `admin-sap-reattach`
- `health-extended-fields`
- `agent-port-override`
- `agent-self-id-override`
- `agent-sap-pin-env-override`

### Tests

`omni_agent/tests/test_phase_a_worker_hardening.py` — 24 pytest cases covering admin endpoints, extended `/health`, env-var honouring, version/capabilities, and backward compat. Requires Python 3.10+ (agent.py union syntax) and FastAPI deps.

## Phase A exit criteria (Section 10)

| # | Criterion | How Phase A satisfies it |
|---|-----------|--------------------------|
| 1 | `POST /admin/ws/reconnect` returns 200 and triggers measurable WS reconnect | Route stops/starts client; response includes `last_message_received_at` |
| 2 | `POST /admin/job/abort` fails row with `step=master-abort` | Delegates to `jobs_fail(..., step="master-abort")` |
| 3 | `POST /admin/sap/reattach` works | Reuses `sap_connect()` |
| 4 | `/health` exposes new probe fields | Implemented in `health()` |
| 5 | Boot env vars honoured | `_read_int_env`, `_seed_sap_indices_from_env`, `_agent_self_id()` override |
| 6 | `_agent_self_id()` consults override before default | Env checked on cache miss |
| 7 | `AGENT_VERSION` **2.1.0** + capabilities extended | Eight new capability strings |
| 8 | Single-agent flow unchanged on `127.0.0.1:8765` | All new env vars optional; default port 8765 |

## Backward compatibility

- **Direct single-exe launch** — no master env vars: port **8765**, identity format unchanged, SAP auto-select unchanged.
- **HTTP contract** — no existing routes removed or renamed.
- **Auth** — `/health` stays token-exempt; `/admin/*` routes follow existing localhost auth middleware (not added to `_TOKEN_EXEMPT_PATHS`).

## Related

- [[Plan-Multi-Session-Agent-Master]]
- [[Omni-Agent-System-Topology]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Resilient-Work-Service-WS-Client]]
- [[Implementations/Implement-SAP-Session-Pinning]]
- [[Implementations/Implement-Phase10-Service-Key-First-Rollout]]
