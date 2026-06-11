# Created and developed by Jai Singh
"""
OmniFrame SAP Agent - Headless Windows background service.

Runs silently on the Citrix desktop and exposes localhost:8765 REST API
for the OmniFrame web app to drive SAP GUI automation.

First-run behavior (Tier 4 Citrix):
    - Detects if running from install path
    - If not, copies self to %LOCALAPPDATA%\\OmniFrameAgent\\
    - Creates startup shortcut so it persists across profile loads
    - Launches installed copy and exits

The headless agent allows users to open Chrome normally in a Citrix
session and use the OmniFrame web app directly. It works alongside
(and is interchangeable with) the OmniFrame SAP Bridge desktop app.

Build to .exe:
    pip install -r requirements.txt
    python -m PyInstaller --onefile --windowed --name OmniFrame_Agent agent.py

Requirements:
    - Windows 10 21H2+ or Windows 11
    - SAP GUI with Scripting enabled
"""

import contextlib
import csv
import hashlib
import io
import json
import logging
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections import OrderedDict, deque
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable, Optional

# v1.7.2 — sys.modules alias so worker modules that do `from agent import ...`
# resolve to the SAME module instance as `__main__` when packaged with
# PyInstaller (and when launched directly via `python agent.py`). Without
# this, `lt22_import.py` and `material_master_read.py` load a SECOND copy
# of agent.py via the bundled module finder; the duplicate has its own
# `state = AgentState()` instance, so any mutation inside the worker
# (e.g. `state.sap_connected = False` after a COM crash in lt22_import)
# never reaches the AgentState the FastAPI handlers + poller actually
# read from. See [[Debug/Fix-Audit-Closeout-v1.7.2]] for the audit
# write-up. Idempotent — does nothing when imported as a regular module.
if __name__ == "__main__" and "agent" not in sys.modules:
    sys.modules["agent"] = sys.modules[__name__]

# --- Windowed-mode stdio fix (PyInstaller --windowed) ------------------
# When built with --windowed, sys.stdout and sys.stderr are None, which
# crashes uvicorn's default logging config (tries to call .isatty()).
# Replace with no-op text streams so downstream libs don't crash.
IS_WINDOWED = sys.stdout is None or sys.stderr is None
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8", errors="replace")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8", errors="replace")

# --- Force UTF-8 stdio regardless of Windows console code page ---------
# 2026-05-21: in production we observed the worker crashing at boot with
# ``UnicodeEncodeError: 'charmap' codec can't encode character '\u2192'``
# (and U+2014 em-dash) the moment ``main()`` printed the boot banner.
# Root cause: on en-US Windows, ``sys.stdout.encoding`` defaults to
# ``cp1252`` which can't encode the U+2192 arrows / U+2014 em-dashes
# present in the v2.1.0 boot prints. The master supervisor now injects
# ``PYTHONIOENCODING=utf-8:replace`` for spawned workers (Phase G follow-
# up) but legacy single-EXE launches and any older master EXE bypass that
# env var. Defensive ``reconfigure`` here covers both paths and is a
# no-op on Linux / macOS / already-UTF-8 consoles.
for _omni_stream in (sys.stdout, sys.stderr):
    if _omni_stream is not None and hasattr(_omni_stream, "reconfigure"):
        try:
            _omni_stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
del _omni_stream

# --- Corporate SSL trust (v1.6.2) --------------------------------------
# Citrix / corporate networks (Rolls-Royce: Netskope) intercept TLS with
# a private root CA. Windows trusts that CA via Group Policy push, but
# PyInstaller-bundled Python only trusts `certifi`'s bundle, which means
# `requests.post('https://*.supabase.co/...')` fails with
# `SSLCertVerificationError: self-signed certificate in certificate chain`.
#
# `truststore.inject_into_ssl()` monkey-patches `ssl.SSLContext` so any
# subsequent HTTPS client (requests, urllib3, httpx, websockets, etc.)
# uses the OS-native trust store (Windows SChannel / macOS Keychain).
# MUST run BEFORE `import requests` because the patch installs a custom
# `SSLContext` subclass; modules already holding a reference to the old
# class won't pick it up.
#
# Escape hatch: set `OMNIFRAME_INSECURE_SSL=1` to disable verification
# entirely (rare cases where the corp pushes the CA only into the user's
# personal cert store — see `_SSL_VERIFY` below).
if sys.platform == "win32":
    try:
        import truststore
        truststore.inject_into_ssl()
        print("[boot] truststore injected — using Windows certificate store for TLS verification")
    except Exception as exc:
        print(f"[boot] truststore unavailable ({exc}); falling back to certifi bundle. Corporate SSL inspection may break login/Supabase calls.")

import requests
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Defense-in-depth fallback for `requests.*` calls. Set
# `OMNIFRAME_INSECURE_SSL=1` to disable TLS verification entirely. This
# is the escape hatch when truststore can't see the corporate CA (e.g.
# the corp pushed the CA to the user's personal cert store rather than
# the machine store). Loud one-time warning at boot when active.
_SSL_VERIFY: bool = os.environ.get("OMNIFRAME_INSECURE_SSL", "") != "1"
if not _SSL_VERIFY:
    print("[boot] OMNIFRAME_INSECURE_SSL=1 detected — TLS verification DISABLED. Use only on trusted networks.")
    try:
        # Suppress urllib3's per-call InsecureRequestWarning so the console
        # isn't flooded; the boot warning above is the user-facing notice.
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass

# Phase 11 (rust-work-service integration plan, 2026-05-07) — defaults
# flipped to ON for the three rust-work-service integration env vars
# (`OMNIFRAME_AGENT_USE_RUST_WS`, `OMNIFRAME_AGENT_CLAIM_VIA_RUST`,
# `OMNIFRAME_AGENT_CONSOLE_RELAY`). Phase 4 / 7 / 6 shipped these as
# parallel-run feature flags defaulting to `0`; the v2.0.0 architecture
# boundary makes the rust-work-service paths the canonical defaults.
#
# Explicitly setting any of these to `0` now logs a single deprecation
# warning at boot — the legacy paths still work for the 2.0.x line so
# operators have an escape hatch if a regression slips through, but the
# env vars themselves are scheduled for removal in 2.1.0 along with
# the matching legacy code paths.
#
# Phase 4 — Agent subscribes to rust-work-service /ws for
# `WsEvent::SapJobStatusChanged` (job-poller wake-up) and
# `WsEvent::RfPutawayChanged` (trigger evaluator wake-up) instead of
# direct Supabase Realtime channels. See
# `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase4.md`.
_USE_RUST_WS_RAW: str = os.environ.get("OMNIFRAME_AGENT_USE_RUST_WS", "1")
_USE_RUST_WS: bool = _USE_RUST_WS_RAW != "0"
if _USE_RUST_WS_RAW == "0":
    print(
        "[boot] DEPRECATION: OMNIFRAME_AGENT_USE_RUST_WS=0 explicitly set. "
        "v2.0.0 made the rust-work-service /ws path the default; this "
        "env var is scheduled for removal in v2.1.0 along with the legacy "
        "Supabase Realtime fallback. Unset the env var (or set to 1) to "
        "silence this warning."
    )
elif _USE_RUST_WS:
    print(
        "[boot] OMNIFRAME_AGENT_USE_RUST_WS=1 (default since v2.0.0). "
        "Agent subscribes to rust-work-service /ws for "
        "WsEvent::SapJobStatusChanged + WsEvent::RfPutawayChanged. "
        "Override rust-work-service URL via OMNIFRAME_WORK_SERVICE_URL "
        "(default: production)."
    )

# Phase 7 — Agent's queue claim / complete / fail / heartbeat calls go
# to rust-work-service `/api/v1/sap-agents/jobs/...` instead of
# PostgREST RPC + PATCH directly. The Rust handlers wrap the same
# `claim_sap_agent_job` + `bump_sap_agent_job_lease` SQL functions
# and preserve the v1.7.2 terminal-state guards (`status='running' AND
# claimed_by=<self>`); they ALSO emit per-org Prometheus metrics
# (`sap_jobs_claim_total{outcome}`, `sap_jobs_claim_latency_ms`,
# `sap_jobs_complete_total{outcome}`, `sap_jobs_fail_total{step}`)
# the legacy direct-PostgREST path lacks. See
# `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase7.md`.
_CLAIM_VIA_RUST_RAW: str = os.environ.get("OMNIFRAME_AGENT_CLAIM_VIA_RUST", "1")
_CLAIM_VIA_RUST: bool = _CLAIM_VIA_RUST_RAW != "0"
if _CLAIM_VIA_RUST_RAW == "0":
    print(
        "[boot] DEPRECATION: OMNIFRAME_AGENT_CLAIM_VIA_RUST=0 explicitly "
        "set. v2.0.0 made the rust-work-service claim path the default "
        "(and Phase 11 deleted the legacy direct-PostgREST claim "
        "fallback). Without `_CLAIM_VIA_RUST=1` the /jobs/claim, "
        "/jobs/{id}/complete, /jobs/{id}/fail, and lease-bump paths will "
        "raise; this env var is scheduled for removal in v2.1.0. Unset "
        "the env var (or set to 1) to silence this warning."
    )
elif _CLAIM_VIA_RUST:
    print(
        "[boot] OMNIFRAME_AGENT_CLAIM_VIA_RUST=1 (default since v2.0.0). "
        "Agent routes claim/complete/fail/heartbeat calls through "
        "rust-work-service /api/v1/sap-agents/jobs/...; legacy "
        "direct-PostgREST control-plane paths were deleted in Phase 11."
    )

# Phase 6 (rust-work-service integration plan, 2026-05-07) — fleet-wide
# live console streaming. When `OMNIFRAME_AGENT_CONSOLE_RELAY=1` the
# agent's `_console_relay_thread` drains a recent-lines buffer every
# ~500ms and POSTs batches to `rust-work-service /api/v1/sap-console/lines`.
# The route fans each line out as a `WsEvent::SapAgentConsoleLine` so
# the SAP Console card in the OmniFrame web app sees agent stdout in
# <100ms after the agent printed it.
#
# Default `0` (off) until Phase 10 lands proper service-key auth — for
# the parallel-run window the agent reuses its existing Supabase JWT
# (same pattern as `OMNIFRAME_AGENT_USE_RUST_WS` and
# `OMNIFRAME_AGENT_CLAIM_VIA_RUST`).
#
# See `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`
# Phase 6 + `memorybank/OmniFrame/Implementations/Implement-Rust-Work-Service-Phase6.md`.
_CONSOLE_RELAY_RAW: str = os.environ.get("OMNIFRAME_AGENT_CONSOLE_RELAY", "1")
_CONSOLE_RELAY_ENABLED: bool = _CONSOLE_RELAY_RAW != "0"
if _CONSOLE_RELAY_RAW == "0":
    print(
        "[boot] DEPRECATION: OMNIFRAME_AGENT_CONSOLE_RELAY=0 explicitly "
        "set. v2.0.0 enabled the console relay by default. The env var "
        "itself is scheduled for removal in v2.1.0. Unset the env var "
        "(or set to 1) to silence this warning."
    )
elif _CONSOLE_RELAY_ENABLED:
    print(
        "[boot] OMNIFRAME_AGENT_CONSOLE_RELAY=1 (default since v2.0.0). "
        "Agent mirrors selected print() lines to rust-work-service "
        "/api/v1/sap-console/lines so the SAP Console card sees live "
        "stdout. Default flush every 500ms in batches up to 50 lines, "
        "10 000-line buffer cap. Override target via "
        "OMNIFRAME_WORK_SERVICE_URL (default: production)."
    )

# Phase 6 — buffer cap. The relay thread drops the oldest entries
# when the deque fills (deque(maxlen=...) handles this for free) so a
# sustained network outage can't OOM the agent. 10 000 lines × ~200B
# average ≈ 2 MB upper bound — safe even on a constrained Citrix box.
_CONSOLE_RELAY_BUFFER_CAP: int = 10_000

# Phase 6 — per-flush batch size. The route's MAX_LINES_PER_REQUEST
# is 200; we target 50 to leave headroom for a future tuning bump and
# to keep the per-batch JSON payload under ~10 KB.
_CONSOLE_RELAY_BATCH_SIZE: int = 50

# Phase 6 — flush cadence. ~500ms keeps the FE feel "live" (typing
# speed) without flooding the rate limiter (100 lines/min/agent ≈
# 1.66/s, which 500ms × 50-line batches covers an order of magnitude
# above with backoff).
_CONSOLE_RELAY_FLUSH_INTERVAL_SEC: float = 0.5

# Phase 6 — backoff after a relay POST fails. Doubles up to a 30s cap
# so a transient network blip doesn't burn cycles, then resets after
# a successful flush. Mirrors the `_supabase_request` retry posture.
_CONSOLE_RELAY_INITIAL_BACKOFF_SEC: float = 2.0
_CONSOLE_RELAY_MAX_BACKOFF_SEC: float = 30.0


# Phase 7 — parallel-run instrumentation. Counts how many claim
# attempts went through each path so a 24h grep can confirm parity
# (counts should grow at near-identical rates while both paths are
# wired in different deploys / agents). Mirrors Phase 4's
# `_work_ws_event_counts` vs `_legacy_realtime_event_counts` pattern.
# Lock guards across the poller / heartbeat / watchdog threads.
_claim_path_lock = threading.Lock()
_claim_via_rust_total: int = 0
_claim_via_supabase_total: int = 0


def _bump_claim_path_counter(via_rust: bool) -> tuple[int, int]:
    """Increment the appropriate parallel-run counter under the lock
    and return the current `(via_rust, via_supabase)` tuple so the
    caller can log both values inline (single line per claim).
    """
    global _claim_via_rust_total, _claim_via_supabase_total
    with _claim_path_lock:
        if via_rust:
            _claim_via_rust_total += 1
        else:
            _claim_via_supabase_total += 1
        return (_claim_via_rust_total, _claim_via_supabase_total)

AGENT_VERSION = "2.1.0"  # v2.1.0 (2026-05-21) — Phase A worker hardening for Multi-Session Agent Master.
# v2.0.0 (2026-05-07) — Phase 11 of the rust-work-service integration plan (.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md). The version BUMP marks the architecture-change boundary: the agent's control plane is now rust-work-service (WS for row events, REST for job claim/complete/fail/heartbeat), the trigger evaluator runs server-side (Phase 9), and the agent owns its own credentials via service keys (Phase 10). Defaults flipped: OMNIFRAME_AGENT_USE_RUST_WS=1 (was 0), OMNIFRAME_AGENT_CLAIM_VIA_RUST=1 (was 0), OMNIFRAME_AGENT_CONSOLE_RELAY=1 (was 0) — explicitly setting these to 0 now logs a deprecation warning at boot, and the env vars themselves are scheduled for removal in 2.1.0. Legacy job-control fallback paths (direct PostgREST RPC for claim/complete/fail/lease-bump) deleted; surviving direct-Supabase surface is documented in [[Implementations/Implement-Rust-Work-Service-Phase11]] under "Surviving direct-Supabase surface" — auth (login/refresh/profile fetch) plus domain mutations (rf_putaway_operations, work_tasks, sap_agents registry, sap_transaction_logs) only. Service-key authentication remains a SOFT REQUIREMENT in 2.0.x: the agent boots without one and logs a deprecation warning, falling back to the user JWT for rust-work-service calls. Operators that have provisioned every agent with a service key can set OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1 to get HARD-FAIL boot semantics (exit code 78 — configuration error) when the key is missing. The user-JWT fallback itself is scheduled for full removal in 2.1.0; the legacy /supabase/login + /supabase/session + /supabase/logout endpoints stay forever — they remain part of the user-launch UX (admin clicks "Launch Agent", browser POSTs the user session so the agent has org context) but no longer drive rust-work-service authentication once a service key is on disk. Migration 284 (Phase 11) flips rf_putaway_operations REPLICA IDENTITY FULL → DEFAULT now that Realtime is no longer the agent's row-event source. Capability "agent-2.0-architecture" advertised. v1.9.0 carry-over (intentionally unbumped per Phase 9 + Phase 10 plan directives — Phase 11 owns the architecture-boundary bump): Agent now consumes WsEvent::SapJobStatusChanged + WsEvent::RfPutawayChanged from rust-work-service /ws (Phase 4); claim/complete/fail/heartbeat route through rust-work-service /api/v1/sap-agents/jobs/* (Phase 7); 750 LOC of agent-side trigger evaluator deleted in favour of server-side rust-work-service::triggers (Phase 9); service-key identity exchange minted via /api/v1/agent-identity/exchange against Argon2id-hashed agent_service_keys (Phase 10). (.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md). Agent now consumes `WsEvent::SapJobStatusChanged` + `WsEvent::RfPutawayChanged` from `rust-work-service /ws` when `OMNIFRAME_AGENT_USE_RUST_WS=1`. Default still `0` — Supabase Realtime path runs unchanged for the 3-day parallel-run window. After telemetry confirms parity between the two paths, the default flips to `1` and v1.10 deletes the legacy ~400 LOC that v1.7.1 → v1.8.4 layered on to keep the Supabase path alive on a degraded tenant (`_RealtimeCleanCloseTracker`, `_RealtimeCircuitBreaker`, `_realtime_cooldown_ladder`, `OMNIFRAME_DISABLE_REALTIME` env gate, `_supabase_request` retry layer). Three new files: (1) `omni_agent/work_service_ws.py` — single-connection asyncio WS client to `rust-work-service /ws`. Mints a 5-min HMAC subscribe-token via `POST /api/v1/work/ws-token`, sends `{"type":"Subscribe","organization_id":<org>}`, dispatches every received event to the caller's `on_event` callback. Reconnect ladder mirrors v1.8.4 Realtime semantics (5s initial, additive +5s per attempt, 60s cap, reset to 5s only after a 60s+ stable run) but WITHOUT the v1.8.0 clean-close circuit breaker — the work service's own breaker (Phase 2 telemetry: `work_ws_broadcast_buffer_pct`, `work_service_ws_lagged_events_total`) is the authoritative reliability signal so this client stays a thin consumer. (2) `rust-work-service/src/rf_putaway_listener.rs` — `LISTEN rf_putaway_operation_changed` consumer that mirrors `sap_agents_listener::run` 1:1. Parses each NOTIFY into `WsEvent::RfPutawayChanged { row_id, organization_id, op, new }` (loose-typed `serde_json::Value` for `new` — the agent's evaluator only inspects `to_status`, `is_mca_workflow`, `confirmed_source`, `to_number`, `warehouse`, all in NEW). Bad payloads log `tracing::error!` and skip — listener task NEVER dies on a parse error. (3) `supabase/migrations/276_notify_rf_putaway_changed.sql` — idempotent `AFTER INSERT OR UPDATE` trigger on `rf_putaway_operations` that ships `row_to_jsonb(NEW)` only. `REPLICA IDENTITY FULL → DEFAULT` flip is deferred to Phase 11 (audit gates that change). Wiring change in `agent.py`: `_start_realtime_subscription()` now branches at the top — when `_USE_RUST_WS` is True, the function instantiates `WorkServiceWsClient(token_provider=..., org_provider=..., on_event=_on_work_ws_event)` and returns BEFORE spawning the legacy Supabase asyncio thread. New handler `_on_work_ws_event(event_dict)` dispatches: `SapJobStatusChanged` → same `_kick_job_poller("rust-ws-...")` wake-up path the legacy `_on_jobs_insert` callback uses; `RfPutawayChanged` → same `_on_hardcoded_table_change("rf_putaway_operations", op, payload_with_record_envelope)` path the legacy `_on_rf_putaway_change` callback uses (the dispatch synthesizes a `{"data": {"record": <new>}}` envelope so the existing v1.6.4 evaluator stays unchanged). Every WS event also stamps `state.last_realtime_event_at` so the v1.7.8 backfill skip logic still works ("Realtime is healthy and recently active" → skip the 60s PostgREST scan). Frontend update: `LATEST_AGENT_VERSION = '1.9.0'` in `src/features/admin/sap-testing/lib/agent-fetch.ts` so the upgrade banner reads the new version. New capability `rust-ws-client` advertised in `/health.capabilities` (purely informational, no frontend gating). DEFERRED to v1.10: (a) deletion of the legacy ~400 LOC (Supabase Realtime path); (b) `WORK_WS_REQUIRE_TOKEN=true` strict-mode flip in production (1 week of stability gates that change). NO existing handler touched. NO trigger semantics changed. NO RLS change. See [[Implementations/Implement-Rust-Work-Service-Phase4]] for the full scope, parallel-run instrumentation details, and the exact deletion plan (grep targets enumerated under "Deferred to Phase 4.4 follow-up"). v1.8.4 carry-over — Aggressive Realtime degradation when unhealthy — 2 closes in 30s trips circuit, exponential backoff up to 6h. New OMNIFRAME_DISABLE_REALTIME=1 escape hatch. Reduces tenant Realtime load when Presence shards are overloaded. Production saw the org's Supabase Realtime Presence GenServer crashing for tenant c9d89a74 (Presence_shard112 timeouts on `:track` calls), GoTrue `/user` requests at 2.2s, and the v1.8.0/v1.8.2 agent's 5s clean-close reconnect cycle (12+ reconnects/min) compounding the tenant Realtime load — closing the agent immediately restored web-app loading. The v1.8.0 circuit breaker was too lenient (5 closes in 60s, 5min auto-retry) so on a chronically degraded tenant the agent cycled forever. v1.8.4 tightens the clean-close tracker (60→30s window, 5→2 closes, 30→15s min-connect-age — any close <15s after subscribe counts as spurious), changes the auto-retry cooldown from a fixed 5min to an exponential ladder (30min initial, doubles to 60/120/240/360min cap = 6h) keyed off a new `_realtime_reset_state["consecutive_trips"]` counter that only resets on a 60s+ stable connection, slows the reconnect ladder (initial 5→15s, additive +5s per attempt instead of multiplicative ×2, reset to 15s only after a 60s+ stable run), and adds an `OMNIFRAME_DISABLE_REALTIME=1` env var that skips Realtime entirely (sets `state.realtime_disabled=True` at boot, polling-only mode for the entire process lifetime). `/realtime/status` extended with `consecutive_trips`, `next_retry_seconds`, `recommended_action`, `realtime_disabled_via_env`. Job poller polling-only ceiling unchanged at 15s — well-tested. New capability `realtime-aggressive-degradation`. (v1.8.3 was UTC-midnight PATCH bug; v1.8.2 was LT22 parser banner penalty; v1.8.1 dropped `shipment_queue` realtime channel; v1.8.0 added clean-close tracker) silently no-op'd. Manually backfilled the 19 rows via Supabase MCP. Three surgical fixes, NO existing handler logic touched, NO trigger semantics changed, NO migration, NO RLS. (1) `_update_putaway_status(to_number, warehouse, row_id=None)` — when `row_id` is provided, PATCHes by `id=eq.<row_id>&to_status=neq.TO%20Confirmed` (exact row, no date guessing, works across any timezone boundary); when `row_id` is None (manual /sap/confirm-to calls without trigger metadata), falls back to a 48-hour `created_at` window instead of the today-UTC window so a same-day retry still hits and a UTC midnight crossing is no longer fatal. The `to_status=neq.TO%20Confirmed` skip filter stays so a re-fired job doesn't overwrite a row already marked confirmed. (2) `confirm_transfer_order(req, row_id=None)` — accepts an optional `row_id` kwarg and forwards it to BOTH `_update_putaway_status` call sites (already-confirmed branch + post-Save success branch). FastAPI exposes it as a query parameter on the HTTP path but the agent's only HTTP caller is the queue dispatcher, which uses the kwarg directly via `_dispatch_job`. (3) `_dispatch_job(job)` — extracts `row_id` from `payload.__omni_trigger_meta.post_success_patch.row_id` and passes it as a kwarg to `/sap/confirm-to` only (narrow allowlist `_ROW_ID_AWARE_ENDPOINTS = ("/sap/confirm-to",)`). Other handlers don't receive `row_id` so adding the kwarg to them later is opt-in. Diagnostic: when the PATCH affects 0 rows the agent now logs `[lt12]  WARN _update_putaway_status PATCHED 0 rows for TO {to_number} WH {warehouse} (row_id={row_id}, cutoff={cutoff}). Possible UTC-midnight crossing OR row already TO Confirmed OR RLS hid it from this user.` so future regressions are visible immediately instead of silently mis-patching. `_apply_trigger_post_patch` (v1.6.8) is UNCHANGED — already uses `id=eq.<row_id>` correctly. New capability `putaway-update-by-rowid` advertised in `/health.capabilities` (purely informational, no frontend gating). Frontend `LATEST_AGENT_VERSION = '1.8.3'`. v1.8.2 carry-over — LT22 parser hardening — multi-factor header scoring with banner penalty + per-batch dedup defense in lt22_import. The user's PDC LT22 export shipped a banner row ("Warehouse No.\t\t\tPDC\tIndianapolis PDC") with EXACTLY 3 non-empty cells — exactly the v1.7.7 floor that was meant to keep banners out. While the real header on this file (19 non-empty) still wins by raw `non_empty`, the user reported the agent INSERT-failing with `409 duplicate key value violates unique constraint sap_outbound_to_imports_unique_per_batch (organization_id, to_number, import_batch_id)` after parsing 561 rows × 2 columns — meaning either the banner DID win on their machine somehow, or duplicate TO numbers slipped through. Three layered defenses, NO existing handler logic touched: (A) `_parse_attempt_b_tab_delimited` and `_parse_attempt_c_fixed_width` now blend three factors via the new `_score_header_candidate(non_empty, total_cells, following_data_rows)` helper — base score `non_empty * 10`, `+ min(following_data_rows, 20) * 5` bonus for lines whose siblings share the same shape (real headers see 100s of matches; banners see ~0), and `-50` penalty when fill_ratio < 0.3 AND non_empty < 5 (the SAP banner pattern: one label + one value padded by tabs). The banner penalty is intentionally larger than any banner could earn from `non_empty` alone (3 × 10 = 30), so a real header reliably outranks any banner-shaped candidate even when the following-row bonus is zero for both. The threshold drops from `non_empty < 3` to `non_empty < 2` since the penalty does the heavy lifting now. (B) `lt22_import.py` adds defense-in-depth before the bulk INSERT: deduplicate normalized rows by `to_number` within the batch (keep first occurrence — split deliveries can legitimately produce duplicate TO numbers), drop rows with empty/null `to_number` with a single warn-summary log line, and switch the POST to use `Prefer: return=minimal,resolution=ignore-duplicates` so a partial-success run can re-execute without 409-aborting on rows the previous run already inserted. (C) `lt22_import.py` also performs a parse-validation step BEFORE the bulk INSERT — if the parsed `columns` array has no "TO Number" / "TO no." / "TANUM" header OR every row's `to_number` is empty, a snapshot of the parsed DataFrame is saved to `%TEMP%/omniframe_lt22_parse_failure_<UTC_ts>.json` (best-effort, never blocks the error) and a specific error is raised: `LT22 parsed but TO Number column not found / values empty — likely parser misidentified header. Diagnostic file saved to <path>`. Triagers can grab the diagnostic and we can add a Format F parser if a future SAP variant slips past the multi-factor scorer. New regression test `omni_agent/tests/test_lt22_smart_header.py` (mirrors `test_lt10export_smart_header.py`'s self-contained namespace pattern) asserts the user's actual LT22 file parses to ≥19 columns + ≥500 rows + a "TO Number" header column + a non-empty first data row TO number. The existing v1.7.7 LT10 test stays passing unchanged. New capability `parser-banner-penalty` advertised in `/health.capabilities` (purely informational, no frontend gating). v1.8.1 carry-over — Removed `shipment_queue` from Realtime subscription (the table doesn't exist in the DB — Supabase Realtime closed the WebSocket cleanly ~0s after `subscribe()` because the subscribed table is absent from both the `supabase_realtime` publication AND `information_schema.tables`). The v1.8.0 clean-close circuit breaker correctly tripped into polling-only fallback within 60s of every boot, but the root cause was a stale subscription, not a corporate proxy. Three surgical fixes, NO handler logic touched: (A) `_start_realtime_subscription` now subscribes to three channels (sap_agent_jobs + rf_putaway_operations + work_tasks) instead of four; `shipment_queue` is skipped with a single `[realtime] skipping shipment_queue — table not present in DB` log line that points to Debug/Fix-Realtime-CleanClose-Cycle.md. The `builtin-shipment-queue` hardcoded trigger entry stays for backward compatibility — if the table is ever created + added to the publication, re-enable the subscription. (B) Per-channel defensive try/except around each `subscribe()` call: a future missing table won't silently close the whole socket — the agent logs `[realtime] channel <name> subscribe error: <exc>` and continues with the remaining channels. (C) `_build_sessions_response` (new helper backing GET /sap/sessions) now computes the pinned winner in a single pass and marks EXACTLY ONE session with `pinned=True` — exact `(conn_idx, sess_idx)` wins first; if `pin_by_criteria=True` and no exact match exists, the FIRST session whose `(system, client, user)` matches the stored pin wins. Previously every criteria-matching session was flagged `pinned=True`, so a user with 6 SAP windows all on the same sys/client/user saw "PINNED" on every dropdown row. (D) `/sap/select-session` now also captures `transaction` at pin time so the pin record carries the TX code as a tiebreaker for future disambiguation (stored on `state.pinned_session['transaction']`; `/sap/sessions` doesn't use it yet — the winner selector's "first criteria match" is deterministic enough — but the field is there for future work). UI fixes landed in the same release: (1) Agent Triggers tab now uses `agentFetch('/sap/sessions')` mirroring the Inventory Management tab so both tabs hit the identical code path (the raw `fetch()` in the Agent Triggers tab was fine for auth-exempt routes but diverged the two tabs' loader behaviour — consistency is worth more than a few bytes). (2) `SapSessionPicker` dropdown rows collapse ACTIVE/PINNED into a single right-aligned pill per session ("PINNED · ACTIVE" / "PINNED" / "ACTIVE" / nothing) so the double "PINNED · PINNED" artifact in the user's screenshot can't recur; subtitle line shows conn label + TX code so "SESSION_MANAGER × 4 + LT10 + ZV20" are visually distinguishable. (3) Frontend `LATEST_AGENT_VERSION = '1.8.1'` so the upgrade banner reads 1.8.1. v1.8.0 carry-over — Realtime resilience: clean-close circuit breaker, aggressive WebSocket heartbeat, /realtime/status endpoint. Production agent on a Citrix → Netskope corporate-proxy box was observed cycling indefinitely through `[realtime] connected … listen() returned cleanly` pairs every ~5s — the proxy idle-closed the WebSocket faster than the realtime library's 25s default heartbeat could keep it alive, and the v1.7.1 exception circuit breaker only counts EXCEPTIONS so the cycle never tripped the fallback. v1.8.0 ships three layered defenses, all surgical, NO existing handler logic touched. (1) `_RealtimeCleanCloseTracker` — a SECOND sliding-window counter (60s window, 5-spurious-close threshold) records every clean close where the connection lasted <30s (i.e. before any heartbeat could plausibly have kept it alive). 5+ in 60s trips the SAME `_disable_realtime_subsystem` path the exception breaker uses, falling back to polling-only mode for 5min before auto-retry. The v1.7.1 exception breaker is left UNTOUCHED so the stderr-flood guard still works in parallel. (2) Tighter heartbeat — `AsyncRealtimeClient(... hb_interval=10)` overrides the library default (25s) to 10s so a typical corporate-proxy idle timer (Netskope/ZScaler/Citrix typically 10-30s) gets reset before it fires. Wrapped in TypeError fallback for older bundled `realtime` wheels that don't accept the kwarg. (3) New `/realtime/status` endpoint — read-only diagnostic exposing `{connected, circuit_tripped, fallback_mode, spurious_close_count_60s, exception_count_60s, last_event_at, uptime_seconds}` so frontends can render an accurate "Realtime: degraded / polling-only" status pill instead of the binary "agent connected/disconnected" signal `/health` gives. Token-exempt so the badge can render before login. Plus a friendly escalation log: 3+ spurious closes in 30s emit one `[realtime] WARN — N spurious clean closes …` per minute pointing the user at the Citrix/Netskope idle-close hypothesis. New capabilities: `realtime-clean-close-detection`, `realtime-status-endpoint`. Pre-1.8.0 agents are unaffected (no spurious closes on healthy networks → tracker never records). v1.7.9 SAP session pinning preserved verbatim. Two new endpoints (POST /sap/select-session, POST /sap/unpin-session) plus a frontend session-picker pill in the SAP Testing tabs let the user dedicate one SAP GUI session to the agent while keeping the rest of their SAP work untouched. When pinned, `_auto_select_valid_session` ONLY returns the pinned session — first by stored (conn_idx, sess_idx), then by criteria match (system + client + user) so SAP's per-launch session renumbering doesn't break the pin. If the pinned session isn't currently available the agent stays disconnected (loudly logged) rather than auto-grabbing a different session. Without a pin, behaviour is identical to v1.7.8 — `_auto_select_valid_session` returns the first usable session as before. Pin survives EXE rebuild + restart because `pinned_session: dict | None` is persisted to %APPDATA%\\OmniFrameAgent\\config.json alongside the existing supabase_token / agent_token blob. `/sap/sessions` GET response augmented with per-session `pinned: bool`, `is_active: bool`, `system`, `client`, `user` so the picker can render checkmarks + criteria. New capability `sap-session-pinning`. NO existing handler touched. NO trigger semantics changed. NO migration. NO RLS. v1.7.8 carry-over — Adaptive heartbeat throttling, dropped redundant reaper RPC, backfill polling skipped when Realtime healthy. Targets the "agent + DB chatty during idle" load profile flagged in the Tier 4 / Tier 2-5 investigation report. Three surgical changes (NO handler touched, NO trigger semantics changed, NO frontend logic touched beyond `LATEST_AGENT_VERSION = '1.7.8'`): (A) `_start_heartbeat_thread` now resolves a per-tick cadence instead of a fixed 30s sleep — base 30s while a job is in flight (`state.active_job_id is not None`) so lease bumps stay snappy; idle 60s when there's been no active job for >5min (`time.time() - state.last_job_completed_at > 300`). New `state.last_job_completed_at` is initialised to boot time on `AgentState` and bumped in the job poller's `finally` block after every dispatch (success or failure). Mode transitions log `[heartbeat] Idle mode — cadence 60s. Active mode — 30s. Currently: <mode>` once per change so ops can correlate console output with the cadence shift; steady-state ticks stay quiet. Halves `sap_agents.last_seen_at` UPDATE rate on a quiescent 4-agent fleet (8 writes/min → 4 writes/min) without affecting fleet-card freshness materially because the pg_cron-driven `mark_stale_sap_agents_offline` reaper runs every minute server-side. (B) Removed the per-tick `reap_stale_sap_agents()` RPC call from the heartbeat loop. The pg_cron job `omniframe-reap-stale-sap-agents` (registered in migration 250) drives the reaper every minute server-side, so each agent doing its own sweep was N×2 RPCs/min for nothing. Function definition is unchanged — only the agent stops calling it. Saves N RPCs/min and the `sap_agents` UPDATE that the function dispatches when nothing is stale. (C) `_start_trigger_backfill_poller` now gates its periodic PostgREST query on Realtime health: when `not state.realtime_disabled` AND `time.time() - state.last_realtime_event_at < 120` the poll is skipped with `[backfill] skipping — Realtime is healthy and recently active`. New `state.last_realtime_event_at` is stamped at the top of `_on_rf_putaway_change` so any Realtime callback resets the clock; the poll runs unconditionally (cold start = 0.0) when no event has fired in the last 2min, the agent just booted, OR the v1.7.1 circuit breaker has tripped (polling-only fallback mode). Fully preserves the v1.6.9 missed-event self-healing semantics — the backfill still wakes when Realtime goes silent for any reason — while eliminating ~60 redundant SELECTs/hour on the dominant "Realtime healthy, no missed events" steady state. Also paired with two DB migrations applied via Supabase MCP: `254_index_hot_read_paths.sql` (composite indexes for the fleet card / claim-path / backfill SELECTs that previously sequential-scanned `sap_agents` + `sap_agent_jobs` + `rf_putaway_operations` on every probe) and `255_optimize_replica_identity.sql` (flips `sap_agents` / `sap_agent_jobs` / `sap_agent_schedules` / `sap_outbound_to_import_runs` from REPLICA IDENTITY FULL → DEFAULT so Realtime UPDATE payloads ship the PK only instead of the entire old + new row pair; `rf_putaway_operations` stays FULL because the v1.6.4 agent-side trigger evaluator inspects the `record` field which Realtime synthesizes from the OLD image when REPLICA IDENTITY is FULL — revisit in v1.8 once we audit consumers). Two new capabilities advertised in /health.capabilities (purely informational, no frontend gating): `adaptive-heartbeat`, `realtime-aware-backfill`. NO migration owned by the agent — both DB migrations are applied independently via Supabase MCP. NO RLS change. NO trigger semantics change. NO existing handler touched. NO change to the v1.7.1/v1.7.0/v1.6.9 self-healing layers (circuit breaker, drain mode, watchdog, in-memory dedup cache) — they all keep working unchanged. v1.7.7 carry-over — Smart header detection in bulk-export parsers — banner lines no longer mistaken for column headers — banner lines no longer mistaken for column headers. The v1.7.6 multi-format ladder correctly detected Format B (tab-delimited) on a real LT10 export, but `_parse_attempt_b_tab_delimited` picked the FIRST non-blank line as the header. SAP's LT10 export starts with banner rows ("Whse number\\t\\t\\t\\t\\tWH5", "Stge type\\t\\t\\t\\t\\t999") BEFORE the actual header — so the parser returned 1 row × 6 columns from the warehouse banner instead of the 232+ rows × 18-20 columns from the real grid. v1.7.7 replaces "first non-blank line is header" with a scoring pass: every tab-bearing non-blank line is scored by its non-empty cell count; the candidate with the highest score (and ≥3 non-empty cells, so banner lines with <3 fall out) wins. Same hardening applied to Format C (fixed-width / 2+ spaces) so future SAP variants that omit tabs still get smart header detection. Data rows are now PERMISSIVE on cell count — SAP DROPS trailing empty cells in tab-exported data rows, so a row with 13 cells against a 20-cell header is normal (pad with empties); only rows with significantly MORE cells than the header are rejected as malformed. Same five-format ladder, same fallback semantics. v1.7.6 — Permissive bulk-export parser: handles dash-separated, tab-delimited, fixed-width, CSV, and HTML SAP list exports. Diagnostic dump on parse failure. v1.7.5 user reported LT10 export reached Phase B (Save-As dialog opened, file landed on disk in %TEMP% with the right uuid filename) but the parser raised `_PcPostCommitError("Could not find a dash-separator row in the %pc export. File may be empty or in an unexpected format.")`. The v1.6.3 single-format parser was looking for a dash row between header and data; on this user's SAP variant the export format is something else (could be tab-delimited, fixed-width without dashes, CSV, or HTML "Web HTML" depending on box-level customizing). v1.7.6 adds five parsers in priority order and tries each one until a non-empty (>=2 columns AND >=1 data row) result returns: A=dash-separator (current), B=tab-delimited (\t between cells), C=fixed-width without dashes (split on 2+ spaces), D=CSV (csv.reader with optional quoting), E=HTML (regex over <tr>/<td>). First match wins; `result["meta"]["parser_format"]` reports A/B/C/D/E so SAP Testing audits can see which format the user's variant produced. New `[query]  Parser detected format: <X>` print on success. On total failure: (1) save a copy of the file to `%TEMP%/omniframe_lastfailed_<UTC_ts>.txt` so the user can grab and share it; (2) print a `repr()` preview of the first 1000 chars + line count + byte count + encoding heuristic + per-format attempt log to the agent console; (3) raise `_PcPostCommitError` with a helpful message that references the saved copy path and suggests trying a different SAP export-format option (Spreadsheet vs Unconverted) as a workaround. New capability `bulk-export-multi-format-parser`. NO existing handler touched. NO trigger semantics changed. NO migration. NO RLS. NO frontend logic changed beyond `LATEST_AGENT_VERSION = '1.7.6'`. v1.7.5 carry-over — LT10/MB52 always bulk-export. Pagination only as PRE-COMMIT fallback. The v1.7.3 gate `if storage_type == "*"` in `handler_lt10` was based on the wrong assumption that specific-type queries return small result sets. Production disproved this: a `storage_type='999'` warehouse-wide query returned 234 rows across 7 pages (~30s of Ctrl+PgDn pagination via `[query]  SAP list paginated: 7 page(s), 234 unique row(s)`) when bulk export would have completed in <5s. v1.7.5 drops the gate entirely — `handler_lt10` always sets `state._use_bulk_export = True` and calls `_extract_via_pc_export(sess)` directly. Falls back to `_extract_sap_list_output` ONLY on `_PcPreCommitError` (dialog never opened, GUI still on source screen — same fallback semantics v1.7.3 introduced). Same pattern applied to `handler_mb52`: always bulk-export first, fall back to `_extract_alv_grid(sess)` on pre-commit failure (handles the rare case where MB52 renders as a true ALV grid with menu indices that differ from the classic list-output report). Both handlers now report `extraction_path` in `result["meta"]` (`pc_bulk_export` / `lbl_paginated_fallback` for LT10; `pc_bulk_export` / `alv_grid_fallback` for MB52) so the frontend / SQL audits can see which path actually ran. New capability `bulk-export-always` advertised in `/health.capabilities`. NO migration. NO RLS. NO trigger semantics changed. NO frontend logic touched beyond `LATEST_AGENT_VERSION = '1.7.5'`. NO other handler touched (LT22 lives in `lt22_import.py` which already always bulk-exports via `if req.use_bulk_export` defaulting to True from v1.6.3; LT24, MMBE, MM02/03, RF, etc. all unchanged). v1.7.4 carry-over — Menu-driven export trigger as primary path; %pc as fallback. Matches recorded SAP flow on this user's variant. The v1.7.3 user reported their LT10 query was STILL paginating via Ctrl+PgDn after the v1.7.3 fix shipped. Capturing a fresh recording on their machine (`MacWindowsBridge/LT10ReRan.vbs`) revealed the actual export trigger they use is the canonical menu path (`wnd[0]/mbar/menu[0]/menu[1]/menu[2]` = List → Save → File...) rather than the `%pc` OK-code shortcut the agent relied on. On their SAP variant `%pc` either is not registered or routes to a different dialog — Step 1 of `_extract_via_pc_export` failed, raised `_PcPreCommitError`, and v1.7.3's correctly-narrowed fallback chain dropped through to `_extract_sap_list_output` (lbl[x,y] pagination). v1.7.3's behaviour was technically correct (pre-commit failures ARE fallback-safe) but the underlying bulk-export path never even RAN on this user. v1.7.4 makes Phase A of `_extract_via_pc_export` try the menu-driven trigger FIRST (universal — every list-output report ships with the same `List → Save → File...` menu entry at the same position), and only falls back to `%pc` if the menu select fails. `%pc` is preserved as a secondary path so other transactions whose menu indices shift on a custom skin keep working. Also: Step 4 (Save-As dismissal) now tries `sendVKey(0)` (Enter) first instead of `btn[11]` because the recording uses Enter; `btn[11]` and `sendVKey(11)` remain as cross-variant fallbacks. Step 3 (path/filename) now falls back to filename-only setting if both `DY_PATH` + `DY_FILENAME` are not present (the recording shows the user's variant only exposes `DY_FILENAME` with the path auto-populated). All three trigger / save / path-setting paths print which method actually worked so future variant differences are diagnosable from the agent console in seconds. New capability `bulk-export-menu-driven`. NO frontend logic change beyond `LATEST_AGENT_VERSION = '1.7.4'`. NO migration. NO RLS. NO trigger semantics changed. Pure additive change to the bulk-export Phase A — the v1.7.3 two-phase error taxonomy + handler_lt10 ALV-probe-skip + `_extract_alv_grid` narrowed fallback chain are all unchanged. v1.7.3 carry-over — LT10/LT22 bulk-export hardening: pre-commit vs post-commit error split + no pagination fallback after file is saved. The user-visible bug from v1.7.2 was that a successful `%pc → Save` on LT10 (storage_type='*') would briefly flash the Save-As dialog, drop the file on disk, and then SAP would visibly start paging down via Ctrl+PgDn for 5+ minutes — making the "fast" bulk-export path slower than plain pagination. Root cause: `_extract_via_pc_export` raised plain `Exception` from BOTH the pre-Save dialog setup AND the post-Save file-read/parse phase, and the caller in `_extract_alv_grid` caught everything with a single `except Exception` that fell through to `_extract_sap_list_output(sess)` (which paginates). So a single quirk in the parsed file (e.g. a SAP variant with extra header banner lines, or a Save-As dialog that closed without writing the file because the path was on a read-only %TEMP%) silently turned into a 5-minute GUI pagination walk. Three surgical fixes: (1) `_extract_via_pc_export` is now two-phase. New `_PcPreCommitError` is raised from anywhere before pressing Save (dialog setup failures, missing radio buttons, missing path/filename fields). New `_PcPostCommitError` is raised from anywhere after pressing Save (file did not appear on disk, file empty, file read failed, dash-row missing, parser found no boundaries). Both raise NEW Exception subclasses near the top of the bulk-export section. Phase A (pre-commit) wraps Steps 1-3 in a single try/except; Phase B (post-commit) is everything from pressing btn[11] / sendVKey(11) onwards. (2) `_extract_alv_grid` fallback chain now distinguishes the two: `_PcPreCommitError` → fall through to `_extract_sap_list_output` (safe — GUI is still on the source screen); `_PcPostCommitError` → re-raise as a clean `Exception("Bulk export saved file but parse failed: ...")`. Anything else → re-raise (conservative — never double-burn a slow walk on an unknown error). (3) `handler_lt10` is restructured: `storage_type == '*'` (warehouse-wide) calls `_extract_via_pc_export(sess)` DIRECTLY — no ALV probe, no TableControl probe, no fallback chain. Falls back to `_extract_sap_list_output` ONLY on `_PcPreCommitError` (the GUI is still on the source screen so it's safe). Specific storage_type calls `_extract_sap_list_output` directly (usually <100 rows, bulk-export overhead isn't worth it). The previous `_extract_alv_grid(sess)` call wasted 8+ COM round-trips probing for ALV/TableControl that LT10 will NEVER have. Same pre/post-commit split applied to `lt22_import.py` — its `if req.use_bulk_export` branch now imports both error classes and applies the same fallback semantics. New prints: `[query]  Starting %pc bulk export — file will save to TEMP and be parsed in-place. No pagination needed.` at the start; `[query]  %pc bulk export complete: <N> row(s), <M> columns in <T>s. No GUI pagination performed.` at the end. So the user can SEE which path is being taken from the agent console and diagnose any future regression in seconds. New capability `bulk-export-no-fallback` advertised in /health.capabilities (purely informational, no frontend gating) so dashboards can show "agent will not silently re-paginate after a successful bulk export". NO existing handler other than LT10 + LT22 import touched. NO migration. NO RLS. NO frontend logic change beyond `LATEST_AGENT_VERSION = '1.7.3'`. NO Supabase Storage touched. v1.7.2 carry-over — Audit closeout: JWT refresh (access + refresh tokens persisted in config.json with absolute `token_expires_at`; `_refresh_supabase_token_if_needed` runs at the top of every `_supabase_request` so the heartbeat / job poller / registry upsert / trigger enqueue / backfill query all silently roll the token before it expires; `/supabase/session` now reports `logged_in: false, reason: 'expired'` past expiry so the AgentSupabaseStatusButton can flip to "Reconnect Account" copy without waiting for a 401 to bubble up); terminal-state guards on `jobs_complete` + `jobs_fail` (PATCH filters now include `&status=eq.running&claimed_by=eq.<self>` via the new `_patch_job_terminal` helper so a watchdog-killed job CANNOT be silently rewritten to `completed` when the long-stuck SAP COM call eventually returns — the running→failed→completed state machine inversion is now impossible; watchdog itself bypasses the guard so it can always transition stuck `running` rows); idempotency-key day suffix (`trig:<id>:<row>:<unix-day>` instead of flat `trig:<id>:<row>` so a row whose first enqueue failed isn't permanently 409-poisoned — backfill can retry the next day); `sys.modules["agent"] = sys.modules[__name__]` alias at module load so the LT22 + material-master worker modules' `from agent import state` resolves to the SAME AgentState instance as the FastAPI handlers (PyInstaller bootloader otherwise loads a SECOND copy of agent.py with its own `state = AgentState()` global, so worker-side mutations like `state.sap_connected = False` after a COM crash never reach the poller); `/jobs/claim` single-flight guard (refuses with `{ok: false, error: 'agent already has an active job', active_job_id: <id>}` when `state.active_job_id` is set so a stale browser-side queue UI / debug curl can't make a single agent own two `running` rows simultaneously); `+shipment_queue` agent-side trigger (mirror of `TRIGGER_TEMPLATES[2]` in agent-triggers-tab.tsx — pre-1.7.2 the broad `agent-side-triggers` capability silenced the browser-side runtime for ALL supabase-realtime triggers but the agent only handled `rf_putaway_operations`, so `shipment_queue` rows were silently dropped; v1.7.2 adds the equivalent server-side rule plus a granular capability id `agent-side-triggers:builtin-shipment-queue` for future per-trigger gating); LT22 retry helper (`lt22_import.py` now uses a local `_lt22_request` mirror of `_supabase_request` with 30s timeout + single retry on Timeout/ConnectionError so a corporate-proxy blip doesn't fail an otherwise-successful 5000-row import); plus four frontend fixes (status button reads `useAgentDetection().authenticated` and forces "Reconnect Account" copy when reachable but unauthenticated; LT22 dialog filters the agent picker to capability holders + ignores stale pinned IDs that lack the cap with a warning toast; Inventory Management gates on `authenticated` instead of just `available`; `MIN_REQUIRED_AGENT_VERSION` user-facing copy replaced by `LATEST_AGENT_VERSION` so the banner reads "v1.7.2 available" instead of "v1.4.0 available"; `enqueueFire` accepts a `forceFire` param and `testFire` passes true so manual smoke tests bypass the agent-side suppression). Six new capabilities: `jwt-refresh`, `terminal-state-guards`, `idempotency-day-suffix`, `agent-module-alias`, `jobs-claim-active-guard`, `agent-side-triggers:builtin-shipment-queue`. v1.7.1 carry-over — Realtime crash-loop containment: asyncio exception handler suppresses noisy library bugs (`realtime>=2.x` `_reconnect()` calling `asyncio.wait([])` → `ValueError: Set of Tasks/Futures is empty.` after a Citrix VDA hibernate / corporate proxy idle WebSocket close), circuit breaker (20 errors / 60s window) + 5min auto-recovery falls back to polling-only on persistent failure. v1.7.0 left the bare `client.listen()` exposed — when the library's `_listen` task crashed inside `_on_connect_error → _reconnect`, the exception escaped to the asyncio loop's default handler, which prints a multi-line `Task exception was never retrieved` traceback to stderr. Each crash spawned a NEW `_listen` task that died the same way, so the agent flooded stderr with thousands of tracebacks per minute, drowning every other thread including the heartbeat (sap_agents.last_seen_at stopped updating) and the job poller. v1.7.1 adds four defensive layers, surgical containment fix only — NO handler touched, NO trigger semantics changed, NO frontend logic changed beyond the version-string bump: (A) `_realtime_loop_exception_handler` installed via `loop.set_exception_handler(...)` BEFORE the AsyncRealtimeClient is constructed; suppresses the known `ValueError('Set of Tasks/Futures is empty')` and `ConnectionClosedError` bursts quietly so they don't drown stderr, logs anything else once with `[realtime] async loop exception: <repr> (suppressed; agent will fall back to polling if persistent)`. Single change eliminates 99% of stderr flooding. (B) `_RealtimeCircuitBreaker` (deque-backed sliding-window error counter) — every suppressed exception increments a 60s-window counter; at 20 errors the circuit trips, `_disable_realtime_subsystem()` logs `[realtime] CIRCUIT BREAKER TRIPPED — too many errors in 60s window. Disabling Realtime subsystem; falling back to polling-only mode for trigger backfill + job claiming.`, sets `state.realtime_disabled = True`, tears down the client + cancels tasks, and tightens the job poller's idle backoff from 5→60s to 5→15s so we don't lose throughput while the trigger backfill poller (60s) carries the missed-event load. After 5min the new `_start_realtime_circuit_reset_loop` daemon resets the breaker and re-enters `_start_realtime_subscription()` for one more attempt — if the network has recovered (Citrix unhibernated, corporate proxy resumed) we're back on Realtime; if not, the breaker trips again and we cycle. (C) Threading isolation confirmed — Realtime asyncio loop runs in `sap-realtime-jobs` thread, heartbeat in `sap-agent-heartbeat` (pure synchronous `requests.post()`, no asyncio), job poller in `sap-job-poller` (pure synchronous, no asyncio), watchdog in `sap-job-watchdog` (pure synchronous), backfill in `sap-trigger-backfill` (pure synchronous). A Realtime asyncio crash CANNOT wedge the other threads because they don't share the loop. (D) Stderr-noise bound — `logging.getLogger('realtime').setLevel(logging.WARNING)` + `logging.getLogger('websockets').setLevel(logging.WARNING)` shut up library-level INFO/DEBUG; a custom `_RealtimeLogThrottle` filter on the root logger caps `Task exception was never retrieved` to 1/min so even if the asyncio default handler somehow runs (e.g. an exception we didn't predict bypasses our handler) the console doesn't drown. Library pinned to `realtime==2.29.0` (latest as of 2026-04-24, and the `_reconnect()` bug was refactored away around v2.5+ — the new `_reconnect` no longer calls `asyncio.wait()` at all); even on the upgrade the containment layers stay so future regressions in any 2.x version are bounded. Three new capabilities advertised in /health.capabilities (purely informational, no frontend gating): `realtime-circuit-breaker`, `realtime-fallback-mode`, `crash-loop-containment`. New env vars (none — thresholds + reset interval are module-level constants, deliberately not user-tunable to keep the runtime simple). New boot prints under `[realtime]` line. v1.7.0 carry-over: Throughput pass — claim-back-to-back drain, stuck-job watchdog, 30s HTTP timeouts with retry, stable Realtime singleton. Production saw 60-180s inter-job dwell because the poller slept 60s on every claim-miss between two queued jobs (Realtime wake-ups were sometimes missed during reconnect blips). Also saw a TO claimed at 20:54:15 stuck "running" for 97+s while the agent claimed the NEXT job without releasing the stuck one — DB showed two `running` rows simultaneously though SAP is single-threaded, indicating the poller-local `current_job_id = None` clear at the end of dispatch never ran (COM hang inside `_dispatch_job` parked the thread forever). Also saw `[triggers] enqueue error: HTTPSConnectionPool... Read timed out. (read timeout=8)` noise from the corporate proxy + Citrix latency, plus dozens of `[realtime] connected to wss://...` lines per minute consistent with multiple reconnect loops fighting for the same channel. Five surgical fixes (NO existing handler touched, NO trigger semantics changed, NO frontend logic changed beyond the version-string bump): (1) DRAIN-BACK-TO-BACK — `_start_job_poller` inner `_loop` now claims until the queue returns empty before sleeping, chained up to `_DRAIN_MAX_CHAIN = 50` jobs per burst; idle backoff exponentially ramps from `_DRAIN_MIN_IDLE_SEC = 5s` → `_DRAIN_MAX_IDLE_SEC = 60s` after consecutive empty polls; resets to 5s on any claim hit. Expected dwell drops from 30-60s → 1-3s on a pre-queued batch. Bursts of 5+ jobs log `[jobs] Drain mode: <N> jobs claimed in last burst.`. (2) ACTIVE-JOB TRACKING via `state.active_job_id` / `state.active_job_started_at` on `AgentState` (protected by `state.active_job_lock`) — single source of truth for "what is the SAP COM thread doing right now" shared between the poller (sets on claim, clears in `finally:` after jobs_complete/fail) and the new watchdog. Legacy `_job_poller_state["current_job_id"]` mirror kept for `/status` + `_build_agent_registry_row` back-compat but authoritative value lives on `state`. Claim lease dropped from 300s → 90s so DB-side expiry fires earlier after a hard agent crash. (3) STUCK-JOB WATCHDOG daemon thread `_start_job_watchdog_thread` wakes every 30s, checks `state.active_job_id` + `state.active_job_started_at`; if the job has been running > `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS` (default 120s, tunable via env with a 10s floor and fallback-on-parse-error), logs `[jobs] WATCHDOG: job <id> running >Ns — likely stuck. Marking failed and releasing.`, PATCHes the row to `failed` via `jobs_fail()` with step='watchdog', clears the active-job state, and kicks the poller so the next row gets claimed immediately. Does NOT try to kill the hung COM call — Python can't safely do that — but frees the DB state so the queue keeps draining while the user manually kills the SAP session to unstick the COM. (4) HTTP HARDENING — new `_supabase_request(method, url, **kwargs)` helper injects 30s default timeout (was 4-10s spread across 17 call sites) and single-retry on `requests.exceptions.Timeout` / `ConnectionError` after a 2s sleep. Corporate proxy + Citrix latency no longer produces spurious `[triggers] enqueue error` log lines. Every `requests.post/patch/get` to Supabase in agent.py now routes through the helper. (5) STABLE REALTIME SINGLETON — new sticky `_realtime_started: bool` flag short-circuits subsequent `_start_realtime_subscription()` calls (from `/supabase/login`, `_on_startup`, etc.) once the first thread is spawned, so a second reconnect loop can't race with the first and produce the "dozens of connected lines/min" pattern. Reconnect backoff floor bumped from 1s → 5s to dampen churn when `client.listen()` returns cleanly for library-internal reasons (heartbeat miss, publication refresh); clean returns now log `[realtime] listen() returned cleanly — socket closed without exception` so a future investigation has a breadcrumb. Three new capabilities advertised in /health.capabilities: `job-drain-mode`, `stuck-job-watchdog`, `realtime-singleton`. New env var `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS` (default 120) lets ops bump the timeout for unusually long handlers. See [[Debug/Fix-Agent-Throughput-Latency]] and [[Patterns/Job-Queue-Drain-Mode]]. Production caught 17 `rf_putaway_operations` rows at `to_status='Completed'` with `confirmed_at=NULL` from the past 4 hours that the agent never picked up despite the same agent correctly auto-confirming 5 OTHER rows in the same window — pure missed Realtime events, not a logic bug. The agent's `rf_putaway_operations` channel only delivers events at-most-once: agent restart / EXE upgrade / WebSocket reconnect blip / Supabase Realtime publication lag / Citrix VDA hibernation / pg_cron interrupting Realtime — any of these silently drop events forever. Three additive changes (NO existing handler touched, NO trigger semantics changed): (1) BACKFILL POLLER — new daemon thread `_start_trigger_backfill_poller` wakes every 60s, runs a bounded PostgREST query per `_HARDCODED_TRIGGERS` entry (`select=*&{trigger.backfill_filter}&organization_id=eq.<org>&created_at=gte.<24h-ago>&limit=50`), defensively re-runs `_hardcoded_trigger_match` on each row, then feeds matches through the same `_enqueue_trigger_job` path the Realtime callback uses. First poll runs 10s after boot to give Realtime a head start for the common case (no backlog). Bounded scope — max 50 rows/poll, 24h lookback window, single query per trigger — so a runaway test or ancient-row backlog can't flood `sap_agent_jobs`. Quiet by design — only logs `[backfill] poll: N matched, M queued, K skipped (dedup)` when M > 0 (queued something fresh); silent when steady-state Realtime caught everything. (2) BOUNDED TTL DEDUP CACHE — new in-memory `_recently_queued_rows: OrderedDict[str, float]` with 5-min TTL + 1000-entry LRU eviction. Realtime callback and backfill poller both consult `_is_recently_queued(row_id)` before the HTTP call to `sap_agent_jobs`, and both call `_mark_recently_queued(row_id)` on enqueue success or 409 (DB-level idempotency_key still wins as final guard, this just saves the round-trip). Critical for correctness: a row that was queued and FAILED can be re-tried later (entries age out, no permanent poison) AND memory is bounded (a long-running agent processing 10k rows/day doesn't accumulate 10k OrderedDict entries). (3) THROTTLED DEDUP LOGGING — `_should_log_dedup(row_id)` allows the first `[triggers] dedup: ...` line per row per minute, suppresses subsequent hits silently within the 60s window. Realtime double-fires (which happen frequently when the UI nudges a row 3-4x in seconds) no longer produce 30+ identical dedup messages — the console is finally useful for triage. New capability `trigger-backfill-poller` advertised in /health.capabilities so dashboards can show "agent self-recovers from missed events" in the capability matrix; frontend doesn't need to gate on it (purely defensive backend hardening, mirrors v1.6.7 `self-healing-schema-fallback`). v1.6.8 carry-over: Fix agent-internal dual-patcher race so `confirmed_source` / `confirmed_by_label` / `confirmed_by_agent_id` actually persist on agent-confirmed TOs. Two patchers fight on every agent-side TO confirm: `_update_putaway_status` (called from inside `confirm_transfer_order` after a successful SAP LT12) PATCHes the LEGACY 3 fields first (`to_status='TO Confirmed'`, `confirmed_at`, `confirmed_by`), then `_apply_trigger_post_patch` (called by the job poller AFTER the handler returns) used to PATCH the FULL body — same legacy 3 fields PLUS the v1.6.6 attribution columns — with a `skip_if = {to_status: 'TO Confirmed'}` filter encoded as `&to_status=neq.TO%20Confirmed`. Step 1 had already flipped `to_status='TO Confirmed'` so the filter always matched 0 rows; PostgREST returned 200 OK with empty body, the agent logged "applied", and the OVERLAY (attribution) columns stayed NULL forever. The UI then fell back to `user_profiles.full_name` for the "Confirmed By" column — looking exactly like the v1.6.6 attribution bug all over again, but rooted in agent-internal contention rather than browser/agent races. Fix: `_apply_trigger_post_patch` now applies ONLY the overlay fields (`confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`) and drops the `skip_if` filter entirely — there's no double-write risk because we're not touching `to_status`/`confirmed_at`/`confirmed_by` here, the legacy patcher owns those. New `Prefer: return=representation` lets us count rows-affected; `rows_affected == 0` now logs a WARN with the field values for diagnosability instead of silently logging "applied". The v1.6.7 self-healing `_TRIGGER_DROP_AGENT_ATTRIBUTION` cooldown is unchanged — still applies to the label + agent_id columns when migration 251 isn't yet visible to PostgREST, just stripped down to the overlay-only body. v1.6.7 carry-over: Self-healing schema-cache fallback so a transient PostgREST cache miss doesn't permanently disable feature columns. The v1.6.5 `_REGISTRY_DROP_PROCESS_STARTED_AT` and v1.6.6 `_TRIGGER_DROP_AGENT_ATTRIBUTION` boolean flags are now `_SchemaFallbackFlag` instances with a 5-minute cooldown: on the first PostgREST 400 ("Could not find the 'X' column") the flag trips and the feature column is stripped from subsequent calls, but after 5min the next call re-attempts WITH the column; if it succeeds (e.g. PostgREST cache caught up after migration 251) the flag stays cleared, if it fails the same way the cooldown restarts. Boot prints `[schema-fallback] <label>: tripped (...)` / `cooldown expired, re-attempting full schema on next call` / `cleared (full schema works again)` for full lifecycle visibility. New capability `self-healing-schema-fallback`. v1.6.6 carry-over: SAP auto-connect on boot + correct attribution for agent-side TO confirms. Two surgical improvements on top of v1.6.5. (1) SAP AUTO-CONNECT: a new daemon thread (`_start_sap_autoconnect_loop`) attempts to attach to SAP GUI immediately after FastAPI startup, then retries with exponential backoff (10 → 20 → 40 → 60s capped) until SAP is reachable. Once attached the loop sleeps short ticks; if a COM crash later flips `state.sap_connected = False` (see the LT22 import handler's defensive flip from v1.6.3) the same loop notices on the next tick and resumes the backoff retry without any explicit hook into the flip. The first attempt happens AFTER the app is listening on 8765 so /health detection works while SAP is mid-attach. Disable via `OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1` for users who want manual control. New capability `sap-auto-connect`. (2) HONEST AGENT ATTRIBUTION: when the v1.6.4 agent-side trigger flow auto-confirms a TO via `_apply_trigger_post_patch` against `rf_putaway_operations`, the patch now also sets `confirmed_by_label = "Omni Agent"` and `confirmed_by_agent_id = _agent_self_id()` (two new text columns added by migration 251). `confirmed_by` (UUID FK to `user_profiles`) still points at the JWT-holder's user_id so RLS + the existing productivity rollups (085, 156, 188, …) keep working — the new label column is the honest display value. The putaway log UI prefers `confirmed_by_label` when present so the cell shows "Omni Agent" with the bot icon instead of the user's display name. The `confirm_transfer_order` direct path (manual user click → /sap/confirm-to) is unchanged — it still credits the user as `confirmed_by` with no label, and the UI keeps rendering their full_name. v1.6.5 carry-over: stable agent_id, persistent agent_token, auth-aware detection, fleet hygiene reaper. Three fixes resolving the "agent has gotten much clunkier since v1.6.2" Citrix complaint. (1) STABLE AGENT ID: dropped the `<PID>` suffix from `_agent_self_id()` so a rebuild + restart re-uses the same `sap_agents` row instead of creating a new one each time. Format is now `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>` — same Citrix box + same Windows user = same fleet row, regardless of how many EXE rebuilds happened today. The previous PID-anchored format meant the user saw 6 entries in Agents Fleet after 4 rebuilds, with only the latest reading "online". A new `process_started_at` column (migration 250) preserves per-process debug info without polluting the primary key. (2) PERSISTENT AGENT TOKEN: the per-session `agent_token` is now minted ONCE on first boot (from `secrets.token_urlsafe(32)`) and persisted to `%APPDATA%\\OmniFrameAgent\\config.json` alongside `supabase_token`, `user_id`, `user_email`, `org_id`. Subsequent boots restore everything. `/supabase/login` no longer rotates the token — only mints if one doesn't already exist. This means the user can rebuild the EXE 100 times and the localStorage token in their browser keeps working as long as the config.json survives. New `POST /agent-token/rotate` endpoint for explicit user-driven rotation (security event). New `GET /agent-token/check` (auth-required) for the browser to verify token validity in `useAgentDetection`. (3) AUTH-AWARE DETECTION: the SAP Testing banner used to read "SAP Agent Not Detected" any time `/health` failed — but `/health` is token-exempt, so it stayed green even when every authenticated call was 401-ing on a stale token. The frontend now distinguishes `available` (process up) vs `authenticated` (token valid) and renders a yellow "Agent online but session expired" banner instead of the misleading red one. The browser also auto-clears stale tokens from localStorage on the first 401 and shows a one-shot toast pointing the user at the Connect Account dialog. v1.6.4 carry-over: agent-side trigger evaluator, Realtime auth fix, /supabase/session + /supabase/logout routes.
def _read_int_env(name: str, default: int) -> int:
    """Parse int env var; fall back to *default* on missing/invalid."""
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        print(
            f"[boot] WARN env var {name}={raw!r} is not an int — "
            f"using default {default}"
        )
        return default


AGENT_PORT = _read_int_env("OMNIFRAME_AGENT_PORT", 8765)
# Phase D2 — master-controller admin token (optional). When set, POST /admin/*
# accepts X-Agent-Token matching this value even if state.agent_token differs.
_ADMIN_ENV_TOKEN: str = os.environ.get("OMNIFRAME_AGENT_ADMIN_TOKEN", "") or ""
CONFIG_FILE = os.path.join(os.getenv("APPDATA", ""), "OmniFrameAgent", "config.json")
ALLOWED_ORIGINS = [
    "https://onebox-ai-logistics-production.up.railway.app",
    "https://omniframe.up.railway.app",
    "http://localhost:5173",
    "http://localhost:3000",
]


# ---------------------------------------------------------------------------
#  Citrix Detection
# ---------------------------------------------------------------------------
def detect_citrix() -> dict:
    """Detect if running in a Citrix session and return environment details."""
    session_name = os.getenv("SESSIONNAME", "")
    client_name = os.getenv("CLIENTNAME", "")
    ica_root = os.getenv("ICAROOT", "")
    hdx = os.getenv("CITRIX_HDX_ENABLED", "")

    is_citrix = bool(
        session_name.startswith("ICA-")
        or session_name.startswith("RDP-")
        or ica_root
        or hdx
        or client_name
    )
    return {
        "is_citrix": is_citrix,
        "session_name": session_name or None,
        "client_name": client_name or None,
        "ica_root": ica_root or None,
        "computer_name": os.getenv("COMPUTERNAME", ""),
        "user_name": os.getenv("USERNAME", ""),
    }


# ---------------------------------------------------------------------------
#  Self-Install (Tier 4)
# ---------------------------------------------------------------------------
def get_install_dir() -> str:
    return os.path.join(os.getenv("LOCALAPPDATA", ""), "OmniFrameAgent")


def get_install_exe_path() -> str:
    return os.path.join(get_install_dir(), "OmniFrame_Agent.exe")


def get_startup_shortcut_path() -> str:
    startup = os.path.join(
        os.getenv("APPDATA", ""),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup",
    )
    return os.path.join(startup, "OmniFrame Agent.lnk")


def create_shortcut(shortcut_path: str, target: str) -> bool:
    try:
        import pythoncom
        from win32com.client import Dispatch

        pythoncom.CoInitialize()
        shell = Dispatch("WScript.Shell")
        shortcut = shell.CreateShortcut(shortcut_path)
        shortcut.TargetPath = target
        shortcut.WorkingDirectory = os.path.dirname(target)
        shortcut.Description = "OmniFrame SAP Agent"
        shortcut.WindowStyle = 7  # Minimized
        shortcut.save()
        return True
    except Exception as e:
        print(f"[install] shortcut creation failed: {e}")
        return False


def install_self_if_needed() -> bool:
    """Copy self to install location and register startup shortcut.

    Returns True if installation happened (caller should exit and let
    the installed copy take over). Returns False if already running
    from the install location.
    """
    if not getattr(sys, "frozen", False):
        # Running as .py script (dev mode) - skip install
        return False

    current_exe = os.path.normpath(sys.executable)
    install_exe = os.path.normpath(get_install_exe_path())

    if current_exe.lower() == install_exe.lower():
        return False

    try:
        os.makedirs(get_install_dir(), exist_ok=True)
        shutil.copy2(current_exe, install_exe)
        print(f"[install] copied to {install_exe}")

        create_shortcut(get_startup_shortcut_path(), install_exe)
        print(f"[install] startup shortcut created")

        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        subprocess.Popen(
            [install_exe],
            creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            close_fds=True,
        )
        print(f"[install] launched installed copy, exiting")
        return True
    except Exception as e:
        print(f"[install] failed: {e}")
        return False


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        try:
            s.connect(("127.0.0.1", port))
            return True
        except (ConnectionRefusedError, socket.timeout, OSError):
            return False


# ---------------------------------------------------------------------------
#  SAP GUI COM
# ---------------------------------------------------------------------------
_sap_conn_idx = _read_int_env("OMNIFRAME_SAP_CONN_IDX", 0)
_sap_sess_idx = _read_int_env("OMNIFRAME_SAP_SESS_IDX", 0)


def _init_com():
    import pythoncom
    pythoncom.CoInitialize()
    import win32com.client
    return win32com.client


def _read_session_identity(sess) -> tuple[str, str, str]:
    """Read (system, client, user) from a SAP session, defensive against
    the COM throwing on a half-initialised session. Empty strings on
    failure. v1.7.9 — used by both the pin matcher and `/sap/sessions`
    so the criteria the user pinned-by are visible to the picker."""
    try:
        info = sess.Info
        return (
            info.SystemName or "",
            info.Client or "",
            info.User or "",
        )
    except Exception:
        return ("", "", "")


def _find_pinned_session(app_obj) -> tuple[int, int] | tuple[None, None]:
    """v1.7.9 — locate the currently-pinned SAP session in the live
    Scripting Engine tree. Two-strategy lookup:

      1. Try `(pin.conn_idx, pin.sess_idx)` directly. If the indexes
         resolve AND the session's identity (system/client/user) still
         matches the pinned criteria, return them — fast path.
      2. If `pin.by_criteria` is True (default), scan every session
         and return the first one whose identity matches the pinned
         system + client + user. SAP renumbers session indexes across
         GUI restart so the criteria match is the durable identity.

    Returns (None, None) if the pinned session is not currently
    available — the caller MUST stay disconnected rather than silently
    auto-select a different session.
    """
    pin = state.pinned_session
    if not pin:
        return None, None

    sys_want = str(pin.get("system", ""))
    client_want = str(pin.get("client", ""))
    user_want = str(pin.get("user", ""))

    # Strategy 1 — pinned indexes (fast path).
    try:
        ci_pin = int(pin.get("conn_idx", -1))
        si_pin = int(pin.get("sess_idx", -1))
        if ci_pin >= 0 and si_pin >= 0:
            c = app_obj.Children(ci_pin)
            s = c.Children(si_pin)
            s.findById("wnd[0]")
            sys_now, client_now, user_now = _read_session_identity(s)
            # Indexes resolved. If criteria still match (or we never
            # captured criteria), accept. Otherwise fall through to
            # the criteria-match scan — SAP slot stayed but a different
            # system/user is now logged in there.
            if (
                (sys_now == sys_want or not sys_want)
                and (client_now == client_want or not client_want)
                and (user_now == user_want or not user_want)
            ):
                return ci_pin, si_pin
    except Exception:
        pass

    # Strategy 2 — criteria scan.
    if not pin.get("by_criteria", True):
        return None, None
    try:
        total = app_obj.Children.Count
        for ci in range(total):
            try:
                c = app_obj.Children(ci)
                n = c.Children.Count
                for si in range(n):
                    try:
                        s = c.Children(si)
                        s.findById("wnd[0]")
                        sys_now, client_now, user_now = _read_session_identity(s)
                        if (
                            sys_now == sys_want
                            and client_now == client_want
                            and user_now == user_want
                        ):
                            return ci, si
                    except Exception:
                        continue
            except Exception:
                continue
    except Exception:
        pass
    return None, None


def _auto_select_valid_session() -> tuple[int, int] | tuple[None, None]:
    """Scan all SAP connections and return the first (conn_idx, sess_idx)
    that has a usable session. Returns (None, None) if nothing found.
    Used to avoid attaching to the SAP Logon Pad (no sessions) or stale
    connections.

    v1.7.9 — when `state.pinned_session` is set, this function ONLY
    returns the pinned session (matched by exact indexes or by
    system/client/user criteria via `_find_pinned_session`). It does NOT
    silently fall back to a different session — the agent will stay
    disconnected until the pinned session reappears. Use
    POST /sap/unpin-session to release the pin and resume auto-select.
    """
    try:
        w32 = _init_com()
        sap_gui = w32.GetObject("SAPGUI")
        app = sap_gui.GetScriptingEngine

        if state.pinned_session:
            ci, si = _find_pinned_session(app)
            if ci is None:
                pin = state.pinned_session
                print(
                    f"[sap]   PINNED session (sys={pin.get('system','?')} "
                    f"client={pin.get('client','?')} "
                    f"user={pin.get('user','?')}) not currently available "
                    f"— agent will retry on next auto-connect tick. Use "
                    f"POST /sap/unpin-session to release the pin."
                )
                return None, None
            return ci, si

        total = app.Children.Count
        for ci in range(total):
            try:
                c = app.Children(ci)
                n = c.Children.Count
                if n <= 0:
                    continue
                try:
                    s = c.Children(0)
                    s.findById("wnd[0]")
                    return ci, 0
                except Exception:
                    continue
            except Exception:
                continue
    except Exception:
        pass
    return None, None


def _get_sap_session():
    """Get the currently-selected SAP session. If the selection is
    invalid (e.g. user closed it, or it's the Logon Pad with no sessions),
    auto-pick the first valid session and retry once."""
    global _sap_conn_idx, _sap_sess_idx
    w32 = _init_com()
    sap_gui = w32.GetObject("SAPGUI")
    app = sap_gui.GetScriptingEngine
    try:
        conn = app.Children(_sap_conn_idx)
        sess = conn.Children(_sap_sess_idx)
        # Verify usable main window
        sess.findById("wnd[0]")
        return sess, conn
    except Exception as first_err:
        # Auto-fallback: find any connection with a session
        ci, si = _auto_select_valid_session()
        if ci is None:
            raise Exception(
                "No active SAP GUI session found. Please log in to an SAP "
                "system first (open SAP Logon, double-click a system, and "
                "sign in). Detail: " + str(first_err)
            )
        print(f"[sap]   Auto-selected valid session: conn={ci}, sess={si} "
              f"(previous {_sap_conn_idx},{_sap_sess_idx} was invalid)")
        _sap_conn_idx = ci
        _sap_sess_idx = si
        conn = app.Children(ci)
        sess = conn.Children(si)
        return sess, conn


def _wait_for_session(sess, timeout_sec: int = 15) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            if not sess.Busy:
                sess.findById("wnd[0]")
                return
        except Exception:
            pass
        time.sleep(0.5)


def _wait_for_control(sess, control_id: str, timeout_sec: int = 20) -> bool:
    """Wait until a specific SAP control exists. Returns True if found,
    False if timeout. Use this after transitions where we know what element
    should appear next - survives SAP scripting popups that briefly pause
    the script."""
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            sess.findById(control_id)
            return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


# ---------------------------------------------------------------------------
#  Agent Service State
# ---------------------------------------------------------------------------
class AgentState:
    def __init__(self):
        self.sap_connected: bool = False
        self.supabase_url: str = ""
        self.supabase_key: str = ""
        self.supabase_token: str = ""
        # v1.7.2 — JWT lifecycle. The Supabase access token returned by
        # `/auth/v1/token?grant_type=password` expires after ~1h; without
        # the refresh token we silently degrade every authenticated path
        # (job claim / complete / fail, heartbeat, registry upsert,
        # trigger enqueue, backfill query) until the user re-launches
        # the Connect Account dialog. We now persist BOTH tokens plus
        # the absolute expiry so a process restart can resume the
        # session without re-prompting. `_refresh_supabase_token_if_needed`
        # gates every outbound `_supabase_request` call: if the token is
        # within `_TOKEN_REFRESH_LEEWAY_SECONDS` of expiry we POST to
        # `/auth/v1/token?grant_type=refresh_token` and rewrite the
        # cached values BEFORE issuing the real request. Lock guards
        # against the same refresh racing the heartbeat + poller threads.
        self.refresh_token: str = ""
        self.token_expires_at: float = 0.0  # epoch seconds; 0 = unknown
        self.token_refresh_lock: threading.Lock = threading.Lock()
        self.user_id: str = ""
        self.org_id: str = ""
        self.user_email: str = ""
        self.started_at: str = datetime.utcnow().isoformat() + "Z"
        # Per-machine agent token. Was previously per-LOGIN (rotated on every
        # /supabase/login) which meant every browser refresh + every EXE
        # rebuild invalidated the token in localStorage and forced the user
        # back through the Connect Account dialog. v1.6.5 mints once on
        # first boot (or rehydrates from config.json on subsequent boots)
        # and only ever rotates via the explicit POST /agent-token/rotate
        # endpoint. /health remains exempt so detection probes still work.
        self.agent_token: str = ""
        # v1.7.0 — single-source-of-truth for the job currently dispatching
        # on the SAP COM thread. `active_job_id` is the row being worked;
        # `active_job_started_at` is the epoch second it was claimed.
        # Previously the poller read `_job_poller_state["current_job_id"]`
        # which was cleared only at the END of the dispatch path — if a
        # SAP COM call hung inside a handler, the state dict kept saying
        # "nothing running" while the poller was actually blocked in the
        # handler. We now ALSO track a second field on AgentState that
        # (a) the watchdog reads to decide if a job is stuck, (b) the
        # job poller consults before claiming to enforce single-flight
        # dispatch even if a future callsite forgets to clear it. The
        # lock protects read-modify-write cycles across the poller
        # thread + the watchdog thread. See [[Patterns/Job-Queue-Drain-Mode]]
        # and [[Debug/Fix-Agent-Throughput-Latency]].
        self.active_job_id: Optional[str] = None
        self.active_job_started_at: Optional[float] = None
        # v2.1.0 — last SAP-side progress tick for master stale-job watchdog
        self.active_job_progress_at: Optional[float] = None
        # 2026-05-31 — endpoint of the active job, so the stuck-job watchdog can
        # apply a per-endpoint timeout. Long SAP fan-outs (LL01 5 plants × 7
        # categories ~5min; LX25 5-warehouse loop) legitimately run for minutes,
        # so the 120s default would mis-fire on them as a "SAP session hang".
        self.active_job_endpoint: Optional[str] = None
        self.active_job_lock: threading.Lock = threading.Lock()
        # v2.1.0 — typed SAP attach failure for /health.last_sap_error
        self.last_sap_error: Optional[str] = None
        # v1.7.1 — Realtime circuit-breaker fallback flag. When the
        # Realtime subsystem trips its error budget (20 errors / 60s) the
        # circuit breaker calls `_disable_realtime_subsystem()` which
        # sets this flag, tears down the WebSocket client, and tightens
        # the job poller's idle backoff so we don't lose throughput while
        # the trigger backfill poller carries missed-event load. The
        # `_start_realtime_circuit_reset_loop` daemon resets the breaker
        # + flips this flag back to False every 5min so a transient
        # Citrix VDA hibernate / corporate proxy idle close auto-recovers.
        # Read by the job poller's idle-backoff calc and by `/status`.
        # See [[Patterns/Async-Library-Circuit-Breaker]] +
        # [[Debug/Fix-Realtime-Library-CrashLoop]].
        self.realtime_disabled: bool = False
        # v1.7.8 — Adaptive heartbeat throttling + Realtime-aware backfill.
        # `last_job_completed_at` lets the heartbeat thread bump its cadence
        # from 30s → 60s when the agent has been idle for >5min (no active
        # job AND no recent completion). Active-job heartbeats stay at 30s
        # so lease bumps remain snappy. Initialised to the boot time so a
        # freshly-launched agent doesn't immediately enter the slow lane.
        # See [[Implementations/Implement-Agent-DB-Load-Reduction]].
        self.last_job_completed_at: float = time.time()
        # v1.7.8 — Tracks when the Realtime asyncio callback last delivered
        # an event. The trigger backfill poller skips its periodic query
        # when this is recent (<2min) AND the circuit breaker has not
        # tripped — Realtime is the authoritative source in that mode and
        # the poll is purely redundant DB load. Initialised to 0.0 so the
        # first poll runs unconditionally on a cold start.
        self.last_realtime_event_at: float = 0.0
        # Phase 7 (rust-work-service integration plan, 2026-05-06).
        # Cached at boot from `OMNIFRAME_WORK_SERVICE_URL` (default:
        # production Railway URL). All Phase 7 callsites use this
        # field so a future runtime mutation (e.g. /admin/url-rewrite
        # endpoint, swap to a sibling deploy for canary testing) is a
        # one-shot setattr instead of touching every callsite.
        # `_work_service_url_base()` is the canonical reader.
        self.work_service_url: str = os.environ.get(
            "OMNIFRAME_WORK_SERVICE_URL",
            "https://rust-work-service-production.up.railway.app",
        ).rstrip("/")
        # v1.7.9 — SAP session pin. When set, the agent is bound to one
        # specific SAP GUI session and `_auto_select_valid_session` will
        # NOT silently jump to a different session if the pinned one
        # disappears. Shape (when set):
        #   {
        #     "conn_idx": int,           # last-known SAP scripting index
        #     "sess_idx": int,           # last-known SAP scripting index
        #     "system":   str,           # session.Info.SystemName
        #     "client":   str,           # session.Info.Client
        #     "user":     str,           # session.Info.User
        #     "pinned_at": ISO 8601 str, # for diagnostic display
        #     "by_criteria": bool,       # if True, scan-by-criteria fallback
        #                                # is used when (conn_idx, sess_idx)
        #                                # is no longer valid (SAP renumbers
        #                                # sessions across restart). Default
        #                                # True. When False, ONLY the exact
        #                                # indexes are tried.
        #   }
        # When None: no pin — `_auto_select_valid_session` returns the
        # first usable session as before (default v1.7.8 behaviour).
        # Persisted in config.json by `persist_config()` so the pin
        # survives EXE rebuild + restart. See [[Implement-SAP-Session-Pinning]].
        self.pinned_session: Optional[dict] = None
        # Phase 6 (rust-work-service integration plan, 2026-05-07) —
        # fleet-wide live console streaming. `_log(level, message)`
        # appends `(level, message, ts_iso)` tuples here; the
        # `_console_relay_thread` daemon drains in batches and POSTs
        # to `rust-work-service /api/v1/sap-console/lines`. Bounded by
        # `_CONSOLE_RELAY_BUFFER_CAP` so a sustained network outage
        # can't OOM the agent — the deque silently drops the oldest
        # entries when full (collections.deque(maxlen=...) is the
        # canonical Python ring-buffer). Off until
        # `OMNIFRAME_AGENT_CONSOLE_RELAY=1`.
        self.console_buffer: deque = deque(maxlen=_CONSOLE_RELAY_BUFFER_CAP)
        self.console_buffer_lock: threading.Lock = threading.Lock()
        # Phase 10 (rust-work-service integration plan, 2026-05-07) —
        # agent identity v2. `agent_service_key` is the on-disk
        # plaintext `omni_sk_*` value loaded from
        # `_AGENT_SERVICE_KEY_PATH` at boot; empty string until the
        # admin registers + drops it on this machine. The JWT trio
        # (`work_service_jwt` / `work_service_jwt_expires_at` /
        # `work_service_jwt_org_id`) is the result of trading
        # `agent_service_key` at `POST /api/v1/agent-identity/exchange`
        # — a 15-min token signed by `WORK_SERVICE_AGENT_JWT_SECRET`
        # that the WS subscribe-token mint + every Phase 7
        # `_work_service_request` prefers over the legacy user JWT.
        # Refreshed by `_start_work_service_jwt_refresh_thread`
        # every 60s; cleared on shutdown so a process restart picks
        # up a fresh token.
        self.agent_service_key: str = ""
        self.work_service_jwt: str = ""
        self.work_service_jwt_expires_at: float = 0.0
        self.work_service_jwt_org_id: str = ""
        self.load_config()

    def load_config(self):
        """Rehydrate the full agent session from %APPDATA%\\OmniFrameAgent\\config.json.

        v1.6.5: persists/restores `agent_token` + `supabase_token` + `user_id`
        / `user_email` / `org_id` in addition to the URL + anon key. This is
        the foundation for "EXE rebuilds + browser refreshes don't kick the
        user out" — the per-machine agent token survives across process
        restarts so the localStorage value in the browser stays valid.
        """
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r") as f:
                    cfg = json.load(f)
                self.supabase_url = cfg.get("supabase_url", "")
                self.supabase_key = cfg.get("supabase_anon_key", "")
                self.supabase_token = cfg.get("supabase_token", "")
                # v1.7.2 — JWT lifecycle. Older config.json files (pre-1.7.2)
                # don't carry these keys — `.get(..., "")` / `.get(..., 0.0)`
                # is the harmless fallback so on first boot after upgrade
                # we'll just behave like v1.7.1 (no refresh) until the next
                # /supabase/login call lands and writes the new fields.
                self.refresh_token = cfg.get("refresh_token", "")
                try:
                    self.token_expires_at = float(cfg.get("token_expires_at", 0.0) or 0.0)
                except (TypeError, ValueError):
                    self.token_expires_at = 0.0
                self.user_id = cfg.get("user_id", "")
                self.user_email = cfg.get("user_email", "")
                self.org_id = cfg.get("org_id", "")
                self.agent_token = cfg.get("agent_token", "")
                # v1.7.9 — SAP session pin. Older config.json files
                # (pre-1.7.9) won't carry this key — `.get(..., None)`
                # is the harmless fallback, behaviour stays auto-select.
                pinned = cfg.get("pinned_session")
                if isinstance(pinned, dict):
                    self.pinned_session = pinned
                else:
                    self.pinned_session = None
        except Exception:
            pass

    def persist_config(self):
        """Write the full session blob. Called from /supabase/login,
        /supabase/logout, /agent-token/rotate, and the first-boot mint
        in main(). Best-effort: filesystem failures are swallowed so a
        permission-denied APPDATA can't crash the agent — the user just
        loses persistence across this run."""
        try:
            os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
            with open(CONFIG_FILE, "w") as f:
                json.dump(
                    {
                        "supabase_url": self.supabase_url,
                        "supabase_anon_key": self.supabase_key,
                        "supabase_token": self.supabase_token,
                        "refresh_token": self.refresh_token,
                        "token_expires_at": self.token_expires_at,
                        "user_id": self.user_id,
                        "user_email": self.user_email,
                        "org_id": self.org_id,
                        "agent_token": self.agent_token,
                        # v1.7.9 — SAP session pin. None when auto-select
                        # is active; dict (see AgentState.__init__ for the
                        # shape) when bound to a specific SAP session.
                        "pinned_session": self.pinned_session,
                    },
                    f,
                )
        except Exception:
            pass


state = AgentState()


def _ensure_persistent_agent_token() -> bool:
    """v1.6.5 — mint a stable per-machine `agent_token` if config.json
    didn't already have one. Called once at module load AFTER `state` is
    constructed. Returns True if a fresh token was minted (so the boot
    banner can flag it), False if we rehydrated an existing token.

    Once minted, the same token survives EXE rebuilds, restarts, and
    `/supabase/login` calls. Only `POST /agent-token/rotate` (or a manual
    delete of config.json) replaces it.
    """
    if state.agent_token:
        return False
    # `token_urlsafe(32)` ⇒ 43 char base64url string, 256 bits of entropy.
    # URL-safe so it's also safe in JSON bodies and HTTP headers without
    # quoting concerns; matches the localStorage key shape on the frontend.
    state.agent_token = secrets.token_urlsafe(32)
    state.persist_config()
    return True


_AGENT_TOKEN_FRESHLY_MINTED = _ensure_persistent_agent_token()


def _ensure_agent_identity_v2_bootstrap() -> None:
    """Phase 10 (rust-work-service integration plan, 2026-05-07) —
    Read the agent service key off disk + advertise the active auth
    path in the boot banner. Defined here next to the `state` init
    block for narrative continuity, but the actual call site is
    moved to AFTER `_bootstrap_agent_identity_v2` is defined further
    down (Phase 10 helper block). The original v2.0.0 ship had the
    invocation here, which raised `NameError` because the helper
    chain (`_load_agent_service_key`, `_exchange_service_key_for_jwt`,
    `_bootstrap_agent_identity_v2`) is defined ~300 lines lower.
    Caught by the post-rebuild Citrix run on 2026-05-07
    (`USINDPR-CXA103V`) — see
    [[Debug/Fix-Phase10-Bootstrap-NameError]].
    """
    try:
        _bootstrap_agent_identity_v2()
    except Exception as e:  # pragma: no cover — boot path defensive
        print(f"[boot]   Agent identity v2 bootstrap raised: {e!r} (continuing)")


def _seed_sap_indices_from_env() -> None:
    """v2.1.0 — master-spawned workers seed COM indices from env before pin restore."""
    global _sap_conn_idx, _sap_sess_idx
    if os.environ.get("OMNIFRAME_SAP_CONN_IDX"):
        _sap_conn_idx = _read_int_env("OMNIFRAME_SAP_CONN_IDX", 0)
    if os.environ.get("OMNIFRAME_SAP_SESS_IDX"):
        _sap_sess_idx = _read_int_env("OMNIFRAME_SAP_SESS_IDX", 0)


def _restore_pinned_session_indexes() -> None:
    """v1.7.9 + v2.1.0 — config.json pin seeds indices unless master env overrides."""
    global _sap_conn_idx, _sap_sess_idx
    if os.environ.get("OMNIFRAME_SAP_CONN_IDX") or os.environ.get(
        "OMNIFRAME_SAP_SESS_IDX"
    ):
        return
    pin = state.pinned_session
    if not pin:
        return
    try:
        ci = int(pin.get("conn_idx", 0))
        si = int(pin.get("sess_idx", 0))
        if ci >= 0:
            _sap_conn_idx = ci
        if si >= 0:
            _sap_sess_idx = si
    except Exception:
        pass


_seed_sap_indices_from_env()
_restore_pinned_session_indexes()


# ---------------------------------------------------------------------------
#  Phase 10 — Agent Identity v2 (rust-work-service service-key auth)
# ---------------------------------------------------------------------------
#
# The agent now owns its OWN credentials. A long-lived `omni_sk_*`
# plaintext key sits on disk on the Citrix box (default
# `~/.omniframe/agent_service_key.txt` on POSIX,
# `%USERPROFILE%\.omniframe\agent_service_key.txt` on Windows). At
# boot we POST it to `rust-work-service /api/v1/agent-identity/exchange`
# and receive a 15-min `kind: "agent"` JWT signed by
# `WORK_SERVICE_AGENT_JWT_SECRET`. A background thread refreshes the
# JWT ~60s before expiry; the WS subscribe-token mint (Phase 4) and
# every `_work_service_request` (Phase 7) prefer this JWT over the
# legacy user JWT inherited from the user's Supabase session.
#
# Backward compatibility: if no service key file exists, the agent
# logs a clear "Visit Settings → Agents to register a key" message
# and continues running on the legacy user-JWT path. Phase 11 owns
# the cleanup that deletes the legacy path entirely.
#
# Plan ref: `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`
# Phase 10 + `Decisions/ADR-Agent-Identity-V2-Phase10.md`.

_AGENT_SERVICE_KEY_PATH: str = os.environ.get(
    "OMNIFRAME_AGENT_SERVICE_KEY_PATH",
    os.path.join(os.path.expanduser("~"), ".omniframe", "agent_service_key.txt"),
)

# v2.0.0 post-release hot-fix (2026-05-07) — multi-path service-key
# search. The canonical Phase 10 path above (`~/.omniframe/...`) is
# the persistent home for the key, but operators that ship a fresh
# .exe alongside a registered key file (the build-folder hand-off
# pattern in `build_exe.bat`) need the agent to find the key on
# first boot WITHOUT the operator having to remember to also drop a
# copy at `%USERPROFILE%\.omniframe\`. The loader below checks, in
# priority order:
#
#   1. `OMNIFRAME_AGENT_SERVICE_KEY` env var — literal key value;
#      highest precedence; useful for ephemeral testing or systemd-
#      style secrets injection where the key never touches disk.
#   2. `OMNIFRAME_AGENT_SERVICE_KEY_PATH` (`_AGENT_SERVICE_KEY_PATH`
#      above) — canonical, surfaces in the runbook
#      ([[Implement-Phase10-Service-Key-First-Rollout]] step 3),
#      survives .exe rebuilds because nothing in `build_exe.bat`
#      touches `%USERPROFILE%\.omniframe\`.
#   3. `<exe-or-script-directory>/agent_service_key.txt` — alongside
#      the running binary; convenient for portable installs and dev
#      builds where the operator already has the key in the build
#      folder. On first successful load from #3 we PROMOTE the file
#      to #2 so future .exe rebuilds can replace the binary without
#      re-registration.
#
# The alongside-exe slot is intentionally NOT bundled into the
# PyInstaller `.spec` — `OmniFrame_Agent.spec` passes `agent.py`
# only, so the key never lands in the distributed `.exe`. Bundling
# would leak the per-agent credential to every download of the
# binary; see [[Implement-Phase10-Service-Key-First-Rollout]]
# §"Repository hygiene" for the security envelope.
_AGENT_SERVICE_KEY_ENV_VAR: str = "OMNIFRAME_AGENT_SERVICE_KEY"

# Track which slot resolved the key so 401-on-exchange can name a
# concrete file path in the "delete the stale local copy" warning.
# Mirrors the `_console_relay_state` shape — a dict so a future
# `/status` debug endpoint can introspect it.
_agent_service_key_source: dict[str, Any] = {
    "slot": "",  # "env" | "canonical" | "alongside-exe" | ""
    "path": "",  # filesystem path when slot is canonical / alongside-exe
}


def _alongside_exe_dir() -> str:
    """Return the directory containing the running entry point.

    PyInstaller-frozen .exe → `os.path.dirname(sys.executable)`
    (sys.argv[0] also works in onefile mode but `sys.executable`
    survives an `argv[0]` rewrite by a Windows shell wrapper).

    Dev / source run → `os.path.dirname(os.path.abspath(__file__))`
    so a developer running `python agent.py` from
    `omni_agent/` can keep a key file in the same folder for
    one-off tests without polluting the canonical location.
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def _alongside_exe_key_path() -> str:
    return os.path.join(_alongside_exe_dir(), "agent_service_key.txt")


def _read_service_key_file(path: str) -> Optional[str]:
    """Shared file reader for slots 2 + 3. Trims whitespace,
    rejects empty / non-`omni_sk_` content with a clear log line,
    swallows disk errors with a single warning.
    """
    try:
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if not raw:
            return None
        if not raw.startswith("omni_sk_"):
            print(
                f"[agent-identity] WARN service key at {path} does not "
                "start with 'omni_sk_' — refusing to use it. Re-register "
                "via the admin UI."
            )
            return None
        return raw
    except Exception as e:  # pragma: no cover — disk error path
        print(f"[agent-identity] WARN failed to read service key at {path}: {e!r}")
        return None


def _promote_service_key_to_canonical(source_path: str, key: str) -> bool:
    """Copy the alongside-exe key to the canonical
    `~/.omniframe/agent_service_key.txt` location, creating
    `~/.omniframe/` if absent. Returns True on success so the
    caller can log the promotion. Best-effort — a disk failure
    here just means the next boot will repeat the alongside-exe
    discovery, which is harmless.

    POSIX gets `0o700` on the directory and `0o600` on the file
    so a multi-user dev box doesn't leak the credential to other
    accounts. On Windows `os.chmod` is largely a no-op for ACLs
    (the runbook's `icacls` lockdown is the right tool there);
    we still call it because Python tolerates the no-op and the
    attempted-mode line in the log is useful in mixed POSIX/
    Windows environments.
    """
    canonical = _AGENT_SERVICE_KEY_PATH
    if os.path.exists(canonical):
        # Defence-in-depth: never overwrite a present canonical
        # file from the alongside-exe copy; the canonical is the
        # source of truth.
        return False
    try:
        canonical_dir = os.path.dirname(canonical)
        if canonical_dir and not os.path.exists(canonical_dir):
            os.makedirs(canonical_dir, exist_ok=True)
            try:
                os.chmod(canonical_dir, 0o700)
            except Exception:  # pragma: no cover — Windows ACLs path
                pass
        shutil.copyfile(source_path, canonical)
        try:
            os.chmod(canonical, 0o600)
        except Exception:  # pragma: no cover — Windows ACLs path
            pass
        return True
    except Exception as e:  # pragma: no cover — disk-full / perms path
        print(
            f"[agent-identity] WARN promotion to canonical path "
            f"{canonical} failed: {e!r}. Future boots will keep "
            f"reading from {source_path} until the canonical copy "
            "is created manually."
        )
        return False

# Refresh ~60s before expiry so a slow tick can't fire requests with
# a dead token. JWT TTL on the server is 900s (15 min) — leeway here
# matches `_TOKEN_REFRESH_LEEWAY_SECONDS` for the legacy Supabase
# refresh path.
_WORK_SERVICE_JWT_REFRESH_LEEWAY_SECONDS: float = 60.0

# Cooldown after a failed exchange so a corp-proxy blackout doesn't
# hammer the work-service. Matches the rate-limit window on the
# server side (5 attempts / hour) — at one attempt every 30s we'd
# burn the budget in 2.5 minutes.
_WORK_SERVICE_JWT_REFRESH_FAILURE_COOLDOWN_SECONDS: float = 60.0

# State holder for the refresh thread. Mirrors `_console_relay_state`
# / `_realtime_state` shape so a `/status` debug endpoint can
# introspect it later without restructuring.
_work_service_jwt_state: dict[str, Any] = {
    "thread": None,
    "stop_event": None,
    "active": False,
    "last_attempt_at": 0.0,
    "last_failure_at": 0.0,
    "successes": 0,
    "failures": 0,
}
_work_service_jwt_lock = threading.Lock()


def _load_agent_service_key() -> Optional[str]:
    """Read the plaintext `omni_sk_*` key. Returns None when no slot
    yields a valid key; callers fall back to the legacy user-JWT path.

    Search order (highest precedence first):

      1. `OMNIFRAME_AGENT_SERVICE_KEY` env var — literal value.
      2. `_AGENT_SERVICE_KEY_PATH` (canonical, default
         `~/.omniframe/agent_service_key.txt`).
      3. `<exe-or-script-dir>/agent_service_key.txt` — alongside the
         running binary. On first successful load from this slot we
         promote the file to slot #2 so future `.exe` swaps don't
         require re-registration.

    The matched slot is recorded in `_agent_service_key_source` so
    the 401-on-exchange handler can point the operator at the
    concrete stale file. Trims whitespace so an editor-saved file
    with a trailing `\\n` doesn't trip the `omni_sk_` prefix check.
    """
    env_key = os.environ.get(_AGENT_SERVICE_KEY_ENV_VAR, "").strip()
    if env_key:
        if not env_key.startswith("omni_sk_"):
            print(
                f"[agent-identity] WARN {_AGENT_SERVICE_KEY_ENV_VAR} "
                "does not start with 'omni_sk_' — refusing to use "
                "it. Unset the env var or set a properly-shaped key."
            )
        else:
            _agent_service_key_source["slot"] = "env"
            _agent_service_key_source["path"] = ""
            print(
                f"[agent-identity] Loaded service key from "
                f"{_AGENT_SERVICE_KEY_ENV_VAR} env var (literal value, "
                "highest precedence). On-disk key files (canonical and "
                "alongside-exe) ignored for this run."
            )
            return env_key

    canonical_key = _read_service_key_file(_AGENT_SERVICE_KEY_PATH)
    if canonical_key:
        _agent_service_key_source["slot"] = "canonical"
        _agent_service_key_source["path"] = _AGENT_SERVICE_KEY_PATH
        return canonical_key

    alongside_path = _alongside_exe_key_path()
    # Resolve to absolute paths before comparing — `_alongside_exe_dir()`
    # is already absolute, but `_AGENT_SERVICE_KEY_PATH` may pass through
    # `os.path.expanduser` only, leaving `os.path.normcase` differences
    # on Windows. Skip the alongside slot if it's literally the canonical
    # path to avoid double-reading (rare; only happens when an operator
    # sets `OMNIFRAME_AGENT_SERVICE_KEY_PATH` to point at the .exe dir).
    try:
        same = os.path.normcase(os.path.normpath(alongside_path)) == os.path.normcase(
            os.path.normpath(_AGENT_SERVICE_KEY_PATH)
        )
    except Exception:
        same = False
    if same:
        return None

    alongside_key = _read_service_key_file(alongside_path)
    if alongside_key:
        _agent_service_key_source["slot"] = "alongside-exe"
        _agent_service_key_source["path"] = alongside_path
        print(
            f"[boot] Service key found alongside .exe at {alongside_path}"
        )
        promoted = _promote_service_key_to_canonical(alongside_path, alongside_key)
        if promoted:
            print(
                f"[boot] Promoted to canonical location "
                f"{_AGENT_SERVICE_KEY_PATH} (mode 0o600)"
            )
            print(
                "[boot] Future agent updates can replace the .exe "
                "without re-registration; the key now persists at "
                "the canonical path."
            )
            # After successful promotion, narrate via the canonical
            # slot so future logs (e.g. the 401-on-exchange warning)
            # point operators at the durable copy rather than the
            # build-folder copy that may get clobbered on the next
            # robocopy.
            _agent_service_key_source["slot"] = "canonical"
            _agent_service_key_source["path"] = _AGENT_SERVICE_KEY_PATH
        return alongside_key

    return None


def _exchange_service_key_for_jwt(service_key: str) -> bool:
    """Trade `service_key` for a short-lived agent JWT via the work
    service. On success, writes `state.work_service_jwt`,
    `state.work_service_jwt_expires_at`, `state.work_service_jwt_org_id`
    and returns True. On failure, logs once and returns False — the
    caller may try again on the next refresh tick.
    """
    base = _work_service_url_base().rstrip("/")
    url = f"{base}/api/v1/agent-identity/exchange"
    body = {"agent_id": _agent_self_id(), "service_key": service_key}
    try:
        resp = requests.post(
            url,
            json=body,
            timeout=_DEFAULT_HTTP_TIMEOUT_SEC,
            verify=_SSL_VERIFY,
        )
    except Exception as e:
        print(f"[agent-identity] exchange request failed: {e!r}")
        return False
    if resp.status_code == 429:
        # Rate limit — back off until the server's `Retry-After`
        # window elapses. We respect the header but cap to 1 h so a
        # buggy server can't park us forever.
        retry = resp.headers.get("Retry-After", "60")
        try:
            secs = min(3600, int(retry))
        except (TypeError, ValueError):
            secs = 60
        print(
            f"[agent-identity] exchange rate-limited (HTTP 429); "
            f"retrying after {secs}s. Verify the agent_id + service "
            "key match a registered active key."
        )
        with _work_service_jwt_lock:
            _work_service_jwt_state["last_failure_at"] = time.time() + secs
            _work_service_jwt_state["failures"] = (
                int(_work_service_jwt_state.get("failures", 0)) + 1
            )
        return False
    if resp.status_code in (401, 403):
        # 401 = invalid_credentials (key revoked or never matched a
        # row); 403 = unknown_agent (key valid but `agent_id` mismatch).
        # Either way the on-disk key is now useless — name the slot in
        # the warning so the operator knows which file to delete +
        # re-register. We deliberately DO NOT auto-delete: a transient
        # server-side bug that returns 401 spuriously must not cost
        # the operator their key.
        body_preview = (resp.text or "")[:200]
        slot = _agent_service_key_source.get("slot", "")
        path = _agent_service_key_source.get("path", "")
        if slot == "env":
            disposition = (
                f"loaded from {_AGENT_SERVICE_KEY_ENV_VAR} env var — "
                "unset the env var, register a new key in the admin UI, "
                "and either re-export the new value or save it to "
                f"{_AGENT_SERVICE_KEY_PATH} before the next boot"
            )
        elif slot in ("canonical", "alongside-exe") and path:
            disposition = (
                f"loaded from {path} — DELETE this file (it is now "
                "stale), register a fresh key in Settings → Agents, "
                f"and save the new plaintext to {_AGENT_SERVICE_KEY_PATH}"
            )
        else:
            disposition = (
                "source slot unknown — re-register in Settings → "
                f"Agents and save the new key to {_AGENT_SERVICE_KEY_PATH}"
            )
        print(
            f"[agent-identity] exchange REJECTED (HTTP {resp.status_code}): "
            f"{body_preview}. The on-disk service key was "
            f"{disposition}. The agent will fall back to the legacy "
            "user-JWT path until a fresh key is configured."
        )
        with _work_service_jwt_lock:
            _work_service_jwt_state["last_failure_at"] = time.time()
            _work_service_jwt_state["failures"] = (
                int(_work_service_jwt_state.get("failures", 0)) + 1
            )
        return False
    if resp.status_code >= 400:
        body_preview = (resp.text or "")[:200]
        print(
            f"[agent-identity] exchange failed (HTTP {resp.status_code}): "
            f"{body_preview}. Confirm the agent_id matches what was "
            "entered in the admin UI when the key was registered."
        )
        with _work_service_jwt_lock:
            _work_service_jwt_state["last_failure_at"] = time.time()
            _work_service_jwt_state["failures"] = (
                int(_work_service_jwt_state.get("failures", 0)) + 1
            )
        return False
    try:
        data = resp.json()
    except Exception:
        print("[agent-identity] exchange response was not JSON; treating as failure")
        with _work_service_jwt_lock:
            _work_service_jwt_state["last_failure_at"] = time.time()
            _work_service_jwt_state["failures"] = (
                int(_work_service_jwt_state.get("failures", 0)) + 1
            )
        return False
    access_token = data.get("access_token", "") or ""
    expires_in = int(data.get("expires_in", 0) or 0)
    org_id = data.get("organization_id", "") or ""
    if not access_token or not org_id:
        print("[agent-identity] exchange response missing access_token/organization_id")
        with _work_service_jwt_lock:
            _work_service_jwt_state["last_failure_at"] = time.time()
            _work_service_jwt_state["failures"] = (
                int(_work_service_jwt_state.get("failures", 0)) + 1
            )
        return False
    state.work_service_jwt = access_token
    state.work_service_jwt_expires_at = (
        time.time() + expires_in if expires_in > 0 else 0.0
    )
    state.work_service_jwt_org_id = org_id
    with _work_service_jwt_lock:
        _work_service_jwt_state["successes"] = (
            int(_work_service_jwt_state.get("successes", 0)) + 1
        )
    print(
        f"[agent-identity] Exchanged service key for agent JWT "
        f"(expires_in={expires_in}s, org={org_id}). All "
        f"_work_service_request + WS subscribe-token calls now use "
        "the agent JWT instead of the user JWT."
    )
    return True


def _refresh_work_service_jwt_if_needed() -> bool:
    """Roll `state.work_service_jwt` if it's within
    `_WORK_SERVICE_JWT_REFRESH_LEEWAY_SECONDS` of expiry. Returns
    True when a refresh ran (regardless of outcome), False when the
    cached token is still good or no service key is configured.
    """
    if not state.agent_service_key:
        return False
    now = time.time()
    expires_at = state.work_service_jwt_expires_at
    if state.work_service_jwt and expires_at > 0:
        if (expires_at - now) > _WORK_SERVICE_JWT_REFRESH_LEEWAY_SECONDS:
            return False
    # Throttle dead-refresh storms. The exchange endpoint rate-limits
    # at 5 attempts / hour per agent_id; a 60s in-process cooldown
    # leaves us well under that even if every poll fires.
    last_failure = float(_work_service_jwt_state.get("last_failure_at", 0.0))
    if (now - last_failure) < _WORK_SERVICE_JWT_REFRESH_FAILURE_COOLDOWN_SECONDS:
        return False
    with _work_service_jwt_lock:
        # Re-check inside the lock — a sibling thread may have
        # already refreshed.
        now = time.time()
        if state.work_service_jwt and state.work_service_jwt_expires_at > 0:
            if (state.work_service_jwt_expires_at - now) > _WORK_SERVICE_JWT_REFRESH_LEEWAY_SECONDS:
                return False
        _work_service_jwt_state["last_attempt_at"] = now
    _exchange_service_key_for_jwt(state.agent_service_key)
    return True


def _start_work_service_jwt_refresh_thread() -> None:
    """Spawn the daemon that wakes every 60s, calls
    `_refresh_work_service_jwt_if_needed`, and exits when the
    process tears down.

    Idempotent — subsequent calls return early if the thread is
    already alive. No-op when no service key is configured (the
    agent stays on the legacy user-JWT path).
    """
    if _work_service_jwt_state.get("active"):
        return
    if not state.agent_service_key:
        return
    stop_event = threading.Event()

    def _loop() -> None:
        # First refresh kicks immediately so a freshly-booted agent
        # gets a JWT before the heartbeat / job poller fires.
        try:
            _refresh_work_service_jwt_if_needed()
        except Exception as e:
            print(f"[agent-identity] initial refresh raised: {e!r}")
        while not stop_event.is_set():
            try:
                _refresh_work_service_jwt_if_needed()
            except Exception as e:
                print(f"[agent-identity] refresh loop raised: {e!r}")
            stop_event.wait(60.0)

    t = threading.Thread(
        target=_loop, daemon=True, name="omni-agent-identity-jwt"
    )
    _work_service_jwt_state["thread"] = t
    _work_service_jwt_state["stop_event"] = stop_event
    _work_service_jwt_state["active"] = True
    t.start()


def _stop_work_service_jwt_refresh_thread() -> None:
    ev = _work_service_jwt_state.get("stop_event")
    if ev is not None:
        ev.set()
    _work_service_jwt_state["active"] = False


def _bootstrap_agent_identity_v2() -> None:
    """Read the on-disk service key, kick off the JWT refresh
    daemon, and disclose status in the boot banner. Called from
    module load BEFORE the FastAPI app starts so the boot banner
    accurately reflects the active auth path.

    Phase 11 (v2.0.0) — soft-fallback transition release:
      * No service key → DEPRECATION WARN at boot, agent keeps running
        on the legacy user-JWT path. v2.1.0 will remove the fallback.
      * No service key + `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1` →
        HARD FAIL at boot with `sys.exit(78)` (configuration error).
        Operators that have provisioned every agent with a service key
        should set the env var so a missing key surfaces as a loud
        config error instead of silently falling back.
      * Service key present → unchanged from Phase 10.
    """
    key = _load_agent_service_key()
    require_service_key = (
        os.environ.get("OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY", "0") == "1"
    )
    if not key:
        if require_service_key:
            print(
                f"[boot]   FATAL Agent identity v2: REQUIRED but no "
                f"service key found at {_AGENT_SERVICE_KEY_PATH}. "
                "OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1 enforces a "
                "hard-fail boot — register a service key via "
                "Settings → Agents → Register New Agent in the web "
                "app, save it to the canonical path, and relaunch. "
                "Exiting with code 78 (configuration error)."
            )
            sys.exit(78)
        print(
            f"[boot]   DEPRECATION Agent identity v2: NOT CONFIGURED. "
            f"No service key at {_AGENT_SERVICE_KEY_PATH}. Falling back "
            "to the legacy user-JWT path (the agent's rust-work-service "
            "calls will sign with state.supabase_token from "
            "/supabase/login). The user-JWT fallback is scheduled for "
            "removal in v2.1.0; visit Settings → Agents → Register New "
            "Agent in the web app to mint a service key now. Set "
            "OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1 to upgrade this "
            "warning to a hard-fail boot once every agent has a key."
        )
        return
    state.agent_service_key = key
    slot = _agent_service_key_source.get("slot", "") or "canonical"
    if slot == "env":
        source_desc = f"{_AGENT_SERVICE_KEY_ENV_VAR} env var (literal value)"
    else:
        source_desc = _agent_service_key_source.get("path", "") or _AGENT_SERVICE_KEY_PATH
    print(
        f"[boot]   Agent identity v2: ENABLED. Service key loaded from "
        f"{source_desc} (slot={slot}). Will exchange for a 15-min "
        "agent JWT on first call to rust-work-service; refresh thread "
        "runs every 60s. WS subscribe-token + every "
        "/api/v1/sap-agents/jobs/* HTTP call will use the agent JWT "
        "in preference to the user JWT once exchange succeeds."
    )


# Phase 10 / v2.0.0 (post-release fix 2026-05-07) — invoke the
# bootstrap AFTER `_bootstrap_agent_identity_v2` and its helper chain
# (`_load_agent_service_key`, `_exchange_service_key_for_jwt`,
# `_refresh_work_service_jwt_if_needed`) are defined. The wrapper
# `_ensure_agent_identity_v2_bootstrap()` is defined ~300 lines above
# next to the `state` init block for narrative continuity, but the
# v2.0.0 original ship invoked it there too — which raised
# `NameError: name '_bootstrap_agent_identity_v2' is not defined` on
# every boot, downgrading every fleet agent to the legacy user-JWT
# fallback. See [[Debug/Fix-Phase10-Bootstrap-NameError]].
_ensure_agent_identity_v2_bootstrap()


# ---------------------------------------------------------------------------
#  Shipment Progress (for live progress bar in the web UI)
# ---------------------------------------------------------------------------
_progress_lock = __import__("threading").Lock()
_shipment_progress: dict[str, Any] = {
    "active": False,
    "status": "idle",  # idle | running | complete | error
    "current_step": 0,
    "total_steps": 6,
    "step_name": "",
    "step_message": "",
    "step_status": "pending",  # pending | running | ok | error | skipped
    "delivery": "",
    "started_at": None,
    "finished_at": None,
    "results": [],
    "shipment_number": "",
    "error": "",
}


def _reset_progress(delivery: str):
    with _progress_lock:
        _shipment_progress.update({
            "active": True,
            "status": "running",
            "current_step": 0,
            "total_steps": 6,
            "step_name": "Initializing",
            "step_message": "",
            "step_status": "running",
            "delivery": delivery,
            "started_at": datetime.utcnow().isoformat() + "Z",
            "finished_at": None,
            "results": [],
            "shipment_number": "",
            "error": "",
        })


def _set_step(step: int, name: str, step_status: str = "running", message: str = ""):
    with _progress_lock:
        _shipment_progress["current_step"] = step
        _shipment_progress["step_name"] = name
        _shipment_progress["step_status"] = step_status
        _shipment_progress["step_message"] = message


def _append_step_result(result: dict):
    with _progress_lock:
        _shipment_progress["results"].append(result)


def _finalize_progress(ok: bool, error: str = "", shipment_number: str = ""):
    with _progress_lock:
        _shipment_progress["active"] = False
        _shipment_progress["status"] = "complete" if ok else "error"
        _shipment_progress["step_status"] = "ok" if ok else "error"
        _shipment_progress["finished_at"] = datetime.utcnow().isoformat() + "Z"
        _shipment_progress["error"] = error
        _shipment_progress["shipment_number"] = shipment_number


# ---------------------------------------------------------------------------
#  Pydantic Models
# ---------------------------------------------------------------------------
class ShipmentRequest(BaseModel):
    delivery: str
    item: Optional[str] = "0010"
    serials: Optional[list[str]] = []
    to_number: str
    warehouse: str
    tracking: Optional[str] = "Tracking"


class ConfirmTORequest(BaseModel):
    to_number: str
    warehouse: str


class TransferInventoryRequest(BaseModel):
    """Create a Transfer Order via LT01 (bin-to-bin transfer).

    Mirrors omni_bridge/sap_scripts/LT01Complete.vbs plus the focused
    field recordings shipped 2026-05-07:
      - LT01Stockstatus.vbs → BESTQ (Stock Category / Stock Status)
      - LT01SpecStockx.vbs  → SOBKZ + LSONR (Special Stock + number)
      - LT01PRint.vbs       → LDEST (Print Destination / spool device)
    """
    warehouse: str               # LTAK-LGNUM
    material: str                # LTAP-MATNR
    quantity: str                # RL03T-ANFME
    plant: str = ""              # LTAP-WERKS (e.g. 8810) — required by SAP
    storage_location: str = ""   # LTAP-LGORT (e.g. RCV1) — optional
    batch: str = ""              # LTAP-CHARG — optional (only for batch-managed materials)
    source_storage_type: str     # LTAP-VLTYP
    source_storage_bin: str      # LTAP-VLPLA
    dest_storage_type: str       # LTAP-NLTYP
    dest_storage_bin: str        # LTAP-NLPLA
    movement_type: str = "999"   # LTAK-BWLVS — default 999 = bin-to-bin
    # v2.0.1 — three optional fields surfaced on the LT01 initial screen.
    # All three default to "" so older agents/payloads stay
    # backward-compatible (the handler only touches the SAP control when
    # the value is non-empty). Capability-gated by `lt01-stock-fields`.
    #
    #   stock_category          → LTAP-BESTQ — Stock Category / Status.
    #     Single character. Common values: "" (unrestricted), "S"
    #     (blocked), "Q" (quality inspection), "R" (returns).
    #   special_stock_indicator → LTAP-SOBKZ — Special Stock indicator.
    #     Single character. Common values: "" (own stock), "E" (sales-
    #     order stock), "K" (vendor consignment), "Q" (project stock),
    #     "V" (returnable packaging), "W" (customer consignment).
    #   special_stock_number    → RL03T-LSONR — Special Stock Number.
    #     Variable-width. Sales order # for E, vendor # for K, project /
    #     WBS for Q, customer # for V/W. Only meaningful when
    #     `special_stock_indicator` is non-empty (the handler skips the
    #     field if SOBKZ is blank, even if a value was sent).
    stock_category: str = ""              # LTAP-BESTQ
    special_stock_indicator: str = ""     # LTAP-SOBKZ
    special_stock_number: str = ""        # RL03T-LSONR
    # v2.0.1 (follow-up) — Print Destination (LDEST). Spool device /
    # printer queue id (e.g. "PG44"). Independent of SOBKZ — can be set
    # alongside any combination of the above. Mirrors LT01PRint.vbs:26.
    # Defaults to "" so the standard "use SAP user's default printer"
    # behaviour is preserved when the field is omitted.
    print_destination: str = ""           # LTAP-LDEST


class BinBlocksRequest(BaseModel):
    """Update putaway / stock-removal block flags on a storage bin.

    Mirrors omni_bridge/sap_scripts/ls02ntesting.vbs (LS02N).
    """
    warehouse: str               # LAGP-LGNUM
    storage_type: str            # LAGP-LGTYP
    storage_bin: str             # LAGP-LGPLA
    putaway_block: bool          # LAGP-SKZUE
    stock_removal_block: bool    # LAGP-SKZUA


class MaterialMasterBinRequest(BaseModel):
    """Update the storage-bin field on a material's Warehouse Mgmt 2 view.

    Mirrors omni_bridge/sap_scripts/MM02Completed.vbs (MM02).
    Pass an empty string for `storage_bin` to clear the existing bin.
    """
    material: str                # RMMG1-MATNR
    plant: str                   # RMMG1-WERKS
    warehouse: str               # RMMG1-LGNUM
    storage_type: str            # RMMG1-LGTYP
    storage_bin: str = ""        # MLGT-LGPLA — "" means CLEAR the current bin


class CreateStorageBinRequest(BaseModel):
    """Create a new storage bin via LS01N.

    Mirrors omni_bridge/sap_scripts/LS01N.vbs.

    Three values on the General tab are constant across all bin creates
    (per user's standard config) and are hard-coded in the handler:
      - LAGP-LGBER = "001"            (Storage Section)
      - LAGP-LGEWI = "9,999,999.000"  (Total Capacity)
      - LAGP-LKAPV = "9,999,999.000"  (Allowed Capacity)
    """
    warehouse: str       # LAGP-LGNUM
    storage_type: str    # LAGP-LGTYP
    storage_bin: str     # LAGP-LGPLA


class MaterialMasterStorageTypesRequest(BaseModel):
    """Update the warehouse-level Storage Type defaults on a material's
    Warehouse Mgmt 1 view (LTKZA = stock removal, LTKZE = stock placement).

    Mirrors omni_bridge/sap_scripts/MM02Completed2.vbs (MM02).
    Pass an empty string for either field to CLEAR that default.
    """
    material: str                       # RMMG1-MATNR
    plant: str                          # RMMG1-WERKS
    warehouse: str                      # RMMG1-LGNUM
    org_storage_type: str               # RMMG1-LGTYP — popup filter (any storage type the material is extended in)
    removal_storage_type: str = ""      # MLGN-LTKZA (stock removal default)
    placement_storage_type: str = ""    # MLGN-LTKZE (stock placement default)


class SessionSelectRequest(BaseModel):
    conn_idx: int
    sess_idx: int


class SupabaseConfigRequest(BaseModel):
    url: str
    key: str
    email: Optional[str] = None
    password: Optional[str] = None


class QueryRequest(BaseModel):
    """Generic query dispatch. `handler` is the name of a registered
    data-pulling handler (e.g. 'lt10'), `params` is a handler-specific
    dict of input parameters.

    `use_bulk_export=true` switches the SAP list extractor to the
    `%pc → Save list in file → Unconverted` path which is dramatically
    faster than Ctrl+PgDn pagination for big reports (LT10 warehouse-
    wide can return 15k+ rows). See `_extract_via_pc_export()`.
    """
    handler: str
    params: dict[str, Any] = {}
    use_bulk_export: bool = False


# ---------------------------------------------------------------------------
#  FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(title="OmniFrame SAP Agent", version=AGENT_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ---------------------------------------------------------------------------
#  Agent Capabilities (Phase B8)
# ---------------------------------------------------------------------------
# Reported by /health so the frontend can gate UI actions ("Requires
# agent v1.4.0+"). When you add a new endpoint, add its capability id
# here so the frontend can detect it without a hardcoded version check.
AGENT_CAPABILITIES: list[str] = [
    "confirm-to",
    "transfer-inventory",
    "bin-blocks",
    "mm02-bin",
    "mm02-storage-types",
    "create-bin",
    "process-shipment",
    "lt10",
    "lt24",
    "lt12",
    "mb52",
    "mmbe",
    "jobs-queue",
    "metrics",
    "audit-log",
    "agent-token",
    "bulk-export-pc",
    "soft-warning-catalog",
    "retry-with-backoff",
    # Phase D #12 — Self-Recording Mode (v1.5.0)
    "recording-start",
    "recording-stop",
    "recording-translate",
    "recording-replay",
    "recording-list",
    # Phase D batch-merge (v1.6.0)
    # #11 dry-run preview
    "mm03-read-bin",
    "mm03-read-storage-types",
    # #13 multi-agent coordination
    "agents-fleet",
    "job-claim-lease",
    # #14 scheduled / recurring jobs
    "scheduled-jobs",
    # #15 reversal / rollback engine
    "reversal-engine",
    # #16 agent-direct Supabase Realtime subscription
    "agent-direct-realtime",
    # Phase D extension (v1.6.1): LT22 outbound TO import via SmartImportButton
    "import-lt22",
    # v1.6.3 — LT22 default extraction is now the %pc bulk-export path
    # (page-down paging through the visible SAP GUI killed the COM
    # bridge on a 657-row pull). Frontend can light up a "Bulk-export"
    # badge in the Import LT22 dialog when this capability is present.
    "import-lt22-bulk",
    # v1.6.3 — capabilities catch-up: these endpoints/features have
    # been shipping for a while but weren't surfaced via
    # /health.capabilities, so the frontend's `hasCapability(...)`
    # gates returned false and dependent UI silently degraded.
    #   - supabase-session       → GET /supabase/session
    #   - agent-supabase-logout  → POST /supabase/logout
    #   - truststore-tls         → corporate SSL trust via the
    #                              `truststore` package (v1.6.2)
    "supabase-session",
    "agent-supabase-logout",
    "truststore-tls",
    # v1.6.4 — Agent-side trigger evaluator. When this capability is
    # advertised, the browser-side runtime in
    # use-agent-trigger-runtime.ts MUST NOT submit jobs itself: the
    # agent has its own Realtime subscription on rf_putaway_operations
    # and enqueues sap_agent_jobs rows directly, so triggers fire even
    # when no SAP Testing tab is open. The browser becomes a status
    # reflector only.
    "agent-side-triggers",
    # v1.6.5 — Fleet hygiene + token persistence.
    #   - persistent-agent-token  → agent_token survives EXE rebuilds.
    #     `/supabase/login` no longer rotates it on every call.
    #   - stable-agent-id         → `_agent_self_id()` no longer carries
    #     the PID, so heartbeats merge into one fleet row instead of
    #     creating a new one each restart.
    #   - agent-token-rotate      → POST /agent-token/rotate for explicit
    #     security-event rotation (frontend can offer a "Rotate token"
    #     button in admin UI).
    #   - agent-token-check       → GET /agent-token/check (auth-required)
    #     so `useAgentDetection` can distinguish "process up" vs
    #     "process up + token valid".
    "persistent-agent-token",
    "stable-agent-id",
    "agent-token-rotate",
    "agent-token-check",
    # v1.6.6 — SAP auto-connect on boot.
    #   - sap-auto-connect → daemon thread retries `/sap/connect` with
    #     exponential backoff until SAP GUI is reachable, then
    #     auto-resumes after a COM-crash-induced disconnect. Disable via
    #     `OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1`. The frontend can use
    #     this capability to hide the manual "SAP Connect" button (or
    #     downgrade it to a "Force reconnect" affordance) on agents that
    #     advertise it.
    "sap-auto-connect",
    # v1.6.7 — Self-healing schema-cache fallback. When a feature column
    # is missing, the agent disables the feature for 5min then auto-
    # retries the full schema (was permanently disabled in v1.6.5/v1.6.6
    # so a transient PostgREST cache miss right after a migration could
    # silently kill the feature for the rest of the process lifetime).
    # Frontend doesn't need to gate on this — it's purely defensive
    # backend hardening — but advertised so dashboards can show "agent
    # auto-recovers from schema lag" in the capability matrix.
    "self-healing-schema-fallback",
    # v1.6.9 — Trigger backfill poller. A 60s daemon sweeps the last
    # 24h of `rf_putaway_operations` for rows the Realtime channel
    # missed (agent restarts, WebSocket reconnect blips, Citrix VDA
    # hibernation, pg_cron interruption). Pairs with a bounded TTL
    # dedup cache (`_recently_queued_rows`) so Realtime + backfill
    # never double-fire on the same row. Frontend doesn't need to gate
    # on this — purely defensive — but advertised so dashboards can
    # show "agent self-recovers from missed events" alongside
    # `self-healing-schema-fallback`. See [[Debug/Fix-Missed-Realtime-Events-Backfill]].
    "trigger-backfill-poller",
    # v1.7.0 — Throughput pass. Three capabilities that pair together
    # and are advertised jointly so ops dashboards can gate a
    # "throughput-optimized agent" badge off any of them:
    #
    #   - job-drain-mode        → poller chains back-to-back claims
    #     instead of sleeping 60s between them. Inter-job dwell drops
    #     from 30-60s → 1-3s on a pre-queued batch.
    #   - stuck-job-watchdog    → separate daemon marks a job
    #     `failed` after `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS`
    #     (default 120s) so a COM-hung handler can't keep the DB
    #     stuck on one row. Complements `job-claim-lease` at the
    #     watchdog tier.
    #   - realtime-singleton    → sticky flag prevents multiple
    #     Realtime reconnect loops from racing for the same channel
    #     (the "dozens of connected lines/min" pattern).
    #
    # Frontend doesn't need to gate on any of them — all three are
    # pure backend throughput improvements, no user-facing behaviour
    # change. Advertised so the capability matrix can show "agent
    # uses drain-mode polling + watchdog" for sites that want to
    # verify the version before flipping their throughput
    # expectations. See [[Debug/Fix-Agent-Throughput-Latency]] +
    # [[Patterns/Job-Queue-Drain-Mode]].
    "job-drain-mode",
    "stuck-job-watchdog",
    "realtime-singleton",
    # v1.7.1 — Realtime crash-loop containment. Three capabilities that
    # advertise the new defensive posture jointly:
    #
    #   - realtime-circuit-breaker  → 20-errors-in-60s sliding window
    #     trips a circuit that disables Realtime and falls back to
    #     polling-only mode. Auto-resets every 5min so a transient
    #     Citrix VDA hibernate / corporate proxy idle close recovers
    #     without an EXE restart.
    #   - realtime-fallback-mode    → when the breaker is tripped, the
    #     job poller's idle backoff tightens from 5→60s to 5→15s and
    #     the trigger backfill poller (60s, unchanged) carries the
    #     missed-event load. Throughput stays bounded even with
    #     Realtime fully offline.
    #   - crash-loop-containment    → asyncio loop exception handler
    #     suppresses the known `realtime>=2.x` `_reconnect()` bug
    #     (`asyncio.wait([])` → `ValueError`) and `ConnectionClosedError`
    #     bursts. Single-line log instead of multi-line traceback per
    #     event. Eliminates the stderr flood that was drowning the
    #     heartbeat thread (silent `last_seen_at` stalls) + job poller.
    #
    # Frontend doesn't need to gate on any of them — pure backend
    # hardening, no user-facing behaviour change. Advertised so ops
    # dashboards can show "agent self-recovers from realtime library
    # bugs" alongside `self-healing-schema-fallback` +
    # `trigger-backfill-poller`. See [[Debug/Fix-Realtime-Library-CrashLoop]]
    # + [[Patterns/Async-Library-Circuit-Breaker]].
    "realtime-circuit-breaker",
    "realtime-fallback-mode",
    "crash-loop-containment",
    # v1.7.2 — Audit closeout. Six capabilities advertised jointly so
    # ops dashboards can show "agent is on the post-audit hardening
    # path" via any of them. Two are user-facing-relevant (the
    # frontend gates copy on `jwt-refresh` for the login dialog hint;
    # the granular shipment-queue id lets a future build narrow the
    # `agent-side-triggers` suppression instead of silencing every
    # supabase-realtime trigger). The other four are pure backend
    # hardening (no frontend behaviour change beyond reading the id).
    #
    #   - jwt-refresh                                → access + refresh
    #     tokens persisted in config.json with absolute expiry;
    #     `_refresh_supabase_token_if_needed` rolls the JWT before
    #     expiry on every `_supabase_request`.
    #   - terminal-state-guards                      → `_patch_job_terminal`
    #     adds `&status=eq.running&claimed_by=eq.<self>` filters so a
    #     watchdog-killed `running` row can't be silently rewritten
    #     to `completed` when the long-stuck SAP call returns.
    #   - idempotency-day-suffix                     → trigger enqueue
    #     idempotency_key now includes `:<unix-day>` so a row whose
    #     first enqueue failed isn't permanently 409-locked.
    #   - agent-module-alias                         → `sys.modules["agent"]`
    #     alias makes `from agent import state` in lt22_import.py /
    #     material_master_read.py resolve to the SAME AgentState as
    #     the FastAPI handlers under PyInstaller.
    #   - jobs-claim-active-guard                    → `/jobs/claim`
    #     refuses with `{ok: false, active_job_id: ...}` when
    #     `state.active_job_id` is already set so a single agent
    #     process can't end up owning two `running` rows.
    #   - agent-side-triggers:builtin-shipment-queue → granular
    #     companion to the broad `agent-side-triggers` capability.
    #     Frontends that want to suppress only the rf_putaway trigger
    #     (e.g. preserve browser-side shipment_queue handling for a
    #     soak period) can gate on the `:builtin-rf-putaway-completed`
    #     suffix instead of the umbrella string.
    #
    # See [[Debug/Fix-Audit-Closeout-v1.7.2]] for the audit write-up.
    "jwt-refresh",
    "terminal-state-guards",
    "idempotency-day-suffix",
    "agent-module-alias",
    "jobs-claim-active-guard",
    "agent-side-triggers:builtin-rf-putaway-completed",
    "agent-side-triggers:builtin-shipment-queue",
    # Work Engine follow-on: Picking. The agent observes
    # `work_tasks.status='completed'` rows where `task_type='pick'` and
    # fires LT12 to confirm the SAP transfer-order line. Idempotency is
    # dual-keyed: (1) the in-memory dedup cache (row id, 5min TTL) and
    # (2) `work_tasks.payload.lt12_confirmed_at` written back by the
    # post-success patch. See `_HARDCODED_TRIGGERS` +
    # `_hardcoded_trigger_{match,payload,post_patch}` branches for the
    # `builtin-pick-completed` id and `docs/work-engine/follow-on-picking.md`
    # for the full lifecycle.
    "agent-side-triggers:builtin-pick-completed",
    # v1.7.3 — LT10/LT22 bulk-export hardening. The %pc bulk-export
    # extractor (`_extract_via_pc_export`) is now two-phase with
    # `_PcPreCommitError` (raised before Save — fallback-safe) and
    # `_PcPostCommitError` (raised after Save — NOT fallback-safe).
    # Callers in `_extract_alv_grid`, `handler_lt10`, and
    # `lt22_import.py` only fall back to `_extract_sap_list_output`
    # on PRE-commit failures. On POST-commit failures we surface a
    # clean error rather than re-walking the same data slowly via
    # Ctrl+PgDn pagination (the v1.7.2 LT10 user-visible bug —
    # successful %pc save followed by visible GUI page-down for 5+
    # minutes). LT10 also drops the now-pointless ALV probe entirely
    # for `storage_type='*'` queries — LT10 always renders a classic
    # list output, never an ALV grid. Pure backend hardening — no
    # frontend behaviour change. Advertised so dashboards can show
    # "agent will not silently re-paginate after a successful bulk
    # export" alongside the throughput + crash-loop containment caps.
    # See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]].
    "bulk-export-no-fallback",
    # v1.7.4 — Menu-driven export trigger as primary path. Phase A of
    # `_extract_via_pc_export` now tries the canonical SAP menu entry
    # `wnd[0]/mbar/menu[0]/menu[1]/menu[2]` (List → Save → File...)
    # FIRST, with the legacy `%pc` OK-code shortcut as fallback. The
    # v1.7.3 user reported LT10 still paginating because `%pc` either
    # is not registered on their SAP variant or routes to a different
    # dialog — the fresh recording at `LT10ReRan.vbs` showed the menu
    # path is what every list-output report ships with universally.
    # Frontend doesn't need to gate on this — pure backend hardening
    # — but advertised so dashboards can show "agent uses canonical
    # menu trigger for bulk export" alongside `bulk-export-pc` and
    # `bulk-export-no-fallback`. See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]]
    # → "v1.7.4 follow-up: menu vs %pc" section.
    "bulk-export-menu-driven",
    # v1.7.5 — `handler_lt10` and `handler_mb52` now ALWAYS use
    # `_extract_via_pc_export` regardless of query parameters. The
    # v1.7.3 `storage_type == '*'` gate in handler_lt10 was based on
    # the wrong assumption that specific-type queries return small
    # result sets — production disproved this with a `storage_type='999'`
    # query that returned 234 rows across 7 pages of Ctrl+PgDn
    # pagination. Both handlers fall back to pagination / ALV
    # extraction ONLY on `_PcPreCommitError` (dialog never opened,
    # GUI still on source screen — safe). NO frontend gating —
    # purely informational so dashboards can show "agent never
    # paginates LT10/MB52 except as last-resort fallback" alongside
    # `bulk-export-no-fallback` and `bulk-export-menu-driven`.
    # See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]]
    # → "v1.7.5: always bulk export" section.
    "bulk-export-always",
    # v1.7.6 — Permissive multi-format parser inside
    # `_extract_via_pc_export`. The v1.7.5 user's LT10 export reached
    # Phase B (Save-As dialog opened, file landed on disk) but the
    # original v1.6.3 parser only recognized one layout (dash row
    # between header and data). v1.7.6 tries five formats in priority
    # order — A=dash-separated, B=tab-delimited, C=fixed-width
    # without dashes, D=CSV, E=HTML — and the first one with >=2
    # columns + >=1 data row wins. On total failure the agent saves
    # a copy of the file to `%TEMP%/omniframe_lastfailed_<ts>.txt`
    # and dumps a `repr()` preview + size hints to the console so
    # the user can ship the file for offline analysis. The resolved
    # format is reported in `result["meta"]["parser_format"]` so SAP
    # Testing audits can see which path each query took. Frontend
    # doesn't need to gate on this — pure backend hardening — but
    # advertised so dashboards can show "agent handles non-standard
    # SAP export formats" alongside `bulk-export-always`,
    # `bulk-export-no-fallback`, and `bulk-export-menu-driven`.
    # See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]]
    # → "v1.7.6: multi-format parser" section.
    "bulk-export-multi-format-parser",
    # v1.7.7 — Smart header detection inside `_parse_attempt_b_tab_delimited`
    # and `_parse_attempt_c_fixed_width`. The v1.7.6 ladder correctly
    # detected Format B on a real LT10 export but picked the first
    # non-blank line as the header — that line was actually a SAP
    # banner row ("Whse number\t\t\t\t\tWH5") and the parser returned
    # 1 row × 6 columns from the banner instead of the 232+ rows × 20
    # columns from the real grid. v1.7.7 scores every candidate header
    # line by its non-empty tab-cell count; banner rows have <3
    # non-empty cells and fall out, so the real header (17+ non-empty)
    # wins. Same hardening applied to Format C in case a future SAP
    # variant emits banners without tabs. Data-row matching is also
    # PERMISSIVE on cell count — SAP DROPS trailing empty cells in
    # tab-exported rows, so the v1.7.6 `abs(len(cells) - expected) > 1`
    # check rejected every legitimate data row on this user's box.
    # Frontend doesn't need to gate on it (purely defensive backend
    # hardening) but advertised so dashboards can show "agent handles
    # SAP banner lines above the column header" alongside
    # `bulk-export-multi-format-parser` and the other bulk-export caps.
    # See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]]
    # → "v1.7.7: smart header detection" section.
    "bulk-export-smart-header",
    # v1.7.8 — Agent + DB load reduction (Tier 4 + Tier 2/5 fixes from
    # the investigation report). Two new capabilities advertised so
    # dashboards can show the agent is on the post-load-reduction
    # path. Frontend does not need to gate on either (both are pure
    # backend hardening).
    #
    #   - adaptive-heartbeat       → `_start_heartbeat_thread` resolves
    #     a per-tick cadence: base 30s while a job is in flight,
    #     idle 60s when there's been no active job for >5min. Halves
    #     `sap_agents.last_seen_at` UPDATE rate on a quiescent fleet
    #     without affecting fleet-card freshness materially. Also
    #     drops the per-tick `reap_stale_sap_agents()` RPC call —
    #     pg_cron drives that function server-side every minute via
    #     migration 250's `omniframe-reap-stale-sap-agents` job.
    #   - realtime-aware-backfill  → `_start_trigger_backfill_poller`
    #     skips its periodic PostgREST scan when Realtime is healthy
    #     and `state.last_realtime_event_at` was bumped in the last
    #     2min. v1.6.9 missed-event self-healing semantics fully
    #     preserved: the scan still runs when Realtime goes silent
    #     for any reason OR the v1.7.1 circuit breaker has tripped
    #     (polling-only fallback mode). Eliminates ~60 redundant
    #     SELECTs/hour on the dominant steady state.
    #
    # Paired with two DB-only migrations applied via Supabase MCP:
    # `254_index_hot_read_paths.sql` (composite indexes for the fleet
    # card / claim-path / backfill SELECTs) and
    # `255_optimize_replica_identity.sql` (REPLICA IDENTITY FULL →
    # DEFAULT for `sap_agents` / `sap_agent_jobs` /
    # `sap_agent_schedules` / `sap_outbound_to_import_runs` so
    # Realtime UPDATE payloads ship the PK only).
    # See [[Implementations/Implement-Agent-DB-Load-Reduction]].
    "adaptive-heartbeat",
    "realtime-aware-backfill",
    # v1.7.9 — SAP session pinning. Bind the agent to ONE specific SAP
    # GUI session so manual SAP work in other sessions doesn't get
    # hijacked by the agent's auto-select. Two new endpoints
    # (POST /sap/select-session, POST /sap/unpin-session) plus the
    # frontend session-picker pill in the SAP Testing tabs let the user
    # dedicate one SAP session to the agent. Pin is persisted in
    # config.json so it survives EXE rebuild + restart. When pinned,
    # `_auto_select_valid_session` ONLY returns the pinned session
    # (matched by exact indexes OR by system/client/user criteria so
    # SAP's per-launch session renumbering doesn't break the pin); if
    # the pinned session is not currently available the agent stays
    # disconnected (loudly logged) rather than auto-grabbing a different
    # session. Frontend can use this capability id to gate the picker
    # UI; older agents (≤1.7.8) will simply hide the picker. See
    # [[Implementations/Implement-SAP-Session-Pinning]].
    "sap-session-pinning",
    # v1.8.0 — Realtime resilience. Two new capabilities advertised
    # jointly so dashboards can show the agent is on the post-cycling
    # path. Frontend doesn't need to gate either (both are pure backend
    # hardening + a read-only diagnostic endpoint), but advertising
    # them lets the SAP Testing tabs / Inventory Management Mission
    # Control eventually consume `/realtime/status` for an accurate
    # "Realtime: degraded / polling-only" pill instead of the binary
    # "agent connected" signal `/health` gives.
    #
    #   - realtime-clean-close-detection → `_RealtimeCleanCloseTracker`
    #     and the v1.7.1 `_RealtimeCircuitBreaker` are tracked
    #     independently. A clean WebSocket close that arrived <30s
    #     after `subscribe()` is counted as a *spurious* close (likely
    #     corporate proxy idle-close); 5+ in 60s trips the same
    #     `_disable_realtime_subsystem` path the exception breaker
    #     uses, falling back to polling-only mode for 5min before
    #     auto-retry. Also tightens the WebSocket heartbeat to 10s
    #     via `hb_interval=10` on the AsyncRealtimeClient constructor
    #     so a typical Citrix/Netskope/ZScaler idle timer (10-30s
    #     window) gets reset before it fires.
    #   - realtime-status-endpoint → `GET /realtime/status` returns
    #     `{connected, circuit_tripped, fallback_mode,
    #     spurious_close_count_60s, exception_count_60s,
    #     last_event_at, uptime_seconds, agent_uptime_seconds,
    #     version, details{...}}`. Read-only, exempt from the
    #     agent-token middleware so a frontend status pill can render
    #     before /supabase/login completes.
    #
    # See [[Debug/Fix-Realtime-CleanClose-Cycle]].
    "realtime-clean-close-detection",
    "realtime-status-endpoint",
    # v1.8.2 — Multi-factor header scorer with banner penalty in
    # `_parse_attempt_b_tab_delimited` + `_parse_attempt_c_fixed_width`.
    # The v1.7.7 single-factor scorer (max non-empty cell count, with
    # a `non_empty < 3` floor) was vulnerable to SAP banners that ship
    # exactly 3 non-empty cells — the LT22 PDC banner ("Warehouse
    # No.\t\t\tPDC\tIndianapolis PDC") slipped past the floor. The new
    # `_score_header_candidate(non_empty, total_cells, following_data_rows)`
    # blends three factors: base `non_empty * 10`, a bonus capped at
    # 20 × 5 for lines whose siblings share the same shape (real
    # headers see 100s of matches; banners see ~0), and a `-50`
    # penalty when fill_ratio < 0.3 AND non_empty < 5 (the SAP banner
    # pattern). The penalty is larger than any banner can earn from
    # raw `non_empty`, so banners are reliably outranked even when
    # `following_data_rows = 0` for both candidates. Pairs with
    # defense-in-depth dedup + ignore-duplicates in `lt22_import.py`
    # so a duplicate TO number from a split-delivery split (or a
    # parser misfire that DID slip through) can no longer 409 the
    # whole batch. Frontend doesn't need to gate on this — pure
    # backend hardening — but advertised so dashboards can show
    # "agent rejects SAP banner rows when picking the column header"
    # alongside `bulk-export-smart-header` and the other bulk-export
    # caps. See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]]
    # → "v1.8.2: parser banner penalty + per-batch dedup" section.
    "parser-banner-penalty",
    # v1.8.3 — `_update_putaway_status` now prefers the source-row id
    # from `__omni_trigger_meta.post_success_patch.row_id` when present,
    # PATCHing by `id=eq.<row_id>&to_status=neq.TO%20Confirmed` instead
    # of the legacy `to_number + warehouse + created_at >= today` filter
    # that silently no-op'd whenever the TO was created the previous
    # UTC day (e.g. agent processes a row at 00:21 UTC on day N when
    # `created_at` lives at 22:00 UTC on day N-1 — the PATCH filter
    # `created_at >= <today UTC>` rejected the row, PostgREST returned
    # 200 OK with empty body, and the frontend kept showing "Pending TO
    # Confirm" forever). When `row_id` is missing (manual curl /
    # browser-side queued job without trigger meta) the fallback path
    # widens the date window to 48 hours so a same-day retry still
    # hits without re-introducing the UTC-midnight cliff. The overlay
    # patch in `_apply_trigger_post_patch` was already correct — it
    # has used `id=eq.<row_id>` since v1.6.8 — so the OVERLAY columns
    # (`confirmed_source` / `confirmed_by_label` / `confirmed_by_agent_id`)
    # were never affected by this bug; only the legacy 3 fields
    # (`to_status` / `confirmed_at` / `confirmed_by`) silently no-op'd.
    # Frontend doesn't need to gate on this — pure backend correctness
    # fix — but advertised so dashboards can show "agent's putaway
    # status PATCH targets the exact source row" alongside the v1.6.8
    # overlay-only attribution capability and the v1.6.9 backfill
    # poller. See [[Debug/Fix-Putaway-Status-UTC-Midnight]] for the
    # 19-row production evidence + the manual SQL backfill.
    "putaway-update-by-rowid",
    # v1.8.4 — Aggressive Realtime degradation when unhealthy. The
    # v1.8.0 clean-close circuit breaker was too lenient (5 closes in
    # 60s = trip, then 5min auto-retry would re-trip on a chronically
    # degraded Supabase tenant — the agent cycled forever). v1.8.4
    # tightens the trip threshold (60→30s window, 5→2 closes,
    # 30→15s min-connect-age — any close <15s after subscribe counts
    # as spurious), changes the auto-retry cooldown from a fixed
    # 5min to an exponential ladder (30min initial, doubles to
    # 60/120/240/360min cap = 6h) keyed off
    # `_realtime_reset_state["consecutive_trips"]` (only resets on a
    # 60s+ stable connection), slows the reconnect ladder (initial
    # 5→15s, additive +5s per attempt instead of multiplicative ×2,
    # reset to 15s only after a 60s+ stable run), and adds an
    # `OMNIFRAME_DISABLE_REALTIME=1` env var that skips Realtime
    # entirely (sets `state.realtime_disabled=True` at boot,
    # polling-only mode for the entire process lifetime). The intent
    # is "if Realtime is reliably broken, give up quickly and stay
    # in polling-only mode for hours, NOT keep retrying every 5min".
    # `/realtime/status` extended with `consecutive_trips`,
    # `next_retry_seconds`, `recommended_action`, and
    # `realtime_disabled_via_env` so dashboards can show the
    # countdown + the suggested env-var fix. Frontend doesn't need
    # to gate on this — pure backend hardening — but advertised so
    # the SAP Testing tabs / Inventory Management can eventually
    # consume the extended `/realtime/status` for an accurate
    # "Realtime: disabled (by env) / off (cooling down 27min)"
    # banner. See [[Debug/Fix-Realtime-Tenant-Overload]].
    "realtime-aggressive-degradation",
    # v1.9.0 (Phase 4 of rust-work-service integration plan) —
    # `rust-ws-client` advertises the new event source. When set on
    # `OMNIFRAME_AGENT_USE_RUST_WS=1` the agent connects to
    # `rust-work-service /ws` and consumes `WsEvent::SapJobStatusChanged`
    # + `WsEvent::RfPutawayChanged` instead of the legacy Supabase
    # Realtime channels. The capability is advertised UNCONDITIONALLY
    # so the frontend can show "agent supports rust-ws routing" in
    # the capability matrix even when the feature flag is currently
    # off (the matrix reflects build capability, not runtime path).
    # Purely informational — no frontend gating today.
    "rust-ws-client",
    # Phase 7 (rust-work-service integration plan, 2026-05-06) —
    # `agent-claims-via-rust` advertises that this build can route
    # claim / complete / fail / heartbeat through
    # `rust-work-service /api/v1/sap-agents/jobs/...` when
    # `OMNIFRAME_AGENT_CLAIM_VIA_RUST=1`. Like `rust-ws-client`, this
    # is advertised UNCONDITIONALLY (build capability, not runtime
    # path) so the FE / dashboards can detect "agents on the new
    # path" without inspecting env vars. The feature flag default
    # stays `0` until Phase 11 flips it; advertise stays on.
    # Purely informational — no FE gating today.
    "agent-claims-via-rust",
    # Phase 10 (rust-work-service integration plan, 2026-05-07) —
    # `agent-identity-v2` advertises that this build can authenticate
    # against rust-work-service via a service-key-derived agent JWT
    # (kind: "agent" claim, signed locally by
    # `WORK_SERVICE_AGENT_JWT_SECRET`, 15-min TTL, refreshed every
    # 60s). Like the sibling `rust-ws-client` / `agent-claims-via-rust`
    # capabilities, this is advertised UNCONDITIONALLY (build
    # capability, not runtime path) so dashboards can show "agent
    # supports identity v2" even when no service key is configured
    # yet. The actual runtime path is decided by whether
    # `_AGENT_SERVICE_KEY_PATH` exists on disk; absent file ⇒ legacy
    # user-JWT path stays in effect (no behavior change). Frontend
    # may surface this in admin UIs ("Agent X is on Identity v2"
    # badge), but no UI is gated on it. See
    # `Decisions/ADR-Agent-Identity-V2-Phase10.md`.
    "agent-identity-v2",
    # Phase 11 (rust-work-service integration plan, 2026-05-07) —
    # `agent-2.0-architecture` is the headline capability for the v2.0.0
    # release. It signals the architecture-change boundary: the agent is
    # on rust-work-service for both event delivery (Phase 4) and queue
    # control plane (Phase 7); trigger evaluation is server-side (Phase
    # 9); identity v2 is supported (Phase 10, soft-fallback in 2.0.x);
    # legacy direct-PostgREST claim/complete/fail/lease-bump fallback
    # paths were DELETED. Default-flipped env vars
    # (`OMNIFRAME_AGENT_USE_RUST_WS`, `OMNIFRAME_AGENT_CLAIM_VIA_RUST`,
    # `OMNIFRAME_AGENT_CONSOLE_RELAY`) are scheduled for removal in
    # v2.1.0. New env var `OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1`
    # upgrades the missing-service-key boot warning to a hard-fail
    # exit-78. See [[Implementations/Implement-Rust-Work-Service-Phase11]]
    # for the migration arc + surviving direct-Supabase surface
    # documentation.
    "agent-2.0-architecture",
    # v2.0.1 (2026-05-07) — `lt01-stock-fields` advertises that
    # `/sap/transfer-inventory` accepts the four optional initial-screen
    # fields needed for non-default LT01 flows:
    #   - stock_category          → LTAP-BESTQ (Stock Status, e.g. "S"
    #     blocked, "Q" quality inspection)
    #   - special_stock_indicator → LTAP-SOBKZ (Special Stock, e.g. "K"
    #     vendor consignment, "E" sales-order stock)
    #   - special_stock_number    → RL03T-LSONR (sales order / vendor /
    #     project number paired with SOBKZ)
    #   - print_destination       → LTAP-LDEST (spool device / printer
    #     queue id, e.g. "PG44"; overrides the SAP user default printer
    #     for the TO confirmation slip — added in the same v2.0.1
    #     follow-up that introduced the other three; capability stays
    #     a single name to keep the FE gate simple)
    # Mirrors the focused VBS recordings shipped 2026-05-07
    # (LT01Stockstatus.vbs, LT01SpecStockx.vbs, LT01PRint.vbs). The
    # Inventory Management tab gates the new form fields on this
    # capability so older agents don't silently drop the values.
    # Backward-compatible: each field defaults to "" and the handler
    # skips the SAP control when empty.
    "lt01-stock-fields",
    # 2026-05-07 — `zmm60-price-lookup` advertises the new
    # POST /sap/zmm60/lookup endpoint backing the Inventory Adjustment
    # workflow on the SAP Testing → Inventory Management tab. Given a
    # material (and optional plant) the handler runs ZMM60, bulk-exports
    # the resulting one-row "Dynamic List Display" via the canonical
    # menu/%pc path, and returns the SAP `Price` column (the per-Price-
    # Unit unit value) plus `Currency`. The browser INSERTs the result
    # into `inventory_adjustment_staging` (migration 288) tagged with
    # the LT10 row's bin coordinates. The new "+ Add to Inv. Adjust"
    # row action in `LT10_COLUMNS` is gated on this capability so older
    # agents render the dropdown item disabled instead of failing the
    # network call. Implementation lives in `omni_agent/zmm60_lookup.py`
    # (sibling module mounted via the same lazy include_router pattern
    # as `material_master_read.py`). Recording reference:
    # MacWindowsBridge/Zmm60xx.vbs; output reference:
    # MacWindowsBridge/ValueExport. See
    # Implementations/Implement-Inventory-Adjustment-Workflow.md.
    "zmm60-price-lookup",
    # 2026-05-10 — `lx25-inventory-completion` advertises the new
    # POST /sap/lx25/inventory-completion endpoint backing the
    # "Inventory Completion" entry in the Inventory Management tab's
    # Query Library (WAREHOUSE category). One call fans out across
    # five warehouses sequentially (WH5/WH8/JSM/JSF/PDC, each with its
    # own SAP variant — TKAWH5/TKAWH8/TKAJSM/TKAJSF/TKAPDC), runs
    # LX25 ("Inventory Status — List with Totals") via the canonical
    # menu/%pc bulk-export path, and aggregates the 5 per-storage-type
    # metrics LX25 emits into a per-warehouse + cross-warehouse
    # completion summary. Per-warehouse failures (missing variant,
    # SAP error) are captured in the response so the FE can surface
    # the failed card without aborting the rest of the fan-out.
    # Implementation lives in `omni_agent/lx25_inventory_completion.py`
    # (sibling module mounted via the same lazy include_router pattern
    # as zmm60_lookup.py / material_master_read.py / lt22_import.py).
    # Recording references: MacWindowsBridge/WH5LX25x (text export
    # sample) + MacWindowsBridge/LX25data.vbs (variant-driven flow).
    # See [[Implementations/Implement-LX25-Inventory-Completion]].
    "lx25-inventory-completion",
    # 2026-05-22 — LL01 Warehouse Activity Monitor. POST
    # /sap/ll01/warehouse-activity fans out per plant × category,
    # persists count snapshots, returns row detail in HTTP response.
    "ll01-warehouse-activity-monitor",
    # v2.1.0 (Phase A — Multi-Session Agent Master worker hardening)
    "master-controller-supported",
    "admin-ws-reconnect",
    "admin-job-abort",
    "admin-sap-reattach",
    "health-extended-fields",
    "agent-port-override",
    "agent-self-id-override",
    "agent-sap-pin-env-override",
    # v2.1.0 (Phase D2 — master admin env token for /admin/* bypass)
    "admin-env-token",
]


# ---------------------------------------------------------------------------
#  Per-User Agent Token Middleware (Phase D #17)
# ---------------------------------------------------------------------------
# The browser receives an `agent_token` from /supabase/login and includes
# it on every subsequent localhost call as `X-Agent-Token`. The middleware
# behaves as follows:
#
#   1. exempt path (/health, /sap/sessions, /jobs/*, …) → always allowed.
#   2. no token minted yet (state.agent_token == "")    → allowed.
#   3. token minted, request omits X-Agent-Token        → allowed (legacy
#      direct-fire clients like the trigger runtime pre-1.4.1 don't ship
#      the header). A warning is logged so this regression-class issue is
#      visible in the agent console.
#   4. token minted, request supplies a *different* token → 401 (CSRF /
#      stale-token guard — this is the actual security goal).
#
# Mode #3 was added in 1.4.1 after the /supabase/login flow started
# minting tokens *without* a corresponding browser-side `setAgentToken`
# wired up. The 1.4.0 strict-reject behaviour silently broke the
# `/sap/confirm-to` agent-trigger fires for any user who had ever called
# /supabase/login on this agent instance. See
# Debug/Fix-Agent-Trigger-Token-Regression in the omniframe vault.
_TOKEN_EXEMPT_PATHS = {
    "/health",
    "/status",
    "/sap/sessions",
    "/sap/shipment-progress",
    "/supabase/login",
    # v1.6.4 — these two were declared as capabilities in v1.6.3 and
    # listed as exempt paths conceptually, but the actual route handlers
    # were never registered on `app`, so requests 404'd (or 401'd when a
    # stale X-Agent-Token raced the middleware). Both endpoints are
    # idempotent reads/clears that don't touch SAP, so they stay exempt.
    "/supabase/session",
    "/supabase/logout",
    "/metrics",  # for the dashboard card; reads only
    "/shutdown",
    "/sap/connect",   # browser must be able to (re)connect before having a token
    "/agents",        # Phase D #13 — read-only fleet listing for dashboards
    # v1.8.0 — Realtime status diagnostic. Read-only; surfaces the
    # circuit-breaker / spurious-close / fallback-mode state so a
    # frontend status pill can show "Realtime: degraded" / "polling-only"
    # instead of the binary "agent connected/disconnected" signal that
    # /health gives. Exempt from token guard so the badge can render
    # before /supabase/login completes.
    "/realtime/status",
}


@app.middleware("http")
async def enforce_agent_token(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    # Always allow exempt paths and any /jobs/* poller endpoints (they
    # come from this same process — see _agent_token_for_self()) plus
    # the read-only /agents/* fleet endpoints (Phase D #13).
    if (
        path in _TOKEN_EXEMPT_PATHS
        or path.startswith("/jobs/")
        or path.startswith("/agents/")
    ):
        return await call_next(request)
    supplied = request.headers.get("x-agent-token") or request.headers.get("X-Agent-Token")
    # Phase D2 — master env token bypasses browser minted token on /admin/* only.
    if (
        _ADMIN_ENV_TOKEN
        and path.startswith("/admin/")
        and supplied
        and supplied == _ADMIN_ENV_TOKEN
    ):
        return await call_next(request)
    expected = state.agent_token
    if not expected:
        # No token minted yet (browser hasn't logged in). Be permissive
        # so legacy direct-fire flows keep working until the user logs in.
        return await call_next(request)
    if not supplied:
        # 1.4.1 — backward compat: legacy clients (and the trigger runtime
        # before agentFetch was wired in) don't send the header. Allow the
        # request but log a warning so the regression is visible. Mismatching
        # tokens are still rejected below.
        print(f"[auth]  WARN no X-Agent-Token on {request.method} {path} — "
              "allowing for backward compat. Update the client to send the "
              "token via agentFetch().")
        return await call_next(request)
    if supplied != expected:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=401,
            content={
                "ok": False,
                "error": "Invalid or stale X-Agent-Token. Re-login from the web app.",
            },
        )
    return await call_next(request)


@app.middleware("http")
async def add_private_network_headers(request: Request, call_next):
    """Chrome 108+ Private Network Access (PNA): when an HTTPS origin
    fetches http://localhost, Chrome sends a preflight with
    'Access-Control-Request-Private-Network: true'. We must respond with
    'Access-Control-Allow-Private-Network: true' or Chrome blocks the
    request silently. This middleware handles both the preflight and the
    actual response."""
    if request.method == "OPTIONS":
        from fastapi.responses import Response
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": request.headers.get(
                    "access-control-request-headers", "*"
                ),
                "Access-Control-Allow-Private-Network": "true",
                "Access-Control-Max-Age": "600",
            },
        )
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Access-Control-Allow-Origin"] = request.headers.get("origin", "*")
    return response


@app.get("/health")
def health() -> dict:
    """Lightweight check for the web app to detect the agent.

    Phase B8: returns `capabilities[]` so the frontend can disable any
    Action button whose backing endpoint isn't supported by the running
    agent version. Older agents (pre-1.4.0) won't include this field;
    callers must treat it as optional.
    """
    return {
        "ok": True,
        "version": AGENT_VERSION,
        "sap_connected": state.sap_connected,
        "started_at": state.started_at,
        "citrix": detect_citrix(),
        "capabilities": AGENT_CAPABILITIES,
        # v2.1.0 — Phase A master-controller fields (additive)
        "ws_connected": _health_ws_connected(),
        "sap_attached": state.sap_connected,
        "job_age_seconds": _health_job_age_seconds(),
        "job_progress_unchanged_seconds": _health_job_progress_unchanged_seconds(),
        "identity_status": _health_identity_status(),
        "last_sap_error": state.last_sap_error,
    }


def _set_last_sap_error(reason: Optional[str]) -> None:
    state.last_sap_error = reason


def _clear_last_sap_error() -> None:
    state.last_sap_error = None


def _touch_active_job_progress() -> None:
    """Bump progress clock when SAP work advances."""
    with state.active_job_lock:
        if state.active_job_id is not None:
            state.active_job_progress_at = time.time()


def _health_identity_status() -> str:
    if state.work_service_jwt:
        return "ok"
    failures = int(_work_service_jwt_state.get("failures", 0))
    if failures > 0:
        return "rejected"
    return "unknown"


def _health_job_age_seconds() -> Optional[int]:
    started = state.active_job_started_at
    if started is None:
        return None
    return max(0, int(time.time() - started))


def _health_job_progress_unchanged_seconds() -> Optional[int]:
    if state.active_job_id is None:
        return None
    progress_at = state.active_job_progress_at or state.active_job_started_at
    if progress_at is None:
        return None
    return max(0, int(time.time() - progress_at))


def _health_ws_connected() -> bool:
    client = _work_ws_state.get("client")
    if client is None:
        return False
    try:
        return bool(client.is_connected())
    except Exception:
        return False


@app.post("/admin/ws/reconnect")
def admin_ws_reconnect() -> dict:
    """Master-controller: force WS client stop()+start()."""
    client = _work_ws_state.get("client")
    if client is None:
        _work_ws_state["started"] = False
        _start_work_service_ws_client()
        client = _work_ws_state.get("client")
    else:
        try:
            client.stop()
        except Exception as e:
            return {"ok": False, "error": f"ws stop failed: {e!r}"}
        _work_ws_state["started"] = False
        try:
            client.start()
            _work_ws_state["started"] = True
        except Exception as e:
            return {"ok": False, "error": f"ws start failed: {e!r}"}
    ws_connected = _health_ws_connected()
    last_msg_at = 0.0
    if client is not None:
        try:
            last_msg_at = float(client.last_message_received_at())
        except Exception:
            pass
    return {
        "ok": True,
        "ws_connected": ws_connected,
        "last_message_received_at": last_msg_at,
    }


class AdminJobAbortRequest(BaseModel):
    detail: str = "aborted by master controller"


@app.post("/admin/job/abort")
def admin_job_abort(req: AdminJobAbortRequest) -> dict:
    """Master-controller: fail active job with step='master-abort'. Idempotent if terminal."""
    with state.active_job_lock:
        job_id = state.active_job_id
    if not job_id:
        return {"ok": True, "aborted": False, "reason": "no_active_job"}
    result = jobs_fail(
        job_id,
        JobFailRequest(
            error=req.detail[:500],
            step="master-abort",
            result={"master_abort": True, "detail": req.detail},
        ),
    )
    rows_affected = int(result.get("rows_affected", 0) or 0)
    aborted = bool(result.get("ok"))
    already_terminal = aborted and rows_affected == 0
    if aborted and rows_affected > 0:
        with state.active_job_lock:
            if state.active_job_id == job_id:
                state.active_job_id = None
                state.active_job_started_at = None
                state.active_job_progress_at = None
                state.active_job_endpoint = None
        _job_poller_state["current_job_id"] = None
        try:
            _kick_job_poller("master-abort")
        except Exception:
            pass
    return {
        "ok": True,
        "aborted": rows_affected > 0,
        "already_terminal": already_terminal,
        "job_id": job_id,
        "rows_affected": rows_affected,
        "skipped_reason": result.get("skipped_reason"),
    }


@app.post("/admin/sap/reattach")
def admin_sap_reattach() -> dict:
    """Master-controller: wrap sap_connect() with typed error surface."""
    result = sap_connect()
    if result.get("ok"):
        return {
            "ok": True,
            "conn_idx": result.get("conn_idx"),
            "sess_idx": result.get("sess_idx"),
        }
    err = str(result.get("error") or "")
    if err.startswith("GetObject SAPGUI failed"):
        return {"ok": False, "error": "GetObject SAPGUI failed"}
    return {"ok": False, "error": err}


@app.get("/status")
def status() -> dict:
    return {
        "version": AGENT_VERSION,
        "sap_connected": state.sap_connected,
        "supabase_configured": bool(state.supabase_url and state.supabase_key),
        "supabase_logged_in": bool(state.supabase_token),
        "user_email": state.user_email,
        "sap_conn_idx": _sap_conn_idx,
        "sap_sess_idx": _sap_sess_idx,
        "citrix": detect_citrix(),
    }


@app.post("/sap/connect")
def sap_connect() -> dict:
    """Attach to SAP GUI and log detailed info about what was found.
    Dumps all connections/sessions to console so the user can verify
    which one the agent is using (especially important when both the
    SAP Logon launcher and active sessions are open).
    Auto-selects a valid session if the currently-selected one is dead."""
    global _sap_conn_idx, _sap_sess_idx
    try:
        w32 = _init_com()
        try:
            sap_gui = w32.GetObject("SAPGUI")
        except Exception as e:
            state.sap_connected = False
            _set_last_sap_error("sapgui_getobject_failed")
            return {"ok": False, "error": f"GetObject SAPGUI failed: {e}"}
        try:
            app_obj = sap_gui.GetScriptingEngine
        except Exception as e:
            state.sap_connected = False
            _set_last_sap_error("scripting_engine_failed")
            return {"ok": False, "error": f"GetScriptingEngine failed: {e}"}

        # --- DIAGNOSTIC: dump all connections + sessions to console ---
        print("\n[sap]   Scanning SAP Scripting Engine children...")
        try:
            total_conns = app_obj.Children.Count
            print(f"[sap]   Found {total_conns} connection(s)")
            for ci in range(total_conns):
                try:
                    c = app_obj.Children(ci)
                    try:
                        c_desc = c.Description
                    except Exception:
                        c_desc = "(no description)"
                    try:
                        c_conn_str = c.ConnectionString
                    except Exception:
                        c_conn_str = ""
                    n_sess = c.Children.Count
                    marker = " <-- SELECTED" if ci == _sap_conn_idx else ""
                    print(f"[sap]     [{ci}] {c_desc}  ({n_sess} session{'s' if n_sess != 1 else ''}){marker}")
                    if c_conn_str:
                        print(f"[sap]         conn string: {c_conn_str}")
                    for si in range(n_sess):
                        try:
                            s = c.Children(si)
                            try:
                                info = s.Info
                                tx = info.Transaction
                                sys_name = info.SystemName
                                client = info.Client
                                user = info.User
                            except Exception:
                                tx, sys_name, client, user = "?", "?", "?", "?"
                            sel = " <-- SELECTED" if (ci == _sap_conn_idx and si == _sap_sess_idx) else ""
                            print(f"[sap]         Session[{si}]: sys={sys_name} client={client} user={user} tx={tx}{sel}")
                        except Exception as e:
                            print(f"[sap]         Session[{si}]: error reading: {e}")
                except Exception as e:
                    print(f"[sap]     [{ci}] error reading: {e}")
        except Exception as e:
            print(f"[sap]   Could not enumerate: {e}")

        # Try the currently-selected session first
        conn = None
        sess = None
        try:
            conn = app_obj.Children(_sap_conn_idx)
            sess = conn.Children(_sap_sess_idx)
            sess.findById("wnd[0]")
        except Exception:
            conn = None
            sess = None

        # If current selection is invalid, auto-pick the first valid one
        if sess is None:
            ci, si = _auto_select_valid_session()
            if ci is None:
                state.sap_connected = False
                _set_last_sap_error("no_active_session")
                msg = (
                    "No active SAP GUI session found. Please log in to an SAP "
                    "system first: open SAP Logon, double-click a system (e.g. "
                    "Productive), and sign in. Then click Retry."
                )
                print(f"[sap]   ERROR: {msg}")
                return {"ok": False, "error": msg}
            print(f"[sap]   Auto-selected conn={ci}, sess={si} (previous {_sap_conn_idx},{_sap_sess_idx} was invalid)")
            _sap_conn_idx = ci
            _sap_sess_idx = si
            conn = app_obj.Children(ci)
            sess = conn.Children(si)

        try:
            desc = conn.Description
        except Exception:
            desc = "SAP GUI"

        session_detail = ""
        try:
            info = sess.Info
            session_detail = f" (system={info.SystemName} client={info.Client} user={info.User} tx={info.Transaction})"
        except Exception:
            pass

        try:
            wnd0 = sess.findById("wnd[0]")
            wnd_title = wnd0.Text or ""
            print(f"[sap]   Selected session wnd[0] title: '{wnd_title}'")
        except Exception as e:
            state.sap_connected = False
            _set_last_sap_error("session_window_unusable")
            msg = f"Selected session has no usable window: {e}"
            print(f"[sap]   ERROR: {msg}")
            return {"ok": False, "error": msg}

        state.sap_connected = True
        _clear_last_sap_error()
        print(f"[sap]   Connected to: {desc}{session_detail}")
        return {
            "ok": True,
            "message": f"Connected to {desc}{session_detail}",
            "conn_idx": _sap_conn_idx,
            "sess_idx": _sap_sess_idx,
        }
    except Exception as e:
        state.sap_connected = False
        _set_last_sap_error("sap_connect_unhandled")
        return {"ok": False, "error": str(e)}


@app.post("/sap/disconnect")
def sap_disconnect() -> dict:
    state.sap_connected = False
    return {"ok": True}


@app.get("/sap/sessions")
def sap_sessions() -> dict:
    """Enumerate SAP connections + sessions for the picker UI.

    v1.7.9 — each session entry now carries identity fields
    (`system`, `client`, `user`, `transaction`) so the picker can
    render env-coloured pills, plus two booleans:
      - `pinned`     true when this session matches `state.pinned_session`
                     (by exact indexes OR by criteria when pin.by_criteria)
      - `is_active`  true when this is the currently-attached session
                     (`(_sap_conn_idx, _sap_sess_idx)`)
    The top-level response also echoes `pinned_session` so the picker
    can show the pinned criteria even if the underlying SAP session is
    not currently visible.
    """
    pin = state.pinned_session
    pin_ci = int(pin.get("conn_idx", -1)) if pin else -1
    pin_si = int(pin.get("sess_idx", -1)) if pin else -1
    pin_sys = str(pin.get("system", "")) if pin else ""
    pin_client = str(pin.get("client", "")) if pin else ""
    pin_user = str(pin.get("user", "")) if pin else ""
    pin_by_criteria = bool(pin.get("by_criteria", True)) if pin else False
    try:
        w32 = _init_com()
        sap_gui = w32.GetObject("SAPGUI")
        app_obj = sap_gui.GetScriptingEngine
        # v1.8.1 — two-pass build so EXACTLY ONE session is flagged
        # `pinned=True` even when pin_by_criteria matches multiple
        # sessions sharing the same (system, client, user). Previously
        # the criteria-match branch flagged every matching session, so
        # a user with 6 SAP windows on PRD/800/U8206556 saw "PINNED" on
        # every dropdown row. Winner selection order:
        #   1. Exact (conn_idx, sess_idx) match (survives across the
        #      usual auto-reconnect where indexes are stable)
        #   2. If pin_by_criteria AND no exact match was found, the
        #      FIRST session whose (system, client, user) matches
        #      (stable because enumeration is deterministic — conn
        #      index ascending, session index ascending)
        # Pass 1: collect every session into raw_sessions AND compute
        # candidates for the winner selector.
        raw_sessions: list[dict] = []
        exact_winner: tuple[int, int] | None = None
        criteria_candidates: list[tuple[int, int]] = []
        for ci in range(app_obj.Children.Count):
            conn = app_obj.Children(ci)
            try:
                desc = conn.Description
            except Exception:
                desc = f"Connection {ci}"
            for si in range(conn.Children.Count):
                sess = conn.Children(si)
                sys_name = ""
                client = ""
                user = ""
                tx = ""
                try:
                    info = sess.Info
                    sys_name = info.SystemName or ""
                    client = info.Client or ""
                    user = info.User or ""
                    tx = info.Transaction or ""
                    label = f"{sys_name} / {tx}"
                except Exception:
                    label = f"Session {si}"
                raw_sessions.append(
                    {
                        "ci": ci,
                        "conn_desc": str(desc),
                        "index": si,
                        "label": label,
                        "system": sys_name,
                        "client": client,
                        "user": user,
                        "transaction": tx,
                    }
                )
                if pin:
                    if pin_ci == ci and pin_si == si:
                        exact_winner = (ci, si)
                    elif pin_by_criteria and (
                        sys_name == pin_sys
                        and client == pin_client
                        and user == pin_user
                    ):
                        criteria_candidates.append((ci, si))

        winner: tuple[int, int] | None = None
        if pin:
            if exact_winner is not None:
                winner = exact_winner
            elif criteria_candidates:
                # Deterministic first match — enumeration order above
                # is (conn ascending, session ascending).
                winner = criteria_candidates[0]

        # Pass 2: build the response, flagging the winner only.
        result: list[dict] = []
        current_conn: dict | None = None
        for s in raw_sessions:
            ci = s["ci"]
            if current_conn is None or current_conn["index"] != ci:
                current_conn = {"index": ci, "label": s["conn_desc"], "sessions": []}
                result.append(current_conn)
            is_winner = (winner is not None and winner == (ci, s["index"]))
            current_conn["sessions"].append(
                {
                    "index": s["index"],
                    "label": s["label"],
                    "system": s["system"],
                    "client": s["client"],
                    "user": s["user"],
                    "transaction": s["transaction"],
                    "pinned": is_winner,
                    "is_active": (
                        ci == _sap_conn_idx and s["index"] == _sap_sess_idx
                    ),
                }
            )
        return {
            "ok": True,
            "connections": result,
            "selected_conn": _sap_conn_idx,
            "selected_sess": _sap_sess_idx,
            "pinned_session": pin,
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "connections": [],
            "selected_conn": _sap_conn_idx,
            "selected_sess": _sap_sess_idx,
            "pinned_session": pin,
        }


@app.post("/sap/session")
def set_session(req: SessionSelectRequest) -> dict:
    """Set which SAP connection/session to use. Validates that the
    selection has a usable main window before accepting."""
    global _sap_conn_idx, _sap_sess_idx
    try:
        w32 = _init_com()
        sap_gui = w32.GetObject("SAPGUI")
        app_obj = sap_gui.GetScriptingEngine
        conn = app_obj.Children(int(req.conn_idx))
        sess = conn.Children(int(req.sess_idx))
        sess.findById("wnd[0]")  # validate usable window
    except Exception as e:
        return {
            "ok": False,
            "error": f"Invalid session selection (conn={req.conn_idx}, "
                     f"sess={req.sess_idx}): {e}. "
                     f"Pick a session that shows an SAP Easy Access or "
                     f"active transaction window.",
        }
    _sap_conn_idx = int(req.conn_idx)
    _sap_sess_idx = int(req.sess_idx)
    print(f"[sap]   Session manually selected: conn={_sap_conn_idx}, sess={_sap_sess_idx}")
    return {"ok": True, "conn_idx": _sap_conn_idx, "sess_idx": _sap_sess_idx}


# ---------------------------------------------------------------------------
#  v1.7.9 — SAP Session Pinning
# ---------------------------------------------------------------------------
# Bind the agent to ONE specific SAP GUI session so manual SAP work in
# other sessions (different system / client / user) doesn't get hijacked
# by the agent's auto-select. The pin is persisted to config.json so it
# survives EXE rebuild + restart. When pinned, `_auto_select_valid_session`
# stays disconnected if the pinned session disappears (rather than silently
# attaching to a different one). See `state.pinned_session` for the shape
# and [[Implement-SAP-Session-Pinning]] for the user-facing flow.
class SelectSessionRequest(BaseModel):
    conn_idx: int
    sess_idx: int
    # When True (default), the agent ALSO captures system/client/user
    # so a future SAP GUI restart that renumbers sessions can still
    # find the right one by criteria. Set to False to pin strictly to
    # the (conn_idx, sess_idx) pair (rare — useful for transient debug
    # scenarios where you don't want the criteria-match fallback).
    pin_by_criteria: bool = True


@app.post("/sap/select-session")
def select_session(req: SelectSessionRequest) -> dict:
    """Pin the agent to a specific SAP GUI session. Survives EXE restart
    via config.json. Subsequent auto-attach attempts (`/sap/connect`, the
    `_start_sap_autoconnect_loop` daemon, `_get_sap_session()` fallback)
    will ONLY use this session — they will NOT silently jump to a
    different one if the pinned session disappears.

    Use POST /sap/unpin-session to release the pin and resume auto-select.
    """
    global _sap_conn_idx, _sap_sess_idx
    try:
        w32 = _init_com()
        sap_gui = w32.GetObject("SAPGUI")
        app_obj = sap_gui.GetScriptingEngine
    except Exception as e:
        return {
            "ok": False,
            "error": f"Could not reach SAP Scripting Engine: {e}",
        }

    try:
        conn = app_obj.Children(int(req.conn_idx))
        sess = conn.Children(int(req.sess_idx))
        sess.findById("wnd[0]")  # validate usable window
        sys_now, client_now, user_now = _read_session_identity(sess)
        # v1.8.1 — also capture the active TX code at pin time. Stored
        # on the pin record as a tiebreaker hint (/sap/sessions picks
        # the winner deterministically today, but shipping the TX now
        # lets future disambiguation logic use it without another
        # config rev). Never breaks the pin: a failed read is harmless.
        tx_now = ""
        try:
            tx_now = sess.Info.Transaction or ""
        except Exception:
            tx_now = ""
    except Exception as e:
        return {
            "ok": False,
            "error": (
                f"Session ({req.conn_idx},{req.sess_idx}) not valid: {e}. "
                "Pick a session that shows an SAP Easy Access or active "
                "transaction window."
            ),
        }

    criteria = {
        "conn_idx": int(req.conn_idx),
        "sess_idx": int(req.sess_idx),
        "system": sys_now,
        "client": client_now,
        "user": user_now,
        "transaction": tx_now,
        "pinned_at": datetime.utcnow().isoformat() + "Z",
        "by_criteria": bool(req.pin_by_criteria),
    }

    state.pinned_session = criteria
    state.persist_config()

    _sap_conn_idx = int(req.conn_idx)
    _sap_sess_idx = int(req.sess_idx)
    state.sap_connected = True

    print(
        f"[sap]   PINNED to session ({_sap_conn_idx},{_sap_sess_idx}): "
        f"system={sys_now or '?'} client={client_now or '?'} "
        f"user={user_now or '?'} tx={tx_now or '?'} "
        f"(by_criteria={criteria['by_criteria']})"
    )

    return {"ok": True, "pinned": criteria}


@app.post("/sap/unpin-session")
def unpin_session() -> dict:
    """Clear the SAP session pin and return to auto-select mode. The
    next auto-connect tick (or `/sap/connect` call) will pick the first
    usable session as in v1.7.8.
    """
    had_pin = state.pinned_session is not None
    prior = state.pinned_session if had_pin else None
    state.pinned_session = None
    state.persist_config()
    if had_pin:
        print(
            "[sap]   Session pin CLEARED — agent will auto-select on next "
            f"attach (was: sys={(prior or {}).get('system','?')} "
            f"client={(prior or {}).get('client','?')} "
            f"user={(prior or {}).get('user','?')})."
        )
    else:
        print("[sap]   /sap/unpin-session called but no pin was active — no-op.")
    return {"ok": True, "had_pin": had_pin}


@app.get("/sap/shipment-progress")
def shipment_progress() -> dict:
    """Return the current live progress of the running shipment. Polled
    by the web UI every second to drive the progress bar."""
    with _progress_lock:
        return dict(_shipment_progress)


@app.post("/supabase/login")
def supabase_login(req: SupabaseConfigRequest) -> dict:
    state.supabase_url = req.url.rstrip("/")
    state.supabase_key = req.key
    try:
        if req.email and req.password:
            resp = _supabase_request(
                "POST",
                f"{state.supabase_url}/auth/v1/token?grant_type=password",
                json={"email": req.email, "password": req.password},
                headers={
                    "apikey": state.supabase_key,
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            state.supabase_token = data.get("access_token", "")
            # v1.7.2 — capture the refresh token + absolute expiry so the
            # in-process `_refresh_supabase_token_if_needed` helper can
            # silently roll the JWT before it expires (the access_token
            # lives ~1h; without rotation every authenticated path
            # 401'd at minute 60 until the user re-logged-in by hand).
            state.refresh_token = data.get("refresh_token", "") or ""
            try:
                expires_in = int(data.get("expires_in", 0) or 0)
            except (TypeError, ValueError):
                expires_in = 0
            state.token_expires_at = (time.time() + expires_in) if expires_in > 0 else 0.0
            state.user_id = data.get("user", {}).get("id", "")
            state.user_email = data.get("user", {}).get("email", "")

            profile = _supabase_request(
                "GET",
                f"{state.supabase_url}/rest/v1/user_profiles"
                f"?id=eq.{state.user_id}&select=organization_id",
                headers={
                    "apikey": state.supabase_key,
                    "Authorization": f"Bearer {state.supabase_token}",
                },
            ).json()
            if profile and len(profile) > 0:
                state.org_id = profile[0].get("organization_id", "")

        # v1.6.5 — agent_token is now per-machine, not per-session. Only
        # mint here when the persistent token has been wiped (e.g. after
        # /supabase/logout, or a fresh first-boot before the heartbeat
        # ran). The default flow rehydrates the same token across EXE
        # rebuilds so the localStorage X-Agent-Token in the browser keeps
        # working without forcing the user back through this dialog.
        if not state.agent_token:
            state.agent_token = secrets.token_urlsafe(32)
        state.persist_config()
        # Phase D #13/16 — now that we have a JWT + org_id, do an
        # immediate registry upsert and (re)arm the Realtime subscription
        # so the user sees this agent online without waiting 30s.
        try:
            _upsert_self_in_registry("online")
        except Exception as _e:
            print(f"[heartbeat] post-login registry upsert failed: {_e}")
        try:
            if not _realtime_state.get("active"):
                _start_realtime_subscription()
        except Exception as _e:
            print(f"[realtime] post-login (re)start failed: {_e}")
        return {
            "ok": True,
            "email": state.user_email,
            "agent_token": state.agent_token,
            "user_id": state.user_id,
            "org_id": state.org_id,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  /supabase/session + /supabase/logout (v1.6.4 — actual route mount)
# ---------------------------------------------------------------------------
# v1.6.3 advertised these as capabilities (`supabase-session`,
# `agent-supabase-logout`) and the middleware exempted them from auth
# enforcement, but the route handlers themselves were never registered
# on `app`, so the AgentSupabaseStatusButton in the web UI saw 404
# (no token sent) or 401 (stale token race) on every poll. The dialog
# also couldn't disconnect — `POST /supabase/logout` returned 404.
# Mounting them here unblocks the "Connect Account" pill across all
# SAP Testing tabs.

@app.get("/supabase/session")
def supabase_session() -> dict:
    """Return current Supabase login state. Read-only and side-effect
    free — `AgentSupabaseStatusButton` polls this every 30s to render
    the green/yellow pill in every tab's status bar.

    v1.7.2 — opportunistically attempt a refresh BEFORE answering, then
    report `logged_in: false` with `reason: 'expired'` if the cached
    token is past `token_expires_at` and no refresh succeeded. Without
    this the pill kept reading "Signed in" for an hour after the JWT
    expired (the existence of `state.supabase_token` was the only check).
    """
    try:
        _refresh_supabase_token_if_needed()
    except Exception:
        pass
    has_token = bool(state.supabase_token)
    expired = (
        state.token_expires_at > 0.0
        and time.time() >= state.token_expires_at
    )
    logged_in = has_token and not expired
    body: dict[str, Any] = {
        "ok": True,
        "logged_in": logged_in,
        "email": state.user_email or None,
        "user_id": state.user_id or None,
        "org_id": state.org_id or None,
    }
    if has_token and expired:
        # Surface a machine-readable hint so the frontend can render
        # "Reconnect Account" copy instead of "Connect Account".
        body["reason"] = "expired"
        body["expires_at"] = state.token_expires_at
    return body


@app.post("/supabase/logout")
def supabase_logout() -> dict:
    """Clear the cached Supabase JWT + identifying user info. The Supabase
    URL/anon key in `config.json` are kept so a subsequent `/supabase/login`
    can re-arm without re-typing them. Also tears down the agent-direct
    Realtime subscription so we don't sit listening with an invalid JWT —
    `_start_realtime_subscription` will rearm on the next login.

    v1.6.5 — `agent_token` is NO LONGER cleared by logout. It's now a
    per-machine token, not a per-Supabase-session token, so logging out
    of Supabase shouldn't kick the browser back to the Connect Account
    dialog every time. The user can rotate it explicitly via
    `POST /agent-token/rotate` if a security event demands it.
    """
    state.supabase_token = ""
    # v1.7.2 — clear the refresh token + expiry alongside the access
    # token so a subsequent /supabase/session correctly reports
    # logged_in=false (and the auto-refresh helper can't accidentally
    # rehydrate a logged-out session).
    state.refresh_token = ""
    state.token_expires_at = 0.0
    state.user_id = ""
    state.user_email = ""
    state.org_id = ""
    state.persist_config()
    try:
        _stop_realtime_subscription()
    except Exception as e:
        print(f"[realtime] stop on logout failed: {e}")
    return {"ok": True}


@app.get("/agent-token/check")
def agent_token_check() -> dict:
    """v1.6.5 — token-validity probe used by `useAgentDetection` on the
    frontend. Auth-required: the middleware already rejected the request
    with 401 if the X-Agent-Token header was missing or stale, so by the
    time we land here we know the caller is authenticated. We just
    return some metadata so the frontend can light up an "Agent online +
    authenticated" badge instead of the misleading "SAP Agent Not
    Detected" banner that v1.6.4 showed even for stale-token cases.

    Two failure modes the frontend interprets:
      - Network error / timeout       → agent process is down.
      - 401 Unauthorized              → process up, token stale.
      - 200 with this body            → process up + token valid.
    """
    return {
        "ok": True,
        "agent_token_valid": True,
        "version": AGENT_VERSION,
        "agent_id": _agent_self_id(),
        "process_started_at": _AGENT_PROCESS_STARTED_AT,
    }


@app.post("/agent-token/rotate")
def agent_token_rotate() -> dict:
    """v1.6.5 — explicit user-driven token rotation. Auth-required: the
    caller must already hold the current token (the middleware
    rejects mismatching tokens with 401), so a hostile local process
    can't rotate the token out from under the legitimate browser
    session. After a successful rotation:

      - The new token is persisted to config.json (survives EXE restart).
      - The old token is invalidated; any other browser tab still using
        it will start getting 401s and trigger its own stale-token
        recovery flow.
      - The frontend that called us reads `new_token` from the response
        and updates its localStorage immediately.

    Used for security events (suspect compromise, deliberate machine
    handoff). Day-to-day flow does NOT need this — `/supabase/login` no
    longer rotates the token, so the typical user never sees this
    endpoint.
    """
    new_token = secrets.token_urlsafe(32)
    state.agent_token = new_token
    state.persist_config()
    return {
        "ok": True,
        "new_token": new_token,
        "rotated_at": datetime.utcnow().isoformat() + "Z",
    }


# ---------------------------------------------------------------------------
#  Metrics (Phase B6)
# ---------------------------------------------------------------------------
@app.get("/metrics")
def metrics() -> dict:
    """Lightweight self-reported health for the dashboard card.

    Frontend polls this every 30s and renders a sparkline-style card in
    Inventory Management. All counters live in-memory (reset on agent
    restart); the source of truth for long-term observability is the
    `sap_audit_log` table (Phase A3).
    """
    started_dt = datetime.fromisoformat(state.started_at.replace("Z", "+00:00"))
    uptime_seconds = max(0, int((datetime.now(started_dt.tzinfo) - started_dt).total_seconds()))

    session_info: dict[str, Any] = {}
    try:
        if state.sap_connected:
            sess, _ = _get_sap_session()
            info = sess.Info
            session_info = {
                "system": info.SystemName,
                "client": info.Client,
                "user": info.User,
                "transaction": info.Transaction,
            }
    except Exception:
        session_info = {}

    with _METRICS_LOCK:
        # Compute the 24h rollup. We don't persist a sliding window here
        # (would balloon memory) — counters are lifetime-of-process and
        # the dashboard labels them as "since boot".
        breakdown: dict[str, dict[str, Any]] = {}
        for action, b in _metrics_state["transactions"].items():
            avg_ms = (b["total_ms"] // b["count_with_ms"]) if b["count_with_ms"] else 0
            breakdown[action] = {
                "success": b["success"],
                "fail": b["fail"],
                "warning": b.get("warning", 0),
                "avg_ms": avg_ms,
                "total": b["success"] + b["fail"] + b.get("warning", 0),
            }
        current_action = _metrics_state["current_action"]
        last_errors = list(_metrics_state["last_5_errors"])

    return {
        "ok": True,
        "version": AGENT_VERSION,
        "uptime_seconds": uptime_seconds,
        "sap_connected": state.sap_connected,
        "session_info": session_info,
        "transactions_24h": breakdown,
        "current_action": current_action,
        "last_5_errors": last_errors,
        "queue_poller_active": _job_poller_state.get("active", False),
        "capabilities": AGENT_CAPABILITIES,
    }


@app.get("/realtime/status")
def realtime_status() -> dict:
    """v1.8.0 — Diagnostic for the Realtime subsystem.

    Surfaces the v1.7.1 exception circuit breaker AND the v1.8.0
    clean-close circuit breaker plus the live connection state so a
    frontend can show a "Realtime: connected/degraded/polling-only"
    pill instead of just the binary "agent connected/disconnected"
    signal /health gives. All values come from in-memory state on
    the agent — no database round-trip — so this endpoint is safe to
    poll at the same cadence as /health (1-3s).

    Schema (stable contract):
      {
        "connected": bool,
        "circuit_tripped": bool,
        "fallback_mode": "realtime" | "polling-only",
        "spurious_close_count_60s": int,
        "exception_count_60s": int,
        "last_event_at": ISO8601 | None,
        "uptime_seconds": int,         # connection uptime, 0 when disconnected
        "agent_uptime_seconds": int,   # process uptime, for sanity/correlation
        "version": str,                # agent version (mirrors /health)
        # v1.8.4 additions —
        "consecutive_trips": int,      # trips without an intervening
                                       #   stable connection; drives the
                                       #   exponential cooldown ladder
        "next_retry_seconds": int,     # countdown to next reconnect
                                       #   attempt; 0 when not tripped
        "recommended_action": str,     # human-readable next step,
                                       #   e.g. "Set OMNIFRAME_DISABLE_REALTIME=1
                                       #   to fully disable Realtime if circuit
                                       #   keeps tripping"
        "realtime_disabled_via_env": bool,  # OMNIFRAME_DISABLE_REALTIME=1
        "details": {                   # extra fields for debug UIs; non-stable
          ... breaker snapshots ...
        }
      }

    Read-only — never mutates state. Exempt from the agent-token
    middleware (see _TOKEN_EXEMPT_PATHS) so the status pill can
    render before the user has logged into Supabase.
    """
    breaker_snap = _realtime_circuit_breaker.snapshot()
    close_snap = _realtime_clean_close_tracker.snapshot()
    circuit_tripped = bool(state.realtime_disabled or breaker_snap.get("tripped"))
    connected = bool(_realtime_state.get("connected"))
    connected_at_ts = _realtime_state.get("connected_at")
    uptime_seconds = (
        max(0, int(time.time() - float(connected_at_ts)))
        if connected and connected_at_ts is not None
        else 0
    )
    try:
        started_dt = datetime.fromisoformat(state.started_at.replace("Z", "+00:00"))
        agent_uptime = max(
            0,
            int((datetime.now(started_dt.tzinfo) - started_dt).total_seconds()),
        )
    except Exception:
        agent_uptime = 0
    # v1.8.4 — exponential-cooldown countdown + recommendation.
    consecutive_trips = int(_realtime_reset_state.get("consecutive_trips", 0))
    next_at = _realtime_reset_state.get("next_retry_at")
    next_retry_seconds = (
        max(0, int(float(next_at) - time.time()))
        if next_at is not None
        else 0
    )
    disabled_via_env = _is_realtime_disabled_via_env()
    if disabled_via_env:
        recommended_action = (
            "Realtime is OFF via OMNIFRAME_DISABLE_REALTIME=1 — agent is "
            "in polling-only mode by user choice. Unset the env var and "
            "restart the agent to re-enable Realtime."
        )
    elif consecutive_trips >= 3:
        recommended_action = (
            f"Circuit has tripped {consecutive_trips} times in a row "
            "without a stable connection. Realtime is likely chronically "
            "broken (Supabase tenant overload, dead JWT, broken DNS). "
            "Set OMNIFRAME_DISABLE_REALTIME=1 and restart the agent to "
            "fully disable Realtime — polling-only mode is well-tested "
            "and won't lose any work, only sub-second push wakes."
        )
    elif circuit_tripped:
        cooldown_min = max(1, int(round(next_retry_seconds / 60.0)))
        recommended_action = (
            f"Circuit breaker tripped — auto-retry in ~{cooldown_min}min. "
            "If this keeps tripping, set OMNIFRAME_DISABLE_REALTIME=1 "
            "and restart to disable Realtime entirely (polling-only mode)."
        )
    else:
        recommended_action = (
            "Realtime is healthy. No action needed."
        )
    return {
        "connected": connected,
        "circuit_tripped": circuit_tripped,
        "fallback_mode": "polling-only" if circuit_tripped else "realtime",
        "spurious_close_count_60s": int(close_snap.get("spurious_close_count_60s", 0)),
        "exception_count_60s": int(breaker_snap.get("errors_in_window", 0)),
        "last_event_at": _realtime_state.get("last_event_at"),
        "uptime_seconds": uptime_seconds,
        "agent_uptime_seconds": agent_uptime,
        "version": AGENT_VERSION,
        # v1.8.4 stable contract additions
        "consecutive_trips": consecutive_trips,
        "next_retry_seconds": next_retry_seconds,
        "recommended_action": recommended_action,
        "realtime_disabled_via_env": disabled_via_env,
        "details": {
            "fallback_reason": _realtime_state.get("fallback_reason"),
            "reconnect_attempts": int(_realtime_state.get("reconnect_attempts", 0)),
            "exception_breaker": breaker_snap,
            "clean_close_tracker": close_snap,
            "heartbeat_interval_sec": _REALTIME_HEARTBEAT_INTERVAL_SEC,
            "active": bool(_realtime_state.get("active")),
            # v1.8.4 — surface the new config knobs
            "reconnect_initial_delay_sec": _REALTIME_RECONNECT_INITIAL_DELAY_SEC,
            "reconnect_max_delay_sec": _REALTIME_RECONNECT_MAX_DELAY_SEC,
            "reconnect_delay_increment_sec": _REALTIME_RECONNECT_DELAY_INCREMENT_SEC,
            "stable_connection_sec": _REALTIME_STABLE_CONNECTION_SEC,
            "circuit_initial_cooldown_sec": _REALTIME_CIRCUIT_INITIAL_COOLDOWN_SEC,
            "circuit_max_cooldown_sec": _REALTIME_CIRCUIT_MAX_COOLDOWN_SEC,
            "next_retry_at": next_at,
        },
    }


# ---------------------------------------------------------------------------
#  Job Queue (Phase A1)
# ---------------------------------------------------------------------------
# State for the background poller. Started via FastAPI lifespan if a
# Supabase token is present at boot, or rearmed after /supabase/login.
#
# Phase D #16 (Agent-Direct Realtime) — `_drain_event` is set by the
# Realtime subscription thread (or any external waker) so the poller
# wakes immediately on a fresh INSERT. Without Realtime, the poller
# falls back to the 60s sleep.
#
# Phase D #13 (Multi-Agent Coordination) — `current_job_id` is the
# row currently dispatching on the SAP COM thread. The heartbeat
# thread bumps its lease every 30s so other agents don't re-claim it.
_job_poller_state: dict[str, Any] = {
    "active": False,
    "thread": None,
    "stop_event": None,
    "drain_event": None,
    # Legacy mirror of `state.active_job_id` kept around for
    # `_build_agent_registry_row` and any `/status` consumer that still
    # reads this key. The authoritative value lives on `AgentState`
    # now — see `state.active_job_id` + `state.active_job_lock`.
    "current_job_id": None,
    "poll_interval_sec": 60.0,  # was 5 — Realtime now drives the wake-ups
}

# v1.7.0 — drain-back-to-back tuning constants. Picked for "human-
# perceptible responsiveness on a real queue":
#
#   - `_DRAIN_MIN_IDLE_SEC` (5) — the floor between empty polls. Even
#     on a totally idle agent, we won't wait longer than 5s on a fresh
#     idle cycle. Short enough that a missed Realtime wake-up only
#     costs the user 5s of latency. Long enough to keep CPU + HTTP
#     load negligible (1 claim RPC every 5s = 12/min).
#   - `_DRAIN_MAX_IDLE_SEC` (60) — the ceiling. After many consecutive
#     empty polls the backoff caps here. Matches the existing v1.6.x
#     fallback interval so nothing regresses.
#   - `_DRAIN_MAX_CHAIN` (50) — a single back-to-back drain will
#     claim + dispatch at most 50 jobs before handing control back to
#     the outer wait loop. The cap exists purely to keep stop_event
#     responsive during shutdown (the loop checks stop_event between
#     claims; 50 * avg 20s/job = 16min max blackout before a graceful
#     Ctrl-C). In practice a production queue rarely exceeds 10-20
#     jobs back-to-back so the cap is slack.
#
# Why not make these env-tunable? The drain logic's correctness
# doesn't depend on the exact values — it depends on "minimum > 0"
# and "chain cap > 0". Hard-coding keeps the surface area small.
_DRAIN_MIN_IDLE_SEC: float = 5.0
_DRAIN_MAX_IDLE_SEC: float = 60.0
_DRAIN_MAX_CHAIN: int = 50

# Phase D #13 — fleet registration / heartbeat thread state.
_agent_heartbeat_state: dict[str, Any] = {
    "active": False,
    "thread": None,
    "stop_event": None,
    "registered": False,
    "interval_sec": 30.0,
}

# Phase D #16 — Supabase Realtime subscription thread state.
_realtime_state: dict[str, Any] = {
    "active": False,
    "thread": None,
    "stop_event": None,
    "connected": False,
    # v1.8.0 — `connected_at` is a `time.time()` timestamp set the
    # moment after `subscribe()` succeeds and cleared on any clean
    # close / exception. Used to compute connection-age for the
    # `_RealtimeCleanCloseTracker` (spurious-close detection) and
    # surfaced via /realtime/status.uptime_seconds when connected.
    "connected_at": None,
    "last_event_at": None,
    "reconnect_attempts": 0,
    "fallback_reason": None,  # set when Realtime is unavailable
}

# v1.7.0 — sticky singleton guard for the Realtime subscription. The
# existing `_realtime_state["active"]` flag is cleared in the thread's
# `finally:` block when `asyncio.run()` returns, so a future call to
# `_start_realtime_subscription()` would start a NEW thread even
# though the first one's reconnect loop is still live inside
# `client.listen()`. Before this flag, `/supabase/login` calling the
# starter defensively could race with the startup hook's call and
# spawn two threads, each creating its own WebSocket. In production
# the user saw dozens of `[realtime] connected to wss://...` lines
# per minute, consistent with multiple reconnect loops fighting for
# the same channel (and each one generating a "deaf spot" during
# backoff).
#
# Once `True`, this flag is NEVER reset until the process exits. If
# the thread really has crashed, the user sees it in the log (the
# `asyncio.run` exception trace from the `_thread_main` crash
# handler) and can restart the agent — but we do NOT silently spawn
# a replacement thread from a random callsite, which was the actual
# problem.
_realtime_started: bool = False


# ---------------------------------------------------------------------------
#  v1.7.1 — Realtime crash-loop containment
# ---------------------------------------------------------------------------
# Production observed the agent wedge after ~25min idle on a Citrix VDA:
# the queue drain froze, the heartbeat thread stopped updating
# `sap_agents.last_seen_at`, and stderr filled with thousands of
# `Task exception was never retrieved` tracebacks per minute originating
# from `realtime\_async\client.py:139` in `_reconnect()`.
#
# Root cause is a known bug in `realtime>=2.x` (older 2.0–2.4 releases):
# when the WebSocket drops (Citrix VDA hibernate, corporate proxy idle
# close), `_on_connect_error → _reconnect()` calls `asyncio.wait()` on
# an empty pending-tasks set, raising `ValueError: Set of Tasks/Futures
# is empty.`. The library doesn't catch it, so the exception escapes
# the listen task into asyncio's default "unhandled exception" handler,
# which prints a multi-line traceback to stderr. Each crash spawns a
# NEW listen task that fails the same way. The traceback flood drowns
# every other thread because Python's print(...) is line-buffered to
# stderr and contended at high volume — even synchronous threads
# slow to a crawl when stderr is hot.
#
# The fix is layered defense:
#   (A) Install an asyncio loop exception handler that suppresses the
#       known `ValueError('Set of Tasks/Futures is empty')` and
#       `ConnectionClosedError` bursts quietly. Single change
#       eliminates 99% of stderr flooding.
#   (B) Sliding-window error counter (deque) trips a circuit breaker
#       after `_REALTIME_ERROR_THRESHOLD` errors in
#       `_REALTIME_ERROR_WINDOW_SECONDS`. Tripped circuit calls
#       `_disable_realtime_subsystem()` which logs once, sets
#       `state.realtime_disabled = True`, tears down the WebSocket
#       client, and tightens the job poller's idle backoff so we
#       don't lose throughput while polling-only carries the load.
#   (C) Threading isolation: heartbeat / job poller / watchdog /
#       backfill all run in their OWN threads with their OWN sync
#       (non-asyncio) `requests.post()` calls. A Realtime asyncio
#       crash CANNOT wedge them — only the stderr flood (now bounded
#       by A + B + D) was the actual coupling mechanism in v1.7.0.
#   (D) Bound stderr noise via Python `logging` filters so even if an
#       exception we didn't predict bypasses our handler, the console
#       doesn't flood.
#
# Auto-recovery: `_start_realtime_circuit_reset_loop` daemon resets
# the breaker every 5min so a transient Citrix unhibernate or proxy
# resume re-arms Realtime without an EXE restart.
#
# See [[Debug/Fix-Realtime-Library-CrashLoop]] +
# [[Patterns/Async-Library-Circuit-Breaker]].

# Sliding-window thresholds. Deliberately not tunable via env vars
# (keeps the runtime simple; ops don't need a knob here — if the
# breaker is tripping every 5min the right answer is to upgrade the
# realtime library or fix the network, not to widen the window).
_REALTIME_ERROR_WINDOW_SECONDS: float = 60.0
_REALTIME_ERROR_THRESHOLD: int = 20

# Auto-reset interval. Aligned with the trigger backfill poller's 60s
# cadence: we lose at most 5min of Realtime push (covered by 5x
# backfill polls) before retrying, well within the user's "minutes
# not hours" tolerance for missed-event recovery.
#
# v1.8.4 — DEPRECATED as the *initial* cooldown. Kept as the cadence
# the reset-loop daemon polls `next_retry_at` at (every 30s — see
# `_REALTIME_CIRCUIT_RESET_POLL_SEC`). The actual auto-retry after a
# breaker trip now uses the exponential-cooldown ladder below
# (30min → 60 → 120 → 240 → 360min cap) keyed off
# `_realtime_reset_state["consecutive_trips"]`.
_REALTIME_CIRCUIT_RESET_INTERVAL_SEC: float = 300.0

# v1.8.4 — Exponential cooldown ladder for the circuit-breaker reset
# loop. After each trip (clean-close OR exception path), the reset
# loop waits `_compute_realtime_cooldown_seconds(consecutive_trips)`
# before re-arming the subsystem. Doubling pattern: 30min, 60min,
# 120min, 240min, 360min (cap, ~6h). `consecutive_trips` resets to 0
# only after a Realtime connection survives at least
# `_REALTIME_STABLE_CONNECTION_SEC` so a chronically degraded tenant
# (e.g. Supabase Presence GenServer overload) gets a long break
# instead of being re-hammered every 5min.
_REALTIME_CIRCUIT_INITIAL_COOLDOWN_SEC: float = 1800.0   # 30 minutes
_REALTIME_CIRCUIT_MAX_COOLDOWN_SEC: float = 21600.0      # 6 hours
# The reset-loop daemon now wakes every 30s and checks
# `next_retry_at` against `time.time()` instead of sleeping the full
# 5min the v1.7.1 design used. 30s polling keeps the time-to-recovery
# accurate to within a half-tick while still being negligible CPU.
_REALTIME_CIRCUIT_RESET_POLL_SEC: float = 30.0

# When Realtime is disabled, tighten the job poller's idle backoff so
# polling-only mode keeps inter-job dwell low. Trigger backfill (60s)
# carries the missed-event load; we shrink the job-poll ceiling from
# 60s → 15s so a fresh `sap_agent_jobs` INSERT doesn't sit unnoticed
# for up to 60s while Realtime is offline.
_REALTIME_FALLBACK_POLL_MAX_IDLE_SEC: float = 15.0

# v1.8.0 — Clean-close circuit-breaker tier. The v1.7.1 sliding-window
# breaker only counts *exceptions* (asyncio task crashes, suppressed
# `ValueError('Set of Tasks/Futures is empty')`, ConnectionClosedError
# bursts, outer connect-loop exceptions). On a corporate-proxy box
# (Citrix → Netskope/ZScaler → internet → Supabase) the proxy
# routinely idle-closes WebSockets after 5-10 seconds, FASTER than the
# Realtime heartbeat (default 25s in `realtime>=2.x`). The library
# observes a clean WebSocket close, returns `listen()` *without*
# raising, and our outer loop reconnects in 5s. The exception breaker
# never sees an error so it never trips — but the agent is
# functionally wedged: every connection dies before any Postgres
# CHANGES events can ride on it, the heartbeat thread starves on the
# stderr churn from re-subscribe traffic, and `/sap/sessions` polls
# back up while the Realtime thread monopolizes the GIL re-handshaking
# four channels every cycle. Production console.txt at
# `MacWindowsBridge/console.txt` showed ~100+ `connected` /
# `listen() returned cleanly` pairs in a 10-minute window with the
# user-visible symptom "SAP session won't stay connected".
#
# Fix: a SECOND sliding-window counter, separate from the exception
# breaker, that records every clean close where the connection lasted
# *less than* `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC` (i.e. before
# any heartbeat could plausibly have kept it alive). 5+ in 60s →
# trip the *same* `_disable_realtime_subsystem` path the exception
# breaker uses, so polling-only fallback takes over (v1.6.9 backfill
# poller covers triggers, v1.7.0 drain-mode poller covers job claim,
# auto-retry every 5min). The exception breaker is left UNTOUCHED so
# the v1.7.1 stderr-flood guard still works in parallel.
# v1.8.4 — Aggressively tightened thresholds. v1.8.0 used
# (window=60s, threshold=5, min_age=30s) which gave the agent ~25s
# of cycling before the breaker tripped. On a chronically degraded
# Supabase tenant (Presence GenServer crash, /user 2.2s, multi-shard
# overload) that 25s of cycling compounds the tenant Realtime load
# and contributes to blocking other users from loading the web app.
# v1.8.4 trips after JUST 2 spurious closes in a 30s window with
# the min-connect-age cliff dropped to 15s — any close inside 15s of
# subscribe is now counted as spurious. Combined with the new
# exponential cooldown (30min→6h) this means a degraded tenant gets
# the agent off the Realtime channel within ~5s of the second close
# and keeps it off for 30+ minutes instead of cycling every 5min.
# See [[Debug/Fix-Realtime-Tenant-Overload]].
_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS: float = 30.0
_REALTIME_SPURIOUS_CLOSE_THRESHOLD: int = 2
_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC: float = 15.0
# Escalate the per-cycle "listen() returned cleanly" log to a clear
# WARN once 3+ spurious closes accumulate within 30s. Helps users
# reading the console diagnose "is this proxy idle-close cycling or
# just one transient blip" without having to count log lines. Throttled
# so a sustained storm only emits one WARN per minute.
_REALTIME_ESCALATE_LOG_WINDOW_SEC: float = 30.0
_REALTIME_ESCALATE_LOG_THRESHOLD: int = 3
_REALTIME_ESCALATE_LOG_THROTTLE_SEC: float = 60.0

# Tighter WebSocket heartbeat. The `realtime>=2.x` library default is
# 25s (`hb_interval=25`); we override to 10s so a Citrix/Netskope idle
# timer in the 10-30s window gets reset before it fires. 10s is well
# under the 30s typical idle-close threshold and well over the
# WebSocket frame round-trip on a healthy connection (~50ms), so the
# overhead is negligible (~0.05% extra bandwidth) on a healthy fleet.
# Older releases of `realtime` use the constructor kwarg `hb_interval`;
# we fall back gracefully if the library doesn't accept it.
_REALTIME_HEARTBEAT_INTERVAL_SEC: int = 10

# v1.8.4 — Slow additive reconnect backoff. v1.7.0/v1.8.0 reset the
# delay to 5s after every successful subscribe and doubled on each
# failure. On a flaky tenant that meant 5s, 10s, 20s, 40s, 60s, 5s,
# 10s, ... — an aggressive cycle that compounded tenant Realtime
# load. v1.8.4 starts at 15s (3x slower first reconnect), adds 5s
# per attempt (instead of doubling), caps at 60s, and resets to 15s
# ONLY after a connection survives `_REALTIME_STABLE_CONNECTION_SEC`
# (60s). The intent: even if Realtime mostly works, don't hammer
# Supabase with rapid reconnects when individual closes are
# transient. See [[Debug/Fix-Realtime-Tenant-Overload]].
_REALTIME_RECONNECT_INITIAL_DELAY_SEC: float = 15.0
_REALTIME_RECONNECT_MAX_DELAY_SEC: float = 60.0
_REALTIME_RECONNECT_DELAY_INCREMENT_SEC: float = 5.0
_REALTIME_STABLE_CONNECTION_SEC: float = 60.0


def _compute_realtime_cooldown_seconds(consecutive_trips: int) -> float:
    """v1.8.4 — Exponential backoff for the reset-loop's cooldown.

    consecutive_trips=1 → 30min (initial)
    consecutive_trips=2 → 60min (doubled)
    consecutive_trips=3 → 120min
    consecutive_trips=4 → 240min
    consecutive_trips>=5 → 360min (cap, ~6h)

    `consecutive_trips` is reset to 0 only after a Realtime connection
    survives at least `_REALTIME_STABLE_CONNECTION_SEC`. So a chronic
    failure mode (Supabase tenant Presence overload, dead JWT, broken
    DNS) gets a long break instead of being re-hammered every 5min.
    """
    n = max(1, int(consecutive_trips))
    multiplier = 1 << (n - 1)  # 1, 2, 4, 8, 16, ...
    seconds = _REALTIME_CIRCUIT_INITIAL_COOLDOWN_SEC * multiplier
    return min(_REALTIME_CIRCUIT_MAX_COOLDOWN_SEC, seconds)


def _is_realtime_disabled_via_env() -> bool:
    """v1.8.4 — `OMNIFRAME_DISABLE_REALTIME=1` escape hatch.

    Read fresh on every call so an ops user could toggle it via a
    process env edit (rare — typically set at launch). Polling-only
    mode is well-tested (v1.6.9 backfill poller + v1.7.0 drain
    mode + 5-15s job poller idle ceiling) so the agent stays fully
    functional with Realtime disabled — only Realtime-pushed
    sub-second wakes are lost.
    """
    return os.environ.get("OMNIFRAME_DISABLE_REALTIME", "") == "1"


class _RealtimeCircuitBreaker:
    """Sliding-window error counter that trips after N errors in T
    seconds and stays tripped until explicitly reset. Thread-safe —
    `record_error()` is called from the asyncio loop's exception
    handler (which runs on the realtime thread) and `tripped` is read
    from the job poller thread + the reset-loop daemon.

    Returns True from `record_error()` exactly once when the threshold
    is crossed so the caller can take a one-shot action (disable the
    subsystem) without a second-trip race.
    """

    def __init__(self):
        self._errors: deque = deque()
        self._lock = threading.Lock()
        self._tripped = False
        self._tripped_at: Optional[float] = None
        self._trips_total = 0

    def record_error(self) -> bool:
        with self._lock:
            now = time.time()
            self._errors.append(now)
            cutoff = now - _REALTIME_ERROR_WINDOW_SECONDS
            while self._errors and self._errors[0] < cutoff:
                self._errors.popleft()
            if len(self._errors) >= _REALTIME_ERROR_THRESHOLD and not self._tripped:
                self._tripped = True
                self._tripped_at = now
                self._trips_total += 1
                return True
            return False

    @property
    def tripped(self) -> bool:
        return self._tripped

    @property
    def tripped_at(self) -> Optional[float]:
        return self._tripped_at

    @property
    def trips_total(self) -> int:
        return self._trips_total

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "tripped": self._tripped,
                "tripped_at": self._tripped_at,
                "trips_total": self._trips_total,
                "errors_in_window": len(self._errors),
                "window_seconds": _REALTIME_ERROR_WINDOW_SECONDS,
                "threshold": _REALTIME_ERROR_THRESHOLD,
            }

    def reset(self) -> None:
        with self._lock:
            self._errors.clear()
            self._tripped = False
            self._tripped_at = None


_realtime_circuit_breaker = _RealtimeCircuitBreaker()


class _RealtimeCleanCloseTracker:
    """Sliding-window counter for spurious clean WebSocket closes
    (v1.8.0). A "spurious" close is one where `listen()` returned
    cleanly while the connection had been alive for less than
    `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC` — well below the heartbeat
    interval, so something below the realtime library (corporate
    proxy, OS-level idle TCP RST, JWT expiry mid-handshake) tore the
    socket down before it could be useful.

    Trips the *same* circuit-breaker disable path as
    `_RealtimeCircuitBreaker` but with its own threshold / window so
    the two failure modes are tracked independently. Records EVERY
    spurious close (not just the trip-edge) so /realtime/status can
    expose `spurious_close_count_60s` for the frontend's status pill.

    Thread-safe — `record()` is called from the asyncio loop's
    reconnect path (which runs on the realtime thread) and `snapshot`
    is read from the FastAPI request thread serving /realtime/status.
    """

    def __init__(self):
        self._closes: deque = deque()
        self._lock = threading.Lock()
        self._last_escalate_log_at: float = 0.0
        self._spurious_total: int = 0

    def record(self, connect_age_sec: float) -> bool:
        """Record a clean close. `connect_age_sec` is the time
        elapsed between the successful `connect()` + `subscribe()`
        and the moment `listen()` returned. Returns True iff this
        call crossed the trip threshold (one-shot — caller should
        invoke `_disable_realtime_subsystem` exactly once).

        Closes that lasted >= `_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC`
        are NOT recorded (those are normal heartbeat-mediated drops
        and shouldn't trip the breaker)."""
        if connect_age_sec >= _REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC:
            return False
        with self._lock:
            now = time.time()
            self._closes.append(now)
            self._spurious_total += 1
            cutoff = now - _REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS
            while self._closes and self._closes[0] < cutoff:
                self._closes.popleft()
            in_window = len(self._closes)
            return in_window >= _REALTIME_SPURIOUS_CLOSE_THRESHOLD

    def maybe_escalate_log(self) -> Optional[int]:
        """Return the in-window count if we should emit a WARN
        breadcrumb (3+ spurious closes in 30s, throttled to one WARN
        per `_REALTIME_ESCALATE_LOG_THROTTLE_SEC`); else None."""
        with self._lock:
            now = time.time()
            cutoff = now - _REALTIME_ESCALATE_LOG_WINDOW_SEC
            recent = sum(1 for t in self._closes if t >= cutoff)
            if recent < _REALTIME_ESCALATE_LOG_THRESHOLD:
                return None
            if (now - self._last_escalate_log_at) < _REALTIME_ESCALATE_LOG_THROTTLE_SEC:
                return None
            self._last_escalate_log_at = now
            return recent

    def count_in_window(self, window_sec: float) -> int:
        with self._lock:
            now = time.time()
            cutoff = now - window_sec
            return sum(1 for t in self._closes if t >= cutoff)

    def snapshot(self) -> dict:
        with self._lock:
            now = time.time()
            cutoff = now - _REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS
            in_window = sum(1 for t in self._closes if t >= cutoff)
            return {
                "spurious_close_count_60s": in_window,
                "spurious_close_total": self._spurious_total,
                "window_seconds": _REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS,
                "threshold": _REALTIME_SPURIOUS_CLOSE_THRESHOLD,
                "min_connect_age_sec": _REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC,
            }

    def reset(self) -> None:
        with self._lock:
            self._closes.clear()


_realtime_clean_close_tracker = _RealtimeCleanCloseTracker()


# Throttled logger for the catch-all branch in the loop exception
# handler. We want to see the FIRST occurrence of each new exception
# class within a window, but not every repeat. Keyed by `repr(exc)`
# so distinct error messages still each get a one-line breadcrumb.
_realtime_log_throttle: dict[str, float] = {}
_REALTIME_LOG_THROTTLE_WINDOW_SEC: float = 60.0


def _realtime_should_log(key: str) -> bool:
    """Return True if we haven't logged this exception class within
    the throttle window. Best-effort, no lock — racing duplicates are
    fine, the goal is volume reduction not exact deduplication."""
    now = time.time()
    last = _realtime_log_throttle.get(key, 0.0)
    if (now - last) >= _REALTIME_LOG_THROTTLE_WINDOW_SEC:
        _realtime_log_throttle[key] = now
        return True
    return False


# Reset-loop thread state. Keep symmetric with the other daemon-thread
# state dicts (heartbeat, watchdog, backfill).
#
# v1.8.4 added two fields used by the exponential cooldown ladder:
#   - `consecutive_trips`: count of trips without a stable
#     (>= `_REALTIME_STABLE_CONNECTION_SEC`) connection in between.
#     Drives `_compute_realtime_cooldown_seconds`. Reset to 0 only by
#     the connect loop when a connection survives the stable window.
#   - `next_retry_at`: `time.time()` timestamp the reset loop must
#     reach before re-arming the subsystem. None when not tripped.
#     Surfaced via `/realtime/status.next_retry_seconds` so the
#     frontend can show a countdown.
_realtime_reset_state: dict[str, Any] = {
    "active": False,
    "thread": None,
    "stop_event": None,
    "consecutive_trips": 0,
    "next_retry_at": None,
}


def _disable_realtime_subsystem(reason: str) -> None:
    """Tear down the live Realtime client + arm the polling-only
    fallback. Idempotent — a second call while already disabled is
    a no-op (logged at debug level via `[realtime]` prefix).

    Called by the asyncio loop exception handler when the circuit
    breaker trips (Fix B), and on demand by `_stop_realtime_subscription`
    via the shutdown hook.

    v1.8.4 — increments `_realtime_reset_state["consecutive_trips"]`
    and stores the next retry timestamp using the exponential
    cooldown ladder (30min → 60 → 120 → 240 → 360min cap). The
    reset loop polls `next_retry_at` every 30s and re-arms only
    once the wall clock has crossed it. So a chronically degraded
    Supabase tenant gets a long break instead of being re-hammered
    every 5min.
    """
    if state.realtime_disabled:
        return
    # Bump consecutive-trip count BEFORE computing cooldown so the
    # first trip uses the initial 30-min cooldown (n=1) and a second
    # trip without an intervening stable connection doubles to 60min.
    consecutive = int(_realtime_reset_state.get("consecutive_trips", 0)) + 1
    _realtime_reset_state["consecutive_trips"] = consecutive
    cooldown_sec = _compute_realtime_cooldown_seconds(consecutive)
    next_retry_at = time.time() + cooldown_sec
    _realtime_reset_state["next_retry_at"] = next_retry_at
    cooldown_min = int(round(cooldown_sec / 60.0))
    print(
        f"[realtime] CIRCUIT BREAKER TRIPPED — {reason} "
        f"(consecutive_trips={consecutive}). "
        "Disabling Realtime subsystem; falling back to polling-only "
        "mode for trigger backfill + job claiming. Auto-retry in "
        f"{cooldown_min}min "
        f"({datetime.utcfromtimestamp(next_retry_at).isoformat()}Z). "
        "Set OMNIFRAME_DISABLE_REALTIME=1 and restart to skip "
        "Realtime entirely if this keeps tripping."
    )
    state.realtime_disabled = True
    # Wake the job poller immediately so it picks up the tightened
    # backoff (5→15s instead of 5→60s) on its very next iteration
    # rather than waiting out the current sleep.
    try:
        _kick_job_poller("realtime-disabled")
    except Exception:
        # _kick_job_poller is defined later in the file; on the off
        # chance the import order ever changes, swallow the NameError
        # rather than crash the disable path.
        pass
    # Tear down the live WebSocket client. The asyncio thread will
    # see the stop_event on its next backoff cycle and exit cleanly;
    # we don't try to cancel tasks from the wrong thread (asyncio
    # tasks must be cancelled from the loop's own thread, not from
    # whichever thread called the exception handler).
    ev = _realtime_state.get("stop_event")
    if ev is not None:
        try:
            ev.set()
        except Exception as e:
            print(f"[realtime] stop_event.set() during disable failed: {e}")
    _realtime_state["connected"] = False
    _realtime_state["connected_at"] = None
    _realtime_state["fallback_reason"] = (
        f"circuit breaker tripped: {reason} "
        f"(consecutive_trips={consecutive}, "
        f"auto-retry in {cooldown_min}min)"
    )


def _start_realtime_circuit_reset_loop() -> None:
    """Spawn the daemon thread that resets the Realtime circuit
    breaker once `_realtime_reset_state["next_retry_at"]` is reached
    and re-enters `_start_realtime_subscription()` for one more
    attempt. Idempotent — second call is a no-op.

    v1.8.4 — uses an exponential cooldown ladder
    (`_compute_realtime_cooldown_seconds`) keyed off
    `consecutive_trips` instead of the fixed 5-minute interval the
    v1.7.1 design used. The loop polls every
    `_REALTIME_CIRCUIT_RESET_POLL_SEC` (30s) and re-arms only once
    `time.time() >= next_retry_at`. So the first trip retries after
    30min, the second after 60min, the third after 120min, etc.,
    capped at 6h.

    Mirrors the v1.6.7 self-healing schema fallback's auto-retry
    pattern, scaled up one layer (whole subsystem instead of one
    feature column) and with a much longer cooldown for the
    "Realtime is reliably broken" failure mode.
    """
    if _realtime_reset_state.get("active"):
        return
    # Honor OMNIFRAME_DISABLE_REALTIME=1 — no point spinning a reset
    # loop when Realtime is intentionally off. The job poller
    # polling-only fallback covers the load.
    if _is_realtime_disabled_via_env():
        print(
            "[realtime] Circuit-breaker reset loop NOT started "
            "(OMNIFRAME_DISABLE_REALTIME=1 — polling-only mode is "
            "intentional, no reset needed)."
        )
        return
    stop_event = threading.Event()

    def _loop() -> None:
        print(
            f"[realtime] Circuit-breaker reset loop started "
            f"(poll every {int(_REALTIME_CIRCUIT_RESET_POLL_SEC)}s; "
            f"cooldown ladder "
            f"{int(_REALTIME_CIRCUIT_INITIAL_COOLDOWN_SEC // 60)}→"
            f"{int(_REALTIME_CIRCUIT_MAX_COOLDOWN_SEC // 60)}min "
            f"on consecutive trips; clean-close window "
            f"{int(_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS)}s, "
            f"threshold {_REALTIME_SPURIOUS_CLOSE_THRESHOLD} closes; "
            f"exception window {int(_REALTIME_ERROR_WINDOW_SECONDS)}s, "
            f"threshold {_REALTIME_ERROR_THRESHOLD} errors)."
        )
        while not stop_event.is_set():
            if stop_event.wait(_REALTIME_CIRCUIT_RESET_POLL_SEC):
                break
            try:
                # Only attempt reset when (a) the breaker (or
                # disable flag) is set AND (b) the wall clock has
                # crossed the scheduled `next_retry_at`. v1.7.1 just
                # ran every 5min; v1.8.4 respects the exponential
                # cooldown so a chronic failure mode gets a long
                # break instead of being re-hammered.
                tripped = (
                    _realtime_circuit_breaker.tripped
                    or state.realtime_disabled
                )
                if not tripped:
                    continue
                next_at = _realtime_reset_state.get("next_retry_at")
                # No scheduled retry → nothing to do (e.g. set via
                # /supabase/logout or a fresh boot before any trip).
                if next_at is None:
                    continue
                if time.time() < float(next_at):
                    continue
                consecutive = int(
                    _realtime_reset_state.get("consecutive_trips", 0)
                )
                print(
                    "[realtime] Circuit breaker reset attempt — "
                    "re-enabling subsystem "
                    f"(consecutive_trips={consecutive})."
                )
                _realtime_circuit_breaker.reset()
                # v1.8.0 — also reset the clean-close tracker so
                # the next round of spurious closes (if any) is
                # measured from a clean baseline. Without this a
                # stale window from before the trip could insta-trip
                # again on the very first new close after reset.
                _realtime_clean_close_tracker.reset()
                state.realtime_disabled = False
                _realtime_state["fallback_reason"] = None
                # `consecutive_trips` is intentionally NOT reset
                # here — only a stable 60s+ connection (detected by
                # the connect loop) clears it. So back-to-back trips
                # without an intervening stable connection keep
                # doubling the cooldown.
                _realtime_reset_state["next_retry_at"] = None
                # Allow `_start_realtime_subscription()` to spawn
                # a fresh thread. The previous v1.7.0 sticky flag
                # is intentionally cleared HERE only — every other
                # callsite still treats the singleton as immutable.
                global _realtime_started
                _realtime_started = False
                try:
                    _start_realtime_subscription()
                except Exception as e:
                    print(
                        f"[realtime] reset-loop respawn failed: {e} "
                        "(will retry next cycle)"
                    )
            except Exception as e:
                print(f"[realtime] reset-loop tick error: {e}")
        print("[realtime] Circuit-breaker reset loop stopped.")

    t = threading.Thread(
        target=_loop, daemon=True, name="sap-realtime-reset"
    )
    _realtime_reset_state["thread"] = t
    _realtime_reset_state["stop_event"] = stop_event
    _realtime_reset_state["active"] = True
    t.start()


def _stop_realtime_circuit_reset_loop() -> None:
    ev = _realtime_reset_state.get("stop_event")
    if ev is not None:
        ev.set()
    _realtime_reset_state["active"] = False


class JobCompleteRequest(BaseModel):
    result: dict[str, Any] = {}


class JobFailRequest(BaseModel):
    error: str
    step: Optional[str] = None
    result: dict[str, Any] = {}


def _supabase_headers(prefer_user: bool = True) -> dict[str, str]:
    """Headers for talking to Supabase REST. Uses the user's bearer token
    when available so RLS policies fire as that user; falls back to anon
    for read-only paths."""
    headers = {
        "apikey": state.supabase_key,
        "Content-Type": "application/json",
    }
    if prefer_user and state.supabase_token:
        headers["Authorization"] = f"Bearer {state.supabase_token}"
    return headers


# v1.7.0 — Shared HTTP helper for outbound Supabase calls. Centralizes
# the 30s timeout (was 4-10s spread across ~17 call sites) and a
# single-retry on transient `Timeout` / `ConnectionError` after a 2s
# sleep. Corporate proxy + Citrix latency + occasional PostgREST cold
# start sporadically produced ~8s read timeouts on otherwise-healthy
# calls, surfaced to users as `[triggers] enqueue error:
# HTTPSConnectionPool... Read timed out. (read timeout=8)` and
# `[heartbeat] lease bump failed: ...`. Bumping the timeout alone fixes
# the 8s truncation; the retry catches the rarer case where the first
# attempt died mid-handshake (TCP RST from an idle pool connection).
#
# Other kwargs pass through untouched — `json=`, `headers=`, `params=`,
# etc. Callers may override `timeout` or `verify` by passing them
# explicitly. This helper does NOT swallow HTTP status codes: 4xx/5xx
# still come back as a `Response` for the caller to inspect.
_DEFAULT_HTTP_TIMEOUT_SEC: float = 30.0
_HTTP_RETRY_SLEEP_SEC: float = 2.0

# v1.7.2 — JWT refresh leeway. Refresh when the access token has
# `<= _TOKEN_REFRESH_LEEWAY_SECONDS` left so a slow round-trip doesn't
# fire a request that arrives at PostgREST already-expired. 60s is
# generous (network + clock skew); the underlying token is ~3600s.
_TOKEN_REFRESH_LEEWAY_SECONDS: float = 60.0
# Throttle so a flurry of failed refresh attempts (e.g. corp proxy
# blackout) doesn't hammer GoTrue with the same dead refresh token.
_TOKEN_REFRESH_RETRY_COOLDOWN_SECONDS: float = 30.0
_token_refresh_state: dict[str, float] = {"last_attempt_at": 0.0}


def _refresh_supabase_token_if_needed() -> bool:
    """Refresh `state.supabase_token` from `state.refresh_token` when
    the cached access token is within `_TOKEN_REFRESH_LEEWAY_SECONDS` of
    expiry. Returns True if a refresh was attempted (regardless of
    success), False if the cached token is still good or we have no
    refresh token to roll with.

    Called at the top of every `_supabase_request` so the lifecycle is
    transparent to callers — they keep using `state.supabase_token` as
    the authoritative bearer.

    Thread safety: the lock prevents the heartbeat / job poller / realtime
    callback / backfill poller from all firing parallel refreshes against
    GoTrue. Only the FIRST caller through the gate touches GoTrue; the
    rest re-read the cached token after the lock releases.

    Failure handling: on a refresh failure (network, 400 invalid_grant,
    5xx) we log once at WARN level and let the underlying request go out
    with the (likely-expired) token — the caller will see the 401 and
    fall through to its own error path. We DON'T clear `supabase_token`
    on refresh failure: a transient corp-proxy blackout would otherwise
    log the user out permanently. The next successful refresh attempt
    rehydrates the cache.
    """
    # No refresh token → nothing to do (likely a pre-1.7.2 config or a
    # boot before the user has logged in).
    if not state.refresh_token or not state.supabase_url or not state.supabase_key:
        return False
    now = time.time()
    # Token expiry not known (older config.json before v1.7.2 migration,
    # or an /auth response that omitted expires_in) → can't decide; let
    # the request go out and lazy-refresh on the next 401 in a future
    # iteration. We err on the side of NOT pre-emptively refreshing
    # because we don't want to invalidate a still-good session.
    if state.token_expires_at <= 0.0:
        return False
    # Token still has more than the leeway worth of life left → no-op.
    if (state.token_expires_at - now) > _TOKEN_REFRESH_LEEWAY_SECONDS:
        return False
    with state.token_refresh_lock:
        # Re-check inside the lock — a sibling thread may have already
        # refreshed while we were waiting for the lock.
        now = time.time()
        if (state.token_expires_at - now) > _TOKEN_REFRESH_LEEWAY_SECONDS:
            return False
        # Throttle dead-refresh storms so we don't hammer GoTrue.
        last_attempt = _token_refresh_state.get("last_attempt_at", 0.0)
        if (now - last_attempt) < _TOKEN_REFRESH_RETRY_COOLDOWN_SECONDS:
            return False
        _token_refresh_state["last_attempt_at"] = now
        try:
            resp = requests.post(
                f"{state.supabase_url}/auth/v1/token?grant_type=refresh_token",
                json={"refresh_token": state.refresh_token},
                headers={
                    "apikey": state.supabase_key,
                    "Content-Type": "application/json",
                },
                timeout=_DEFAULT_HTTP_TIMEOUT_SEC,
                verify=_SSL_VERIFY,
            )
        except Exception as e:
            print(f"[auth]  WARN refresh token request failed: {e} "
                  "(will retry after cooldown; current token may 401)")
            return True
        if resp.status_code >= 400:
            # 400 from GoTrue typically means `invalid_grant` — the
            # refresh token itself is dead (user logged out on another
            # device, password changed, refresh token expired). At this
            # point we have NO recovery path other than the user
            # re-launching the Connect Account dialog, so clear both
            # tokens to force the explicit re-login.
            txt = resp.text[:200] if resp.text else "(no body)"
            print(f"[auth]  WARN refresh failed: HTTP {resp.status_code}: {txt}")
            if resp.status_code in (400, 401, 403):
                state.supabase_token = ""
                state.refresh_token = ""
                state.token_expires_at = 0.0
                try:
                    state.persist_config()
                except Exception:
                    pass
                print("[auth]  Refresh token rejected — cleared session. "
                      "User must reconnect via the Connect Account dialog.")
            return True
        try:
            data = resp.json()
        except Exception:
            print("[auth]  WARN refresh response was not JSON; treating as failure")
            return True
        new_access = data.get("access_token", "") or ""
        new_refresh = data.get("refresh_token", "") or state.refresh_token
        try:
            expires_in = int(data.get("expires_in", 0) or 0)
        except (TypeError, ValueError):
            expires_in = 0
        if not new_access:
            print("[auth]  WARN refresh response missing access_token")
            return True
        state.supabase_token = new_access
        state.refresh_token = new_refresh
        state.token_expires_at = (
            time.time() + expires_in if expires_in > 0 else 0.0
        )
        try:
            state.persist_config()
        except Exception:
            pass
        print(
            f"[auth]  Refreshed Supabase JWT (expires_in={expires_in}s). "
            "All subsequent /jobs/* + heartbeat + trigger calls will use "
            "the new token."
        )
        return True


def _supabase_request(method: str, url: str, **kwargs) -> requests.Response:
    """POST/PATCH/GET wrapper with a 30s default timeout and a single
    retry on transient network errors (Timeout / ConnectionError).

    Used by every outbound Supabase call in agent.py (job claim, job
    complete/fail, trigger enqueue, lease bump, registry upsert, backfill
    query, etc.) so latency + retry behavior is consistent across paths.
    See [[Debug/Fix-Agent-Throughput-Latency]].

    v1.7.2 — pre-emptively refresh `state.supabase_token` if it's within
    the leeway window of expiry so the about-to-fly request lands with
    a fresh JWT. The helper short-circuits when there's no refresh
    token (e.g. user hasn't logged in yet) or the cached token is still
    healthy. Called BEFORE we materialize the headers further down the
    call chain — but this helper itself is bypassed when callers pass
    explicit `headers=` because the in-thread refresh just rewrites
    `state.supabase_token`; the next `_supabase_headers()` call (most
    common pattern) picks up the fresh value automatically.
    """
    try:
        _refresh_supabase_token_if_needed()
    except Exception as e:
        # Never let a refresh failure bubble up to the caller — log once
        # and let the underlying request go out with whatever token we
        # have. The caller's existing 401 handling stays in charge.
        print(f"[auth]  WARN pre-request refresh raised: {e} (continuing)")
    kwargs.setdefault("timeout", _DEFAULT_HTTP_TIMEOUT_SEC)
    kwargs.setdefault("verify", _SSL_VERIFY)
    fn = getattr(requests, method.lower())
    try:
        return fn(url, **kwargs)
    except (
        requests.exceptions.Timeout,
        requests.exceptions.ConnectionError,
    ) as exc:
        short_url = url.split("?")[0][:120]
        print(
            f"[http] transient {type(exc).__name__} on {method.upper()} "
            f"{short_url} — retrying once after {_HTTP_RETRY_SLEEP_SEC:.0f}s"
        )
        time.sleep(_HTTP_RETRY_SLEEP_SEC)
        return fn(url, **kwargs)


# Phase 7 (rust-work-service integration plan, 2026-05-06).
# Mirror of `_supabase_request` for the centralized claim path. The
# work service is reachable at `state.work_service_url` (defaulting to
# the production Railway URL via `OMNIFRAME_WORK_SERVICE_URL`); auth
# is the same Supabase JWT we already mint at login because the work
# service's `require_auth` middleware validates user JWTs against
# rust-core-service. We pass `X-Agent-Id` so future Phase 10 (agent
# identity v2) work can validate the body's `agent_id` field against
# this header at the middleware layer; today the field is purely
# informational.
def _work_service_url_base() -> str:
    """Resolve the base URL for rust-work-service. Reads from
    `state.work_service_url` (set in `AgentState.__init__` from the
    `OMNIFRAME_WORK_SERVICE_URL` env var); falls back to the
    module-level constant in `work_service_ws.py` if state hasn't
    been populated yet (early-boot edge case before `state =
    AgentState()` runs at the module's bottom)."""
    if getattr(state, "work_service_url", ""):
        return state.work_service_url
    try:
        import work_service_ws as _ws  # type: ignore
        return getattr(_ws, "WORK_SERVICE_URL", "")
    except Exception:
        return os.environ.get(
            "OMNIFRAME_WORK_SERVICE_URL",
            "https://rust-work-service-production.up.railway.app",
        )


def _work_service_request(method: str, path: str, **kwargs) -> requests.Response:
    """POST/PATCH/GET wrapper targeting `rust-work-service`. Same
    timeout / retry semantics as `_supabase_request` so the two paths
    behave identically under corporate-proxy / Citrix latency.

    `path` MUST start with `/api/v1/sap-agents/...` (or another
    work-service prefix the caller controls). The helper:
      - prepends `state.work_service_url` (env-overridable),
      - prefers the Phase 10 agent JWT (`state.work_service_jwt`) over
        the legacy user JWT (`state.supabase_token`) when both are
        present — the agent JWT carries `kind: "agent"` and is
        verified locally by the work service's middleware,
      - injects `X-Agent-Id: <_agent_self_id()>` for forensic
        correlation,
      - pre-emptively refreshes whichever JWT is in play so a stale
        token doesn't 401 us mid-call. The user-JWT refresh runs
        unconditionally (cheap, no-ops when no refresh_token is
        present); the agent-JWT refresh only fires when a service
        key is configured.

    Caller-provided `headers=` are merged on top so per-call extras
    (e.g. `Idempotency-Key`) survive.
    """
    try:
        _refresh_supabase_token_if_needed()
    except Exception as e:
        print(f"[auth]  WARN pre-request refresh raised: {e} (continuing)")
    # Phase 10 — pre-emptively refresh the agent JWT. No-ops when no
    # service key is configured (legacy path); cheap when the cached
    # token is still healthy.
    try:
        _refresh_work_service_jwt_if_needed()
    except Exception as e:
        print(f"[agent-identity] WARN pre-request refresh raised: {e} (continuing)")

    base = _work_service_url_base().rstrip("/")
    url = f"{base}{path}"

    headers = dict(kwargs.pop("headers", None) or {})
    # Prefer the Phase 10 agent JWT when available; fall through to
    # the legacy user JWT otherwise. NEVER send both — the work
    # service's middleware peeks at `kind` to route the verify path,
    # so a hybrid header is ambiguous.
    if state.work_service_jwt:
        headers.setdefault(
            "Authorization", f"Bearer {state.work_service_jwt}"
        )
    elif state.supabase_token:
        headers.setdefault("Authorization", f"Bearer {state.supabase_token}")
    headers.setdefault("X-Agent-Id", _agent_self_id())
    headers.setdefault("Content-Type", "application/json")

    kwargs.setdefault("timeout", _DEFAULT_HTTP_TIMEOUT_SEC)
    kwargs.setdefault("verify", _SSL_VERIFY)
    kwargs["headers"] = headers
    fn = getattr(requests, method.lower())
    try:
        return fn(url, **kwargs)
    except (
        requests.exceptions.Timeout,
        requests.exceptions.ConnectionError,
    ) as exc:
        short_url = path[:120]
        print(
            f"[work-svc] transient {type(exc).__name__} on {method.upper()} "
            f"{short_url} — retrying once after {_HTTP_RETRY_SLEEP_SEC:.0f}s"
        )
        time.sleep(_HTTP_RETRY_SLEEP_SEC)
        return fn(url, **kwargs)


# ---------------------------------------------------------------------------
#  Phase 6 — Console relay (`OMNIFRAME_AGENT_CONSOLE_RELAY=1`)
# ---------------------------------------------------------------------------
#
# `_log(level, message)` mirrors `print(message)` AND appends to
# `state.console_buffer` so the relay thread can flush batches to
# `rust-work-service /api/v1/sap-console/lines`. Behind the env flag
# at module scope (`_CONSOLE_RELAY_ENABLED`); when off, the helper
# becomes a thin `print()` wrapper with negligible overhead.
#
# Design notes:
#   * `print()` is preserved verbatim so the existing console UX
#     (Citrix admin watching the agent console window) is unchanged.
#   * `state.console_buffer` is a `collections.deque(maxlen=10000)`
#     so a sustained network outage can't OOM the agent — the deque
#     silently drops the oldest entries when full (Python's canonical
#     ring buffer).
#   * The buffer holds `(level, message, ts_iso)` tuples; the relay
#     thread serialises them into the JSON shape the route expects.
#   * Future phase: replace ALL `print(...)` callsites with `_log(...)`
#     so the console card mirrors the entire agent output. For now
#     we wrap the most informative call sites only — boot banner +
#     `[jobs]`, `[triggers]`, `[work-ws]`, `[lt12]`, `[sap]`,
#     `[backfill]`, `[heartbeat]`, `[realtime]`. See TODO at end of
#     this section.

_LEVEL_BY_PREFIX: dict[str, str] = {
    # The mapping is intentionally narrow — the agent's existing
    # log lines use a small vocabulary of prefix tags (`[boot]`,
    # `[jobs]`, etc) so a single line typically carries enough
    # signal to pick a level WITHOUT each callsite passing one.
    "[boot]": "info",
    "[start]": "info",
    "[install]": "info",
    "[jobs]": "info",
    "[triggers]": "info",
    "[work-ws]": "info",
    "[work-svc]": "info",
    "[heartbeat]": "info",
    "[realtime]": "info",
    "[backfill]": "info",
    "[lt12]": "info",
    "[lt22]": "info",
    "[sap]": "info",
    "[sap-auto]": "info",
    "[query]": "info",
    "[claim-path]": "info",
    "[recorder]": "info",
    "[auth]": "info",
    "[schema-fallback]": "info",
}


def _detect_log_level(message: str) -> str:
    """Pick a level from the message prefix vocabulary. Falls back to
    `info`. Markers like `WARN`, `ERROR`, `error`, `failed` flip the
    level upward so a `[jobs] WATCHDOG: ... failed` line surfaces as
    `error` even though the prefix is `[jobs]`.
    """
    lower = message.lower()
    if " error" in lower or "error:" in lower or "exception" in lower:
        return "error"
    if " warn" in lower or "warning" in lower or "watchdog" in lower:
        return "warn"
    for prefix, lvl in _LEVEL_BY_PREFIX.items():
        if message.startswith(prefix):
            return lvl
    return "info"


def _log(message: str, level: Optional[str] = None) -> None:
    """Print `message` AND append to `state.console_buffer` for the
    Phase 6 relay thread.

    `level` is optional — when None, `_detect_log_level()` infers
    one from the message prefix + word markers. Cheap (negligible
    overhead when `_CONSOLE_RELAY_ENABLED=False` because the lock
    acquire is the only extra work; the buffer append is O(1)).

    Thread-safe — the buffer lock is per-deque so concurrent
    callers from the heartbeat / poller / realtime threads don't
    corrupt the ring.
    """
    print(message)
    if not _CONSOLE_RELAY_ENABLED:
        return
    lvl = level or _detect_log_level(message)
    ts_iso = datetime.utcnow().isoformat() + "Z"
    try:
        with state.console_buffer_lock:
            state.console_buffer.append((lvl, message, ts_iso))
    except Exception:
        # Defence-in-depth — the relay path MUST never break the
        # primary print() callsite. Failures are silent because
        # logging the failure would loop into the same path.
        pass


class _ConsoleRelayStream:
    """Phase 6 — `sys.stdout` / `sys.stderr` proxy that mirrors writes
    to `state.console_buffer` on top of the original stream.

    Why a stream proxy instead of wrapping every `print(...)` call?
    The agent has 250+ `print(...)` callsites spread across handler
    files, the LT22 importer, material-master worker, etc. Wrapping
    each individually risks regressions, churns the diff, and forces
    a future merge across worker modules. The stream proxy captures
    every line that hits stdout / stderr in ONE place — including
    library log output that uvicorn's logger would otherwise miss
    from the buffer entirely.

    Behaviour:
      * `write()` forwards to the original stream verbatim, then
        accumulates characters in `_pending` until a newline is
        seen. Complete lines are appended to `state.console_buffer`.
      * Buffered lines are tagged with a level inferred from the
        message prefix vocabulary (`_detect_log_level`).
      * `flush()` and `isatty()` forward unchanged so uvicorn's
        ANSI-colour detection still works.

    Installed at boot ONLY when `_CONSOLE_RELAY_ENABLED=True`, so
    the unflagged build pays zero overhead.
    """

    def __init__(self, original, default_level: str = "info") -> None:
        self._original = original
        self._default_level = default_level
        self._pending = ""
        # Per-stream lock so concurrent writes from different
        # threads don't interleave half-lines in the buffer.
        self._lock = threading.Lock()

    def write(self, data: str) -> int:  # type: ignore[override]
        # Forward to the real stream FIRST so the existing console
        # UX is unaffected even if the buffer append raises.
        try:
            n = self._original.write(data)
        except Exception:
            n = len(data) if isinstance(data, str) else 0
        if not _CONSOLE_RELAY_ENABLED:
            return n
        try:
            with self._lock:
                self._pending += data
                # Drain complete lines in one pass.
                while "\n" in self._pending:
                    line, _, rest = self._pending.partition("\n")
                    self._pending = rest
                    if not line.strip():
                        continue
                    lvl = _detect_log_level(line)
                    ts_iso = datetime.utcnow().isoformat() + "Z"
                    try:
                        with state.console_buffer_lock:
                            state.console_buffer.append((lvl, line, ts_iso))
                    except Exception:
                        # `state` may not yet be initialised at the
                        # earliest stream-write moments (e.g. while
                        # the boot banner runs before AgentState is
                        # constructed). Fall back to silently
                        # dropping — the print already happened.
                        pass
        except Exception:
            pass
        return n

    def flush(self) -> None:
        try:
            self._original.flush()
        except Exception:
            pass

    def isatty(self) -> bool:
        try:
            return bool(self._original.isatty())
        except Exception:
            return False

    def __getattr__(self, name: str) -> Any:
        # Forward any other attribute access (e.g. `.encoding`,
        # `.fileno`, `.buffer`) to the wrapped stream so uvicorn's
        # logging plumbing keeps working unchanged.
        return getattr(self._original, name)


def _install_console_relay_streams() -> None:
    """Wrap `sys.stdout` and `sys.stderr` with `_ConsoleRelayStream`
    so EVERY agent print line mirrors into `state.console_buffer`
    when `_CONSOLE_RELAY_ENABLED=True`. Idempotent — wrapping an
    already-wrapped stream is a no-op (we check `_original`).

    Called from `_on_startup` after `state` exists. Phase 11 will
    move this to module-load time once we audit early-boot print()
    callsites that fire before `state = AgentState()` lands (today
    they'd land in the buffer's pre-state `try/except` swallow).
    """
    if not _CONSOLE_RELAY_ENABLED:
        return
    if not isinstance(sys.stdout, _ConsoleRelayStream):
        sys.stdout = _ConsoleRelayStream(sys.stdout, default_level="info")
    if not isinstance(sys.stderr, _ConsoleRelayStream):
        sys.stderr = _ConsoleRelayStream(sys.stderr, default_level="error")


# Phase 6 — relay thread state. Mirrors the
# `_realtime_started: bool` sticky-singleton pattern so a second call
# (e.g. via `/supabase/login`) is a no-op.
_console_relay_state: dict[str, Any] = {
    "thread": None,
    "stop_event": None,
    "active": False,
    # Parallel-run instrumentation. `flush_count` is the number of
    # successful POST batches; `dropped_count` is the cumulative
    # number of lines the deque silently dropped (computed as
    # `appends - flushes - current_buffer_len`). Useful for a 24h
    # grep to see if the buffer ever pressured.
    "flush_count": 0,
    "broadcast_count": 0,
    "appended_count": 0,
}


def _start_console_relay_thread() -> None:
    """Spawn the daemon that drains `state.console_buffer` and POSTs
    batches to `rust-work-service /api/v1/sap-console/lines`. No-op
    when `_CONSOLE_RELAY_ENABLED` is False so an unflagged build
    pays nothing.

    Idempotent — subsequent calls return early if the thread is
    already running. The loop gates on `state.supabase_token` and
    `state.org_id` so a pre-login start is safe (it just sleeps
    until login completes).
    """
    if not _CONSOLE_RELAY_ENABLED:
        return
    if _console_relay_state.get("active"):
        return
    stop_event = threading.Event()

    def _loop() -> None:
        backoff_sec = _CONSOLE_RELAY_INITIAL_BACKOFF_SEC
        while not stop_event.is_set():
            # Wait for login + buffer to have something to flush.
            if not state.supabase_token or not state.org_id:
                stop_event.wait(_CONSOLE_RELAY_FLUSH_INTERVAL_SEC * 2)
                continue
            # Drain a batch under the lock to avoid concurrent
            # appends racing with the slice. We pop up to
            # _CONSOLE_RELAY_BATCH_SIZE entries; remaining lines
            # land in the next tick.
            batch: list[tuple[str, str, str]] = []
            with state.console_buffer_lock:
                while state.console_buffer and len(batch) < _CONSOLE_RELAY_BATCH_SIZE:
                    batch.append(state.console_buffer.popleft())
            if not batch:
                stop_event.wait(_CONSOLE_RELAY_FLUSH_INTERVAL_SEC)
                continue
            try:
                payload = {
                    "agent_id": _agent_self_id(),
                    "lines": [
                        {"level": lvl, "message": msg, "ts": ts}
                        for (lvl, msg, ts) in batch
                    ],
                    # `persist=False` is the default — the hot path
                    # is the broadcast. Operators flip this to True
                    # in the future via a `?persist=1` query string
                    # or a new env var.
                    "persist": False,
                }
                resp = _work_service_request(
                    "POST",
                    "/api/v1/sap-console/lines",
                    json=payload,
                )
                if resp.status_code >= 400:
                    # Re-inject so the lines aren't silently lost.
                    # The deque's `extendleft` reverses iteration
                    # order; we reverse our batch FIRST to keep the
                    # original ordering on the next flush.
                    with state.console_buffer_lock:
                        for entry in reversed(batch):
                            state.console_buffer.appendleft(entry)
                    print(
                        f"[work-ws] console relay HTTP {resp.status_code}: "
                        f"{resp.text[:160]} (re-buffered {len(batch)} lines, "
                        f"backoff {backoff_sec:.0f}s)"
                    )
                    stop_event.wait(backoff_sec)
                    backoff_sec = min(
                        backoff_sec * 2.0,
                        _CONSOLE_RELAY_MAX_BACKOFF_SEC,
                    )
                    continue
                # Success — bump the counters and reset backoff.
                _console_relay_state["flush_count"] = (
                    int(_console_relay_state.get("flush_count", 0)) + 1
                )
                _console_relay_state["broadcast_count"] = (
                    int(_console_relay_state.get("broadcast_count", 0))
                    + len(batch)
                )
                backoff_sec = _CONSOLE_RELAY_INITIAL_BACKOFF_SEC
            except Exception as exc:
                # Network / serialisation errors mirror the
                # non-200 branch — re-buffer and back off.
                with state.console_buffer_lock:
                    for entry in reversed(batch):
                        state.console_buffer.appendleft(entry)
                print(
                    f"[work-ws] console relay exception: {exc!r} "
                    f"(re-buffered {len(batch)} lines, backoff {backoff_sec:.0f}s)"
                )
                stop_event.wait(backoff_sec)
                backoff_sec = min(
                    backoff_sec * 2.0,
                    _CONSOLE_RELAY_MAX_BACKOFF_SEC,
                )
                continue
            # Brief sleep between batches so we don't busy-loop on
            # a chatty agent (the rate limiter would 429 us).
            stop_event.wait(_CONSOLE_RELAY_FLUSH_INTERVAL_SEC)

    t = threading.Thread(
        target=_loop, daemon=True, name="omni-console-relay"
    )
    _console_relay_state["thread"] = t
    _console_relay_state["stop_event"] = stop_event
    _console_relay_state["active"] = True
    t.start()
    print(
        f"[work-ws] console relay thread started — flush every "
        f"{_CONSOLE_RELAY_FLUSH_INTERVAL_SEC * 1000:.0f}ms in batches up "
        f"to {_CONSOLE_RELAY_BATCH_SIZE} lines, buffer cap "
        f"{_CONSOLE_RELAY_BUFFER_CAP}. POSTing to "
        f"rust-work-service /api/v1/sap-console/lines."
    )


def _stop_console_relay_thread() -> None:
    ev = _console_relay_state.get("stop_event")
    if ev is not None:
        ev.set()
    _console_relay_state["active"] = False


_AGENT_SELF_ID: Optional[str] = None
_AGENT_PROCESS_STARTED_AT: str = datetime.utcnow().isoformat() + "Z"


def _agent_self_id() -> str:
    """Stable identifier for this agent process used in `claimed_by` and
    as the primary key in `public.sap_agents`. Format:
        ``<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>``

    v1.6.5 — dropped the trailing `-<PID>` segment that v1.4.0 → v1.6.4
    used. The PID rotated on every EXE rebuild + every fresh launch, so
    the user's Citrix box accumulated a NEW `sap_agents` row each time
    they iterated on the agent (4-5 rebuilds in a workday → 6 stale rows
    in the fleet card, all but one offline). The reaper marks them
    `offline` after 90s but never deletes them, so the UI bloated.

    The new format is stable across EXE restarts: same Windows box +
    same Citrix session + same Windows user always produces the same id,
    so the heartbeat upsert merges into the existing row instead of
    creating a new one. For per-process debug we expose
    `process_started_at` (column added in migration 250) and the cached
    `_AGENT_PROCESS_STARTED_AT` module-level value.

    Computed once and cached so it's safe to call from multiple threads
    (Realtime, heartbeat, poller).
    """
    global _AGENT_SELF_ID
    if _AGENT_SELF_ID is None:
        override = os.environ.get("OMNIFRAME_AGENT_SELF_ID_OVERRIDE")
        if override:
            _AGENT_SELF_ID = override.strip()
        else:
            host = os.getenv("COMPUTERNAME") or socket.gethostname() or "unknown-host"
            sess = os.getenv("SESSIONNAME") or "Console"
            user = os.getenv("USERNAME") or os.getenv("USER") or "unknown-user"
            # Sanitize: strip whitespace + collapse problematic characters so a
            # weird CLIENTNAME / SESSIONNAME (e.g. "ICA-tcp#0") still produces a
            # well-formed PostgREST identifier when used in `?id=eq.<value>`.
            def _slug(s: str) -> str:
                return "".join(c if (c.isalnum() or c in "-_.") else "_" for c in s.strip())
            _AGENT_SELF_ID = f"{_slug(host)}-{_slug(sess)}-{_slug(user)}"
    return _AGENT_SELF_ID


@app.post("/jobs/claim")
def jobs_claim() -> dict:
    """Atomically claim the next queued job for our org via the
    lease-aware `claim_sap_agent_job` RPC (Phase D #13).

    SAP scripting is single-threaded per session, so we always claim
    one row at a time. The RPC honours `assigned_agent_id` pinning
    (Phase D #13 multi-agent coordination): a row pinned to a different
    agent will be skipped here and stay queued until its target agent
    polls. Returns `{ok: true, job: null}` when no eligible row exists.
    """
    if not state.supabase_url or not state.supabase_key:
        return {"ok": False, "error": "Supabase not configured. Login from the web app first."}
    if not state.org_id:
        return {"ok": False, "error": "Agent has no org_id. Login from the web app first."}
    # v1.7.2 — single-flight guard. `/jobs/claim` is in
    # `_TOKEN_EXEMPT_PATHS` (via the broad `/jobs/*` prefix in the
    # middleware) so any local browser tab can call it. The internal
    # poller is serial, but a stale browser-side queue UI / debug curl
    # could call this while the poller is mid-dispatch. The DB
    # `claim_sap_agent_job` RPC stops two AGENTS from claiming the
    # same row, but it can't stop a single agent from owning two rows
    # — and SAP scripting is single-threaded, so the second row would
    # then fight the first one for the COM session. Refuse the claim
    # when we already have an active job so the same agent process
    # can't end up with two `running` rows assigned to it.
    with state.active_job_lock:
        active_id = state.active_job_id
    if active_id:
        return {
            "ok": False,
            "error": "agent already has an active job",
            "active_job_id": active_id,
        }
    try:
        # v1.7.0 — lease dropped from 300s → 90s. The new in-agent
        # watchdog (see `_start_job_watchdog_thread`) will mark a stuck
        # job failed after 120s and clear `state.active_job_id`, so the
        # DB-side lease expiry only needs to cover the gap between a
        # hard agent crash and the reaper picking up the row. 90s is
        # long enough that a slow-but-live SAP call doesn't look stale
        # (the heartbeat thread bumps the lease every 30s anyway).
        #
        # Phase 11 (v2.0.0, 2026-05-07) — claim path is unconditionally
        # rust-work-service. The legacy direct-PostgREST fallback (RPC
        # `claim_sap_agent_job`) was deleted alongside the parallel-run
        # parity counter. The Phase-4 `_USE_RUST_WS` deprecation log at
        # boot is the operator-facing escape hatch.
        if not _CLAIM_VIA_RUST:
            return {
                "ok": False,
                "error": (
                    "OMNIFRAME_AGENT_CLAIM_VIA_RUST=0 is no longer "
                    "supported in v2.0.0+ (Phase 11 deleted the legacy "
                    "direct-PostgREST claim fallback). Unset the env var "
                    "or set it to 1."
                ),
            }
        resp = _work_service_request(
            "POST",
            "/api/v1/sap-agents/jobs/claim",
            json={
                "agent_id": _agent_self_id(),
                "lease_seconds": 90,
            },
        )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": (
                    f"claim work-service HTTP {resp.status_code}: "
                    f"{resp.text[:200]}"
                ),
            }
        try:
            envelope = resp.json() if resp.text else {}
        except ValueError:
            envelope = {}
        data = envelope.get("job") if isinstance(envelope, dict) else None
        via_rust, via_supa = _bump_claim_path_counter(via_rust=True)
        print(
            f"[claim-path] via=rust hit={'yes' if data else 'no'} "
            f"totals(rust={via_rust}, supabase={via_supa})"
        )
        if not data or (isinstance(data, dict) and not data.get("id")):
            return {"ok": True, "job": None}
        return {"ok": True, "job": data}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# Phase 11 (rust-work-service integration plan, 2026-05-07) — the
# legacy `_patch_job` and `_patch_job_terminal` helpers were deleted
# along with the v1.7.2 direct-PostgREST PATCH guards. The
# `status='running' AND claimed_by=<self>` invariant they enforced
# now lives server-side in
# `rust-work-service::api::routes::sap_agents::complete_handler` /
# `fail_handler` (Phase 7). Callers route through `_work_service_complete`
# / `_work_service_fail` instead; the rows-affected semantics are
# preserved at the wire level.


def _work_service_complete(job_id: str, result_payload: Any) -> dict:
    """Phase 7 — POST /api/v1/sap-agents/jobs/<id>/complete.

    Returns a dict shaped like the legacy `_patch_job_terminal`
    output so the caller doesn't care which path executed:
        { ok, rows_affected, row?, skipped_reason?, error? }.
    The work service applies the SAME terminal-state guards
    (`status='running' AND claimed_by=<agent_id>`); when 0 rows
    match it returns `skipped_reason` in the body.
    """
    try:
        resp = _work_service_request(
            "POST",
            f"/api/v1/sap-agents/jobs/{job_id}/complete",
            json={
                "agent_id": _agent_self_id(),
                "result": result_payload,
            },
        )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": (
                    f"work-service complete HTTP {resp.status_code}: "
                    f"{resp.text[:200]}"
                ),
            }
        body = resp.json() if resp.text else {}
        return {
            "ok": bool(body.get("ok", True)),
            "rows_affected": int(body.get("rows_affected", 0)),
            "skipped_reason": body.get("skipped_reason"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _work_service_fail(
    job_id: str, error_msg: Optional[str], step: Optional[str]
) -> dict:
    """Phase 7 — POST /api/v1/sap-agents/jobs/<id>/fail.

    Same shape as `_work_service_complete`. The Rust handler trims
    `error` to 500 chars so we don't bother trimming here too — but
    we keep the local trim symmetric with the legacy PATCH so the
    parallel-run paths emit identical row contents.
    """
    try:
        resp = _work_service_request(
            "POST",
            f"/api/v1/sap-agents/jobs/{job_id}/fail",
            json={
                "agent_id": _agent_self_id(),
                "error": (error_msg or "")[:500],
                "step": step,
            },
        )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": (
                    f"work-service fail HTTP {resp.status_code}: "
                    f"{resp.text[:200]}"
                ),
            }
        body = resp.json() if resp.text else {}
        return {
            "ok": bool(body.get("ok", True)),
            "rows_affected": int(body.get("rows_affected", 0)),
            "skipped_reason": body.get("skipped_reason"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/jobs/{job_id}/complete")
def jobs_complete(job_id: str, req: JobCompleteRequest) -> dict:
    """Mark a job as completed with its result payload.

    v1.7.2 — uses `_patch_job_terminal` so a watchdog-killed job
    (status='failed') can't be silently rewritten to 'completed' when
    the long-stuck SAP call eventually returns. If 0 rows matched, we
    return `{ok: True, rows_affected: 0, skipped_reason: ...}` so the
    poller's caller can log the rejection and skip clearing
    `state.active_job_id`.

    Phase 11 (v2.0.0, 2026-05-07) — write unconditionally goes through
    `rust-work-service /api/v1/sap-agents/jobs/<id>/complete`. The
    Rust handler enforces the same `status='running' AND
    claimed_by=<self>` guard so the v1.7.2 semantics are preserved —
    only the transport changed. The legacy direct-PostgREST fallback
    (`_patch_job_terminal`) was deleted; setting
    `OMNIFRAME_AGENT_CLAIM_VIA_RUST=0` now returns an error instead of
    silently routing through PostgREST.
    """
    if not _CLAIM_VIA_RUST:
        return {
            "ok": False,
            "error": (
                "OMNIFRAME_AGENT_CLAIM_VIA_RUST=0 is no longer supported "
                "in v2.0.0+ (Phase 11 deleted the legacy direct-PostgREST "
                "complete fallback). Unset the env var or set it to 1."
            ),
        }
    result = _work_service_complete(job_id, req.result)
    if result.get("ok") and result.get("rows_affected", 0) == 0:
        print(
            f"[jobs] WARN status transition rejected — job {job_id} "
            f"not in expected state (likely watchdog-failed already)."
        )
    return result


@app.post("/jobs/{job_id}/fail")
def jobs_fail(job_id: str, req: JobFailRequest) -> dict:
    """Mark a job as failed with an error message.

    v1.7.2 — when invoked by the in-process watchdog the call goes
    through `_patch_job` directly (the watchdog's whole job is to
    transition a stuck `running` row → `failed`, so it shouldn't be
    blocked by the terminal guard). When invoked from a HANDLER's
    failure path (the dispatch returned `{ok: false}`), we DO want the
    guard so a watchdog-killed row isn't double-failed; the guard
    no-ops harmlessly in that case.

    Phase 11 (v2.0.0, 2026-05-07) — fail PATCH unconditionally goes
    through `rust-work-service /api/v1/sap-agents/jobs/<id>/fail`. The
    Rust handler enforces `status='running' AND claimed_by=<self>`
    even on the watchdog path: that's a slight TIGHTENING vs. the
    legacy unguarded `_patch_job(...)` watchdog escape hatch, but it's
    intentional — the watchdog only fires on a row this agent has been
    parked on, so the guard SHOULD always pass. If it doesn't (e.g.
    another agent already re-claimed via lease expiry), refusing the
    overwrite is the correct semantic: we don't want a ghost watchdog
    failing a row that's already running on a different box. The
    `state_mismatch` outcome is logged + counted in
    `sap_jobs_fail_total{step="watchdog"}` so the operator can see
    when this fires.
    """
    if not _CLAIM_VIA_RUST:
        return {
            "ok": False,
            "error": (
                "OMNIFRAME_AGENT_CLAIM_VIA_RUST=0 is no longer supported "
                "in v2.0.0+ (Phase 11 deleted the legacy direct-PostgREST "
                "fail fallback). Unset the env var or set it to 1."
            ),
        }
    result = _work_service_fail(job_id, req.error, req.step)
    if result.get("ok") and result.get("rows_affected", 0) == 0:
        print(
            f"[jobs] WARN fail transition rejected — job {job_id} "
            f"not in expected state (likely watchdog-failed already)."
        )
    return result


@app.post("/jobs/{job_id}/heartbeat")
def jobs_heartbeat(job_id: str) -> dict:
    """Bump heartbeat_at so dashboards know the job is still progressing.

    Phase 11 (v2.0.0, 2026-05-07) — wraps rust-work-service's
    `/api/v1/sap-agents/jobs/<id>/heartbeat` to stay symmetric with
    `_bump_current_job_lease`. Browser-facing `/jobs/{id}/heartbeat`
    is rarely called from outside the agent (the in-process heartbeat
    thread uses `_bump_current_job_lease` directly), but for any
    operator that hits this route via curl / debug shell the
    rust-work-service path is the canonical control-plane.
    """
    if not _CLAIM_VIA_RUST:
        return {
            "ok": False,
            "error": (
                "OMNIFRAME_AGENT_CLAIM_VIA_RUST=0 is no longer supported "
                "in v2.0.0+. Unset the env var or set it to 1."
            ),
        }
    try:
        resp = _work_service_request(
            "POST",
            f"/api/v1/sap-agents/jobs/{job_id}/heartbeat",
            json={
                "agent_id": _agent_self_id(),
                "lease_seconds": 90,
            },
        )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": (
                    f"heartbeat work-service HTTP {resp.status_code}: "
                    f"{resp.text[:200]}"
                ),
            }
        body = resp.json() if resp.text else {}
        return {
            "ok": bool(body.get("ok", True)),
            "rows_affected": int(body.get("rows_affected", 0)),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# Map job.endpoint values to the in-process handler that runs them.
# These are added below `process_shipment` is defined; populated in
# `_dispatch_job` via the FastAPI route table to avoid a forward ref.
_JOB_ENDPOINT_MODELS: dict[str, type[BaseModel]] = {
    "/sap/confirm-to":                    ConfirmTORequest,
    "/sap/transfer-inventory":            TransferInventoryRequest,
    "/sap/bin-blocks":                    BinBlocksRequest,
    "/sap/material-master-bin":           MaterialMasterBinRequest,
    "/sap/material-master-storage-types": MaterialMasterStorageTypesRequest,
    "/sap/create-storage-bin":            CreateStorageBinRequest,
    "/sap/process-shipment":              ShipmentRequest,
    # /sap/query is not a Pydantic-bound endpoint that mirrors a row payload,
    # but we still allow queue-driven queries by passing the dict through.
    # /sap/import-lt22 (Worker-D) is registered dynamically at boot time
    # below in the lt22_import include_router try-block — the model is
    # imported there to avoid a hard dependency on the optional module.
}


def _dispatch_job(job: dict) -> dict:
    """Run the agent endpoint matching job['endpoint'] with job['payload']
    and return its dict response. Uses the registered Pydantic model where
    available so validation matches the HTTP path.

    v1.6.4 — strips the `__omni_trigger_meta` key before validation so
    Pydantic's `extra='ignore'` default doesn't silently drop it when
    the model is strict (the poller still reads it directly from
    `job.payload` to apply post-success patches; see `_loop` below).

    v1.8.3 — extracts `row_id` from `__omni_trigger_meta.post_success_patch`
    and passes it as a kwarg to `/sap/confirm-to` so the handler can
    forward it into `_update_putaway_status` and PATCH by exact row id
    instead of `to_number + warehouse + created_at >= today` (the
    UTC-midnight bug fix). Other handlers do NOT receive `row_id` —
    only handlers that explicitly accept it opt in here. See
    [[Debug/Fix-Putaway-Status-UTC-Midnight]].
    """
    endpoint = str(job.get("endpoint", "")).strip()
    _touch_active_job_progress()
    raw_payload = job.get("payload") or {}
    payload = {k: v for k, v in raw_payload.items() if k != "__omni_trigger_meta"}

    # v1.8.3 — pull the source-row id off the trigger meta, if present.
    # This is the SAME row_id that `_apply_trigger_post_patch` already
    # uses for the attribution overlay PATCH (`id=eq.<row_id>`); we now
    # also let the handler use it for the legacy 3-field PATCH.
    trigger_row_id: Optional[str] = None
    try:
        _meta = (raw_payload.get("__omni_trigger_meta") or {})
        _post_patch = _meta.get("post_success_patch") or {}
        _row_id = _post_patch.get("row_id")
        if isinstance(_row_id, str) and _row_id:
            trigger_row_id = _row_id
    except Exception:
        trigger_row_id = None

    # The handlers are normal Python functions on `app`. Look them up in
    # the FastAPI router table by path so we don't have to import each
    # symbol up front.
    handler_fn = None
    for r in app.routes:
        if getattr(r, "path", None) == endpoint:
            handler_fn = getattr(r, "endpoint", None)
            break
    if handler_fn is None:
        return {"ok": False, "error": f"No agent endpoint for '{endpoint}'"}

    Model = _JOB_ENDPOINT_MODELS.get(endpoint)
    # v1.8.3 — endpoints that opt in to receiving `row_id` from the
    # trigger meta. Keep this list narrow — adding an endpoint here
    # changes its dispatch shape, so the handler MUST declare a
    # `row_id: Optional[str] = None` kwarg.
    _ROW_ID_AWARE_ENDPOINTS = ("/sap/confirm-to",)
    try:
        if Model is None:
            # Generic dict path (e.g. /sap/query)
            if endpoint == "/sap/query":
                return handler_fn(QueryRequest(**payload))
            return handler_fn(**payload)
        if endpoint in _ROW_ID_AWARE_ENDPOINTS and trigger_row_id:
            return handler_fn(Model(**payload), row_id=trigger_row_id)
        return handler_fn(Model(**payload))
    except Exception as e:
        return {"ok": False, "error": f"Job dispatch raised: {e}"}


def _start_job_poller():
    """Background thread that drains `sap_agent_jobs` for our org.

    Phase D #16 — wake-ups come from two sources:
        1. The Supabase Realtime subscription (sub-second latency on
           a fresh INSERT — see `_start_realtime_subscription`).
        2. A polling fallback for missed events / reconnect gaps.

    v1.7.0 — DRAIN-BACK-TO-BACK throughput overhaul
    ================================================
    Previously (v1.6.x) the loop would claim one job, dispatch it, then
    `continue` back to the top. The outer `while` re-entered the try
    block, re-checked `state.sap_connected && supabase_token && org_id`,
    and re-called `jobs_claim()` — which is the right shape in theory,
    but in production the user saw **60-180s inter-job dwell** because:

    - `continue` after a successful dispatch fell through to
      `drain_event.wait(interval)` when `jobs_claim()` returned `None`
      (queue empty). `interval` was 60s. Even a single claim-miss
      between two queued jobs cost a 60s wait for the next Realtime
      wake-up.
    - The Realtime wake-up sometimes didn't fire (missed WebSocket
      event during a reconnect blip — the same failure mode the v1.6.9
      backfill poller covers for `rf_putaway_operations` but NOT for
      `sap_agent_jobs`).

    v1.7.0 restructures the loop:
      - Once a job completes/fails, IMMEDIATELY try to claim another
        (no sleep). Chain up to `_DRAIN_MAX_CHAIN` back-to-back jobs in
        one pass before handing control back to the wait loop.
      - Idle (no job to claim) uses exponential backoff starting at
        `_DRAIN_MIN_IDLE_SEC` (5s) and doubling up to
        `_DRAIN_MAX_IDLE_SEC` (60s). The existing fallback cap is
        preserved — we never sleep LONGER than 60s even after many
        consecutive empty polls.
      - Any claim hit (job returned) resets the backoff to the minimum
        so the next idle wait is 5s, not 60s.
      - Back-to-back chains of 5+ jobs print a
        `[jobs] Drain mode: <N> jobs claimed in last burst.` summary
        line so a batch of triggers is clearly visible in the console.

    Also in v1.7.0:
      - Active-job tracking moved from `_job_poller_state["current_job_id"]`
        (local to this thread) to `state.active_job_id` (shared with the
        new watchdog thread — see `_start_job_watchdog_thread`).
        `_job_poller_state["current_job_id"]` is still mirrored for
        back-compat with the existing `_build_agent_registry_row`
        / `/status` consumers but the authoritative value lives in
        `state`.
      - The lock around `state.active_job_id` ensures the watchdog
        can't observe a torn write mid-clear.

    Multiple agents pointed at the same org still race safely thanks
    to `FOR UPDATE SKIP LOCKED` inside the `claim_sap_agent_job` RPC,
    plus the 90s lease re-claim path (v1.7.0 — was 300s).
    """
    if _job_poller_state.get("active"):
        return
    stop_event = threading.Event()
    drain_event = threading.Event()

    def _claim_and_dispatch_one() -> bool:
        """Try to claim exactly ONE job. If there's work, dispatch it
        and update `state.active_job_id` lifecycle. Returns True if a
        job was claimed (regardless of success/failure), False if the
        queue was empty or we couldn't claim. Raised exceptions are
        logged and treated as "no claim" so the outer loop falls
        through to the backoff wait.
        """
        try:
            claim = jobs_claim()
        except Exception as e:
            print(f"[jobs]   Claim raised: {e}")
            return False
        if not claim.get("ok"):
            return False
        job = claim.get("job")
        if not job:
            return False
        job_id = job["id"]
        endpoint = job.get("endpoint")
        # v1.7.0 — mark the job active BEFORE dispatch so the watchdog
        # sees it. Clear AFTER the complete/fail PATCH lands so a crash
        # mid-PATCH still looks "running" to the watchdog (which will
        # then time out and try to mark it failed — correct behavior).
        with state.active_job_lock:
            state.active_job_id = job_id
            state.active_job_started_at = time.time()
            state.active_job_progress_at = state.active_job_started_at
            state.active_job_endpoint = endpoint
        # Mirror into the legacy dict for `_build_agent_registry_row`
        # and any other consumer that still reads the old key.
        _job_poller_state["current_job_id"] = job_id
        print(f"[jobs]   Claimed job {job_id} → {endpoint}")
        try:
            result = _dispatch_job(job)
        except Exception as e:
            result = {"ok": False, "error": f"unhandled: {e}"}

        try:
            if isinstance(result, dict) and result.get("ok"):
                # v1.6.4 — apply trigger post-success patch BEFORE
                # marking the job complete. This is the agent-side
                # equivalent of applyPostSuccessPatch in
                # use-agent-trigger-runtime.ts; without it the source
                # row never flips to "TO Confirmed" and the trigger
                # would re-fire on the next Realtime tick.
                try:
                    _meta = ((job.get("payload") or {})
                             .get("__omni_trigger_meta") or {})
                    _post_patch = _meta.get("post_success_patch")
                    if _post_patch:
                        _apply_trigger_post_patch(_post_patch, job_id)
                except Exception as _ppe:
                    print(f"[triggers] post-success patch error "
                          f"for job {job_id}: {_ppe}")
                jobs_complete(job_id, JobCompleteRequest(result=result))
                print(f"[jobs]   Job {job_id} completed.")
            else:
                err = (result or {}).get("error") if isinstance(result, dict) else "Unknown"
                step = (result or {}).get("step") if isinstance(result, dict) else None
                jobs_fail(job_id, JobFailRequest(
                    error=str(err)[:500], step=step,
                    result=result if isinstance(result, dict) else {},
                ))
                print(f"[jobs]   Job {job_id} failed: {err}")
        finally:
            # ALWAYS clear the active-job state, even if the complete/
            # fail PATCH itself raised. Otherwise the watchdog would
            # time out on a job whose SAP work actually succeeded,
            # producing a confusing "watchdog killed a healthy job"
            # line in the log. The job row would then get re-patched
            # by the watchdog's `jobs_fail` anyway — harmless in the
            # DB (PATCH is idempotent on status=failed) but misleading.
            with state.active_job_lock:
                state.active_job_id = None
                state.active_job_started_at = None
                state.active_job_progress_at = None
                state.active_job_endpoint = None
            _job_poller_state["current_job_id"] = None
            # v1.7.8 — Stamp completion time so the heartbeat thread
            # can decide whether to slow its cadence (idle >5min →
            # 60s). Set in the finally so a failed/raised dispatch
            # still counts as "agent finished doing work" for
            # cadence purposes.
            state.last_job_completed_at = time.time()
        return True

    def _resolve_idle_max() -> float:
        """v1.7.1 — when the Realtime circuit breaker has tripped we
        run polling-only. Tighten the idle ceiling from 5→60s to
        5→15s so a fresh `sap_agent_jobs` INSERT doesn't sit
        unclaimed for up to a minute while Realtime is offline. The
        `_start_realtime_circuit_reset_loop` daemon flips
        `state.realtime_disabled` back to False every 5min so
        normal-mode dwell resumes automatically once the network
        recovers. Re-evaluated on EVERY iteration so the change is
        picked up the same tick the breaker trips/resets.
        """
        configured_max = float(
            _job_poller_state.get("poll_interval_sec", _DRAIN_MAX_IDLE_SEC)
        )
        if state.realtime_disabled:
            return min(configured_max, _REALTIME_FALLBACK_POLL_MAX_IDLE_SEC)
        return configured_max

    def _loop():
        # Initial idle sleep — same 5s floor the drain chain uses after
        # an empty poll. First burst of work still fires sub-second
        # via the Realtime wake-up (drain_event).
        idle_sleep = _DRAIN_MIN_IDLE_SEC
        max_idle = _resolve_idle_max()
        print(
            f"[jobs]   Background poller started — drain-mode "
            f"(idle backoff {int(_DRAIN_MIN_IDLE_SEC)}→{int(max_idle)}s, "
            f"drain chain cap {_DRAIN_MAX_CHAIN}; "
            f"Realtime-driven wake-ups when connected; "
            f"polling-only fallback ceiling "
            f"{int(_REALTIME_FALLBACK_POLL_MAX_IDLE_SEC)}s when "
            "Realtime circuit breaker is tripped)."
        )
        consecutive_empty = 0
        while not stop_event.is_set():
            # v1.7.1 — re-resolve every iteration so a Realtime
            # circuit-breaker trip/reset takes effect on the next
            # backoff cycle without restarting the poller.
            max_idle = _resolve_idle_max()
            # Gate: only poll when we have SAP + a Supabase session.
            # This is the same gate as v1.6.x — an agent without SAP
            # connected cannot dispatch any handler, and without a
            # JWT the claim RPC would 401.
            if not (state.sap_connected and state.supabase_token and state.org_id):
                # Respect the drain_event for wake-up during startup
                # (e.g. /supabase/login finishing). Idle cap applies.
                drain_event.clear()
                drain_event.wait(min(idle_sleep, max_idle))
                if stop_event.is_set():
                    break
                continue

            # DRAIN — chain up to `_DRAIN_MAX_CHAIN` jobs back-to-back.
            # Each loop iteration claims exactly one job; the helper
            # returns True if work was done, False if the queue is
            # empty. We stop draining as soon as a claim misses OR
            # we hit the chain cap.
            drained = 0
            while drained < _DRAIN_MAX_CHAIN and not stop_event.is_set():
                did_work = _claim_and_dispatch_one()
                if not did_work:
                    break
                drained += 1
            if drained > 0:
                # Successful burst — reset backoff so the next idle is
                # short (5s, not 60s).
                consecutive_empty = 0
                idle_sleep = _DRAIN_MIN_IDLE_SEC
                if drained >= 5:
                    print(f"[jobs]   Drain mode: {drained} jobs claimed in last burst.")
                if drained >= _DRAIN_MAX_CHAIN:
                    # Hit the cap — don't sleep, just re-enter the
                    # loop so the next iteration's drain continues.
                    # The chain cap is purely about preventing a single
                    # iteration from monopolizing the thread so the
                    # stop_event can fire between bursts.
                    continue
            else:
                # Empty poll — bump the backoff exponentially, capped
                # at max_idle. Resets to the minimum on any claim hit.
                consecutive_empty += 1
                idle_sleep = min(max_idle, _DRAIN_MIN_IDLE_SEC * (2 ** max(0, consecutive_empty - 1)))

            # Wait either for the idle interval or a Realtime-driven
            # wake-up (whichever comes first). drain_event fires on
            # every `sap_agent_jobs` INSERT the Realtime thread sees
            # and on any external `/jobs/claim` POST.
            drain_event.clear()
            triggered = drain_event.wait(idle_sleep)
            if triggered:
                # Realtime wake — treat as a claim hit for backoff
                # purposes so the NEXT idle is short (the drain loop
                # above will exit quickly if the insert was a false
                # alarm).
                consecutive_empty = 0
                idle_sleep = _DRAIN_MIN_IDLE_SEC
                drain_event.clear()
            if stop_event.is_set():
                break
        print("[jobs]   Background poller stopped.")

    t = threading.Thread(target=_loop, daemon=True, name="sap-job-poller")
    _job_poller_state["thread"] = t
    _job_poller_state["stop_event"] = stop_event
    _job_poller_state["drain_event"] = drain_event
    _job_poller_state["active"] = True
    t.start()


def _stop_job_poller():
    ev = _job_poller_state.get("stop_event")
    if ev is not None:
        ev.set()
    drain = _job_poller_state.get("drain_event")
    if drain is not None:
        drain.set()
    _job_poller_state["active"] = False


def _kick_job_poller(reason: str = "external"):
    """Wake the poller immediately. Called by the Realtime subscription
    callback on every INSERT and after manual `/jobs/claim` invocations
    so the poller doesn't sleep through fresh work."""
    drain = _job_poller_state.get("drain_event")
    if drain is not None:
        drain.set()


# ---------------------------------------------------------------------------
#  v1.7.0 — Stuck-Job Watchdog
# ---------------------------------------------------------------------------
# Production observed an active job stuck in `running` for 97+ seconds
# (normal distribution is 3-30s for a TO confirm; 20-60s for a shipment).
# Meanwhile the agent's poller had moved on to the NEXT job without
# releasing the stuck one — DB snapshot showed two rows as `running`
# simultaneously, which is physically impossible on a single-threaded
# SAP COM session. Root cause: a SAP scripting call that never
# returned (COM hang; popup eaten by `_wait_for_control` without the
# handler being coded to notice). The handler's `_dispatch_job` call
# was blocked forever, so the poller's `current_job_id = None` line
# after the complete/fail PATCH never ran. The heartbeat thread kept
# bumping the lease, so nobody re-claimed.
#
# The watchdog runs on its own daemon thread, wakes every
# `_WATCHDOG_TICK_SEC` (30), and checks whether a job has been
# `state.active_job_id` for more than `_WATCHDOG_TIMEOUT_SEC`
# (default 120; override via `OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS`).
# If yes:
#   1. Log `[jobs] WATCHDOG: job <id> running >Ns — likely stuck.
#      Marking failed and releasing.`
#   2. Call `jobs_fail(job_id, error="Watchdog: ...")` against the
#      DB so the row transitions to `failed` and the lease clears.
#   3. Reset `state.active_job_id` to None so the NEXT poll cycle
#      can claim the next row.
#
# We DO NOT try to kill the hung COM call — that's not safe from
# Python (SAP scripting runs on the main thread's COM apartment). The
# handler eventually returns (possibly with an error), which is now
# harmless because the watchdog has already written the DB row as
# `failed`; the `jobs_complete` that the handler tries to send will
# 200 OK with no effect (the row is already terminal on the DB side,
# PostgREST accepts a same-value PATCH idempotently). Worst case the
# poller blocks in COM for a few more minutes but the job queue keeps
# draining on subsequent rows because the watchdog already cleared
# `state.active_job_id`… wait, no — actually the poller IS blocked
# on the hung call. The watchdog frees the DB state, but the poller
# thread is still parked in the COM call. When the COM call eventually
# returns (or the SAP session is killed externally by the user) the
# poller's `finally:` block runs and tries to clear
# `state.active_job_id` — which is already None, so it's a no-op.
# The poller's outer loop then claims the next job.
#
# Net effect: the DB state is always consistent (one `running` row at
# a time from the agent's perspective), the user can manually kill
# the SAP session to unstick the COM call, and nobody has to restart
# the agent for a single bad row.
#
# Capability id: `stuck-job-watchdog`. Advertised so dashboards can
# show "agent self-recovers from COM hangs" alongside
# `self-healing-schema-fallback` and `trigger-backfill-poller`.

_WATCHDOG_TICK_SEC: float = 30.0

# Default watchdog timeout (seconds). Tunable via env so ops can
# bump it for SAP systems where LT12 on an exceptionally large TO
# legitimately takes 2+ minutes. 120s covers every handler we ship
# today (the slowest observed normal completion was ~60s on a
# 10-item shipment during the shipment-processing worst case). If
# the env var is malformed, fall back to 120.
def _resolve_watchdog_timeout() -> float:
    raw = os.environ.get("OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS", "").strip()
    if not raw:
        return 120.0
    try:
        val = float(raw)
        if val < 10.0:
            # Guard-rail — a sub-10s watchdog would kill legitimate work.
            print(
                f"[jobs]   WARN watchdog timeout {val}s is below the 10s "
                "floor; clamping to 10s. Set "
                "OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS to a larger value."
            )
            return 10.0
        return val
    except ValueError:
        print(
            f"[jobs]   WARN OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS="
            f"{raw!r} is not a number; falling back to 120s."
        )
        return 120.0


_WATCHDOG_TIMEOUT_SEC: float = _resolve_watchdog_timeout()

# 2026-05-31 — Per-endpoint watchdog budgets. A few handlers are multi-step SAP
# fan-outs that legitimately run for minutes, so the 120s default mis-fires on
# them ("Watchdog: job exceeded 120s timeout — likely SAP session hang" on a
# perfectly healthy run — exactly the LL01 failure ops reported). Map those
# endpoints to a generous budget; every other endpoint keeps the fast 120s
# default so a genuine COM hang still recovers quickly. The effective timeout is
# max(per-endpoint, env default), so bumping OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS
# still lifts these too.
#
#   - /sap/ll01/warehouse-activity: 5 plants × 7 categories sequential, ~5 min
#     typical; 900s matches the frontend's 15-min dispatch ceiling.
#   - /sap/lx25/inventory-completion: 5-warehouse fan-out, 30-60s typical but
#     bursty on a slow SAP (see the LX25 "lease budget caveat").
_WATCHDOG_ENDPOINT_TIMEOUT_SEC: dict[str, float] = {
    "/sap/ll01/warehouse-activity": 900.0,
    "/sap/lx25/inventory-completion": 600.0,
}


def _watchdog_timeout_for(endpoint: Optional[str]) -> float:
    """Effective stuck-job timeout for the active job's endpoint. Long SAP
    fan-outs get a generous per-endpoint budget; everything else uses the
    120s default. Always >= the env-configured default so an ops bump lifts
    every endpoint."""
    if not endpoint:
        return _WATCHDOG_TIMEOUT_SEC
    return max(_WATCHDOG_ENDPOINT_TIMEOUT_SEC.get(endpoint, 0.0), _WATCHDOG_TIMEOUT_SEC)


_watchdog_state: dict[str, Any] = {
    "active": False,
    "thread": None,
    "stop_event": None,
    "last_killed_job_id": None,
    "kills_total": 0,
}


def _start_job_watchdog_thread():
    """Spawn the stuck-job watchdog daemon thread. Idempotent — safe
    to call multiple times (second call is a no-op). Started from
    the FastAPI startup hook alongside the other background threads.
    """
    if _watchdog_state.get("active"):
        return
    stop_event = threading.Event()

    def _loop():
        print(
            f"[jobs]   Stuck-job watchdog started "
            f"(tick {int(_WATCHDOG_TICK_SEC)}s, timeout {int(_WATCHDOG_TIMEOUT_SEC)}s; "
            f"override via OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS)."
        )
        while not stop_event.is_set():
            try:
                with state.active_job_lock:
                    job_id = state.active_job_id
                    started_at = state.active_job_started_at
                    endpoint = state.active_job_endpoint
                if job_id and started_at:
                    elapsed = time.time() - started_at
                    timeout = _watchdog_timeout_for(endpoint)
                    if elapsed > timeout:
                        # Double-check under the lock to guard against
                        # a race where the poller's finally: block
                        # cleared state.active_job_id between our
                        # snapshot and this branch. If cleared, bail —
                        # the job finished legitimately.
                        with state.active_job_lock:
                            still_active = (
                                state.active_job_id == job_id
                                and state.active_job_started_at == started_at
                            )
                            if still_active:
                                state.active_job_id = None
                                state.active_job_started_at = None
                                state.active_job_progress_at = None
                                state.active_job_endpoint = None
                                _job_poller_state["current_job_id"] = None
                        if still_active:
                            elapsed_int = int(elapsed)
                            print(
                                f"[jobs]   WATCHDOG: job {job_id} "
                                f"({endpoint or 'unknown'}) running "
                                f">{elapsed_int}s (budget {int(timeout)}s) — "
                                "likely stuck. Marking failed and releasing."
                            )
                            _watchdog_state["last_killed_job_id"] = job_id
                            _watchdog_state["kills_total"] = (
                                int(_watchdog_state.get("kills_total", 0)) + 1
                            )
                            try:
                                jobs_fail(
                                    job_id,
                                    JobFailRequest(
                                        error=(
                                            f"Watchdog: job exceeded "
                                            f"{int(timeout)}s "
                                            "timeout — likely SAP session hang"
                                        ),
                                        step="watchdog",
                                        result={"watchdog": True, "elapsed_sec": elapsed_int},
                                    ),
                                )
                            except Exception as fe:
                                print(f"[jobs]   WATCHDOG: jobs_fail raised: {fe}")
                            # Wake the poller so the next row gets claimed
                            # immediately (don't wait for the next tick).
                            _kick_job_poller("watchdog-released")
            except Exception as e:
                print(f"[jobs]   WATCHDOG tick error: {e}")
            stop_event.wait(_WATCHDOG_TICK_SEC)
        print("[jobs]   Stuck-job watchdog stopped.")

    t = threading.Thread(target=_loop, daemon=True, name="sap-job-watchdog")
    _watchdog_state["thread"] = t
    _watchdog_state["stop_event"] = stop_event
    _watchdog_state["active"] = True
    t.start()


def _stop_job_watchdog_thread():
    ev = _watchdog_state.get("stop_event")
    if ev is not None:
        ev.set()
    _watchdog_state["active"] = False


# ---------------------------------------------------------------------------
#  Phase D #13 — Multi-Agent Coordination: fleet registry + heartbeat
# ---------------------------------------------------------------------------
# Every 30s the agent upserts its row in `public.sap_agents` so the
# dashboard knows it's online, what version it runs, what SAP session
# it's bound to, and which capabilities it reports. Dropped heartbeats
# (90s grace) flip status → 'offline' via `reap_stale_sap_agents()`.
#
# The heartbeat thread also bumps `claim_lease_until` for whatever job
# the poller is currently running, so a long SAP transaction doesn't
# look stale and get re-claimed from under us.

def _current_sap_session_info() -> dict:
    """Best-effort snapshot of the current SAP session (system/client/user
    + active transaction). Returns empty fields when SAP is not connected
    so the heartbeat upsert never fails on a missing COM object."""
    info: dict[str, Any] = {"system": "", "client": "", "user": "", "transaction": ""}
    if not state.sap_connected:
        return info
    try:
        sess, _ = _get_sap_session()
        si = sess.Info
        info["system"] = str(si.SystemName or "")
        info["client"] = str(si.Client or "")
        info["user"] = str(si.User or "")
        info["transaction"] = str(si.Transaction or "")
    except Exception:
        # SAP could have closed the window between the connected flag and
        # the heartbeat tick — ignore, we'll resync on the next pulse.
        pass
    return info


def _build_agent_registry_row(status: str = "online") -> dict[str, Any]:
    """Construct the upsert payload for `public.sap_agents`. Always includes
    the org id (FK) and pulls live SAP session info so dashboards can see
    which warehouse/system this agent is currently bound to."""
    citrix = detect_citrix()
    sapinfo = _current_sap_session_info()
    current_action = None
    cur_id = _job_poller_state.get("current_job_id")
    if cur_id:
        current_action = {"job_id": cur_id, "kind": "job"}
    return {
        "id": _agent_self_id(),
        "organization_id": state.org_id,
        "display_name": (citrix.get("user_name") or "")
                          + (f"@{citrix.get('computer_name', '')}" if citrix.get("computer_name") else ""),
        "hostname": citrix.get("computer_name") or "",
        "citrix_session": citrix.get("session_name") or "",
        "version": AGENT_VERSION,
        "sap_system": sapinfo.get("system") or None,
        "sap_client": sapinfo.get("client") or None,
        "sap_user": sapinfo.get("user") or None,
        "capabilities": AGENT_CAPABILITIES,
        "status": status,
        "current_action": current_action,
        "last_seen_at": datetime.utcnow().isoformat() + "Z",
        # v1.6.5 — per-process fingerprint for debugging. The agent_id
        # itself no longer carries the PID (so heartbeats merge into one
        # stable row instead of bloating the fleet card after every
        # rebuild), but ops still want to see "this row was last
        # heartbeat'd by a process that started at HH:MM" to spot a
        # boot-loop. Migration 250 adds the column; older schemas
        # silently drop the field on upsert (PostgREST ignores unknown
        # cols by default — but since our migration runs before the
        # rebuild, this isn't a real concern in practice).
        "process_started_at": _AGENT_PROCESS_STARTED_AT,
    }


# v1.6.7 — Self-healing schema-cache fallback. When a feature column is
# missing (migration not yet applied OR PostgREST schema cache is stale
# right after a fresh migration), PostgREST returns 400 with
# `"Could not find ... column"`. v1.6.5/v1.6.6 set a permanent boolean
# flag, which meant a transient cache miss disabled the feature for the
# rest of the process lifetime. This wrapper trips for `cooldown_seconds`
# (default 5min), then auto-retries the FULL schema on the next call;
# clears on success, restarts the cooldown on repeat failure.
class _SchemaFallbackFlag:
    """Self-healing fallback flag. Once tripped, suppresses a feature
    for `cooldown` seconds (default 5min). After cooldown, the next call
    re-attempts WITH the feature; if it succeeds, the flag stays cleared;
    if it fails the same way, the cooldown restarts.

    Prevents a transient PostgREST schema cache miss (or any 400-class
    schema error) from permanently disabling a feature for the lifetime
    of the agent process. See [[Patterns/Self-Healing-Schema-Fallback]].
    """

    def __init__(self, label: str, cooldown_seconds: float = 300.0):
        self._label = label
        self._cooldown = cooldown_seconds
        self._tripped_at: Optional[float] = None

    @property
    def active(self) -> bool:
        if self._tripped_at is None:
            return False
        if (time.time() - self._tripped_at) > self._cooldown:
            print(
                f"[schema-fallback] {self._label}: cooldown expired, "
                "re-attempting full schema on next call."
            )
            self._tripped_at = None
            return False
        return True

    def trip(self, reason: str) -> None:
        self._tripped_at = time.time()
        print(
            f"[schema-fallback] {self._label}: tripped ({reason}); "
            f"will retry full schema in {int(self._cooldown)}s."
        )

    def clear(self) -> None:
        if self._tripped_at is not None:
            print(
                f"[schema-fallback] {self._label}: cleared "
                "(full schema works again)."
            )
        self._tripped_at = None


# v1.6.5 — when migration 250 hasn't been applied yet (or PostgREST's
# schema cache is stale right after the migration), the
# `process_started_at` column doesn't exist and the upsert 400s. The
# self-healing wrapper drops the field for 5min then auto-retries.
_REGISTRY_DROP_PROCESS_STARTED_AT = _SchemaFallbackFlag(
    "sap_agents.process_started_at", cooldown_seconds=300
)


def _upsert_self_in_registry(status: str = "online") -> dict:
    """POST a `merge-duplicates` upsert into `public.sap_agents`. Uses the
    user JWT so RLS allows the row (organization_id matches the user's
    org).

    v1.6.5 — retries without `process_started_at` if migration 250 hasn't
    been applied yet, so an out-of-order rebuild + migration rollout
    doesn't silently break the fleet card.

    v1.6.7 — fallback is now self-healing: a transient PostgREST schema
    cache miss right after migration 250 lands no longer permanently
    strips the column for the rest of the process lifetime. See
    `_SchemaFallbackFlag`.
    """
    if not state.supabase_url or not state.supabase_token or not state.org_id:
        return {"ok": False, "error": "Supabase not logged in (no token/org_id) — cannot register agent."}
    try:
        body = _build_agent_registry_row(status=status)
        attempted_full_schema = not _REGISTRY_DROP_PROCESS_STARTED_AT.active
        if not attempted_full_schema:
            body.pop("process_started_at", None)
        resp = _supabase_request(
            "POST",
            f"{state.supabase_url}/rest/v1/sap_agents",
            json=body,
            headers={
                **_supabase_headers(),
                "Prefer": "resolution=merge-duplicates,return=representation",
            },
        )
        # If the column doesn't exist (migration 250 not yet applied OR
        # PostgREST cache stale), trip the fallback for 5min then retry.
        fallback_used = False
        if (
            resp.status_code == 400
            and attempted_full_schema
            and "process_started_at" in (resp.text or "")
        ):
            _REGISTRY_DROP_PROCESS_STARTED_AT.trip(
                f"PostgREST 400 on sap_agents upsert: {resp.text[:120]}"
            )
            fallback_used = True
            body.pop("process_started_at", None)
            resp = _supabase_request(
                "POST",
                f"{state.supabase_url}/rest/v1/sap_agents",
                json=body,
                headers={
                    **_supabase_headers(),
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
            )
        if resp.status_code >= 400:
            return {"ok": False, "error": f"sap_agents upsert HTTP {resp.status_code}: {resp.text[:200]}"}
        if attempted_full_schema and not fallback_used:
            _REGISTRY_DROP_PROCESS_STARTED_AT.clear()
        return {"ok": True, "row": resp.json()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# 2026-05-31 — Per-endpoint claim lease. The 90s default is too tight for the
# multi-minute SAP fan-outs (LL01 ~6 min, LX25 bursty): the lease lapses right
# as the agent's jobs_complete lands, so the server-side zombie reaper
# (claim_sap_agent_job, migration 291) flips the still-`running` row to `failed`
# and the result never attaches — even though the SAP work + data write
# finished (see Debug/Fix-LL01-Job-Reaped-But-Data-Persisted). A generous
# per-endpoint lease keeps the row claimed through completion. Default stays 90s
# so a genuinely-crashed agent's normal job is re-claimable quickly. rust's
# /jobs/{id}/heartbeat already honours the request's lease_seconds — no rust
# change needed.
_LEASE_SECONDS_DEFAULT = 90
_LEASE_SECONDS_BY_ENDPOINT: dict[str, int] = {
    "/sap/ll01/warehouse-activity": 600,
    "/sap/lx25/inventory-completion": 600,
}


def _lease_seconds_for(endpoint: Optional[str]) -> int:
    if not endpoint:
        return _LEASE_SECONDS_DEFAULT
    return max(
        _LEASE_SECONDS_BY_ENDPOINT.get(endpoint, 0), _LEASE_SECONDS_DEFAULT
    )


def _bump_current_job_lease() -> None:
    """If the poller is running a job right now, push its
    `claim_lease_until` forward so other agents don't re-claim it.

    v1.7.0 — now reads from `state.active_job_id` (the single source of
    truth for "what is the SAP COM thread doing right now") instead of
    the poller-local `_job_poller_state["current_job_id"]` mirror.
    Lease seconds tightened from 300 → 90 to match the new watchdog
    semantics (a row that the agent has actually hung on should become
    re-claimable quickly).

    Phase 11 (v2.0.0, 2026-05-07) — bump unconditionally goes through
    `rust-work-service /api/v1/sap-agents/jobs/<id>/heartbeat`. The
    legacy direct-PostgREST RPC fallback (`bump_sap_agent_job_lease`)
    was deleted; the heartbeat thread no-ops cleanly when the env var
    `OMNIFRAME_AGENT_CLAIM_VIA_RUST=0` is set.
    """
    with state.active_job_lock:
        cur_id = state.active_job_id
        endpoint = state.active_job_endpoint
    _touch_active_job_progress()
    if not cur_id:
        return
    if not _CLAIM_VIA_RUST:
        return
    try:
        _work_service_request(
            "POST",
            f"/api/v1/sap-agents/jobs/{cur_id}/heartbeat",
            json={
                "agent_id": _agent_self_id(),
                "lease_seconds": _lease_seconds_for(endpoint),
            },
        )
    except Exception as e:
        # Lease bump is best-effort. The next claim attempt will pick the
        # row back up if it gets reaped.
        print(f"[heartbeat] lease bump failed: {e}")


def _start_heartbeat_thread():
    """Background thread that:
        - Upserts our row in `sap_agents` every 30s (active mode) or
          60s (idle mode) — see v1.7.8 adaptive cadence below.
        - Bumps `claim_lease_until` for the currently-running job
          (only meaningful in active mode).

    v1.7.8 — Adaptive cadence + reaper RPC removal:
      - Default (active) cadence is 30s, retained for snappy lease
        bumping while a job is in flight.
      - When `state.active_job_id is None` AND `time.time() -
        state.last_job_completed_at > 300` (5min idle) the cadence
        slows to 60s. This halves `sap_agents.last_seen_at` UPDATEs
        on quiescent agents — the dominant DB write outside of job
        execution itself — without affecting fleet-card freshness
        materially (the pg_cron-driven `mark_stale_sap_agents_offline`
        reaper still runs every minute, so a dead agent is still
        flipped to `offline` within ~3min). Transitions log once so
        ops can correlate console output with the cadence change.
      - Removed the per-tick `reap_stale_sap_agents()` RPC call. The
        pg_cron job `omniframe-reap-stale-sap-agents` (registered in
        migration 250) drives the reaper server-side every minute,
        so each agent doing its own sweep was N×2 RPCs/min for
        nothing. Function definition is unchanged — only the agent
        stops calling it. See
        [[Implementations/Implement-Agent-DB-Load-Reduction]].
    """
    if _agent_heartbeat_state.get("active"):
        return
    stop_event = threading.Event()
    base_interval = float(_agent_heartbeat_state.get("interval_sec", 30.0))
    idle_interval = max(base_interval, 60.0)
    idle_after_sec = 300.0

    def _resolve_cadence(currently_active: bool, idle_for_sec: float) -> float:
        """Active job → base; idle for >5min and no active job → idle."""
        if currently_active:
            return base_interval
        if idle_for_sec > idle_after_sec:
            return idle_interval
        return base_interval

    def _loop():
        print(
            f"[heartbeat] Agent registry heartbeat started "
            f"(active cadence {base_interval:.0f}s, "
            f"idle cadence {idle_interval:.0f}s after "
            f"{int(idle_after_sec)}s idle)."
        )
        last_mode: Optional[str] = None
        while not stop_event.is_set():
            try:
                if state.supabase_token and state.org_id:
                    res = _upsert_self_in_registry("online")
                    if res.get("ok") and not _agent_heartbeat_state.get("registered"):
                        _agent_heartbeat_state["registered"] = True
                        print(f"[heartbeat] Registered as {_agent_self_id()} in sap_agents.")
                    _bump_current_job_lease()
                    # v1.7.8 — `reap_stale_sap_agents()` is no longer called
                    # from here; the pg_cron job
                    # `omniframe-reap-stale-sap-agents` (migration 250)
                    # runs server-side every minute and is the canonical
                    # reaper. Function still exists for opportunistic
                    # callsites; the agent simply doesn't need to drive it.
            except Exception as e:
                print(f"[heartbeat] tick failed: {e}")

            with state.active_job_lock:
                currently_active = state.active_job_id is not None
            idle_for_sec = max(0.0, time.time() - state.last_job_completed_at)
            cadence = _resolve_cadence(currently_active, idle_for_sec)
            mode = "active" if cadence == base_interval else "idle"
            if mode != last_mode:
                print(
                    f"[heartbeat] Idle mode — cadence {idle_interval:.0f}s. "
                    f"Active mode — {base_interval:.0f}s. Currently: {mode}"
                )
                last_mode = mode
            stop_event.wait(cadence)
        print("[heartbeat] Agent registry heartbeat stopped.")

    t = threading.Thread(target=_loop, daemon=True, name="sap-agent-heartbeat")
    _agent_heartbeat_state["thread"] = t
    _agent_heartbeat_state["stop_event"] = stop_event
    _agent_heartbeat_state["active"] = True
    t.start()


def _stop_heartbeat_thread():
    ev = _agent_heartbeat_state.get("stop_event")
    if ev is not None:
        ev.set()
    _agent_heartbeat_state["active"] = False


# ---------------------------------------------------------------------------
#  Phase D #16 — Agent-Direct Supabase Realtime
# ---------------------------------------------------------------------------
# Replaces the 5s claim-poll with a WebSocket subscription to INSERT
# events on `sap_agent_jobs` for our org. On each event we kick the
# poller (which then runs a real `claim_sap_agent_job` RPC — the
# Realtime stream alone is not authoritative because two agents on the
# same org will see the same INSERT and only one should claim).
#
# Falls back transparently to polling-only mode when the optional
# `realtime` (or `supabase`) package isn't bundled in the build, or the
# WebSocket can't connect. The poller's 60s fallback ensures we never
# stall on missed events.

try:
    # `realtime` >= 2.x exposes AsyncRealtimeClient. It's a sub-dependency
    # of `supabase` >= 2.0; we depend on it directly because we don't need
    # the rest of supabase-py (Postgrest/Storage/Auth) — REST + JWT
    # already cover those code paths via plain `requests`.
    from realtime import AsyncRealtimeClient  # type: ignore
    _HAVE_REALTIME = True
except Exception:  # pragma: no cover - import-time fallback
    AsyncRealtimeClient = None  # type: ignore
    _HAVE_REALTIME = False


def _realtime_url_from_supabase_url(supabase_url: str) -> str:
    """Convert https://<ref>.supabase.co → wss://<ref>.supabase.co/realtime/v1."""
    base = supabase_url.rstrip("/")
    if base.startswith("https://"):
        wss = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        wss = "ws://" + base[len("http://"):]
    else:
        wss = base
    return f"{wss}/realtime/v1"


# ---------------------------------------------------------------------------
#  v1.9.0 (Phase 4) — rust-work-service WS client integration
# ---------------------------------------------------------------------------
# State for the new WS client lives on `_work_ws_state` (mirrors
# `_realtime_state` for the legacy path). The actual asyncio loop +
# reconnect ladder lives in `omni_agent/work_service_ws.py`; this
# module just hosts the `state.org_id` / `state.supabase_token` glue
# and the event dispatcher that translates `WsEvent` JSON into the
# same wake-up calls the legacy Supabase Realtime callbacks made.
#
# Parallel-run instrumentation: every event delivered through this
# path increments `_work_ws_event_counts[event_type]` so the operator
# can compare event rates against the legacy
# `_legacy_realtime_event_counts` accumulator (incremented by
# `_on_jobs_insert` / `_on_rf_putaway_change`). After ~3 days both
# accumulators should match within ±5% per type — that's the green
# light for flipping the default to `1`.
_work_ws_state: dict[str, Any] = {
    "client": None,           # WorkServiceWsClient instance
    "started": False,         # singleton guard
    "fallback_reason": None,  # surfaced via /realtime/status
}

# Per-type event counters for the parallel-run window. Same keys are
# bumped from `_legacy_realtime_event_counts` when the legacy path
# delivers a SAP-jobs INSERT or rf_putaway change so the two are
# directly comparable. Both maps are read-mostly diagnostic surfaces;
# no thread safety beyond the GIL is required.
_work_ws_event_counts: dict[str, int] = {
    "SapJobStatusChanged": 0,
    "RfPutawayChanged": 0,
    "Other": 0,
}
_legacy_realtime_event_counts: dict[str, int] = {
    "SapJobStatusChanged": 0,
    "RfPutawayChanged": 0,
}


def _on_work_ws_event(event_dict: dict) -> None:
    """Dispatch a `WsEvent` JSON envelope from rust-work-service into
    the same wake-up paths the legacy Supabase Realtime callbacks used.

    Every handled event stamps `state.last_realtime_event_at` so the
    v1.7.8 backfill skip logic ("Realtime is healthy and recently
    active" → skip the 60s PostgREST scan) treats this path the same
    way it treated the legacy path. Per-type counts are bumped on
    `_work_ws_event_counts` for the parallel-run audit.
    """
    if not isinstance(event_dict, dict):
        return
    event_type = event_dict.get("type") or "Other"
    try:
        state.last_realtime_event_at = time.time()
    except Exception:
        pass

    if event_type == "SapJobStatusChanged":
        # Same wake-up the legacy `_on_jobs_insert` does. We only care
        # about INSERTs for the wake-up (the legacy path filtered the
        # same way), but bumping the poller on UPDATE is harmless —
        # the poller will just observe no new claimable rows and idle.
        _work_ws_event_counts["SapJobStatusChanged"] = (
            _work_ws_event_counts.get("SapJobStatusChanged", 0) + 1
        )
        try:
            row_id = event_dict.get("job_id") or "?"
            print(
                f"[work-ws] event delivered: type=SapJobStatusChanged "
                f"job_id={row_id} status={event_dict.get('status', '?')} "
                f"op={event_dict.get('op', '?')}"
            )
        except Exception:
            pass
        try:
            _kick_job_poller("rust-ws-sap-job")
        except Exception as e:
            print(f"[work-ws] kick_job_poller error: {e!r}")
        return

    if event_type == "RfPutawayChanged":
        # Same path as the legacy `_on_rf_putaway_change` →
        # `_on_hardcoded_table_change`. The dispatcher expects a
        # Supabase Realtime-shaped payload (`{"data": {"record": <new>}}`
        # OR `{"new": <new>}`); the rust-work-service event ships
        # `new` flat, so synthesize the envelope here.
        _work_ws_event_counts["RfPutawayChanged"] = (
            _work_ws_event_counts.get("RfPutawayChanged", 0) + 1
        )
        try:
            row_id = event_dict.get("row_id") or "?"
            op = event_dict.get("op") or "?"
            print(
                f"[work-ws] event delivered: type=RfPutawayChanged "
                f"row_id={row_id} op={op}"
            )
        except Exception:
            pass
        try:
            new_row = event_dict.get("new") or {}
            envelope = {"data": {"record": new_row}, "new": new_row}
            op = event_dict.get("op", "UPDATE") or "UPDATE"
            # Normalise op casing — the legacy callback distinguished
            # INSERT vs UPDATE only for the trigger event-set check.
            op_label = op.upper() if isinstance(op, str) else "UPDATE"
            _on_hardcoded_table_change(
                "rf_putaway_operations", op_label, envelope
            )
        except Exception as e:
            print(f"[work-ws] rf_putaway dispatch error: {e!r}")
        return

    # Anything else (Heartbeat, PresenceJoined, …) is ignored — the
    # agent doesn't care about those variants today. Bump the catch-
    # all bucket so the audit can still see total volume.
    _work_ws_event_counts["Other"] = _work_ws_event_counts.get("Other", 0) + 1


def _start_work_service_ws_client() -> None:
    """Spawn the rust-work-service WS client (Phase 4).

    Singleton — safe to call multiple times. Uses zero-arg
    `token_provider` / `org_provider` callables so the client picks up
    the current `state.supabase_token` / `state.org_id` on every
    reconnect, including after a `/supabase/login` or token refresh.
    """
    if _work_ws_state.get("started"):
        return
    if not state.supabase_token or not state.org_id:
        # Caller hasn't logged in yet. The startup hook calls us
        # defensively; the next `/supabase/login` will re-invoke
        # `_start_realtime_subscription()` which re-enters this branch.
        _work_ws_state["fallback_reason"] = "Supabase not logged in — work-ws idle"
        return

    try:
        from work_service_ws import WorkServiceWsClient  # type: ignore
    except Exception as e:
        _work_ws_state["fallback_reason"] = (
            f"work_service_ws import failed: {e!r}"
        )
        print(f"[work-ws] {_work_ws_state['fallback_reason']}")
        raise

    # Phase 10 — prefer the agent JWT for the subscribe-token mint
    # (`POST /api/v1/work/ws-token`). The work service's middleware
    # routes `kind: "agent"` JWTs through local verification (Phase
    # 10) and any other shape through rust-core-service (legacy);
    # both paths land at the same handler so the WS subscribe-token
    # endpoint accepts either. We always prefer the agent JWT when
    # present so the legacy user-JWT path is exercised only by
    # agents that haven't been migrated to identity v2 yet.
    def _ws_token_provider() -> str:
        return state.work_service_jwt or state.supabase_token or ""

    client = WorkServiceWsClient(
        token_provider=_ws_token_provider,
        org_provider=lambda: state.work_service_jwt_org_id or state.org_id or "",
        on_event=_on_work_ws_event,
    )
    client.start()
    _work_ws_state["client"] = client
    _work_ws_state["started"] = True
    _work_ws_state["fallback_reason"] = client.fallback_reason()
    print(
        "[work-ws] client started (Phase 4 — rust-work-service /ws). "
        "Subscribed to WsEvent::SapJobStatusChanged + "
        "WsEvent::RfPutawayChanged for org "
        f"{state.org_id}."
    )


def _stop_work_service_ws_client() -> None:
    """Best-effort shutdown of the work-service WS client. Safe to
    call when the client was never started."""
    client = _work_ws_state.get("client")
    if client is not None:
        try:
            client.stop()
        except Exception:
            pass


def _start_realtime_subscription():
    """Spawn a background thread that runs an asyncio loop, connects to
    Supabase Realtime, and subscribes to two channels:

      1. INSERTs on `sap_agent_jobs` filtered to our organization —
         wakes the job poller sub-second on freshly-queued work.
      2. INSERTs + UPDATEs on `rf_putaway_operations` (v1.6.4) —
         drives the agent-side trigger evaluator below so the
         auto-confirm-TO trigger fires even when no SAP Testing tab
         is open in the browser. See `_HARDCODED_TRIGGERS` and
         `_on_rf_putaway_change`.

    Auto-reconnects with exponential backoff on WebSocket drops.

    v1.6.4 auth fix: `realtime>=2.x` uses the constructor `token` arg
    as the `?apikey=...` query param on the WebSocket URL, which
    Supabase Realtime validates against the project's anon key BEFORE
    accepting the upgrade. v1.6.3 (and earlier) was passing
    `state.supabase_token` (user JWT) here, which is NOT a valid
    apikey, so the handshake 401'd before `set_auth()` ever ran.
    The exponential-backoff loop in the boot log was the visible
    symptom of that. We now pass `state.supabase_key` (anon key) to
    the constructor and the user JWT via `set_auth()` per the
    documented Supabase Realtime protocol
    (https://supabase.com/docs/guides/realtime/protocol).

    v1.7.0 — the sticky `_realtime_started` flag now short-circuits
    any subsequent call after the first successful thread spawn so
    `/supabase/login`, `_on_startup`, and any future callsite can't
    accidentally create a second reconnect loop. The existing
    `_realtime_state["active"]` check stays as a belt-and-suspenders
    guard for the case where the thread has already been started in
    the same process.

    v1.7.1 — circuit-breaker fallback. Before doing any work we check
    `state.realtime_disabled`; if the breaker has tripped (20 errors
    in 60s — see `_realtime_loop_exception_handler` +
    `_RealtimeCircuitBreaker`) we skip the spawn entirely and let the
    polling-only fallback carry the load. The
    `_start_realtime_circuit_reset_loop` daemon flips the flag back
    to False every 5min and clears `_realtime_started` so a fresh
    spawn can succeed if the network has recovered.

    Inside the asyncio loop we now install
    `_realtime_loop_exception_handler` BEFORE constructing the
    `AsyncRealtimeClient` so the known `ValueError('Set of
    Tasks/Futures is empty')` (a `realtime>=2.x` `_reconnect()` bug
    triggered by Citrix VDA hibernate / corporate proxy idle close)
    is suppressed quietly instead of flooding stderr with multi-line
    `Task exception was never retrieved` tracebacks. We also raise
    the `realtime` and `websockets` library loggers to WARNING so
    their INFO/DEBUG chatter doesn't hit stderr either. See
    [[Debug/Fix-Realtime-Library-CrashLoop]] +
    [[Patterns/Async-Library-Circuit-Breaker]].
    """
    global _realtime_started
    # v1.9.0 (Phase 4 of rust-work-service integration plan) — when the
    # operator opts into the new path, replace the Supabase Realtime
    # asyncio subsystem with a single connection to
    # `rust-work-service /ws`. The new WS client subscribes to the
    # already-shipped `WsEvent::SapJobStatusChanged` (replacing
    # `_on_jobs_insert`) + `WsEvent::RfPutawayChanged` (replacing
    # `_on_rf_putaway_change`, migration 276 ships the trigger). The
    # legacy Supabase Realtime spawn is intentionally short-circuited
    # here so the two paths NEVER both connect at once — the Phase 4
    # parallel-run window compares event RATES across machines (one
    # cohort with the env var set, one without), not in-process. After
    # ~3 days the default flips to True and v1.10 deletes the entire
    # legacy spawn below this branch.
    #
    # `state.realtime_disabled` stays untouched — the v1.7.8 backfill
    # poller uses `state.last_realtime_event_at` as its health proxy,
    # and the new WS handler stamps that field on every event, so
    # backfill correctly recognises "Realtime is healthy".
    if _USE_RUST_WS:
        try:
            _start_work_service_ws_client()
        except Exception as e:
            print(f"[work-ws] start failed (will fall through to legacy path): {e!r}")
            # Defensive: a failure to start the new client should NOT
            # silently leave the agent without an event source. Fall
            # through to the legacy Supabase spawn so a buggy build
            # still ships work in production.
        else:
            return
    # v1.8.4 — `OMNIFRAME_DISABLE_REALTIME=1` escape hatch. Skip
    # Realtime entirely and stay in polling-only mode for the entire
    # process lifetime. Used when Realtime is reliably unstable on
    # the user's network/tenant (Supabase Presence GenServer
    # overload, dead JWT, broken DNS) and "stability over latency"
    # is the user's preference. Sets `state.realtime_disabled = True`
    # so the job poller picks up the tightened 5→15s idle ceiling.
    if _is_realtime_disabled_via_env():
        if not state.realtime_disabled:
            state.realtime_disabled = True
            _realtime_state["fallback_reason"] = (
                "OMNIFRAME_DISABLE_REALTIME=1 — Realtime intentionally "
                "off; polling-only mode (job poller 5-15s, backfill "
                "poller 60s)."
            )
            try:
                _kick_job_poller("realtime-disabled-via-env")
            except Exception:
                pass
        return
    if state.realtime_disabled:
        # v1.7.1 — circuit breaker tripped. Don't spawn a fresh
        # reconnect loop; the reset daemon will flip the flag back
        # once `next_retry_at` is reached (v1.8.4 exponential
        # cooldown, 30min → 6h). Polling-only mode is in effect (job
        # poller idle backoff is tightened to 5→15s by
        # `_resolve_idle_max()` so we don't lose throughput).
        return
    if _realtime_started:
        # Singleton — the library's internal auto-reconnect handles
        # network blips. Any further `start` call is a no-op so we
        # never spawn a second reconnect loop.
        return
    if _realtime_state.get("active"):
        _realtime_started = True
        return
    if not _HAVE_REALTIME:
        _realtime_state["fallback_reason"] = "realtime client library not available — polling only"
        print("[realtime] realtime client not available; falling back to polling. "
              "Install `realtime>=2.0` (or `supabase>=2.0`) and rebuild to enable.")
        return
    if not state.supabase_url or not state.supabase_key or not state.org_id:
        _realtime_state["fallback_reason"] = "Supabase not logged in — polling only"
        return

    # v1.7.1 — quiet the realtime + websockets library loggers so
    # their INFO/DEBUG output doesn't flood stderr alongside the
    # traceback bursts our exception handler suppresses. WARNING is
    # the floor — actual subscription failures still log. asyncio's
    # default exception handler also uses logging; raise it too so
    # an uncaught task escape (which our handler should catch first)
    # doesn't dump a multi-line traceback.
    try:
        logging.getLogger("realtime").setLevel(logging.WARNING)
        logging.getLogger("websockets").setLevel(logging.WARNING)
        logging.getLogger("asyncio").setLevel(logging.ERROR)
    except Exception:
        pass

    stop_event = threading.Event()

    def _on_jobs_insert(payload):
        """Realtime push callback for sap_agent_jobs INSERTs."""
        # v1.9.0 (Phase 4 parallel-run instrumentation) — bump the
        # legacy SAP-job counter so its rate can be compared against
        # `_work_ws_event_counts["SapJobStatusChanged"]` over the
        # 3-day parallel-run window. NB: the legacy callback only fires
        # on INSERT (single subscription); the WS path delivers INSERT
        # + UPDATE so the WS counter is expected to be HIGHER. The
        # parity check is on INSERT-shaped events specifically (look
        # for op="INSERT" in `[work-ws] event delivered:` log lines).
        try:
            _legacy_realtime_event_counts["SapJobStatusChanged"] = (
                _legacy_realtime_event_counts.get("SapJobStatusChanged", 0) + 1
            )
        except Exception:
            pass
        try:
            new_row = (payload or {}).get("data", {}).get("record") or (payload or {}).get("new") or {}
            assigned = new_row.get("assigned_agent_id")
            self_id = _agent_self_id()
            if assigned and assigned != self_id:
                # Pinned to a different agent — don't even bother kicking
                # ourselves; the RPC would skip it anyway.
                return
            _realtime_state["last_event_at"] = datetime.utcnow().isoformat() + "Z"
            _kick_job_poller("realtime-insert")
        except Exception as e:
            print(f"[realtime] jobs callback error: {e}")

    def _on_rf_putaway_insert(payload):
        _on_rf_putaway_change("INSERT", payload)

    def _on_rf_putaway_update(payload):
        _on_rf_putaway_change("UPDATE", payload)

    # v1.7.2 — shipment_queue INSERT callback. Routes through the same
    # `_on_hardcoded_table_change` dispatcher that rf_putaway uses, but
    # against the new `builtin-shipment-queue` trigger entry. Without
    # this the agent advertises `agent-side-triggers` (which silences
    # the browser-side runtime for ALL supabase-realtime trigger types)
    # but never enqueues `shipment_queue` rows server-side, so the
    # trigger silently drops in production. See
    # [[Debug/Fix-Audit-Closeout-v1.7.2]].
    def _on_shipment_queue_insert(payload):
        _on_hardcoded_table_change("shipment_queue", "INSERT", payload)

    # Work Engine follow-on: Picking. `work_tasks` was added to the
    # supabase_realtime publication by mig 257. INSERT handles the
    # rare case where a `pick` row is created already in
    # `status='completed'` (e.g. a supervisor bulk-complete); UPDATE
    # is the normal path (operator completes via the RF shell). Both
    # funnel through `_on_hardcoded_table_change` which filters by
    # table + trigger match, so cycle_count / zone_audit rows won't
    # leak into the pick-completed branch.
    def _on_work_tasks_insert(payload):
        _on_hardcoded_table_change("work_tasks", "INSERT", payload)

    def _on_work_tasks_update(payload):
        _on_hardcoded_table_change("work_tasks", "UPDATE", payload)

    async def _run_async():
        import asyncio  # local import keeps cold-start cheap when disabled

        # v1.7.1 — install a custom asyncio exception handler on THIS
        # loop BEFORE constructing the AsyncRealtimeClient. Without
        # this, the known `realtime>=2.x` `_reconnect()` bug
        # (`asyncio.wait([])` → `ValueError: Set of Tasks/Futures is
        # empty.`) escapes the listen task into asyncio's default
        # handler, which prints a multi-line `Task exception was
        # never retrieved` traceback to stderr per occurrence. At
        # high frequency (every WebSocket drop spawns a fresh task
        # that fails the same way) this drowns every other thread.
        #
        # Each suppressed exception increments the circuit breaker's
        # sliding-window error counter; when the threshold is crossed
        # we tear down the subsystem and fall back to polling-only
        # mode. The `_start_realtime_circuit_reset_loop` daemon
        # auto-recovers after 5min if the network has stabilized.
        loop = asyncio.get_running_loop()

        def _realtime_loop_exception_handler(_loop, context):
            exc = context.get("exception")
            # Resolve websockets exception class lazily — it's only
            # available when the realtime extra is installed (we
            # already gated on _HAVE_REALTIME above to even get here,
            # but be defensive if the wheel is missing the transitive
            # websockets dep at import time).
            try:
                from websockets.exceptions import (  # type: ignore
                    ConnectionClosedError,
                    ConnectionClosedOK,
                )
            except Exception:
                ConnectionClosedError = ()  # type: ignore
                ConnectionClosedOK = ()  # type: ignore

            suppressed = False
            if isinstance(exc, ValueError) and (
                "Set of Tasks/Futures is empty" in str(exc)
            ):
                suppressed = True
            elif isinstance(exc, (ConnectionClosedError, ConnectionClosedOK)):
                suppressed = True

            if suppressed:
                tripped = _realtime_circuit_breaker.record_error()
                if tripped:
                    _disable_realtime_subsystem(
                        f"library bug: {type(exc).__name__}: {str(exc)[:80]}"
                    )
                return

            # Catch-all: log once per exception class per minute so a
            # never-before-seen failure mode is visible without
            # carpet-bombing stderr if it repeats. Still increments
            # the circuit breaker (a high-volume new failure mode
            # should also disable the subsystem).
            if exc is not None:
                key = type(exc).__name__
                if _realtime_should_log(key):
                    print(
                        f"[realtime] async loop exception: {exc!r} "
                        "(suppressed; agent will fall back to polling "
                        "if persistent)"
                    )
                tripped = _realtime_circuit_breaker.record_error()
                if tripped:
                    _disable_realtime_subsystem(
                        f"unexpected: {type(exc).__name__}: {str(exc)[:80]}"
                    )

        loop.set_exception_handler(_realtime_loop_exception_handler)
        # Stash the loop on _realtime_state so future tooling could
        # introspect (e.g. a /status diagnostic) — not required for
        # correctness today.
        _realtime_state["loop"] = loop

        # v1.8.4 — slow additive reconnect backoff. v1.7.0 reset
        # backoff to 5s on each successful subscribe and DOUBLED on
        # close (5s → 10 → 20 → 40 → 60 cap). On a flaky/degraded
        # tenant that meant 12+ reconnects/minute compounding tenant
        # Realtime load. v1.8.4 starts at 15s, ADDS 5s per attempt
        # (15 → 20 → 25 → … → 60 cap), and ONLY resets to 15s after
        # a connection survives `_REALTIME_STABLE_CONNECTION_SEC`
        # (60s). So even if Realtime mostly works, we don't hammer
        # Supabase. See [[Debug/Fix-Realtime-Tenant-Overload]].
        backoff = _REALTIME_RECONNECT_INITIAL_DELAY_SEC
        min_backoff = _REALTIME_RECONNECT_INITIAL_DELAY_SEC
        max_backoff = _REALTIME_RECONNECT_MAX_DELAY_SEC
        while not stop_event.is_set():
            # v1.7.1 — bail mid-loop if the breaker tripped between
            # iterations. The reset loop will respawn us once the
            # exponential cooldown has elapsed (v1.8.4: 30min → 6h).
            if state.realtime_disabled:
                print(
                    "[realtime] subsystem disabled (circuit breaker "
                    "tripped); exiting reconnect loop. Auto-retry "
                    "scheduled per exponential cooldown — see "
                    "/realtime/status.next_retry_seconds."
                )
                break
            clean_return = False
            connect_started_at: Optional[float] = None
            try:
                rt_url = _realtime_url_from_supabase_url(state.supabase_url)
                # v1.6.4 — constructor `token` MUST be the anon key
                # (used as `?apikey=`); the user JWT goes through
                # set_auth() AFTER connect.
                # v1.8.0 — pass `hb_interval` to tighten the WebSocket
                # heartbeat from the library default (25s) to 10s so a
                # corporate-proxy idle timer (Citrix → Netskope/ZScaler
                # close idle TCP/TLS connections in the 10-30s range)
                # gets reset before it fires. Older releases of the
                # `realtime` library may not accept the kwarg — fall
                # back to the default-heartbeat constructor on
                # TypeError so we don't break older bundled wheels.
                try:
                    client = AsyncRealtimeClient(
                        rt_url,
                        token=state.supabase_key,
                        hb_interval=_REALTIME_HEARTBEAT_INTERVAL_SEC,
                    )
                except TypeError:
                    client = AsyncRealtimeClient(rt_url, token=state.supabase_key)
                await client.connect()
                # Authenticate the socket so RLS-protected payloads
                # are delivered to us (we're org-scoped via the user JWT).
                if state.supabase_token:
                    try:
                        await client.set_auth(state.supabase_token)
                    except Exception as _set_err:
                        print(f"[realtime] set_auth failed: {_set_err}")

                # v1.8.1 — each channel subscribes independently and logs
                # its own success / failure. Previously a single `subscribe()`
                # failure (or a subscription to a non-existent table) tore
                # the whole socket down silently ~0s after connect, making
                # the failure mode look like a corporate-proxy idle close
                # when it was actually a stale publication reference. Now a
                # future missing table will print
                # `[realtime] channel <name> subscribe error: <exc>` and
                # continue with the remaining channels instead of bringing
                # down the whole subsystem.
                subscribed_tables: list[str] = []

                async def _subscribe_channel(
                    channel_name: str,
                    table: str,
                    build: "callable[[Any], Any]",
                ) -> bool:
                    try:
                        ch = client.channel(channel_name)
                        ch = build(ch)
                        await ch.subscribe()
                        subscribed_tables.append(f"public.{table}")
                        return True
                    except Exception as sub_err:  # pragma: no cover
                        print(
                            f"[realtime] channel {channel_name} "
                            f"subscribe error: {type(sub_err).__name__}: "
                            f"{sub_err}. Continuing with remaining channels."
                        )
                        return False

                # Channel 1 — sap_agent_jobs INSERTs (wake the poller).
                def _build_ch_jobs(ch):
                    return ch.on_postgres_changes(
                        "INSERT",
                        schema="public",
                        table="sap_agent_jobs",
                        filter=f"organization_id=eq.{state.org_id}",
                        callback=_on_jobs_insert,
                    )

                await _subscribe_channel(
                    f"sap-agent-jobs-{state.org_id}", "sap_agent_jobs",
                    _build_ch_jobs,
                )

                # Channel 2 (v1.6.4) — rf_putaway_operations INSERT+UPDATE.
                # Filter is org-agnostic at the wire level (the table
                # doesn't carry organization_id); the trigger evaluator's
                # match function applies the actual rule (status==Completed
                # && !is_mca_workflow). RLS on the user JWT scopes us
                # to rows the user can see, which in practice means rows
                # in the user's org.
                def _build_ch_rf(ch):
                    ch = ch.on_postgres_changes(
                        "INSERT",
                        schema="public",
                        table="rf_putaway_operations",
                        callback=_on_rf_putaway_insert,
                    )
                    return ch.on_postgres_changes(
                        "UPDATE",
                        schema="public",
                        table="rf_putaway_operations",
                        callback=_on_rf_putaway_update,
                    )

                await _subscribe_channel(
                    f"rf-putaway-{state.org_id}", "rf_putaway_operations",
                    _build_ch_rf,
                )

                # v1.8.1 — `shipment_queue` is INTENTIONALLY NOT subscribed.
                # The table does not exist in the DB (verified via
                # `information_schema.tables` + `pg_publication_tables`
                # — neither returns it). The v1.7.2 commit that added
                # this subscription referenced a table that was planned
                # but never shipped. Subscribing to a missing-from-
                # publication table makes Supabase Realtime close the
                # WebSocket cleanly immediately after `subscribe()`
                # (the pattern the user reported in production: `listen()
                # returned cleanly — socket closed without exception
                # after 0.0s; reconnect in 5.0s`). The `_on_shipment_queue_insert`
                # callback and the `builtin-shipment-queue` hardcoded
                # trigger entry are kept for backward compatibility — if
                # the table is ever created, add it to the publication
                # and re-enable the subscription here. See
                # Debug/Fix-Realtime-CleanClose-Cycle.md.
                print(
                    "[realtime] skipping shipment_queue — table not present "
                    "in DB (see Debug/Fix-Realtime-CleanClose-Cycle.md)"
                )

                # Channel 3 — work_tasks INSERT+UPDATE. Drives the
                # `builtin-pick-completed` trigger (Work Engine
                # follow-on: Picking). Filter is org-scoped at the
                # publication level via RLS on the user JWT. The match
                # function re-checks `task_type='pick' AND
                # status='completed'` so cycle_count / zone_audit
                # rows on the same table never fall through to the
                # pick branch.
                def _build_ch_wt(ch):
                    ch = ch.on_postgres_changes(
                        "INSERT",
                        schema="public",
                        table="work_tasks",
                        filter=f"organization_id=eq.{state.org_id}",
                        callback=_on_work_tasks_insert,
                    )
                    return ch.on_postgres_changes(
                        "UPDATE",
                        schema="public",
                        table="work_tasks",
                        filter=f"organization_id=eq.{state.org_id}",
                        callback=_on_work_tasks_update,
                    )

                await _subscribe_channel(
                    f"work-tasks-{state.org_id}", "work_tasks",
                    _build_ch_wt,
                )

                _realtime_state["connected"] = True
                _realtime_state["connected_at"] = time.time()
                connect_started_at = _realtime_state["connected_at"]
                _realtime_state["reconnect_attempts"] = 0
                # v1.8.4 — DO NOT reset `backoff` here. The reset
                # was previously unconditional on subscribe success,
                # which on a flaky tenant meant 5s, 10, 20, 40, 60,
                # 5, 10, ... — an aggressive cycle. v1.8.4 only
                # resets `backoff` when a connection survives the
                # stable window (see the close path below). That
                # way the first close after a long-stable run still
                # gets a quick 15s retry, but a flapping tenant
                # never benefits from the reset.
                print(
                    f"[realtime] connected to {rt_url} "
                    f"(subscribed to {' + '.join(subscribed_tables) or '(no channels)'} "
                    f"for org {state.org_id})"
                )
                # Keep the socket alive. listen() blocks until the socket
                # closes, at which point we drop into the reconnect path.
                await client.listen()
                # v1.7.0 — if listen() returns WITHOUT raising, the
                # library decided to tear the connection down for its
                # own reasons (heartbeat miss, explicit close,
                # publication refresh). Log it loudly so a future
                # "why is realtime churning" investigation has a
                # breadcrumb, and fall through to the same backoff
                # path an exception would take. Without this branch
                # the user saw only "connected" lines and no
                # "disconnected" lines, making the churn look like
                # a subscription bug when it was really a reconnect.
                clean_return = True
                _realtime_state["connected"] = False
                _realtime_state["connected_at"] = None
                _realtime_state["reconnect_attempts"] = int(_realtime_state.get("reconnect_attempts", 0)) + 1
                # v1.8.0 — measure how long the connection actually
                # lived. If it died before any heartbeat could have
                # plausibly kept it alive, count it as a *spurious*
                # clean close (likely corporate proxy idle-close)
                # and feed the clean-close circuit breaker. Trips
                # after `_REALTIME_SPURIOUS_CLOSE_THRESHOLD` (5) in
                # `_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS` (60) →
                # `_disable_realtime_subsystem` falls back to
                # polling-only mode for 5min, exactly like the
                # exception breaker does.
                connect_age = (
                    time.time() - connect_started_at
                    if connect_started_at is not None
                    else 0.0
                )
                # v1.8.4 — reset backoff + consecutive_trips ONLY
                # if this connection actually stabilized. A run that
                # survived `_REALTIME_STABLE_CONNECTION_SEC` (60s)
                # is the signal that the network/tenant is healthy
                # right now; we can afford a quick 15s retry next
                # time. Anything shorter keeps the additive backoff
                # ladder so a flapping tenant can't cycle aggressively.
                if connect_age >= _REALTIME_STABLE_CONNECTION_SEC:
                    backoff = min_backoff
                    if int(_realtime_reset_state.get("consecutive_trips", 0)) > 0:
                        print(
                            "[realtime] Stable connection observed "
                            f"({connect_age:.0f}s ≥ "
                            f"{int(_REALTIME_STABLE_CONNECTION_SEC)}s) — "
                            "clearing consecutive_trips counter so "
                            "future cooldowns restart at the initial "
                            f"{int(_REALTIME_CIRCUIT_INITIAL_COOLDOWN_SEC // 60)}min."
                        )
                    _realtime_reset_state["consecutive_trips"] = 0
                print(
                    f"[realtime] listen() returned cleanly — socket closed "
                    f"without exception after {connect_age:.1f}s; "
                    f"reconnect in {backoff:.1f}s"
                )
                if connect_age < _REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC:
                    tripped = _realtime_clean_close_tracker.record(connect_age)
                    if tripped:
                        _disable_realtime_subsystem(
                            f"spurious clean closes "
                            f"({_REALTIME_SPURIOUS_CLOSE_THRESHOLD}+ in "
                            f"{int(_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS)}s, "
                            f"each <{int(_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC)}s "
                            f"alive — likely corporate proxy idle-closing "
                            f"WebSocket faster than heartbeat)"
                        )
                    else:
                        recent = _realtime_clean_close_tracker.maybe_escalate_log()
                        if recent is not None:
                            print(
                                f"[realtime] WARN — {recent} spurious clean closes "
                                f"in last {int(_REALTIME_ESCALATE_LOG_WINDOW_SEC)}s "
                                f"(connection lasted <"
                                f"{int(_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC)}s "
                                f"before close). Likely a corporate proxy "
                                f"(Citrix/Netskope/ZScaler) idle-closing the "
                                f"WebSocket faster than the heartbeat keep-alive. "
                                f"If this persists, the circuit breaker will trip "
                                f"after "
                                f"{_REALTIME_SPURIOUS_CLOSE_THRESHOLD} closes in "
                                f"{int(_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS)}s "
                                f"and fall back to polling-only mode."
                            )
            except Exception as e:
                _realtime_state["connected"] = False
                _realtime_state["connected_at"] = None
                _realtime_state["reconnect_attempts"] = int(_realtime_state.get("reconnect_attempts", 0)) + 1
                print(f"[realtime] disconnected ({e}); reconnect in {backoff:.1f}s")
                # v1.7.1 — the synchronous outer-loop except path also
                # feeds the breaker so a flapping connect (e.g. corp
                # proxy 401 storm) trips the same fallback mode as a
                # task-level crash.
                tripped = _realtime_circuit_breaker.record_error()
                if tripped:
                    _disable_realtime_subsystem(
                        f"connect-loop: {type(e).__name__}: {str(e)[:80]}"
                    )
            if stop_event.is_set():
                break
            try:
                await asyncio.sleep(backoff)
            except Exception:
                pass
            # v1.8.4 — additive backoff (was multiplicative). Each
            # reconnect attempt adds `_REALTIME_RECONNECT_DELAY_INCREMENT_SEC`
            # (5s) to the next delay, capped at `max_backoff` (60s).
            # 15 → 20 → 25 → 30 → 35 → 40 → 45 → 50 → 55 → 60. Slow
            # growth means even a flapping tenant doesn't oscillate
            # back to a 5s reconnect on a single successful subscribe;
            # only `_REALTIME_STABLE_CONNECTION_SEC` (60s) of stable
            # connection clears the ladder back to the 15s floor.
            backoff = min(
                max_backoff,
                max(
                    min_backoff,
                    backoff + _REALTIME_RECONNECT_DELAY_INCREMENT_SEC,
                ),
            )

    def _thread_main():
        import asyncio
        try:
            asyncio.run(_run_async())
        except Exception as e:
            print(f"[realtime] thread crashed: {e}")
        finally:
            _realtime_state["connected"] = False
            _realtime_state["connected_at"] = None
            _realtime_state["active"] = False
            _realtime_state["loop"] = None
            # v1.7.1 — when the breaker tore us down we want the reset
            # loop to be able to respawn after the cooldown. Clear the
            # singleton flag here ONLY if we exited because of the
            # breaker (state.realtime_disabled is True). Otherwise
            # keep the v1.7.0 sticky semantics (an unrelated thread
            # crash still requires an EXE restart so the user notices).
            if state.realtime_disabled:
                global _realtime_started
                _realtime_started = False

    t = threading.Thread(target=_thread_main, daemon=True, name="sap-realtime-jobs")
    _realtime_state["thread"] = t
    _realtime_state["stop_event"] = stop_event
    _realtime_state["active"] = True
    t.start()
    # v1.7.0 — arm the sticky singleton AFTER the thread is running.
    # If the start itself failed (e.g. a threading module error), we
    # haven't armed the flag so the next call can retry. Once armed,
    # subsequent calls are no-ops even if the thread later crashes —
    # the user must restart the agent to get a fresh subscription.
    _realtime_started = True


def _stop_realtime_subscription():
    ev = _realtime_state.get("stop_event")
    if ev is not None:
        ev.set()
    _realtime_state["active"] = False
    # v1.9.0 — also stop the rust-work-service WS client when present
    # so logout / shutdown tears down BOTH paths cleanly.
    try:
        _stop_work_service_ws_client()
    except Exception:
        pass


# ---------------------------------------------------------------------------
#  Trigger evaluator stubs (Phase 9 of `.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`).
# ---------------------------------------------------------------------------
# Pre-Phase-9, this section held ~840 LOC of agent-side trigger evaluation:
# `_HARDCODED_TRIGGERS`, `_recently_queued_rows` dedup cache,
# `_hardcoded_trigger_match` / `_hardcoded_trigger_payload` /
# `_hardcoded_trigger_post_patch`, `_enqueue_trigger_job`, plus the
# Realtime callback dispatcher `_on_hardcoded_table_change`,
# `_on_rf_putaway_change`, and the v1.6.9 `_start_trigger_backfill_poller`
# safety-net daemon.
#
# Phase 9 (2026-05-07) moves trigger evaluation SERVER-SIDE into
# `rust-work-service::triggers::evaluator`. The new evaluator subscribes
# to `<table>_changed` Postgres NOTIFY channels (rf_putaway_operation_changed,
# sap_agent_job_changed, work_tasks_changed [future migration], …),
# loads rules from `public.agent_triggers` (migration 281 — created by
# admins via the rewritten "Agent Triggers" CRUD UI), runs each row
# through the whitelisted DSL parser, and INSERTs `sap_agent_jobs` rows
# on every match — using the SAME `payload.__omni_trigger_meta.post_success_patch`
# envelope the legacy agent-side path used. So `_apply_trigger_post_patch`
# (below) is unchanged: it still pulls the patch out of the job's payload
# after a successful SAP dispatch, exactly as it did before.
#
# Net deletion: ~840 LOC removed from this file. Stubs preserved below
# only for the legacy Realtime-subscription callback wiring (channels 2
# and 3 in `_start_realtime_subscription` still reference these names);
# all stubs do today is bump `state.last_realtime_event_at` and kick the
# job poller. Once the legacy Supabase-Realtime path is fully retired
# (Phase 11 / agent v2.0.0), even these stubs go.
#
# See:
#   - Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md
#   - Implementations/Implement-Rust-Work-Service-Phase9.md


def _on_hardcoded_table_change(
    table: str, event_type: str, payload: Any
) -> None:
    """Phase 9 stub — preserves the function name for the legacy
    Realtime callbacks in `_start_realtime_subscription` (channels 2
    and 3) plus `_on_work_ws_event`'s rf_putaway dispatch path. The
    body no longer evaluates rules; the server-side evaluator
    (`rust-work-service::triggers::evaluator`) does that now and
    INSERTs `sap_agent_jobs` itself, so all the agent has to do is
    stamp the Realtime-recently-active timestamp and kick the poller
    so the new job is claimed quickly.
    """
    _ = (table, event_type, payload)
    try:
        state.last_realtime_event_at = time.time()
    except Exception:
        pass
    try:
        _kick_job_poller("realtime-row-change")
    except Exception:
        pass


def _on_rf_putaway_change(event_type: str, payload: Any) -> None:
    """Phase 9 stub — preserves the function name for the legacy
    `_on_rf_putaway_insert` / `_on_rf_putaway_update` Realtime callbacks
    plus the parallel-run `[work-ws] event delivered: type=RfPutawayChanged`
    instrumentation. The body delegates to `_on_hardcoded_table_change`
    which itself is now a stub; both exist purely so the call sites in
    `_start_realtime_subscription` and `_on_work_ws_event` don't need
    to change for Phase 9.
    """
    state.last_realtime_event_at = time.time()
    try:
        _legacy_realtime_event_counts["RfPutawayChanged"] = (
            _legacy_realtime_event_counts.get("RfPutawayChanged", 0) + 1
        )
    except Exception:
        pass
    _on_hardcoded_table_change("rf_putaway_operations", event_type, payload)


def _start_trigger_backfill_poller() -> None:
    """Phase 9 — no-op. The server-side evaluator subscribes directly
    to per-table NOTIFY channels (which are at-least-once within the
    listener's reconnect window) and loads its rule set from the
    database, so a separate agent-side backfill poller is no longer
    needed. The function is kept so the startup hook
    (`_on_startup` → `_start_trigger_backfill_poller()`) doesn't have
    to be touched for Phase 9.
    """
    return None


def _stop_trigger_backfill_poller() -> None:
    """Phase 9 — no-op (mirrors `_start_trigger_backfill_poller`)."""
    return None


# v1.6.6 — when migration 251 hasn't been applied yet (or PostgREST's
# schema cache is stale right after the migration), the
# `confirmed_by_label` / `confirmed_by_agent_id` columns 400 the patch
# with `"Could not find ... column"`. The self-healing wrapper drops
# the fields for 5min then auto-retries the full schema; a transient
# cache miss no longer permanently strips honest agent attribution for
# the rest of the process lifetime (was the v1.6.6 forever-disable bug).
_TRIGGER_DROP_AGENT_ATTRIBUTION = _SchemaFallbackFlag(
    "rf_putaway_operations.agent_attribution", cooldown_seconds=300
)


def _apply_trigger_post_patch(post_patch: dict, job_id: str) -> None:
    """PATCH the source row with the OVERLAY (attribution) fields ONLY,
    after the handler has successfully dispatched to SAP.

    v1.6.8 — agent-internal dual-patcher race fix. There are TWO patchers
    on agent-side TO confirms:

      1. `_update_putaway_status` (called from inside `confirm_transfer_order`)
         flips the LEGACY 3 fields first: `to_status='TO Confirmed'`,
         `confirmed_at`, `confirmed_by`.
      2. THIS function (called by the job poller AFTER the handler
         returns) used to PATCH the FULL body — same legacy 3 fields
         PLUS the v1.6.6 attribution columns. It carried a
         `skip_if = {to_status: 'TO Confirmed'}` filter encoded as
         `&to_status=neq.TO%20Confirmed` to dodge double-writes. But
         step 1 had already set `to_status='TO Confirmed'`, so the
         filter always matched 0 rows. PostgREST returned 200 OK with
         an empty body, the agent logged "applied", and the OVERLAY
         columns (`confirmed_source`, `confirmed_by_label`,
         `confirmed_by_agent_id`) silently stayed NULL. The UI then
         fell back to `user_profiles.full_name` for the "Confirmed By"
         column — looking exactly like the v1.6.6 attribution bug all
         over again, but rooted in agent-internal race rather than
         browser/agent contention.

    The fix is to OVERLAY-ONLY: this function now writes ONLY the new
    attribution columns, and drops the `skip_if` filter entirely. There
    is no double-write risk because we never touch `to_status` /
    `confirmed_at` / `confirmed_by` here. The legacy patcher owns those
    columns; we own attribution. See [[Patterns/Agent-Self-Attribution]]
    "Two-step overlay pattern" for the full rationale.

    `Prefer: return=representation` is set so we can read the
    `rows_affected` count from the response and log a WARN when the
    PATCH no-ops (catches future regressions immediately instead of
    burying them in a 200/empty pair).

    v1.6.6 — tolerant of `confirmed_by_label` / `confirmed_by_agent_id`
    not existing yet (migration 251 may land after the rebuild). On the
    first 400 mentioning either column, we strip them and retry.

    v1.6.7 — fallback is now self-healing: 5-minute cooldown then
    auto-retry the full schema, so a transient PostgREST schema cache
    miss right after migration 251 lands doesn't permanently disable
    agent attribution for the rest of the process lifetime.
    """
    if not state.supabase_url or not state.supabase_token:
        return
    table = post_patch.get("table")
    row_id = post_patch.get("row_id")

    # Work Engine follow-on: Picking. The `work_tasks` JSONB-merge
    # path is distinct from the rf_putaway_operations attribution
    # overlay below — we dispatch EARLY and return to avoid the
    # attribution-fields allowlist filter (which would strip
    # `payload` and leave `body` empty, silently dropping the patch).
    # `work_tasks.payload` is a JSONB column; PostgREST replaces it
    # wholesale on PATCH, so the caller already merged the new fields
    # INTO the row's current payload. The match-branch guard
    # (`payload.lt12_confirmed_at`) + the in-memory dedup cache make
    # the race window (operator reopening the task between agent
    # dispatch and this patch) narrow enough to accept — `work_tasks`
    # rows in `status='completed'` are frozen by every other caller.
    # See `docs/work-engine/follow-on-picking.md` for the rationale.
    if table == "work_tasks":
        raw_patch = post_patch.get("patch") or {}
        if not row_id or not raw_patch:
            return
        url = f"{state.supabase_url}/rest/v1/work_tasks?id=eq.{row_id}"
        try:
            resp = _supabase_request(
                "PATCH",
                url,
                json=raw_patch,
                headers={**_supabase_headers(), "Prefer": "return=representation"},
            )
            if resp.status_code >= 400:
                print(
                    f"[triggers] post-success PATCH work_tasks/{row_id} "
                    f"failed: HTTP {resp.status_code}: {resp.text[:200]}"
                )
                return
            try:
                patched = resp.json() if resp.text else []
                rows_affected = len(patched) if isinstance(patched, list) else 0
            except Exception:
                rows_affected = 0
            prefix = "[triggers] WARN" if rows_affected == 0 else "[triggers]"
            confirmed_at = None
            merged_payload = raw_patch.get("payload") or {}
            if isinstance(merged_payload, dict):
                confirmed_at = merged_payload.get("lt12_confirmed_at")
            print(
                f"{prefix} post-success PATCH work_tasks/{row_id} applied — "
                f"lt12_confirmed_at={confirmed_at} (rows_affected={rows_affected}) "
                f"(job {job_id})"
            )
        except Exception as e:
            print(f"[triggers] post-success PATCH work_tasks error: {e}")
        return

    body = {
        k: v for k, v in (post_patch.get("patch") or {}).items()
        if k in ("confirmed_source", "confirmed_by_label", "confirmed_by_agent_id")
    }
    if not table or not row_id or not body:
        return
    attempted_full_schema = not _TRIGGER_DROP_AGENT_ATTRIBUTION.active
    if not attempted_full_schema:
        body.pop("confirmed_by_label", None)
        body.pop("confirmed_by_agent_id", None)
    if not body:
        return
    # NO `skip_if` — the legacy `_update_putaway_status` already set
    # `to_status='TO Confirmed'`. Re-applying a `&to_status=neq.TO%20Confirmed`
    # filter here would always match 0 rows (the v1.6.7 race condition).
    url = f"{state.supabase_url}/rest/v1/{table}?id=eq.{row_id}"
    try:
        resp = _supabase_request(
            "PATCH",
            url,
            json=body,
            headers={**_supabase_headers(), "Prefer": "return=representation"},
        )
        fallback_used = False
        if (
            resp.status_code == 400
            and attempted_full_schema
            and (
                "confirmed_by_label" in (resp.text or "")
                or "confirmed_by_agent_id" in (resp.text or "")
            )
        ):
            _TRIGGER_DROP_AGENT_ATTRIBUTION.trip(
                f"PostgREST 400 on {table} patch: {resp.text[:120]}"
            )
            fallback_used = True
            body.pop("confirmed_by_label", None)
            body.pop("confirmed_by_agent_id", None)
            if not body:
                return
            resp = _supabase_request(
                "PATCH",
                url,
                json=body,
                headers={**_supabase_headers(), "Prefer": "return=representation"},
            )
        if resp.status_code >= 400:
            print(
                f"[triggers] post-success PATCH {table}/{row_id} failed: "
                f"HTTP {resp.status_code}: {resp.text[:200]}"
            )
            return
        if attempted_full_schema and not fallback_used:
            _TRIGGER_DROP_AGENT_ATTRIBUTION.clear()
        try:
            patched = resp.json() if resp.text else []
            rows_affected = len(patched) if isinstance(patched, list) else 0
        except Exception:
            rows_affected = 0
        source = body.get("confirmed_source", "?")
        label = body.get("confirmed_by_label", "<dropped>")
        agent_id_val = body.get("confirmed_by_agent_id", "<dropped>")
        prefix = "[triggers] WARN" if rows_affected == 0 else "[triggers]"
        print(
            f"{prefix} post-success PATCH {table}/{row_id} applied — "
            f"overlay fields: source={source}, label='{label}', "
            f"agent_id={agent_id_val} (rows_affected={rows_affected}) "
            f"(job {job_id})"
        )
    except Exception as e:
        print(f"[triggers] post-success PATCH error: {e}")


# ---------------------------------------------------------------------------
#  /agents — read-only proxy onto rust-work-service `/api/v1/sap-agents/fleet`
# ---------------------------------------------------------------------------
# Browsers can hit these token-exempt sidecar endpoints to render the
# fleet card without round-tripping every list call through Supabase
# REST. As of audit gap AGT-1 (2026-05-07) this surface is served
# through `_work_service_request`, NOT direct PostgREST: the rust-work-
# service `/api/v1/sap-agents/fleet` route already org-scopes,
# capability-decodes, and projects a slim `FleetAgent` shape suitable
# for the fleet card. Returning the work-service projection means:
#   1. One canonical query plan (sqlx-prepared, indexed) instead of
#      two (PostgREST + work-service) drifting over time.
#   2. The agent JWT (Phase 10) is valid here too — fleet reads work
#      even after the legacy user JWT path is retired.
#   3. `reap_stale_sap_agents` is no longer needed on the read path —
#      `last_seen_at` ordering at the work-service layer surfaces stale
#      agents naturally; the agent's own heartbeat keeps `status` fresh.
# See `Implementations/Implement-Rust-Work-Service-Phase11.md` and the
# audit closure note in `Sessions/2026-05-07.md`.

@app.get("/agents")
def list_agents() -> dict:
    """Return every sap_agents row visible to this org via the
    rust-work-service fleet endpoint. The work-service auth middleware
    accepts both the agent JWT (Phase 10) and the legacy user JWT, so
    this works regardless of which credential the agent is currently
    using."""
    if not (state.work_service_jwt or state.supabase_token):
        return {"ok": False, "error": "No auth token available", "agents": []}
    try:
        resp = _work_service_request(
            "GET",
            "/api/v1/sap-agents/fleet?status=all&include_capabilities=true",
        )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
                "agents": [],
            }
        rows = resp.json() or []
        return {
            "ok": True,
            "self_id": _agent_self_id(),
            "agents": rows,
            "realtime": {
                "connected": bool(_realtime_state.get("connected")),
                "fallback_reason": _realtime_state.get("fallback_reason"),
                "last_event_at": _realtime_state.get("last_event_at"),
                "reconnect_attempts": _realtime_state.get("reconnect_attempts", 0),
            },
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "agents": []}


@app.get("/agents/{agent_id}")
def get_agent(agent_id: str) -> dict:
    """Single-agent detail. The rust-work-service fleet endpoint
    returns ALL agents in the caller's org; we filter client-side by
    `agent_id` rather than adding a per-id route on the server, since
    the fleet payload is bounded (typically ≤20 rows per org) and the
    extra work-service round-trip per drill-down would dwarf the
    client-side filter cost.

    Returns 404-ish payload (`{ok: false, error: "agent not found"}`)
    when the row is missing — same contract as before the audit fix."""
    if not (state.work_service_jwt or state.supabase_token):
        return {"ok": False, "error": "No auth token available"}
    try:
        resp = _work_service_request(
            "GET",
            "/api/v1/sap-agents/fleet?status=all&include_capabilities=true",
        )
        if resp.status_code >= 400:
            return {
                "ok": False,
                "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
            }
        rows = resp.json() or []
        match = next((r for r in rows if r.get("id") == agent_id), None)
        if not match:
            return {"ok": False, "error": "agent not found"}
        return {"ok": True, "agent": match}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  SAP Auto-Connect on Boot (v1.6.6)
# ---------------------------------------------------------------------------
# Pre-1.6.6 the user had to manually click "SAP Connect" (or run any
# query that called /sap/connect under the hood) before
# `state.sap_connected` flipped True. On a fresh Citrix session where SAP
# Logon hadn't been launched yet, this meant the agent sat idle and the
# user had to remember to do it themselves.
#
# v1.6.6 spawns a background daemon thread that monitors
# `state.sap_connected` and tries to attach immediately on boot, then
# again every N seconds with exponential backoff (10 → 20 → 40 → 60s
# capped) until SAP GUI becomes reachable. Once attached, the loop sleeps
# longer ticks but stays alive — if a COM crash later flips
# `state.sap_connected = False` (see the LT22 import handler's defensive
# `state.sap_connected = False` after `pywintypes.com_error` since
# v1.6.3), this same loop notices on the next tick and resumes the
# backoff retry cycle without needing any explicit hook into the flip.
#
# Disable via env: `OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1` for users who
# want manual control (e.g. Bridge users running in parallel, or anyone
# debugging COM behavior who doesn't want the background thread firing
# `_init_com()` mid-test).
#
# The loop calls `sap_connect()` (the FastAPI handler) directly. That
# handler is a plain function decorated with `@app.post`; FastAPI doesn't
# enforce request context for direct calls, so it works fine from a
# worker thread. `_init_com()` calls `pythoncom.CoInitialize()` per-thread
# so there's no STA/MTA conflict with concurrent /sap/connect requests
# from the browser.

_sap_autoconnect_state: dict[str, Any] = {
    "active": False,
    "thread": None,
    "stop_event": None,
}

# Backoff schedule between failed attach attempts (seconds). Caps at 60s
# so we don't sleep forever after a long outage. The loop restarts the
# schedule from index 0 every time the flag flips back to False, so a
# transient COM crash quickly retries without waiting through the long
# tail of a previous backoff.
_SAP_AUTOCONNECT_BACKOFFS: tuple[int, ...] = (10, 20, 40, 60)
# How long to sleep between checks while already attached. Short enough
# that a flip-to-False is noticed quickly, long enough to keep CPU at
# zero. The loop is otherwise idle when sap_connected is True.
_SAP_AUTOCONNECT_HEALTHY_TICK: float = 5.0


def _start_sap_autoconnect_loop() -> None:
    """Spawn the SAP auto-connect daemon thread.

    Idempotent — called from the FastAPI startup hook and (defensively)
    on /supabase/login in case a future restart of the loop is desired.
    Honors OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 for manual-control users.
    """
    if os.environ.get("OMNIFRAME_DISABLE_SAP_AUTOCONNECT", "") == "1":
        print(
            "[sap-auto] DISABLED via OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 — "
            "use POST /sap/connect (or the SAP Connect button in the web app) "
            "to attach manually."
        )
        return
    if _sap_autoconnect_state.get("active"):
        return
    stop_event = threading.Event()

    def _loop() -> None:
        print(
            "[sap-auto] SAP auto-connect loop started (will keep retrying every "
            "10-60s until SAP GUI is reachable)."
        )
        backoff_idx = 0
        while not stop_event.is_set():
            if state.sap_connected:
                # Attached — reset backoff so the next disconnect retries
                # immediately at the short end of the schedule.
                backoff_idx = 0
                if stop_event.wait(_SAP_AUTOCONNECT_HEALTHY_TICK):
                    break
                continue
            # Not attached — try to attach. Calling the handler directly
            # is fine; it's a plain function. Wrap defensively so any
            # unexpected exception (e.g. COM uninitialized in a way the
            # handler didn't predict) doesn't kill the daemon thread.
            reason = "unknown"
            try:
                result = sap_connect()
                if isinstance(result, dict) and result.get("ok"):
                    print(
                        "[sap-auto] Attached to SAP session — "
                        "sap_connected=True"
                    )
                    backoff_idx = 0
                    # Idle wait before the next health tick.
                    if stop_event.wait(_SAP_AUTOCONNECT_HEALTHY_TICK):
                        break
                    continue
                if isinstance(result, dict):
                    reason = str(result.get("error") or "unknown")
            except Exception as e:
                reason = str(e)
            wait = _SAP_AUTOCONNECT_BACKOFFS[
                min(backoff_idx, len(_SAP_AUTOCONNECT_BACKOFFS) - 1)
            ]
            # Trim long SAP error strings so the boot log stays scannable.
            print(
                f"[sap-auto] SAP not yet available ({reason[:160]}); "
                f"retrying in {wait}s"
            )
            backoff_idx = min(
                backoff_idx + 1, len(_SAP_AUTOCONNECT_BACKOFFS) - 1
            )
            if stop_event.wait(wait):
                break
        print("[sap-auto] SAP auto-connect loop stopped.")

    t = threading.Thread(target=_loop, daemon=True, name="sap-auto-connect")
    _sap_autoconnect_state["thread"] = t
    _sap_autoconnect_state["stop_event"] = stop_event
    _sap_autoconnect_state["active"] = True
    t.start()


def _stop_sap_autoconnect_loop() -> None:
    ev = _sap_autoconnect_state.get("stop_event")
    if ev is not None:
        ev.set()
    _sap_autoconnect_state["active"] = False


@app.on_event("startup")
def _on_startup():
    # Auto-arm the poller — the loop itself gates on supabase_token + org_id,
    # so it's safe to start before the user logs in.
    _start_job_poller()
    # v1.7.0 — Stuck-job watchdog. Runs alongside the poller, shares
    # `state.active_job_id` for detection. Safe to start before login —
    # the loop just sees no active job and idles.
    _start_job_watchdog_thread()
    # Phase D #13 — fleet heartbeat. Gates internally on supabase_token.
    _start_heartbeat_thread()
    # Phase D #16 — Realtime subscription. No-ops if the user hasn't
    # logged in yet; rearmed by /supabase/login.
    _start_realtime_subscription()
    # v1.7.1 — Realtime circuit-breaker reset loop. Sleeps 5min
    # between checks; re-arms _start_realtime_subscription() if the
    # breaker is tripped. Safe to start before login — the loop just
    # observes that the breaker is untripped and idles.
    _start_realtime_circuit_reset_loop()
    # v1.6.6 — SAP auto-connect. First attempt happens AFTER the FastAPI
    # app is listening on 8765, so /health detection from the web app
    # works while SAP is still mid-attach. Honors
    # OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 for manual-control users.
    _start_sap_autoconnect_loop()
    # v1.6.9 — Trigger backfill poller. Catches Realtime events missed
    # during agent restarts, WebSocket reconnect blips, Citrix VDA
    # hibernation, etc. Same supabase_token gating as the job poller.
    _start_trigger_backfill_poller()
    # Phase 6 (rust-work-service integration plan, 2026-05-07) —
    # console relay. Wraps stdout/stderr with `_ConsoleRelayStream`
    # so every print() mirrors into `state.console_buffer`, then
    # spawns the daemon that drains the buffer in batches and POSTs
    # to `rust-work-service /api/v1/sap-console/lines`. No-op when
    # `OMNIFRAME_AGENT_CONSOLE_RELAY=0` (default). Same login gating
    # as the job poller — safe to start before login.
    _install_console_relay_streams()
    _start_console_relay_thread()
    # Phase 10 (rust-work-service integration plan, 2026-05-07) —
    # agent identity v2. Spawns the daemon that exchanges the
    # on-disk service key for a 15-min JWT and refreshes ~60s
    # before expiry. No-ops when no service key is configured
    # (legacy path stays active). Must run AFTER the FastAPI app
    # starts listening so the bootstrap banner (logged at module
    # load) doesn't get clipped by a slow-to-attach Citrix VDA
    # session redirecting stdout.
    _start_work_service_jwt_refresh_thread()
    # Phase D #12 — flag orphaned recordings from a prior crashed run.
    try:
        _scan_for_orphaned_recordings()
    except Exception as e:
        print(f"[recorder] orphan scan failed: {e}")


@app.on_event("shutdown")
def _on_shutdown():
    _stop_job_poller()
    _stop_job_watchdog_thread()
    _stop_heartbeat_thread()
    _stop_realtime_subscription()
    _stop_realtime_circuit_reset_loop()
    _stop_sap_autoconnect_loop()
    _stop_trigger_backfill_poller()
    # Phase 6 — drain & stop the console relay. The flush loop
    # respects the stop event between sleeps; in-flight POSTs are
    # naturally bounded by `_DEFAULT_HTTP_TIMEOUT_SEC`.
    _stop_console_relay_thread()
    # Phase 10 — stop the agent identity JWT refresh thread.
    _stop_work_service_jwt_refresh_thread()
    # Phase D #13 — best-effort offline marker so the dashboard reflects
    # the agent disappearing immediately instead of waiting for the 90s
    # reaper grace window.
    try:
        if state.supabase_token and state.org_id:
            _upsert_self_in_registry("offline")
    except Exception as e:
        print(f"[heartbeat] shutdown offline marker failed: {e}")
    # Phase D #12 — best-effort flush of an active recording on shutdown
    # so users don't lose unsaved events when they close the agent window.
    try:
        if _active_recording is not None and _active_recording.status == "recording":
            print("[recorder] auto-stopping active recording on shutdown")
            _stop_recording_session()
    except Exception as e:
        print(f"[recorder] shutdown stop failed: {e}")


# ---------------------------------------------------------------------------
#  SAP Automation - shared helpers
# ---------------------------------------------------------------------------
def _log_sap_txn(delivery_id: str, transaction_code: str, action: str, status: str, message: str):
    # Hot-fix 2026-05-07 (post-audit Workstream A item 3): the legacy URL
    # `/rest/v1/sap_transaction_logs` was dead — that table was retired
    # when migration 246 introduced `sap_audit_log` as the single
    # cross-transaction audit surface. The agent has been silently
    # 404-dropping every audit POST since the rename, which is why
    # `sap_audit_log` showed only 22 browser-side rows from `logSapAudit()`
    # while the agent fleet ran daily. Repoint the URL and reshape the body
    # to the `sap_audit_log` schema:
    #   - `delivery_id` is no longer a column → folded into `payload` jsonb
    #     so reversal/UI consumers can still recover it.
    #   - `executed_by` → `user_id` (uuid FK to user_profiles).
    #   - `agent_version` is now populated so audit rows from agents are
    #     trivially distinguishable from browser-side `logSapAudit()` rows.
    # The CHECK constraint on `status` only allows ('success','error',
    # 'warning'); all existing call sites already pass one of those.
    if not state.supabase_token or not state.org_id:
        return
    try:
        delivery_str = str(delivery_id) if delivery_id else ""
        payload = {"delivery_id": delivery_str} if delivery_str else {}
        _supabase_request(
            "POST",
            f"{state.supabase_url}/rest/v1/sap_audit_log",
            json={
                "transaction_code": transaction_code,
                "action": action,
                "status": status,
                "sap_message": message[:500],
                "user_id": state.user_id,
                "organization_id": state.org_id,
                "agent_version": AGENT_VERSION,
                "payload": payload,
            },
            headers={
                "apikey": state.supabase_key,
                "Authorization": f"Bearer {state.supabase_token}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
        )
    except Exception:
        pass


def _update_putaway_status(
    to_number: str,
    warehouse: str,
    row_id: Optional[str] = None,
):
    """PATCH the putaway log row to mark the TO as confirmed.

    Requires an authenticated Supabase session on the agent (call
    /supabase/login first). When the token is missing this function
    used to silently no-op, which made stuck rows mysterious in
    production. Now we log loudly.

    v1.8.3 — accepts an optional `row_id` so trigger-driven confirms
    can target the EXACT source row instead of inferring it from
    `to_number + warehouse + created_at >= today`. The legacy
    date-window path was UTC-naive: a TO created on May 5 22:00 UTC
    that the agent processed at May 6 00:21 UTC would be filtered out
    of the PATCH because `created_at >= 2026-05-06` rejected the
    May 5 row. PostgREST returned 200 OK with an empty array, the
    agent logged "patched 0 rows", and the frontend kept showing
    "Pending TO Confirm" forever. The overlay-patch in
    `_apply_trigger_post_patch` already used `id=eq.<row_id>` and was
    fine — but the legacy `to_status` / `confirmed_at` / `confirmed_by`
    fields stayed unset on every UTC-midnight crossing.

    When `row_id` is provided (the trigger / queue-driven path), we
    PATCH by `id=eq.<row_id>` — exact match, no date guessing, works
    across any time-zone boundary. When `row_id` is None (manual
    /sap/confirm-to calls without trigger metadata, kept for
    backward compat) we fall back to a 48-hour `created_at` window
    so a same-day retry still hits, but a UTC midnight crossing is
    no longer fatal.

    NOTE: This sets the LEGACY 3 fields only. Agent-side trigger flow
    overlays `confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`
    in `_apply_trigger_post_patch` (called after the handler returns).
    Don't try to set those here — the trigger meta isn't fully
    accessible from this function and we'd need to plumb the entire
    `__omni_trigger_meta` blob through every handler. The overlay
    pattern keeps the change surgical. See [[Patterns/Agent-Self-Attribution]].
    """
    if not state.supabase_token:
        print(f"[lt12]  WARN _update_putaway_status skipped: no Supabase "
              f"token. Call /supabase/login from the web UI so confirmed "
              f"rows can be patched. (TO {to_number} WH {warehouse})")
        return
    cutoff: Optional[str] = None
    if row_id:
        url = (
            f"{state.supabase_url}/rest/v1/rf_putaway_operations"
            f"?id=eq.{row_id}"
            f"&to_status=neq.TO%20Confirmed"
        )
    else:
        cutoff = (datetime.utcnow() - timedelta(hours=48)).strftime("%Y-%m-%d")
        url = (
            f"{state.supabase_url}/rest/v1/rf_putaway_operations"
            f"?to_number=eq.{to_number}"
            f"&warehouse=eq.{warehouse}"
            f"&to_status=neq.TO%20Confirmed"
            f"&created_at=gte.{cutoff}"
        )
    try:
        resp = _supabase_request(
            "PATCH",
            url,
            json={
                "to_status": "TO Confirmed",
                "confirmed_by": state.user_id,
                "confirmed_at": datetime.utcnow().isoformat() + "Z",
            },
            headers={
                "apikey": state.supabase_key,
                "Authorization": f"Bearer {state.supabase_token}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
        )
        try:
            patched = resp.json() if resp.text else []
            count = len(patched) if isinstance(patched, list) else 0
        except Exception:
            count = 0
        if resp.status_code >= 400:
            print(f"[lt12]  ERROR _update_putaway_status HTTP "
                  f"{resp.status_code}: {resp.text[:200]} "
                  f"(TO {to_number} WH {warehouse}, row_id={row_id})")
        elif count == 0:
            print(
                f"[lt12]  WARN _update_putaway_status PATCHED 0 rows for "
                f"TO {to_number} WH {warehouse} (row_id={row_id}, "
                f"cutoff={cutoff}). Possible UTC-midnight crossing OR "
                f"row already TO Confirmed OR RLS hid it from this "
                f"user. Check Putaway Log directly. See "
                f"[[Debug/Fix-Putaway-Status-UTC-Midnight]]."
            )
        else:
            print(f"[lt12]  OK _update_putaway_status patched {count} row(s) "
                  f"(TO {to_number} WH {warehouse}, row_id={row_id})")
    except Exception as e:
        print(f"[lt12]  ERROR _update_putaway_status exception: {e} "
              f"(TO {to_number} WH {warehouse}, row_id={row_id})")


# ---------------------------------------------------------------------------
#  LT12 Confirm TO
# ---------------------------------------------------------------------------
# Status-bar phrases that indicate SAP wants the TO confirmed in two
# separate steps (Material withdrawal + Material shipment). For these
# TOs the LT12 screen requires a second `Enter` (sendVKey 0) before
# the Save (btn[11]) commits both steps. See
# omni_bridge/sap_scripts/2steptesting.vbs for the recorded flow.
_TWO_STEP_KEYWORDS = (
    "must be confirmed separately",
    "must be confirmed in two steps",
    "consist of two",
    "withdrawal and material shipment",
    "withdrawal and material putaway",
)

_SUCCESS_KEYWORDS = ("confirmed", "saved", "updated", "posted")


def _classify_sbar(sess) -> tuple[str, str]:
    """Return (sbar_text, message_type). message_type is 'S'/'E'/'A'/'W'
    or '' if not exposed by this SAP version."""
    try:
        sbar_text = sess.findById("wnd[0]/sbar").Text or ""
    except Exception:
        sbar_text = ""
    try:
        msg_type = sess.findById("wnd[0]/sbar").MessageType or ""
    except Exception:
        msg_type = ""
    return sbar_text, msg_type


# ---------------------------------------------------------------------------
#  SAP Soft-Warning Catalog (Phase B5)
# ---------------------------------------------------------------------------
# Maps lowercase status-bar substrings to a dispatch policy. Driven by
# `_ack_save_warnings()` after every Save (btn[11]). Each policy declares:
#   action: 'enter'    → press Enter on wnd[0] to acknowledge + commit.
#           'option1'  → click the "Yes / OK" SPOP button on wnd[1] if present,
#                        else fall back to Enter on the active window.
#           'skip'     → take no action (treat as informational; outer code decides).
#   log:    one of 'info' | 'warning' | 'error'. Used for noise-level on the
#           agent's stdout.
#
# Add new entries as users hit new SAP advisories — this catalog is the
# single source of truth instead of multiple inline tuples.
SAP_SOFT_WARNINGS: dict[str, dict[str, str]] = {
    # MM02 clearing bin / LS02N change with residual quant
    "quant still exists":               {"action": "enter",   "log": "info"},
    "quant exists":                     {"action": "enter",   "log": "info"},
    "still exists":                     {"action": "enter",   "log": "info"},
    # MM02 save flowing through "last record / first record" advisories
    "last data record":                 {"action": "enter",   "log": "info"},
    "first data record":                {"action": "enter",   "log": "info"},
    # SAP address-format change advisory (LS01N / LS02N / customer master)
    "address has been simplified":      {"action": "enter",   "log": "info"},
    # MM02 / business-partner "data has been changed" confirmation
    "data has been changed":            {"action": "option1", "log": "info"},
    # MM02 consignment stock advisory
    "consignment information":          {"action": "enter",   "log": "info"},
    # LX/LT report empty-result hint — surface to outer code, do not press Enter.
    "no data records found":            {"action": "skip",    "log": "info"},
    # LT12 / MM02 stock-category warning
    "stock category":                   {"action": "enter",   "log": "info"},
    # Warehouse-frozen advisory on LS02N / LT12 — outer code may choose to abort.
    "warehouse activities not allowed": {"action": "skip",    "log": "warning"},
    # Master-data placeholders for industries (e.g. material descriptions)
    "values are accepted":              {"action": "enter",   "log": "info"},
}


def _ack_save_warnings(
    sess,
    *,
    extra_keywords: Iterable[str] = (),
    max_iters: int = 6,
    wait_secs: int = 8,
) -> tuple[str, str]:
    """After pressing Save, dispatch on the SAP soft-warning catalog to
    acknowledge advisories that don't actually block the commit.

    Returns the final (sbar_text, msg_type) — same shape as
    `_classify_sbar`. Stops when the message is a hard error/abend, a
    success, or no entry in the catalog matches.

    `extra_keywords` adds ad-hoc 'enter' rules for one-off endpoints that
    expect a specific advisory not yet in the global catalog.
    """
    extra_rules = {k.lower(): {"action": "enter", "log": "info"} for k in extra_keywords}
    catalog = {**SAP_SOFT_WARNINGS, **extra_rules}

    sbar, msg_type = _classify_sbar(sess)
    for _ in range(max_iters):
        if msg_type in ("E", "A", "S"):
            break
        sbar_lower = sbar.lower()
        match_key = None
        match_rule = None
        for key, rule in catalog.items():
            if key in sbar_lower:
                match_key = key
                match_rule = rule
                break
        if match_rule is None:
            break

        action = match_rule.get("action", "enter")
        log_level = match_rule.get("log", "info")
        prefix = "[soft-warning]" if log_level != "warning" else "[soft-warn]"
        print(f"{prefix} '{match_key}' → {action}: {sbar}")

        if action == "skip":
            break
        try:
            if action == "option1":
                # Try the Yes / OK button first; fall back to Enter.
                try:
                    sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                except Exception:
                    sess.findById("wnd[0]").sendVKey(0)
            else:  # 'enter'
                sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, wait_secs)
        except Exception as e:
            print(f"[soft-warning] dispatch failed: {e}")
            break

        sbar, msg_type = _classify_sbar(sess)
    return sbar, msg_type


# ---------------------------------------------------------------------------
#  Retry / Backoff Helper (Phase A2)
# ---------------------------------------------------------------------------
def _with_retries(
    fn: Callable[[], Any],
    *,
    max_attempts: int = 3,
    backoff: tuple[float, ...] = (0.5, 1.5, 3.0),
    exceptions: tuple[type, ...] = (Exception,),
    label: str = "step",
) -> Any:
    """Run `fn()` with retry + exponential-ish backoff.

    Use ONLY for navigation / read steps (open transaction, set field,
    sendVKey, lookup). Do NOT wrap the actual Save (btn[11]) — a retry
    after a partial commit could double-commit.
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except exceptions as e:
            last_exc = e
            if attempt >= max_attempts - 1:
                break
            delay = backoff[attempt] if attempt < len(backoff) else backoff[-1]
            print(f"[retry]  {label} attempt {attempt + 1}/{max_attempts} failed: {e}. "
                  f"Sleeping {delay}s before retry.")
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc


# ---------------------------------------------------------------------------
#  Agent Metrics (Phase B6)
# ---------------------------------------------------------------------------
_METRICS_LOCK = threading.Lock()
_metrics_state: dict[str, Any] = {
    "transactions": {},        # action -> {success, fail, warning, total_ms, count_with_ms}
    "current_action": None,
    "last_5_errors": [],       # newest first
}


def _track_metric(action: str):
    """Decorator that wraps a top-level mutation handler with timing +
    counters feeding `GET /metrics`. Inspects the returned dict's `ok`
    and `warning` keys to classify the outcome. Use as
    `@_track_metric('confirm_transfer_order')` above each endpoint."""
    def _outer(fn):
        from functools import wraps

        @wraps(fn)
        def _inner(*args, **kwargs):
            started = time.time()
            with _METRICS_LOCK:
                _metrics_state["current_action"] = {
                    "action": action,
                    "started_at": datetime.utcnow().isoformat() + "Z",
                }
            outcome = "fail"
            error_msg: Optional[str] = None
            try:
                result = fn(*args, **kwargs)
                if isinstance(result, dict):
                    if result.get("ok") is True:
                        outcome = "warning" if result.get("warning") else "success"
                    else:
                        outcome = "fail"
                        if result.get("error"):
                            error_msg = str(result["error"])
                return result
            except Exception as e:
                error_msg = str(e)
                outcome = "fail"
                raise
            finally:
                elapsed_ms = int((time.time() - started) * 1000)
                with _METRICS_LOCK:
                    buckets = _metrics_state["transactions"].setdefault(action, {
                        "success": 0, "fail": 0, "warning": 0,
                        "total_ms": 0, "count_with_ms": 0,
                    })
                    if outcome == "success":
                        buckets["success"] += 1
                    elif outcome == "warning":
                        buckets["warning"] += 1
                    else:
                        buckets["fail"] += 1
                    buckets["total_ms"] += elapsed_ms
                    buckets["count_with_ms"] += 1

                    if error_msg:
                        _metrics_state["last_5_errors"] = (
                            [{
                                "action": action,
                                "error": str(error_msg)[:300],
                                "at": datetime.utcnow().isoformat() + "Z",
                            }] + _metrics_state["last_5_errors"]
                        )[:5]
                    _metrics_state["current_action"] = None
        return _inner
    return _outer


@app.post("/sap/confirm-to")
@_track_metric("confirm_transfer_order")
def confirm_transfer_order(
    req: ConfirmTORequest,
    row_id: Optional[str] = None,
) -> dict:
    """Confirm a Transfer Order via LT12.

    Handles three flavours, decided based on the SAP status bar after
    the first Enter following TO/WH entry:

      1. Already-confirmed TO         → idempotent success (patch DB).
      2. Two-step (withdrawal+shipment)
         TO that requires an extra
         Enter before Save             → send second Enter, then Save.
      3. Normal single-step TO         → just Save.

    The recording in 2steptesting.vbs shows the only difference between
    a normal and a two-step TO is one extra `sendVKey 0`. Both end with
    the same btn[11].press() to commit.

    v1.8.3 — `row_id` is optional and only set by `_dispatch_job` when
    the job carries `__omni_trigger_meta.post_success_patch.row_id`
    (every agent-side trigger fire). It is forwarded to
    `_update_putaway_status(... row_id=row_id)` so the legacy 3-field
    PATCH targets the EXACT source row instead of inferring it from
    `to_number + warehouse + created_at >= today` (the UTC-midnight
    bug). Browser-side queued jobs and direct curls to /sap/confirm-to
    don't carry trigger meta — `row_id` stays None and the legacy
    48-hour-window fallback runs (covers retries within 2 days).
    See [[Debug/Fix-Putaway-Status-UTC-Midnight]].
    """
    if not req.to_number:
        return {"ok": False, "error": "No TO number provided"}
    if not req.warehouse:
        return {"ok": False, "error": "No warehouse provided"}
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}

    try:
        sess, _ = _get_sap_session()

        # Step 1 — open LT12 and enter the TO/WH on the initial screen.
        # Wrapped in _with_retries (Phase A2) — opening a tx + entering
        # the initial screen is the flakiest step on slow Citrix sessions
        # and is safe to retry (no commit yet). The actual Save below is
        # NOT wrapped to avoid double-commits.
        def _open_lt12():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT12"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_open_lt12, label="LT12 open")

        def _fill_initial():
            sess.findById("wnd[0]/usr/txtLTAK-TANUM").text = str(req.to_number)
            sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = str(req.warehouse)
            try:
                sess.findById("wnd[0]/usr/chkRL03T-OFPOS").setFocus()
            except Exception:
                pass
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_fill_initial, label="LT12 initial screen")

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()

        # Already confirmed → idempotent success.
        for already in ("already confirmed", "already been confirmed",
                        "completely confirmed"):
            if already in sbar_lower:
                _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                             "success",
                             f"WH:{req.warehouse} | already-confirmed | {sbar}")
                _update_putaway_status(req.to_number, req.warehouse, row_id=row_id)
                return {
                    "ok": True,
                    "message": sbar,
                    "already_confirmed": True,
                }

        # Hard errors → fail fast.
        for err in ("does not exist", "not found", "no authorization",
                    "does not belong", "is locked"):
            if err in sbar_lower:
                _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                             "error", f"WH:{req.warehouse} | {sbar}")
                return {"ok": False, "error": sbar}

        # Step 2 — if SAP is asking for a two-step confirmation, send an
        # extra Enter to acknowledge / advance past the warning before the
        # Save. This matches 2steptesting.vbs.
        two_step = any(k in sbar_lower for k in _TWO_STEP_KEYWORDS)
        if two_step:
            print(f"[lt12]  Two-step TO {req.to_number}: '{sbar}'. Sending extra Enter before Save.")
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)

            sbar2, msg_type2 = _classify_sbar(sess)
            sbar2_lower = sbar2.lower()

            # If the second Enter produced a fresh hard-error, stop.
            if msg_type2 in ("E", "A"):
                _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                             "error",
                             f"WH:{req.warehouse} | 2-step second-Enter failed | {sbar2}")
                return {"ok": False, "error": sbar2}
            for err in ("does not exist", "not found", "no authorization",
                        "does not belong", "is locked"):
                if err in sbar2_lower:
                    _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                                 "error", f"WH:{req.warehouse} | {sbar2}")
                    return {"ok": False, "error": sbar2}

        # Step 3 — Save (commits the confirmation, both steps if applicable).
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)

        # Dismiss any "save?" popup that might appear.
        try:
            sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
            _wait_for_session(sess, 10)
        except Exception:
            pass

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()

        # Hard error after save.
        if msg_type in ("E", "A"):
            _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                         "error", f"WH:{req.warehouse} | {sbar}")
            return {"ok": False, "error": sbar}

        # Success.
        if msg_type == "S" or any(w in sbar_lower for w in _SUCCESS_KEYWORDS):
            _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                         "success",
                         f"WH:{req.warehouse} | {'2-step | ' if two_step else ''}{sbar}")
            _update_putaway_status(req.to_number, req.warehouse, row_id=row_id)
            response = {"ok": True, "message": sbar}
            if two_step:
                response["two_step"] = True
            return response

        # Unrecognised response — return ok=False so the browser does NOT
        # falsely patch the row. Better to surface the issue than to
        # silently mark a non-confirmed TO as confirmed.
        _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                     "warning",
                     f"WH:{req.warehouse} | unrecognised: {sbar}")
        return {
            "ok": False,
            "error": sbar or "LT12 returned no confirmation message — TO state unknown",
            "warning": True,
        }
    except Exception as e:
        _log_sap_txn(req.to_number, "LT12", "confirm_transfer_order",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  LT01 Transfer Inventory (bin-to-bin TO creation)
# ---------------------------------------------------------------------------
@app.post("/sap/transfer-inventory")
@_track_metric("transfer_inventory")
def transfer_inventory(req: TransferInventoryRequest) -> dict:
    """Create a Transfer Order in LT01 to move stock between bins.

    Mirrors the recorded flow in omni_bridge/sap_scripts/LT01Steps.vbs:

      1. /nLT01 → Create Transfer Order: Initial Screen
      2. Fill: LGNUM, BWLVS (movement type), MATNR, ANFME (quantity),
         LGORT (storage location). Set focus on SOBKZ then Enter.
      3. Next screen: source bin (VLTYP, VLPLA) + destination
         (NLTYP, NLPLA). Quant numbers (VLQNR, NLQNR) left blank.
      4. Enter to validate. Enter again to commit. SAP responds with
         "Transfer Order <number> created" in the status bar.
    """
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}

    missing = [
        f for f, v in [
            ("warehouse",           req.warehouse),
            ("material",            req.material),
            ("quantity",            req.quantity),
            ("source_storage_type", req.source_storage_type),
            ("source_storage_bin",  req.source_storage_bin),
            ("dest_storage_type",   req.dest_storage_type),
            ("dest_storage_bin",    req.dest_storage_bin),
        ] if not v
    ]
    if missing:
        return {
            "ok": False,
            "error": f"Missing required fields: {', '.join(missing)}",
        }

    try:
        sess, _ = _get_sap_session()

        # Step 1: Open LT01 (Phase A2 retry — safe, no commit yet).
        def _open_lt01():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT01"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_open_lt01, label="LT01 open")

        # Step 2: Initial screen
        try:
            sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = req.warehouse
            sess.findById("wnd[0]/usr/ctxtLTAK-BWLVS").text = req.movement_type
            sess.findById("wnd[0]/usr/ctxtLTAP-MATNR").text = req.material
            sess.findById("wnd[0]/usr/txtRL03T-ANFME").text = req.quantity
        except Exception as e:
            return {"ok": False, "error": f"Could not fill LT01 initial screen: {e}"}

        # Plant (LTAP-WERKS) — required for most material setups.
        if req.plant:
            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-WERKS").text = req.plant
            except Exception:
                pass  # Field may not appear in some warehouse configs

        if req.storage_location:
            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-LGORT").text = req.storage_location
            except Exception:
                pass  # Some flows don't expose LGORT here

        # Batch (LTAP-CHARG) — only for batch-managed materials.
        if req.batch:
            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-CHARG").text = req.batch
            except Exception:
                pass

        # v2.0.1 (follow-up) — Print Destination (LDEST). Spool device /
        # printer queue id (e.g. "PG44") that overrides the SAP user's
        # default printer for the TO confirmation slip. Set on the
        # initial screen between LGORT/CHARG and the stock-attribute
        # fields, BEFORE the sendVKey(0) that advances to the bin
        # screen. Mirrors LT01PRint.vbs:26. Best-effort: not every
        # warehouse layout exposes LDEST on the initial screen, so a
        # missing control is silently skipped (same pattern as
        # LGORT/CHARG/BESTQ above).
        if req.print_destination:
            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-LDEST").text = req.print_destination
            except Exception:
                pass

        # v2.0.1 — Stock Category (BESTQ). Single character. Best-effort:
        # not every warehouse layout exposes BESTQ on the initial screen,
        # so a missing control is silently skipped (matches the WERKS /
        # LGORT pattern above). Mirrors LT01Stockstatus.vbs:18.
        if req.stock_category:
            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-BESTQ").text = req.stock_category
            except Exception:
                pass

        # v2.0.1 — Special Stock indicator (SOBKZ). When set, the LSONR
        # field below is the matching identifier (sales order, vendor,
        # project, customer). When SOBKZ is blank the LSONR control is
        # display-only on most variants, so we skip it even if a value
        # was sent (per LT01SpecStockx.vbs:20-21).
        if req.special_stock_indicator:
            try:
                sess.findById("wnd[0]/usr/ctxtLTAP-SOBKZ").text = req.special_stock_indicator
            except Exception:
                pass
            if req.special_stock_number:
                try:
                    sess.findById("wnd[0]/usr/txtRL03T-LSONR").text = req.special_stock_number
                except Exception:
                    pass

        try:
            sess.findById("wnd[0]/usr/ctxtLTAP-SOBKZ").setFocus()
        except Exception:
            pass

        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "LT01", "transfer_inventory",
                         "error",
                         f"WH:{req.warehouse} | Step1 | {sbar}")
            return {"ok": False, "error": sbar, "step": "initial_screen"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                _log_sap_txn(req.material, "LT01", "transfer_inventory",
                             "error", f"WH:{req.warehouse} | {sbar}")
                return {"ok": False, "error": sbar}

        # Step 3: Source + destination bins
        try:
            sess.findById("wnd[0]/usr/ctxtLTAP-VLTYP").text = req.source_storage_type
            sess.findById("wnd[0]/usr/ctxtLTAP-VLPLA").text = req.source_storage_bin
            sess.findById("wnd[0]/usr/ctxtLTAP-NLTYP").text = req.dest_storage_type
            sess.findById("wnd[0]/usr/ctxtLTAP-NLPLA").text = req.dest_storage_bin
        except Exception as e:
            return {"ok": False, "error": f"Could not fill LT01 bin screen: {e}"}

        # Validate
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "LT01", "transfer_inventory",
                         "error",
                         f"WH:{req.warehouse} | Step2 | {sbar}")
            return {"ok": False, "error": sbar, "step": "bin_screen"}

        # Commit
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 25)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()

        # Try to extract the new TO number from the success message
        # (e.g. "Transfer order 0007281234 created").
        import re as _re
        to_number = None
        m = _re.search(r"transfer order\s*0*(\d+)", sbar_lower)
        if m:
            to_number = m.group(1)

        if msg_type == "S" or any(
            w in sbar_lower for w in ("created", "saved", "posted", "transfer order")
        ):
            _log_sap_txn(req.material, "LT01", "transfer_inventory",
                         "success",
                         f"WH:{req.warehouse} | TO:{to_number} | {sbar}")
            return {
                "ok": True,
                "message": sbar,
                "to_number": to_number,
            }
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "LT01", "transfer_inventory",
                         "error", f"WH:{req.warehouse} | {sbar}")
            return {"ok": False, "error": sbar}

        # Unknown / warning — be conservative, do not claim success.
        _log_sap_txn(req.material, "LT01", "transfer_inventory",
                     "warning",
                     f"WH:{req.warehouse} | unrecognised: {sbar}")
        return {
            "ok": False,
            "error": sbar or "LT01 returned no confirmation message — TO state unknown",
            "warning": True,
        }

    except Exception as e:
        _log_sap_txn(req.material, "LT01", "transfer_inventory",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  LS02N Bin Blocks (Putaway / Stock-Removal flags on a storage bin)
# ---------------------------------------------------------------------------
@app.post("/sap/bin-blocks")
@_track_metric("set_bin_blocks")
def set_bin_blocks(req: BinBlocksRequest) -> dict:
    """Update putaway and stock-removal block flags on a storage bin via LS02N.

    Mirrors the recorded flow in omni_bridge/sap_scripts/ls02ntesting.vbs:

      1. /nLS02N → Change Storage Bin: Initial Screen
      2. Fill: LAGP-LGNUM (warehouse), LAGP-LGTYP (storage type),
         LAGP-LGPLA (storage bin). Enter to load the bin's detail screen.
      3. On the General (ALLG) tab, set:
         - LAGP-SKZUE = Putaway Block
         - LAGP-SKZUA = Stock Removal Block
      4. Save (btn[11]) and Exit (btn[12]).
    """
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}

    if not req.warehouse or not req.storage_type or not req.storage_bin:
        return {
            "ok": False,
            "error": "Missing warehouse, storage_type, or storage_bin",
        }

    try:
        sess, _ = _get_sap_session()

        # Step 1: Open LS02N (Phase A2 retry — safe, no commit yet).
        def _open_ls02n():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLS02N"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_open_ls02n, label="LS02N open")

        # Step 2: Look up the bin
        try:
            sess.findById("wnd[0]/usr/ctxtLAGP-LGNUM").text = req.warehouse
            sess.findById("wnd[0]/usr/ctxtLAGP-LGTYP").text = req.storage_type
            sess.findById("wnd[0]/usr/ctxtLAGP-LGPLA").text = req.storage_bin
        except Exception as e:
            return {"ok": False, "error": f"Could not fill LS02N initial screen: {e}"}

        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.storage_bin, "LS02N", "set_bin_blocks",
                         "error",
                         f"WH:{req.warehouse} | lookup | {sbar}")
            return {"ok": False, "error": sbar, "step": "lookup"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                _log_sap_txn(req.storage_bin, "LS02N", "set_bin_blocks",
                             "error", f"WH:{req.warehouse} | {sbar}")
                return {"ok": False, "error": sbar, "step": "lookup"}

        # Step 3: Toggle the block checkboxes on the General (ALLG) tab.
        # Element IDs are stable in standard SAP releases; if a customer
        # has customised the tab strip these can shift — fall back to a
        # walker-based search by control name suffix.
        chk_putaway_id = (
            "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
            "ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUE"
        )
        chk_removal_id = (
            "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
            "ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUA"
        )

        def _set_checkbox(primary_id: str, suffix: str, value: bool) -> None:
            try:
                sess.findById(primary_id).selected = value
                return
            except Exception:
                pass
            # Fallback: walk the tree to find the checkbox ending with `suffix`
            nodes: list = []
            try:
                _walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
            except Exception as e:
                raise Exception(
                    f"Could not locate checkbox '{suffix}': tree walk failed: {e}"
                )
            for node_id, node_type, node in nodes:
                if node_type == "GuiCheckBox" and node_id.endswith(suffix):
                    try:
                        node.selected = value
                        return
                    except Exception as e:
                        raise Exception(
                            f"Found '{node_id}' but could not set: {e}"
                        )
            raise Exception(
                f"Could not find checkbox ending with '{suffix}' on the LS02N "
                f"detail screen. The General tab layout may have shifted."
            )

        try:
            _set_checkbox(chk_putaway_id, "/chkLAGP-SKZUE", req.putaway_block)
        except Exception as e:
            return {"ok": False, "error": f"Putaway block: {e}", "step": "checkbox"}

        try:
            _set_checkbox(chk_removal_id, "/chkLAGP-SKZUA", req.stock_removal_block)
        except Exception as e:
            return {
                "ok": False,
                "error": f"Stock removal block: {e}",
                "step": "checkbox",
            }

        # Step 4: Save
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.storage_bin, "LS02N", "set_bin_blocks",
                         "error", f"WH:{req.warehouse} | save | {sbar}")
            return {"ok": False, "error": sbar, "step": "save"}

        # Best-effort exit so the next user query starts clean.
        try:
            sess.findById("wnd[0]/tbar[0]/btn[12]").press()
            _wait_for_session(sess, 5)
        except Exception:
            pass

        if msg_type == "S" or any(
            w in sbar_lower for w in ("changed", "saved", "updated", "modified")
        ):
            _log_sap_txn(
                req.storage_bin, "LS02N", "set_bin_blocks", "success",
                f"WH:{req.warehouse} | bin:{req.storage_type}/{req.storage_bin} | "
                f"PutBlk={req.putaway_block} StkRemBlk={req.stock_removal_block} | {sbar}",
            )
            return {
                "ok": True,
                "message": sbar,
                "putaway_block": req.putaway_block,
                "stock_removal_block": req.stock_removal_block,
            }

        # No clear success/error — be conservative.
        _log_sap_txn(req.storage_bin, "LS02N", "set_bin_blocks",
                     "warning", f"WH:{req.warehouse} | unrecognised: {sbar}")
        return {
            "ok": False,
            "error": sbar or "LS02N returned no confirmation message — bin state unknown",
            "warning": True,
        }

    except Exception as e:
        _log_sap_txn(req.storage_bin, "LS02N", "set_bin_blocks",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  MM02 Material Master — change storage bin (Warehouse Mgmt 2 view)
# ---------------------------------------------------------------------------
@app.post("/sap/material-master-bin")
@_track_metric("material_master_bin")
def material_master_bin(req: MaterialMasterBinRequest) -> dict:
    """Change a material's Warehouse Mgmt 2 storage-bin assignment.

    Mirrors the recorded flow in omni_bridge/sap_scripts/MM02Completed.vbs:

      1. /nMM02 → Change Material: Initial Screen
      2. Enter material number (RMMG1-MATNR), then press btn[6] on
         toolbar 1 to open the "Organizational Levels" popup.
      3. In the popup: fill plant (RMMG1-WERKS), warehouse
         (RMMG1-LGNUM), storage type (RMMG1-LGTYP), focus on the
         "Warehouse Mgmt" view checkbox (chkUSRM1-ASCHL), Enter to
         confirm.
      4. On the loaded material screen, the "Warehouse Mgmt 2" tab
         (tabpSP22) is auto-selected. Set MLGT-LGPLA to the new bin.
      5. Save (btn[11]).
    """
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}

    # Note: storage_bin is intentionally NOT required — passing an empty
    # string clears the bin assignment in the material master, which is a
    # legitimate operation.
    missing = [
        f for f, v in [
            ("material",     req.material),
            ("plant",        req.plant),
            ("warehouse",    req.warehouse),
            ("storage_type", req.storage_type),
        ] if not v
    ]
    if missing:
        return {
            "ok": False,
            "error": f"Missing required fields: {', '.join(missing)}",
        }
    clearing_bin = not req.storage_bin.strip()

    try:
        sess, _ = _get_sap_session()

        # Step 1: Open MM02 (Phase A2 retry — safe, no commit yet).
        def _open_mm02():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMM02"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_open_mm02, label="MM02 open")

        # Step 2: Initial screen — material number then "Org Levels" button.
        try:
            sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = req.material
        except Exception as e:
            return {"ok": False, "error": f"Could not set material RMMG1-MATNR: {e}"}

        # Some MM02 layouts put "Org Levels" on btn[6] of toolbar 1; if the
        # popup doesn't appear we'll fail at the wnd[1] lookup below.
        def _press_org_levels():
            try:
                sess.findById("wnd[0]/tbar[1]/btn[6]").press()
            except Exception:
                sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_press_org_levels, label="MM02 org-levels press")

        # Hard-error after picking the material (e.g. material doesn't exist).
        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "MM02", "material_master_bin",
                         "error", f"WH:{req.warehouse} | initial | {sbar}")
            return {"ok": False, "error": sbar, "step": "initial_screen"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                _log_sap_txn(req.material, "MM02", "material_master_bin",
                             "error", f"WH:{req.warehouse} | {sbar}")
                return {"ok": False, "error": sbar, "step": "initial_screen"}

        # Step 3: Organizational Levels popup (wnd[1])
        try:
            sess.findById("wnd[1]/usr/ctxtRMMG1-WERKS").text = req.plant
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGNUM").text = req.warehouse
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGTYP").text = req.storage_type
        except Exception as e:
            return {
                "ok": False,
                "error": f"Could not fill org-levels popup (plant/warehouse/storage_type): {e}",
                "step": "org_levels_popup",
            }
        # Focus the WM view checkbox if present (matches recording).
        try:
            sess.findById("wnd[1]/usr/chkUSRM1-ASCHL").setFocus()
        except Exception:
            pass
        # Confirm popup
        sess.findById("wnd[1]").sendVKey(0)
        _wait_for_session(sess, 20)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "MM02", "material_master_bin",
                         "error",
                         f"WH:{req.warehouse} | org-levels | {sbar}")
            return {"ok": False, "error": sbar, "step": "org_levels_popup"}

        # Step 4: Set the storage bin on the Warehouse Mgmt 2 tab.
        # Element ID is the long path from the recording; fall back to a
        # walker-based search if the user's variant has shifted it.
        bin_id = (
            "wnd[0]/usr/tabsTABSPR1/tabpSP22/ssubTABFRA1:SAPLMGMM:2000/"
            "subSUB3:SAPLMGD1:2734/ctxtMLGT-LGPLA"
        )
        bin_field = None
        try:
            bin_field = sess.findById(bin_id)
        except Exception:
            # Fallback: walk for any field whose ID ends with /ctxtMLGT-LGPLA
            nodes: list = []
            try:
                _walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
            except Exception:
                pass
            for nid, ntype, node in nodes:
                if ntype in ("GuiCTextField", "GuiTextField") and nid.endswith("/ctxtMLGT-LGPLA"):
                    bin_field = node
                    break
        if bin_field is None:
            return {
                "ok": False,
                "error": (
                    "Could not locate the storage-bin field (MLGT-LGPLA) on "
                    "the Warehouse Mgmt 2 tab. The material may not have "
                    "this view extended, or the tab strip differs in your "
                    "SAP variant. Re-record MM02 and confirm the field path."
                ),
                "step": "bin_field",
            }
        try:
            # An empty string clears the current bin assignment.
            bin_field.text = req.storage_bin
        except Exception as e:
            return {"ok": False, "error": f"Could not set storage bin: {e}", "step": "bin_field"}

        # Step 5: Save
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 30)

        # MM02 sometimes pops a "Last data record" or "Storage type already
        # exists" confirmation; click Yes / Enter to accept.
        for _ in range(3):
            try:
                # Yes button on most popups
                sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                _wait_for_session(sess, 5)
            except Exception:
                try:
                    sess.findById("wnd[1]").sendVKey(0)
                    _wait_for_session(sess, 5)
                except Exception:
                    break

        # Acknowledge advisory status-bar warnings (e.g. "Quant still exists
        # for storage bin X and material Y" when clearing a bin) by pressing
        # Enter. These are soft warnings, not blocking errors.
        sbar, msg_type = _ack_save_warnings(sess)
        sbar_lower = sbar.lower()

        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "MM02", "material_master_bin",
                         "error", f"WH:{req.warehouse} | save | {sbar}")
            return {"ok": False, "error": sbar, "step": "save"}

        if msg_type == "S" or any(
            w in sbar_lower for w in ("changed", "saved", "updated", "modified")
        ):
            bin_label = "(cleared)" if clearing_bin else req.storage_bin
            _log_sap_txn(
                req.material, "MM02", "material_master_bin", "success",
                f"WH:{req.warehouse} Plant:{req.plant} STyp:{req.storage_type} "
                f"Bin:{bin_label} | {sbar}",
            )
            return {
                "ok": True,
                "message": sbar or f"{req.material} → {bin_label}",
                "material": req.material,
                "storage_bin": req.storage_bin,
                "cleared": clearing_bin,
            }

        # Conservative fallback
        _log_sap_txn(req.material, "MM02", "material_master_bin",
                     "warning", f"WH:{req.warehouse} | unrecognised: {sbar}")
        return {
            "ok": False,
            "error": sbar or "MM02 returned no confirmation message — material state unknown",
            "warning": True,
        }

    except Exception as e:
        _log_sap_txn(req.material, "MM02", "material_master_bin",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  MM02 Material Master — change Storage Type defaults (Warehouse Mgmt 1)
# ---------------------------------------------------------------------------
@app.post("/sap/material-master-storage-types")
@_track_metric("material_master_storage_types")
def material_master_storage_types(
    req: MaterialMasterStorageTypesRequest,
) -> dict:
    """Update Storage Type for Stock Removal (LTKZA) and Storage Type for
    Stock Placement (LTKZE) on a material's Warehouse Mgmt 1 view.

    Mirrors omni_bridge/sap_scripts/MM02Completed2.vbs:

      1. /nMM02 → Change Material: Initial Screen
      2. Enter material number (RMMG1-MATNR).
      3. Press btn[6] on toolbar 1 → "Organizational Levels" popup.
      4. In the popup: plant (RMMG1-WERKS), warehouse (RMMG1-LGNUM),
         storage type (RMMG1-LGTYP — any storage type the material is
         extended in works as a popup filter); focus chkUSRM1-ASCHL,
         press Enter to confirm.
      5. Click the "Warehouse Mgmt 1" tab (tabsTABSPR1/tabpSP21).
      6. Set MLGN-LTKZA = removal_storage_type, MLGN-LTKZE =
         placement_storage_type. Empty string clears the field.
      7. Save (btn[11]).
    """
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}

    missing = [
        f for f, v in [
            ("material",         req.material),
            ("plant",            req.plant),
            ("warehouse",        req.warehouse),
            ("org_storage_type", req.org_storage_type),
        ] if not v
    ]
    if missing:
        return {
            "ok": False,
            "error": f"Missing required fields: {', '.join(missing)}",
        }

    clearing_removal = not req.removal_storage_type.strip()
    clearing_placement = not req.placement_storage_type.strip()
    if clearing_removal and clearing_placement:
        return {
            "ok": False,
            "error": "Provide at least one of removal_storage_type or "
                     "placement_storage_type. Submitting both blank would "
                     "clear both defaults — pass them explicitly if that's "
                     "intentional.",
        }

    try:
        sess, _ = _get_sap_session()

        # Step 1: Open MM02 (Phase A2 retry — safe, no commit yet).
        def _open_mm02_st():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMM02"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_open_mm02_st, label="MM02 (storage types) open")

        # Step 2: Initial screen — material number then "Org Levels" button.
        try:
            sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = req.material
        except Exception as e:
            return {"ok": False, "error": f"Could not set material RMMG1-MATNR: {e}"}

        def _press_org_levels_st():
            try:
                sess.findById("wnd[0]/tbar[1]/btn[6]").press()
            except Exception:
                sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_press_org_levels_st, label="MM02 (storage types) org-levels press")

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "MM02", "material_master_storage_types",
                         "error", f"WH:{req.warehouse} | initial | {sbar}")
            return {"ok": False, "error": sbar, "step": "initial_screen"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                _log_sap_txn(req.material, "MM02", "material_master_storage_types",
                             "error", f"WH:{req.warehouse} | {sbar}")
                return {"ok": False, "error": sbar, "step": "initial_screen"}

        # Step 3: Organizational Levels popup (wnd[1])
        try:
            sess.findById("wnd[1]/usr/ctxtRMMG1-WERKS").text = req.plant
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGNUM").text = req.warehouse
            sess.findById("wnd[1]/usr/ctxtRMMG1-LGTYP").text = req.org_storage_type
        except Exception as e:
            return {
                "ok": False,
                "error": f"Could not fill org-levels popup: {e}",
                "step": "org_levels_popup",
            }
        try:
            sess.findById("wnd[1]/usr/chkUSRM1-ASCHL").setFocus()
        except Exception:
            pass
        sess.findById("wnd[1]").sendVKey(0)
        _wait_for_session(sess, 20)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()
        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "MM02", "material_master_storage_types",
                         "error",
                         f"WH:{req.warehouse} | org-levels | {sbar}")
            return {"ok": False, "error": sbar, "step": "org_levels_popup"}

        # Step 4: Switch to "Warehouse Mgmt 1" tab.
        wm1_tab_id = "wnd[0]/usr/tabsTABSPR1/tabpSP21"
        try:
            sess.findById(wm1_tab_id).select()
            _wait_for_session(sess, 10)
        except Exception as e:
            return {
                "ok": False,
                "error": (
                    f"Could not switch to Warehouse Mgmt 1 tab: {e}. "
                    "The material may not have this view extended for the "
                    "given plant/warehouse/storage-type combination."
                ),
                "step": "wm1_tab",
            }

        # Step 5: Set storage-type defaults. Walker fallback if the long
        # subscreen path differs in a customer's variant.
        ltkza_id = (
            "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
            "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZA"
        )
        ltkze_id = (
            "wnd[0]/usr/tabsTABSPR1/tabpSP21/ssubTABFRA1:SAPLMGMM:2000/"
            "subSUB3:SAPLMGD1:2733/ctxtMLGN-LTKZE"
        )

        def _find_field(primary_id: str, suffix: str):
            try:
                return sess.findById(primary_id)
            except Exception:
                pass
            nodes: list = []
            try:
                _walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
            except Exception:
                return None
            for nid, ntype, node in nodes:
                if ntype in ("GuiCTextField", "GuiTextField") and nid.endswith(suffix):
                    return node
            return None

        ltkza_field = _find_field(ltkza_id, "/ctxtMLGN-LTKZA")
        ltkze_field = _find_field(ltkze_id, "/ctxtMLGN-LTKZE")
        if ltkza_field is None and ltkze_field is None:
            return {
                "ok": False,
                "error": (
                    "Could not locate either storage-type default field "
                    "(MLGN-LTKZA, MLGN-LTKZE) on the Warehouse Mgmt 1 tab. "
                    "Re-record MM02 and confirm the field paths."
                ),
                "step": "field_lookup",
            }

        try:
            if ltkza_field is not None:
                ltkza_field.text = req.removal_storage_type
            if ltkze_field is not None:
                ltkze_field.text = req.placement_storage_type
        except Exception as e:
            return {"ok": False, "error": f"Could not set storage-type defaults: {e}", "step": "fields"}

        # Step 6: Save
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 30)

        # Accept any "Last data record" / "Storage type already exists"
        # confirmation popups.
        for _ in range(3):
            try:
                sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
                _wait_for_session(sess, 5)
            except Exception:
                try:
                    sess.findById("wnd[1]").sendVKey(0)
                    _wait_for_session(sess, 5)
                except Exception:
                    break

        # Acknowledge advisory status-bar warnings (e.g. "Quant still exists")
        # by pressing Enter — these are soft, non-blocking.
        sbar, msg_type = _ack_save_warnings(sess)
        sbar_lower = sbar.lower()

        if msg_type in ("E", "A"):
            _log_sap_txn(req.material, "MM02", "material_master_storage_types",
                         "error", f"WH:{req.warehouse} | save | {sbar}")
            return {"ok": False, "error": sbar, "step": "save"}

        if msg_type == "S" or any(
            w in sbar_lower for w in ("changed", "saved", "updated", "modified")
        ):
            removal_label = "(cleared)" if clearing_removal else req.removal_storage_type
            placement_label = "(cleared)" if clearing_placement else req.placement_storage_type
            _log_sap_txn(
                req.material, "MM02", "material_master_storage_types", "success",
                f"WH:{req.warehouse} Plant:{req.plant} "
                f"Removal(LTKZA):{removal_label} Placement(LTKZE):{placement_label} | {sbar}",
            )
            return {
                "ok": True,
                "message": sbar or (
                    f"{req.material} → removal={removal_label} placement={placement_label}"
                ),
                "material": req.material,
                "removal_storage_type": req.removal_storage_type,
                "placement_storage_type": req.placement_storage_type,
            }

        _log_sap_txn(req.material, "MM02", "material_master_storage_types",
                     "warning", f"WH:{req.warehouse} | unrecognised: {sbar}")
        return {
            "ok": False,
            "error": sbar or "MM02 returned no confirmation message — material state unknown",
            "warning": True,
        }

    except Exception as e:
        _log_sap_txn(req.material, "MM02", "material_master_storage_types",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  LS01N Create Storage Bin
# ---------------------------------------------------------------------------

# Constants from the recorded flow (LS01N.vbs). User confirmed these
# never change for their warehouse setup.
_LS01N_STORAGE_SECTION = "001"           # LAGP-LGBER
_LS01N_TOTAL_CAPACITY = "9,999,999.000"  # LAGP-LGEWI
_LS01N_ALLOWED_CAPACITY = "9,999,999.000"  # LAGP-LKAPV


@app.post("/sap/create-storage-bin")
@_track_metric("create_storage_bin")
def create_storage_bin(req: CreateStorageBinRequest) -> dict:
    """Create a new storage bin via LS01N.

    Mirrors omni_bridge/sap_scripts/LS01N.vbs:

      1. /nLS01N → Create Storage Bin: Initial Screen.
      2. Fill warehouse (LAGP-LGNUM), storage type (LAGP-LGTYP), bin
         (LAGP-LGPLA). Press Enter to load the detail screen.
      3. On the General (ALLG) tab fill the three constant fields:
         LAGP-LGBER (storage section) = "001"
         LAGP-LGEWI (total capacity)  = "9,999,999.000"
         LAGP-LKAPV (allowed capacity) = "9,999,999.000"
      4. Save (btn[11]).
      5. Press Back twice (btn[3]) to exit cleanly so the next iteration
         starts from a known state.
    """
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}

    missing = [
        f for f, v in [
            ("warehouse",    req.warehouse),
            ("storage_type", req.storage_type),
            ("storage_bin",  req.storage_bin),
        ] if not v
    ]
    if missing:
        return {
            "ok": False,
            "error": f"Missing required fields: {', '.join(missing)}",
        }

    try:
        sess, _ = _get_sap_session()

        # Step 1: Open LS01N (Phase A2 retry — safe, no commit yet).
        def _open_ls01n():
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLS01N"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
        _with_retries(_open_ls01n, label="LS01N open")

        # Step 2: Initial screen
        try:
            sess.findById("wnd[0]/usr/ctxtLAGP-LGNUM").text = req.warehouse
            sess.findById("wnd[0]/usr/ctxtLAGP-LGTYP").text = req.storage_type
            sess.findById("wnd[0]/usr/ctxtLAGP-LGPLA").text = req.storage_bin
        except Exception as e:
            return {"ok": False, "error": f"Could not fill LS01N initial screen: {e}"}

        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)

        sbar, msg_type = _classify_sbar(sess)
        sbar_lower = sbar.lower()

        # If the bin already exists, LS01N stays on the initial screen
        # and shows "Storage bin already exists" or similar. Surface as
        # a soft error so a batch run can keep going.
        for already in (
            "already exists",
            "already created",
            "already defined",
        ):
            if already in sbar_lower:
                _log_sap_txn(req.storage_bin, "LS01N", "create_storage_bin",
                             "error",
                             f"WH:{req.warehouse} | already-exists | {sbar}")
                return {
                    "ok": False,
                    "error": sbar,
                    "step": "initial_screen",
                    "already_exists": True,
                }

        if msg_type in ("E", "A"):
            _log_sap_txn(req.storage_bin, "LS01N", "create_storage_bin",
                         "error",
                         f"WH:{req.warehouse} | initial | {sbar}")
            return {"ok": False, "error": sbar, "step": "initial_screen"}
        for err in ("does not exist", "not found", "no authorization", "is locked"):
            if err in sbar_lower:
                _log_sap_txn(req.storage_bin, "LS01N", "create_storage_bin",
                             "error", f"WH:{req.warehouse} | {sbar}")
                return {"ok": False, "error": sbar, "step": "initial_screen"}

        # Step 3: Detail screen — General tab. Element IDs are stable
        # in the recording; walker fallback lets us survive customer-
        # specific subscreen path shifts.
        section_id = (
            "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
            "ssubD0400_S:SAPML01S:4001/ctxtLAGP-LGBER"
        )
        total_cap_id = (
            "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
            "ssubD0400_S:SAPML01S:4001/txtLAGP-LGEWI"
        )
        allowed_cap_id = (
            "wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/"
            "ssubD0400_S:SAPML01S:4001/txtLAGP-LKAPV"
        )

        def _find_field(primary_id: str, suffix: str):
            try:
                return sess.findById(primary_id)
            except Exception:
                pass
            nodes: list = []
            try:
                _walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
            except Exception:
                return None
            for nid, ntype, node in nodes:
                if ntype in ("GuiCTextField", "GuiTextField") and nid.endswith(suffix):
                    return node
            return None

        section_field = _find_field(section_id, "/ctxtLAGP-LGBER")
        total_cap_field = _find_field(total_cap_id, "/txtLAGP-LGEWI")
        allowed_cap_field = _find_field(allowed_cap_id, "/txtLAGP-LKAPV")

        if section_field is None or total_cap_field is None or allowed_cap_field is None:
            return {
                "ok": False,
                "error": (
                    "Could not locate LS01N detail-screen fields "
                    "(LGBER / LGEWI / LKAPV) on the General tab. The "
                    "subscreen layout may differ in your SAP variant — "
                    "re-record LS01N to confirm."
                ),
                "step": "detail_screen",
            }

        try:
            section_field.text = _LS01N_STORAGE_SECTION
            total_cap_field.text = _LS01N_TOTAL_CAPACITY
            allowed_cap_field.text = _LS01N_ALLOWED_CAPACITY
        except Exception as e:
            return {
                "ok": False,
                "error": f"Could not set bin attributes: {e}",
                "step": "detail_screen",
            }

        # Step 4: Save
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)

        # Acknowledge any soft advisory warnings (rare on LS01N create
        # but kept consistent with the other mass-update endpoints).
        sbar, msg_type = _ack_save_warnings(sess)
        sbar_lower = sbar.lower()

        if msg_type in ("E", "A"):
            _log_sap_txn(req.storage_bin, "LS01N", "create_storage_bin",
                         "error", f"WH:{req.warehouse} | save | {sbar}")
            return {"ok": False, "error": sbar, "step": "save"}

        success = msg_type == "S" or any(
            w in sbar_lower for w in ("created", "saved", "added")
        )

        # Step 5: Best-effort exit (Back x2). Don't fail the operation if
        # SAP is already on the initial screen and Back doesn't apply.
        for _ in range(2):
            try:
                sess.findById("wnd[0]/tbar[0]/btn[3]").press()
                _wait_for_session(sess, 5)
            except Exception:
                break
        # Dismiss any "Data will be lost — exit anyway?" popup
        try:
            sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
        except Exception:
            pass

        if success:
            _log_sap_txn(
                req.storage_bin, "LS01N", "create_storage_bin", "success",
                f"WH:{req.warehouse} STyp:{req.storage_type} "
                f"Bin:{req.storage_bin} | {sbar}",
            )
            return {
                "ok": True,
                "message": sbar or f"Bin {req.storage_bin} created in {req.warehouse}/{req.storage_type}",
                "warehouse": req.warehouse,
                "storage_type": req.storage_type,
                "storage_bin": req.storage_bin,
            }

        _log_sap_txn(req.storage_bin, "LS01N", "create_storage_bin",
                     "warning", f"WH:{req.warehouse} | unrecognised: {sbar}")
        return {
            "ok": False,
            "error": sbar or "LS01N returned no confirmation message — bin state unknown",
            "warning": True,
        }

    except Exception as e:
        _log_sap_txn(req.storage_bin, "LS01N", "create_storage_bin",
                     "error", f"WH:{req.warehouse} | {e}")
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
#  Generic Query Framework
#  Reads data from SAP by transaction + layout. Extensible via handler
#  registry. Add new handlers to QUERY_HANDLERS dict below.
# ---------------------------------------------------------------------------

def _safe_get(obj, attr, default=None):
    """Safely read a COM attribute that may not exist."""
    try:
        return getattr(obj, attr, default)
    except Exception:
        return default


def _walk_gui_tree(node, out: list, depth: int = 0, max_depth: int = 12):
    """Recursively walk the SAP GUI control tree, collecting every node
    along with its Id/Type. Defensive against opaque COM objects."""
    try:
        node_id = str(_safe_get(node, "Id", "") or "")
        node_type = str(_safe_get(node, "Type", "") or "")
        if node_id:
            out.append((node_id, node_type, node))
    except Exception:
        pass
    if depth >= max_depth:
        return
    try:
        children = node.Children
        count = int(_safe_get(children, "Count", 0) or 0)
    except Exception:
        return
    for i in range(count):
        try:
            child = children.ElementAt(i)
        except Exception:
            try:
                child = children(i)
            except Exception:
                continue
        _walk_gui_tree(child, out, depth + 1, max_depth)


def _find_alv_grid_in_tree(sess):
    """Walk the entire window tree and return the first node that quacks
    like an ALV GridView (has .ColumnOrder). Returns (grid, id) or
    (None, None). Used as a fallback when candidate IDs don't match."""
    nodes: list = []
    try:
        _walk_gui_tree(sess.findById("wnd[0]"), nodes)
    except Exception:
        return None, None

    # Prioritise node types that are most often ALV grids
    priority_types = ("GuiGridView", "GuiShell")
    nodes.sort(key=lambda t: 0 if t[1] in priority_types else 1)

    for node_id, node_type, node in nodes:
        try:
            _ = node.ColumnOrder
            print(f"[query]  Auto-discovered ALV grid at '{node_id}' (type={node_type})")
            return node, node_id
        except Exception:
            continue
    return None, None


_LIST_CELL_RE = None


def _walk_list_page(sess) -> dict[int, list[tuple[int, str, str]]]:
    """Walk the user-area once and return {y: [(x, text, type), ...]}
    for whatever SAP list output is currently rendered on screen."""
    import re
    global _LIST_CELL_RE
    if _LIST_CELL_RE is None:
        _LIST_CELL_RE = re.compile(r"/(?:lbl|txt|ctxt)\[(\d+),(\d+)\]$")
    nodes: list = []
    try:
        _walk_gui_tree(sess.findById("wnd[0]/usr"), nodes)
    except Exception:
        try:
            _walk_gui_tree(sess.findById("wnd[0]"), nodes)
        except Exception:
            return {}
    rows_by_y: dict[int, list[tuple[int, str, str]]] = {}
    for node_id, node_type, node in nodes:
        m = _LIST_CELL_RE.search(node_id)
        if not m:
            continue
        x = int(m.group(1))
        y = int(m.group(2))
        try:
            text = str(_safe_get(node, "Text", "") or "").rstrip()
        except Exception:
            text = ""
        rows_by_y.setdefault(y, []).append((x, text, node_type))
    return rows_by_y


def _is_blank_or_separator(row_cells: list) -> bool:
    """True for SAP separator lines like '----' or blank rows."""
    texts = [t for _, t, _ in row_cells]
    if not any(texts):
        return True
    joined = "".join(texts).strip()
    if joined and set(joined) <= set("-_=. "):
        return True
    return False


# ── Bulk-export error taxonomy (v1.7.3) ──────────────────────────────
# Two distinct failure modes for the %pc → Unconverted → Save flow.
# Splitting them lets the caller make the right fallback decision:
#
#   _PcPreCommitError  — failure happened BEFORE we pressed Save in the
#                        Save-As dialog. Nothing was written to disk;
#                        SAP is still on the original list screen with
#                        the data fully addressable. Falling back to
#                        lbl[x,y] pagination is correct here.
#
#   _PcPostCommitError — failure happened AFTER we pressed Save. Either
#                        the file landed on disk and the parser choked,
#                        or the file never appeared (SAP variant routed
#                        it elsewhere). EITHER WAY, falling back to
#                        pagination would re-walk the same data slowly
#                        AND the GUI may already have advanced past the
#                        original list screen (SAP often lands on a
#                        different transaction view after a successful
#                        save). NOT fallback-safe.
#
# v1.7.2 and earlier raised plain `Exception` from anywhere in the
# function and the caller fell back to pagination on every failure —
# that was the symptom the LT10 user saw: %pc save dialog flashes,
# file lands, parser hits a quirk, pagination kicks in for 5+ minutes
# walking data we already had.
# ────────────────────────────────────────────────────────────────────
class _PcPreCommitError(Exception):
    """Raised from `_extract_via_pc_export` when the %pc dialog could
    not be set up or the Save button could not be pressed. The SAP
    GUI is still on the original list screen, so the caller may
    safely fall back to a lbl[x,y] pagination extractor."""


class _PcPostCommitError(Exception):
    """Raised from `_extract_via_pc_export` when the Save button was
    pressed but the file could not be read / parsed. The export
    has already burned the SAP roundtrip; the caller MUST NOT fall
    back to pagination because (a) the same data would be re-walked
    slowly and (b) the GUI may have advanced past the original list
    screen so pagination would scrape the wrong data."""


# ────────────────────────────────────────────────────────────────────
# v1.7.6 — Permissive bulk-export parser. The v1.7.5 LT10 user's
# Save-As dialog opened correctly (file landed on disk with the right
# uuid filename in %TEMP%) but the dash-separator parser raised
# `_PcPostCommitError("Could not find a dash-separator row...")`.
# Their SAP variant produces a list-export format the original v1.6.3
# parser doesn't recognize — could be tab-delimited, fixed-width
# without dashes, CSV, or HTML "Web HTML" depending on the SAP
# customizing on their box.
#
# Five parsers are tried in order; first one that returns
# (columns, rows) with >= 2 columns and >= 1 data row wins. If none
# match we save a copy of the file to `%TEMP%/omniframe_lastfailed_<ts>.txt`,
# print a `repr()` preview of the first 1000 chars + line/byte counts
# to the agent console, and raise `_PcPostCommitError` referencing
# the saved copy so the user can ship it for offline analysis.
#
# Format A (current): Dash-separator row between header and data.
# Format B: Tab-delimited (header + rows split on \t).
# Format C: Fixed-width without dashes (split on 2+ spaces).
# Format D: CSV (csv.reader with optional quoting).
# Format E: HTML (SAP "Web HTML" — <table>/<tr>/<td>).
#
# See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]]
# → "v1.7.6: multi-format parser" section.
# ────────────────────────────────────────────────────────────────────


_FOOTER_RE = re.compile(r"^\s*\d[\d,]*\s+record", re.IGNORECASE)


def _parse_attempt_a_dash_separator(text: str, lines: list[str]) -> Optional[dict]:
    """Format A — original SAP "Unconverted" list export with a dash
    row between header and data. Identical logic to the v1.6.3 parser."""
    dash_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and len(stripped) >= 8 and set(stripped) <= set("-|+ "):
            dash_idx = i
            break
    if dash_idx is None or dash_idx == 0:
        return None

    header_idx = dash_idx - 1
    while header_idx > 0 and not lines[header_idx].strip():
        header_idx -= 1
    header_line = lines[header_idx]
    dash_line = lines[dash_idx]

    boundaries: list[tuple[int, int]] = []
    in_run = False
    run_start = 0
    for j, ch in enumerate(dash_line):
        if ch == "-":
            if not in_run:
                in_run = True
                run_start = j
        else:
            if in_run:
                boundaries.append((run_start, j))
                in_run = False
    if in_run:
        boundaries.append((run_start, len(dash_line)))

    if not boundaries:
        return None

    columns = []
    for i, (s, e) in enumerate(boundaries):
        title = header_line[s:e].strip() or f"col_{i}"
        columns.append({"id": f"c{i}_{s}", "title": title})

    rows: list[dict[str, Any]] = []
    for raw in lines[dash_idx + 1:]:
        if not raw.strip():
            continue
        if set(raw.strip()) <= set("-|+ "):
            continue
        if _FOOTER_RE.match(raw):
            break
        row: dict[str, Any] = {"_rowIndex": len(rows)}
        for i, (s, e) in enumerate(boundaries):
            row[columns[i]["id"]] = raw[s:e].strip()
        if any(v for k, v in row.items() if k != "_rowIndex"):
            rows.append(row)

    if len(columns) < 2 or not rows:
        return None
    return {
        "columns": columns,
        "rows": rows,
        "meta": {"header_y": header_idx, "dash_y": dash_idx},
    }


def _score_header_candidate(
    non_empty: int, total_cells: int, subordinate_data_rows: int
) -> int:
    """Multi-factor header-candidate score (v1.8.2 scorer).

    Three factors blended into a single integer:
      * Base score = `non_empty * 10`. A real SAP column header carries
        every populated title; a banner row carries only a label + a
        value. So the count of non-blank tab-cells alone is usually
        enough to separate the two.
      * `subordinate_data_rows` bonus (capped at 20 × 5 = 100). The real
        header is followed by HUNDREDS of rows whose non-empty counts
        are ≤ its own AND whose total-cell counts are ≤ its own (SAP
        drops trailing empty cells from data rows, so data rows are
        almost always strictly shorter than the header). A banner row
        sees 0 subordinates because the subsequent lines (header + data)
        carry MORE non-empty cells than it does. A data row sees its
        peers as subordinates ONLY when its own non-empty count is high
        enough to dominate them — which by definition is what makes a
        line a header. The "subordinate" framing is the v1.8.2 fix for
        the v1.7.7 single-factor scorer: a similar-shape framing gave
        data rows a 100-point bonus too, letting them outrank the real
        header (the LT10 regression caught this in CI: data rows with
        9 non-empty + 230 sibling rows beat the header with 17
        non-empty + 0 siblings).
      * Banner penalty (`-50`). Flagged when the line has fewer than 5
        non-empty cells AND less than 30% of its cells are populated —
        the SAP banner pattern (one label + one value padded by tabs).
        Real headers fail at least one of those tests because their
        non-empty count is large (≥10 in practice).

    The penalty is intentionally larger than any banner could earn from
    `non_empty` alone (3 × 10 = 30), so a line that scores `score(real
    header) ≥ 50` reliably outranks any banner-shaped candidate even
    when `subordinate_data_rows = 0` for both. The bonus on top means a
    header followed by 100+ data rows always wins by an even larger
    margin — which is the LT10/LT22 happy path.
    """
    score = non_empty * 10
    score += min(subordinate_data_rows, 20) * 5
    if total_cells > 0:
        fill_ratio = non_empty / total_cells
        if fill_ratio < 0.3 and non_empty < 5:
            score -= 50
    return score


def _parse_attempt_b_tab_delimited(text: str, lines: list[str]) -> Optional[dict]:
    """Format B — tab-delimited with SMART header detection.

    SAP list exports often start with banner lines (e.g.
    "Whse number\\t\\t\\t\\t\\tWH5", "Stge type\\t\\t\\t\\t\\t999")
    BEFORE the actual column header row. The v1.7.6 implementation
    picked the first non-blank line as the header → on this user's
    LT10 export it returned 1 row × 6 columns from the warehouse
    banner instead of 232+ rows × 18-20 columns from the real grid.

    v1.7.7 strategy was:
      1. Score every non-blank tab-bearing line by its non-empty
         tab-cell count. Banner rows have <3 non-empty cells
         (e.g. ['Whse number', '', '', '', '', 'WH5'] → 2 non-empty).
      2. Pick the candidate with the highest non-empty count.
      3. Permissive data-row matching (drop trailing empties only).

    v1.8.2 hardening — the LT22 PDC export shipped a banner with EXACTLY
    3 non-empty cells ("Warehouse No.", "PDC", "Indianapolis PDC") that
    sneaks past the v1.7.7 `non_empty < 3` floor. While the real header
    on this file (19 non-empty) still wins by raw `non_empty`, a future
    SAP variant could easily ship a 4-5 non-empty banner that DOES
    outscore a real header on a sparse layout. v1.8.2 replaces the
    single-factor scorer with `_score_header_candidate(...)` (three
    factors: non_empty count, following-data-row similarity bonus,
    banner-shape penalty). The threshold drops from `non_empty < 3` to
    `non_empty < 2` since the banner penalty does the heavy lifting now.
    See `_score_header_candidate` for the formula.
    """
    candidates: list[tuple[int, str, list[str], int]] = []
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        if "\t" not in line:
            continue
        cells = line.split("\t")
        non_empty = sum(1 for c in cells if c.strip())
        candidates.append((i, line, cells, non_empty))

    if len(candidates) < 2:
        return None

    best_idx = -1
    best_score = -(10**9)
    for k, (_i, _line, cells, non_empty) in enumerate(candidates):
        if non_empty < 2:
            continue
        # Subordinate-rows bonus: count later candidates whose non-empty
        # count is ≤ this line's AND whose total-cell count is ≤ this
        # line's. Real headers dominate every data row (data rows have
        # ≤ non_empty AND ≤ total_cells because SAP drops trailing
        # empties); banners dominate ~nothing (the lines after a banner
        # are the header + data rows, all of which carry MORE non-empty
        # cells than the banner). A data row only wins this bonus when
        # ALL later candidates are strictly less populated than it,
        # which by definition is what makes the candidate a header.
        n_total = len(cells)
        subordinate = sum(
            1
            for nxt in candidates[k + 1:]
            if nxt[3] <= non_empty and len(nxt[2]) <= n_total
        )
        score = _score_header_candidate(non_empty, n_total, subordinate)
        if score > best_score:
            best_score = score
            best_idx = k

    if best_idx < 0:
        return None

    header_i, _header_line, header_cells, header_non_empty = candidates[best_idx]
    expected = len(header_cells)
    if expected < 2:
        return None

    columns = [
        {"id": f"c{i}", "title": (h.strip() or f"col_{i}")}
        for i, h in enumerate(header_cells)
    ]

    rows: list[dict[str, Any]] = []
    for k, (_i, line, cells, _non_empty) in enumerate(candidates):
        if k <= best_idx:
            continue
        if _FOOTER_RE.match(line):
            break
        if len(cells) > expected + 2:
            continue
        row: dict[str, Any] = {"_rowIndex": len(rows)}
        for j in range(expected):
            row[columns[j]["id"]] = cells[j].strip() if j < len(cells) else ""
        if any(v for kk, v in row.items() if kk != "_rowIndex"):
            rows.append(row)

    if not rows:
        return None
    return {
        "columns": columns,
        "rows": rows,
        "meta": {
            "header_y": header_i,
            "delimiter": "tab",
            "header_cols": expected,
            "header_non_empty": header_non_empty,
            "header_score": best_score,
        },
    }


def _parse_attempt_c_fixed_width(text: str, lines: list[str]) -> Optional[dict]:
    """Format C — fixed-width WITHOUT a dash separator. Split header
    and each data line on runs of 2+ spaces.

    v1.7.7 — same smart-header pass as Format B. Score every non-blank
    line by its whitespace-delimited token count; pick the candidate
    with the highest count among those with ≥3 tokens (banner lines
    like "Whse number  WH5" only have 2). Then collect data rows
    that share a similar token count (±2). Reasonably robust for
    SAP variants that strip the dash banner but keep the column
    alignment intact AND emit one or two banner rows above the grid.

    v1.8.2 — promoted to the same `_score_header_candidate` formula
    used by Format B (multi-factor: token count, following-similar
    bonus, banner penalty) so a sparse banner can't outrank a real
    header that happens to be on a line with leading whitespace.
    """
    candidates: list[tuple[int, str, list[str], int]] = []
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        tokens = [t for t in re.split(r"\s{2,}", line.strip()) if t]
        if len(tokens) < 2:
            continue
        candidates.append((i, line, tokens, len(tokens)))

    if len(candidates) < 2:
        return None

    best_idx = -1
    best_score = -(10**9)
    for k, (_i, _line, tokens, total) in enumerate(candidates):
        if total < 2:
            continue
        # Subordinate-rows bonus mirrors Format B: count later
        # candidates whose token count is ≤ this candidate's. In
        # Format C `non_empty == total_cells == total` (we already
        # stripped blanks), so the banner penalty in
        # `_score_header_candidate` is a no-op; only the base score
        # and the subordinate bonus matter here.
        subordinate = sum(
            1 for nxt in candidates[k + 1:] if nxt[3] <= total
        )
        score = _score_header_candidate(total, total, subordinate)
        if score > best_score:
            best_score = score
            best_idx = k

    if best_idx < 0:
        return None

    header_i, _header_line, header_tokens, expected = candidates[best_idx]
    if expected < 2:
        return None

    columns = [{"id": f"c{i}", "title": h} for i, h in enumerate(header_tokens)]

    rows: list[dict[str, Any]] = []
    for k, (_i, line, tokens, _total) in enumerate(candidates):
        if k <= best_idx:
            continue
        stripped = line.strip()
        if set(stripped) <= set("-|+ "):
            continue
        if _FOOTER_RE.match(line):
            break
        if abs(len(tokens) - expected) > 2:
            continue
        row: dict[str, Any] = {"_rowIndex": len(rows)}
        for j in range(expected):
            row[columns[j]["id"]] = tokens[j].strip() if j < len(tokens) else ""
        if any(v for kk, v in row.items() if kk != "_rowIndex"):
            rows.append(row)

    if not rows:
        return None
    return {
        "columns": columns,
        "rows": rows,
        "meta": {
            "header_y": header_i,
            "delimiter": "whitespace2+",
            "header_cols": expected,
        },
    }


def _parse_attempt_d_csv(text: str, lines: list[str]) -> Optional[dict]:
    """Format D — comma-delimited CSV with optional quoting. Try
    csv.reader on the full text; quietly bail if the first row has
    fewer than 2 fields or no commas."""
    non_blank = [l for l in lines if l.strip()]
    if len(non_blank) < 2:
        return None
    if "," not in non_blank[0]:
        return None

    try:
        reader = csv.reader(io.StringIO(text))
        all_rows = [r for r in reader if r and any(c.strip() for c in r)]
    except Exception:
        return None
    if len(all_rows) < 2:
        return None

    headers = [h.strip() for h in all_rows[0]]
    expected = len(headers)
    if expected < 2:
        return None

    columns = [
        {"id": f"c{i}", "title": h or f"col_{i}"}
        for i, h in enumerate(headers)
    ]

    rows: list[dict[str, Any]] = []
    for raw_cells in all_rows[1:]:
        joined = ",".join(raw_cells)
        if _FOOTER_RE.match(joined):
            break
        if abs(len(raw_cells) - expected) > 1:
            continue
        row: dict[str, Any] = {"_rowIndex": len(rows)}
        for i in range(expected):
            row[columns[i]["id"]] = (
                raw_cells[i].strip() if i < len(raw_cells) else ""
            )
        if any(v for k, v in row.items() if k != "_rowIndex"):
            rows.append(row)

    if not rows:
        return None
    return {"columns": columns, "rows": rows, "meta": {"delimiter": "csv"}}


_HTML_TR_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_HTML_CELL_RE = re.compile(r"<t[hd][^>]*>(.*?)</t[hd]>", re.IGNORECASE | re.DOTALL)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_HTML_ENTITIES = (
    ("&nbsp;", " "),
    ("&amp;", "&"),
    ("&lt;", "<"),
    ("&gt;", ">"),
    ("&quot;", '"'),
    ("&#39;", "'"),
    ("&apos;", "'"),
)


def _html_strip(cell: str) -> str:
    cleaned = _HTML_TAG_RE.sub("", cell)
    for ent, repl in _HTML_ENTITIES:
        cleaned = cleaned.replace(ent, repl)
    return cleaned.strip()


def _parse_attempt_e_html(text: str, lines: list[str]) -> Optional[dict]:
    """Format E — SAP "Web HTML" export. Detect by leading <!DOCTYPE
    or by `<html`/`<table>` appearing in the first ~5 KB. Pull rows
    out with a couple of regexes; we deliberately don't bring in
    BeautifulSoup so the PyInstaller bundle stays small."""
    head = text[:5000].lower()
    if not (
        text.lstrip().lower().startswith("<!doctype")
        or "<html" in head
        or "<table" in head
    ):
        return None

    rows_html = _HTML_TR_RE.findall(text)
    if len(rows_html) < 2:
        return None

    parsed: list[list[str]] = []
    for tr in rows_html:
        cells = _HTML_CELL_RE.findall(tr)
        if not cells:
            continue
        parsed.append([_html_strip(c) for c in cells])

    if len(parsed) < 2:
        return None

    headers = parsed[0]
    expected = len(headers)
    if expected < 2:
        return None

    columns = [
        {"id": f"c{i}", "title": h or f"col_{i}"}
        for i, h in enumerate(headers)
    ]

    rows: list[dict[str, Any]] = []
    for cells in parsed[1:]:
        joined = ",".join(cells)
        if _FOOTER_RE.match(joined):
            break
        if abs(len(cells) - expected) > 1:
            continue
        row: dict[str, Any] = {"_rowIndex": len(rows)}
        for i in range(expected):
            row[columns[i]["id"]] = cells[i] if i < len(cells) else ""
        if any(v for k, v in row.items() if k != "_rowIndex"):
            rows.append(row)

    if not rows:
        return None
    return {"columns": columns, "rows": rows, "meta": {"delimiter": "html"}}


# Ordered (label, parser) — first hit wins.
_PARSER_LADDER: list[tuple[str, Callable[[str, list[str]], Optional[dict]]]] = [
    ("A", _parse_attempt_a_dash_separator),
    ("B", _parse_attempt_b_tab_delimited),
    ("C", _parse_attempt_c_fixed_width),
    ("D", _parse_attempt_d_csv),
    ("E", _parse_attempt_e_html),
]


def _save_failed_export_debug_copy(text: str) -> Optional[str]:
    """Best-effort copy of a parse-failed %pc export to %TEMP% so the
    user can ship it for offline analysis. Returns the path on
    success, None otherwise — we never let a debug-write failure
    mask the original parse error."""
    try:
        ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
        debug_dir = os.getenv("TEMP", os.path.expanduser("~"))
        debug_path = os.path.join(debug_dir, f"omniframe_lastfailed_{ts}.txt")
        with open(debug_path, "w", encoding="utf-8", errors="replace") as f:
            f.write(text)
        return debug_path
    except Exception as exc:
        print(f"[query]  Could not save debug copy of failed %pc export: {exc}")
        return None


def _print_failed_export_diagnostics(
    text: str,
    debug_path: Optional[str],
    attempts: list[tuple[str, str]],
) -> None:
    """Dump a `repr()` preview of the first 1000 chars + size hints to
    the agent console so the user can paste the output back to us
    when they hit a new SAP variant. Encoding hint is heuristic —
    we read the file as cp1252 (SAP's Latin1 default) so all bytes
    are addressable; the hint just tells us if the content LOOKS
    binary / UTF-8 BOM / HTML / etc."""
    line_count = text.count("\n") + (0 if text.endswith("\n") else 1)
    byte_count = len(text.encode("utf-8", errors="replace"))
    encoding_hint = "cp1252-decoded"
    if text.startswith("\ufeff"):
        encoding_hint = "utf-8-bom"
    elif text.lstrip().lower().startswith("<!doctype"):
        encoding_hint = "html"
    elif "\x00" in text[:1000]:
        encoding_hint = "binary-or-utf16"

    print("[query]  PARSE FAILURE — first 1000 chars of the export file:")
    print("=" * 60)
    print(repr(text[:1000]))
    print("=" * 60)
    print(
        f"[query]  Diagnostics: {line_count} line(s), "
        f"{byte_count} byte(s), encoding-hint={encoding_hint}, "
        f"parser-attempts={attempts}"
    )
    if debug_path:
        print(f"[query]  Full file saved to {debug_path} for inspection.")
    else:
        print("[query]  Full file could NOT be saved — see preview above.")


def _extract_via_pc_export(sess) -> dict:
    """Bulk-export the current SAP list via the `%pc → Unconverted` path.

    Phase B4: dramatically faster than Ctrl+PgDn pagination for big
    reports (e.g. LT10 warehouse-wide). Flow:

      1. Type `%pc` in the OK code → "Save list in file" dialog opens.
      2. Pick "Unconverted" radio (option SAP_LIST_TXT) and confirm.
      3. SAP shows a Save-As popup; we set the path to a stable file in
         %TEMP% and press Save / Replace.
      4. Read the file back from disk (cp1252 — SAP Latin1 default),
         parse the fixed-width columns by detecting the dash row that
         SAP renders between header and data rows.

    Returns the same `{columns, rows, total, meta}` shape as
    `_extract_sap_list_output()` so handlers can use either path.

    v1.7.3 — two-phase error taxonomy. Anything before the Save button
    raises `_PcPreCommitError` (fallback-safe); anything after raises
    `_PcPostCommitError` (NOT fallback-safe). Callers in
    `_extract_alv_grid` + `lt22_import.py` use the distinction to
    avoid the v1.7.2 misbehaviour where ANY post-save parse error
    triggered a slow Ctrl+PgDn re-walk of the same data.
    """
    started = time.time()
    print(
        "[query]  Starting %pc bulk export — file will save to TEMP and be "
        "parsed in-place. No pagination needed."
    )

    out_path = os.path.join(
        os.getenv("TEMP", os.path.expanduser("~")),
        f"omniframe_{uuid.uuid4().hex}.txt",
    )
    try:
        if os.path.exists(out_path):
            os.remove(out_path)
    except Exception:
        pass

    # ── Phase A: pre-commit (open the export dialog, pick Unconverted,
    # fill the Save-As path/filename). Any failure here means SAP is
    # still on the original list screen and the caller may safely
    # fall back to pagination.
    #
    # v1.7.4 — Trigger fan-out. Two ways to open the "Save list in file"
    # dialog from a classic SAP list screen:
    #
    #   (A) MENU PATH:  List → Save → File...
    #       UI-tree id: `wnd[0]/mbar/menu[0]/menu[1]/menu[2]`
    #       Universal across SAP variants because it's the canonical
    #       menu entry every list-output report ships with. Matches the
    #       fresh LT10 recording at LT10ReRan.vbs:23.
    #
    #   (B) OK-CODE:    `%pc`
    #       Older SAP shortcut; on SOME variants either unregistered
    #       or routes to a different dialog. v1.7.3 used %pc as the
    #       sole trigger; on at least one production user's variant
    #       %pc silently dropped the dialog → `_PcPreCommitError` →
    #       fallback to Ctrl+PgDn pagination — exactly what bulk
    #       export was supposed to ELIMINATE.
    #
    # Try menu first (universal), fall back to %pc (works on most
    # other variants where the menu entry's index might shift).
    chose_unconverted = False
    triggered = False
    trigger_method: str | None = None
    menu_err_repr: str | None = None
    pc_err_repr: str | None = None
    try:
        # Step 1a: Menu-driven trigger (primary path; matches the
        # LT10ReRan.vbs recording on the user's SAP variant).
        try:
            sess.findById("wnd[0]/mbar/menu[0]/menu[1]/menu[2]").select()
            _wait_for_session(sess, 10)
            triggered = True
            trigger_method = "menu"
        except Exception as menu_err:
            menu_err_repr = repr(menu_err)
            print(
                f"[query]  Menu-driven export trigger (List → Save → File...) "
                f"failed: {menu_err_repr}; trying %pc OK-code fallback"
            )

        # Step 1b: %pc OK-code fallback. Still works on most SAP variants
        # — keep it so other reports that DO have %pc registered keep
        # working when the menu indices shift on a custom skin.
        if not triggered:
            try:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "%pc"
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 10)
                triggered = True
                trigger_method = "%pc"
            except Exception as pc_err:
                pc_err_repr = repr(pc_err)
                raise _PcPreCommitError(
                    f"Both export triggers failed — menu={menu_err_repr}, "
                    f"%pc={pc_err_repr}. Falling back to lbl[x,y] pagination."
                )

        print(f"[query]  Bulk export triggered via {trigger_method} (menu / %pc)")

        # Step 2: Choose "Unconverted" on the export-format dialog.
        # The radio buttons live on wnd[1]/usr; the well-known one for
        # unconverted is rbSPOPLI-SELFLAG[0,0] in older SAP, or
        # spop-varoption[0,0] in newer skin variants. Try a couple.
        for rb_id in (
            "wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[1,0]",
            "wnd[1]/usr/subSUBSCREEN_STEPLOOP:SAPLSPO5:0150/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[0,0]",
            "wnd[1]/usr/sub:SAPLSPO5:0150/radSPOPLI-SELFLAG[0,0]",
            "wnd[1]/usr/radSPOPLI-SELFLAG[0,0]",
        ):
            try:
                sess.findById(rb_id).select()
                chose_unconverted = True
                break
            except Exception:
                continue
        try:
            sess.findById("wnd[1]/tbar[0]/btn[0]").press()
        except Exception:
            try:
                sess.findById("wnd[1]").sendVKey(0)
            except Exception:
                pass
        _wait_for_session(sess, 10)

        # Step 3: Save-As popup. The recording at LT10ReRan.vbs:27
        # shows that on this user's variant only `DY_FILENAME` is
        # settable (path is auto-populated to %TEMP%). On most other
        # variants both `DY_PATH` and `DY_FILENAME` are present and
        # required. Try setting BOTH first (cross-variant compat); if
        # that fails, accept setting only `DY_FILENAME`. SAP picks up
        # whatever directory is pre-populated in the dialog when only
        # the filename is overwritten.
        file_dir = os.path.dirname(out_path) + os.sep
        file_name = os.path.basename(out_path)
        set_path_ok = False
        path_set_mode: str | None = None
        for path_id, file_id in (
            ("wnd[1]/usr/ctxtDY_PATH",     "wnd[1]/usr/ctxtDY_FILENAME"),
            ("wnd[1]/usr/txtDY_PATH",      "wnd[1]/usr/txtDY_FILENAME"),
        ):
            try:
                sess.findById(path_id).text = file_dir
                sess.findById(file_id).text = file_name
                set_path_ok = True
                path_set_mode = "path+filename"
                break
            except Exception:
                continue

        if not set_path_ok:
            # Fall back to filename-only (matches the LT10ReRan.vbs
            # recording: only `ctxtDY_FILENAME` is set, dialog accepts
            # the pre-populated path). out_path was reserved with a
            # unique uuid in TEMP up top; if SAP saves the file
            # somewhere else we'll widen the on-disk search after Save.
            for file_id in (
                "wnd[1]/usr/ctxtDY_FILENAME",
                "wnd[1]/usr/txtDY_FILENAME",
            ):
                try:
                    sess.findById(file_id).text = file_name
                    set_path_ok = True
                    path_set_mode = "filename-only"
                    break
                except Exception:
                    continue

        if not set_path_ok:
            raise _PcPreCommitError(
                "Could not locate the Save-As path/filename fields after "
                f"{trigger_method} trigger — this SAP variant may render a "
                "different export dialog. Falling back to lbl[x,y] pagination."
            )
        print(f"[query]  Save-As dialog populated via {path_set_mode}")
    except _PcPreCommitError:
        raise
    except Exception as exc:
        raise _PcPreCommitError(
            f"Export dialog setup failed (trigger={trigger_method}): {exc}"
        ) from exc

    # ── Phase B: post-commit (press Save → file lands on disk → parse).
    # From here on, any failure means we already burned the SAP
    # roundtrip and the GUI may have advanced past the source screen.
    # Falling back to pagination would re-walk the same data slowly
    # AND scrape from the wrong screen. We raise `_PcPostCommitError`
    # so the caller can surface a clean error instead of triggering
    # a useless re-extraction.

    # Dismiss the Save-As dialog. v1.7.4 — try Enter (sendVKey 0) first
    # since the LT10ReRan.vbs recording shows the user's SAP variant
    # commits the save with Enter rather than the legacy `btn[11]`
    # ("Generate") button. On most other variants `btn[11]` is also
    # bound to the same action, so we keep it as a secondary attempt
    # for cross-variant compat. `sendVKey(11)` is the last-ditch
    # fallback for skins that bind Save to F11. Print which method
    # actually worked so future variant differences are diagnosable
    # in seconds. If a "file already exists, replace?" popup follows,
    # press Yes (Option1) just below.
    save_method: str | None = None
    for method_name, method_fn in (
        ("Enter",        lambda: sess.findById("wnd[1]").sendVKey(0)),
        ("btn[11]",      lambda: sess.findById("wnd[1]/tbar[0]/btn[11]").press()),
        ("sendVKey 11",  lambda: sess.findById("wnd[1]").sendVKey(11)),
    ):
        try:
            method_fn()
            save_method = method_name
            break
        except Exception:
            continue
    if save_method is None:
        raise _PcPreCommitError(
            "Could not dismiss Save-As dialog with Enter / btn[11] / "
            "sendVKey(11) — Save dialog state is unknown but no file "
            "was committed. Falling back to lbl[x,y] pagination."
        )
    print(f"[query]  Save dialog dismissed via {save_method} (Enter / btn[11] / sendVKey 11)")
    _wait_for_session(sess, 15)

    try:
        sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
        _wait_for_session(sess, 5)
    except Exception:
        pass

    # Wait briefly for the file to materialise on disk.
    deadline = time.time() + 10
    while time.time() < deadline:
        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            break
        time.sleep(0.5)

    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        raise _PcPostCommitError(
            f"Save-As dialog closed (trigger={trigger_method}, "
            f"save={save_method}, unconverted_radio_selected={chose_unconverted}) "
            f"but no file at {out_path} — this SAP variant may route the file "
            f"elsewhere. NOT falling back to pagination because we already "
            f"burned the export roundtrip and the GUI may have advanced past "
            f"the source screen."
        )

    # NOTE: After %pc → Save, SAP typically returns to the source list
    # screen (e.g. LT10 Stock Transfer: Overview, LT22 result list).
    # This is harmless — we already have the data from the file. Do
    # NOT call any further extraction here; doing so would page-walk
    # data we already hold in memory.

    try:
        with open(out_path, "r", encoding="cp1252", errors="replace") as f:
            text = f.read()
    except Exception as exc:
        # File read itself failed — nothing to diagnose, just surface.
        try:
            os.remove(out_path)
        except Exception:
            pass
        raise _PcPostCommitError(
            f"%pc save succeeded but file read failed at {out_path}: {exc}"
        ) from exc

    # v1.7.6 — Permissive multi-format parser. Try the original
    # dash-separated layout first; fall through to tab-delimited,
    # fixed-width-without-dashes, CSV, and HTML in that order. First
    # parser that returns a non-None result with >=2 columns and
    # >=1 data row wins. If all five fail we save a copy of the file
    # for offline analysis and raise `_PcPostCommitError` referencing
    # it. See [[Debug/Fix-LT10-Bulk-Export-Pagedown-Fallback]] →
    # "v1.7.6: multi-format parser" section.
    lines = text.splitlines()
    parser_format: Optional[str] = None
    parsed: Optional[dict] = None
    parser_attempts: list[tuple[str, str]] = []
    for fmt_label, fmt_fn in _PARSER_LADDER:
        try:
            candidate = fmt_fn(text, lines)
        except Exception as fmt_exc:
            parser_attempts.append((fmt_label, f"error: {fmt_exc!r}"))
            continue
        if candidate is None:
            parser_attempts.append((fmt_label, "no-match"))
            continue
        parsed = candidate
        parser_format = fmt_label
        parser_attempts.append((fmt_label, "matched"))
        break

    if parsed is None or parser_format is None:
        # All five parsers failed. Save a copy + dump diagnostics to
        # console BEFORE removing the original temp file, so even if
        # the debug copy fails to write, the user can still grab the
        # uuid file from %TEMP% before agent shutdown.
        debug_path = _save_failed_export_debug_copy(text)
        _print_failed_export_diagnostics(text, debug_path, parser_attempts)
        try:
            os.remove(out_path)
        except Exception:
            pass
        location_hint = (
            f" Saved copy of the failing file to {debug_path} — please "
            f"share it so we can identify the SAP variant's export "
            f"format. As a workaround, try selecting a different "
            f"export format option in SAP (Spreadsheet vs Unconverted) "
            f"and recording the new flow."
            if debug_path
            else " Could not save a copy of the failing file; see the "
                 "agent console for the first-1000-chars preview. As a "
                 "workaround, try selecting a different export format "
                 "option in SAP (Spreadsheet vs Unconverted) and "
                 "recording the new flow."
        )
        raise _PcPostCommitError(
            "Could not parse the %pc export file with any known format "
            f"(tried A=dash-separated, B=tab-delimited, C=fixed-width, "
            f"D=CSV, E=HTML). File may be empty or in an unexpected "
            f"SAP variant format.{location_hint}"
        )

    # Successful parse — clean up the temp file and harvest results.
    try:
        os.remove(out_path)
    except Exception:
        pass

    columns = parsed["columns"]
    rows = parsed["rows"]
    parsed_meta = parsed.get("meta", {})
    print(f"[query]  Parser detected format: {parser_format}")

    elapsed = time.time() - started
    print(
        f"[query]  %pc bulk export complete: {len(rows)} row(s), "
        f"{len(columns)} columns in {elapsed:.1f}s. "
        f"No GUI pagination performed."
    )
    return {
        "columns": columns,
        "rows": rows,
        "total": len(rows),
        "meta": {
            "extraction_mode": "pc_bulk_export",
            "parser_format": parser_format,
            "elapsed_sec": round(elapsed, 2),
            **parsed_meta,
        },
    }


def _extract_sap_list_output(sess, paginate: bool = True,
                             max_pages: int = 2000) -> dict:
    """Extract data from a classic SAP list output screen.

    SAP's oldest report output format renders every cell as a GuiLabel
    at position `lbl[x,y]` — x = character column, y = line number.
    Used by LT10, LT22, ME2L, SE16 list view, and many old reports.

    The GuiUserArea only exposes the *currently visible* page (~25
    rows). For large reports (e.g. LT10 warehouse-wide returning 15K+
    rows), we page through with Ctrl+PgDn (sendVKey 82) accumulating
    unique rows. Pagination stops when:
      - Ctrl+PgDn yields no new unique rows (end of list), OR
      - status bar shows "End of list" / "Last page", OR
      - max_pages safety cap is reached.

    Algorithm per page:
      1. Walk wnd[0]/usr collecting (x, y, text) for each lbl/txt/ctxt.
      2. Group by y. Largest non-blank row in the first ~5 lines = header.
      3. Map each cell to nearest header x → output {col_id: value}.
      4. Skip blank/separator rows and repeated headers on later pages.
      5. Dedupe by content fingerprint so overlap between pages doesn't
         duplicate rows.
    """
    # First page (the current scroll position).
    first_page = _walk_list_page(sess)
    if not first_page:
        raise Exception(
            "No lbl[x,y] / txt[x,y] cells found on current screen — "
            "not a classic SAP list output."
        )

    sorted_ys = sorted(first_page.keys())

    # Pick the header row: the first non-blank row in the first ~5 lines
    # that has the most cells (handles single-line or double-line headers).
    header_y = None
    best_count = 0
    for y in sorted_ys:
        cells = first_page[y]
        if _is_blank_or_separator(cells):
            continue
        if len(cells) > best_count:
            best_count = len(cells)
            header_y = y
        if y >= (sorted_ys[0] + 4) and best_count > 0:
            break
    if header_y is None:
        header_y = sorted_ys[0]

    header_cells = sorted(first_page[header_y], key=lambda c: c[0])
    header_xs = [c[0] for c in header_cells]
    header_titles = [c[1] or f"col_{c[0]}" for c in header_cells]
    col_count = len(header_cells)

    columns = [
        {"id": f"c{i}_{header_xs[i]}", "title": header_titles[i]}
        for i in range(col_count)
    ]

    def _nearest_col(x: int) -> int:
        if not header_xs:
            return 0
        dists = [(abs(x - hx), i) for i, hx in enumerate(header_xs)]
        dists.sort()
        return dists[0][1]

    def _row_to_dict(cells: list, idx: int) -> dict[str, Any]:
        row: dict[str, Any] = {"_rowIndex": idx}
        for x, text, _t in sorted(cells, key=lambda c: c[0]):
            col_idx = _nearest_col(x)
            col_id = columns[col_idx]["id"]
            existing = row.get(col_id)
            if existing:
                row[col_id] = f"{existing} {text}".strip()
            else:
                row[col_id] = text
        for col in columns:
            row.setdefault(col["id"], "")
        return row

    def _is_repeated_header(cells: list) -> bool:
        """Does this row look like the header row repeated on a later page?"""
        sorted_cells = sorted(cells, key=lambda c: c[0])
        if len(sorted_cells) != len(header_cells):
            return False
        for i, (x, text, _) in enumerate(sorted_cells):
            hx, htext, _ = header_cells[i]
            if x != hx or text != htext:
                return False
        return True

    def _row_fingerprint(cells: list) -> tuple:
        return tuple(sorted((x, t) for x, t, _ in cells))

    seen_fingerprints: set[tuple] = set()
    data_rows: list[dict[str, Any]] = []

    def _absorb_page(page_rows: dict[int, list]) -> int:
        added = 0
        for y in sorted(page_rows.keys()):
            cells = page_rows[y]
            if _is_blank_or_separator(cells):
                continue
            if _is_repeated_header(cells):
                continue
            fp = _row_fingerprint(cells)
            if fp in seen_fingerprints:
                continue
            seen_fingerprints.add(fp)
            data_rows.append(_row_to_dict(cells, len(data_rows)))
            added += 1
        return added

    _absorb_page(first_page)

    pages_processed = 1
    if paginate:
        while pages_processed < max_pages:
            # Status bar end-of-list detection
            try:
                sbar = sess.findById("wnd[0]/sbar").Text or ""
                if any(k in sbar.lower() for k in (
                    "end of list", "last page", "list complete",
                    "no further data",
                )):
                    break
            except Exception:
                pass

            # Advance one page (Ctrl+PgDn = SAP next-page in list output).
            try:
                sess.findById("wnd[0]").sendVKey(82)
                _wait_for_session(sess, 5)
            except Exception:
                break

            page = _walk_list_page(sess)
            if not page:
                break

            added = _absorb_page(page)
            pages_processed += 1

            # If a page-down yields no new rows, we've reached the end.
            if added == 0:
                break

        print(
            f"[query]  SAP list paginated: {pages_processed} page(s), "
            f"{len(data_rows)} unique row(s)"
        )
    else:
        print(
            f"[query]  SAP list single-page: {len(data_rows)} row(s)"
        )
    print(f"[query]  Header: {header_titles}")

    return {
        "columns": columns,
        "rows": data_rows,
        "total": len(data_rows),
        "meta": {
            "extraction_mode": "sap_list_output",
            "header_y": header_y,
            "pages": pages_processed,
        },
    }


def _find_table_control_in_tree(sess):
    """Walk the tree and return the first GuiTableControl node. Used for
    classic screen-painter report outputs (e.g. LT10 Stock Transfer:
    Overview) which are NOT ALV grids."""
    nodes: list = []
    try:
        _walk_gui_tree(sess.findById("wnd[0]"), nodes)
    except Exception:
        return None, None, nodes
    for node_id, node_type, node in nodes:
        if node_type == "GuiTableControl":
            print(f"[query]  Auto-discovered GuiTableControl at '{node_id}'")
            return node, node_id, nodes
    return None, None, nodes


def _extract_table_control_auto(sess, table, table_id: str) -> dict:
    """Extract every row from a GuiTableControl, auto-discovering the
    field IDs of each column from row 0. Handles vertical scrolling.

    Classic screen-painter tables in SAP expose cells as
    `{table_id}/{field_id}[{row}]` where field_id is something like
    `txtLTAP-MATNR` or `ctxtLTAK-LGNUM`. We probe row 0 to discover the
    unique field_ids present, then read every row.
    """
    total = int(_safe_get(table, "RowCount", 0) or 0)
    visible = max(1, int(_safe_get(table, "VisibleRowCount", 0) or 1))

    # Probe row 0 to discover the field IDs.
    field_ids: list[str] = []
    try:
        row0_children = sess.findById(table_id).Children
        count = int(_safe_get(row0_children, "Count", 0) or 0)
        for i in range(count):
            try:
                cell = row0_children.ElementAt(i)
            except Exception:
                try:
                    cell = row0_children(i)
                except Exception:
                    continue
            cid = str(_safe_get(cell, "Id", "") or "")
            # Strip the absolute path prefix and index suffix to extract
            # the bare field id (e.g. ".../txtLTAP-MATNR[0]" → "txtLTAP-MATNR")
            last = cid.rsplit("/", 1)[-1]
            if last.endswith("[0]"):
                last = last[:-3]
            if last and last not in field_ids:
                field_ids.append(last)
    except Exception as e:
        raise Exception(f"Could not probe GuiTableControl columns: {e}")

    if not field_ids:
        raise Exception(
            f"GuiTableControl at '{table_id}' has no discoverable columns "
            f"in row 0. Control may be empty or scripting-disabled."
        )

    print(f"[query]  GuiTableControl: {total} rows × {len(field_ids)} cols: {field_ids[:6]}...")

    rows: list[dict[str, Any]] = []
    for top in range(0, total, visible):
        try:
            table.VerticalScrollbar.Position = top
        except Exception:
            pass
        for r in range(min(visible, total - top)):
            row: dict[str, Any] = {"_rowIndex": top + r}
            for fid in field_ids:
                try:
                    cell = sess.findById(f"{table_id}/{fid}[{r}]")
                    row[fid] = str(_safe_get(cell, "Text", "") or "")
                except Exception:
                    row[fid] = ""
            rows.append(row)

    # Best-effort column titles: use the bare tech name stripped of the
    # control prefix (e.g. "txtLTAP-MATNR" → "Material / LTAP-MATNR").
    def _title(fid: str) -> str:
        if "-" in fid:
            return fid.split("-", 1)[-1]
        return fid

    columns = [{"id": fid, "title": _title(fid)} for fid in field_ids]
    return {"columns": columns, "rows": rows, "total": total}


def _extract_alv_grid(sess, candidate_ids: Optional[list[str]] = None) -> dict:
    """Extract all rows+columns from an ALV grid on the current SAP screen.

    Tries a list of candidate shell IDs (common SAP ALV grid locations),
    then falls back to walking the entire window tree for anything that
    quacks like an ALV GridView (has .ColumnOrder).
    Returns {columns: [{id, title, width?}], rows: [{col_id: value, ...}]}.
    Raises Exception if no grid found.
    """
    candidates = candidate_ids or [
        "wnd[0]/usr/cntlGRID1/shellcont/shell",
        "wnd[0]/usr/cntlCC_CONTAINER/shellcont/shell",
        "wnd[0]/usr/cntlCONTAINER1_CONT/shellcont/shell",
        "wnd[0]/usr/cntlGRIDCONTAINER/shellcont/shell",
        "wnd[0]/usr/shellcont/shell",
        "wnd[0]/shellcont/shell",
        "wnd[0]/usr/cntlGRID/shellcont/shell",
        # LT10 "Stock Transfer: Overview" uses a nested container
        "wnd[0]/usr/cntlGRID_CONTAINER/shellcont/shell",
        "wnd[0]/usr/cntlCONTAINER/shellcont/shell",
        "wnd[0]/usr/cntlTREE_CONTAINER/shellcont/shell",
    ]
    grid = None
    matched_id = None
    for cand in candidates:
        try:
            g = sess.findById(cand)
            _ = g.ColumnOrder
            grid = g
            matched_id = cand
            break
        except Exception:
            continue

    # Fallback 1: walk the whole control tree looking for any ALV grid.
    if grid is None:
        grid, matched_id = _find_alv_grid_in_tree(sess)

    # Fallback 2: no ALV — try a classic GuiTableControl (screen-painter
    # report style).
    if grid is None:
        tc, tc_id, all_nodes = _find_table_control_in_tree(sess)
        if tc is not None:
            return _extract_table_control_auto(sess, tc, tc_id)
    else:
        all_nodes = []

    # Fallback 3: classic SAP list output (GuiLabel[x,y] grid), used by
    # LT10 Stock Transfer: Overview, LT22, and many older reports.
    # Phase B4: when /sap/query?use_bulk_export=true, try the %pc save-
    # to-file path first — it's an order of magnitude faster than
    # Ctrl+PgDn pagination for big reports.
    #
    # v1.7.3 — fallback chain is no longer greedy. We only fall back to
    # `_extract_sap_list_output` when %pc raises `_PcPreCommitError`
    # (the dialog never opened, nothing was saved, GUI is still on
    # the source screen). On `_PcPostCommitError` we re-raise — the
    # file was already burned and pagination would re-walk the same
    # data slowly (the v1.7.2 LT10 user-visible bug).
    if grid is None:
        if getattr(state, "_use_bulk_export", False):
            try:
                return _extract_via_pc_export(sess)
            except _PcPreCommitError as pre_err:
                print(
                    f"[query]  %pc pre-commit failed, falling back to "
                    f"lbl[x,y]: {pre_err}"
                )
            except _PcPostCommitError as post_err:
                print(
                    f"[query]  %pc post-commit failed — NOT falling back "
                    f"(file was already saved, pagination would scrape "
                    f"the wrong screen): {post_err}"
                )
                raise Exception(
                    f"Bulk export saved file but parse failed: {post_err}"
                ) from post_err
            except Exception as pc_err:
                # Unknown error class — be conservative, surface it
                # rather than risking a double-burn pagination walk.
                print(
                    f"[query]  %pc unknown error — NOT falling back to "
                    f"avoid double-burn: {pc_err}"
                )
                raise
        try:
            return _extract_sap_list_output(sess)
        except Exception as list_err:
            print(f"[query]  List-output extraction skipped: {list_err}")

    if grid is None:
        # Emit a diagnostic listing of the actual control tree so we can
        # see exactly what's on screen. Focus on the user-area nodes
        # (wnd[0]/usr/*) and drop menu bar noise.
        nodes: list = all_nodes
        walk_err = None
        if not nodes:
            try:
                _walk_gui_tree(sess.findById("wnd[0]"), nodes)
            except Exception as e:
                walk_err = str(e)

        print(f"[query]  ALV/Table extraction failed. Walked {len(nodes)} nodes.")
        usr_nodes = [n for n in nodes if "/usr/" in n[0] or n[0].endswith("/usr")]
        print(f"[query]  User-area nodes ({len(usr_nodes)}):")
        for nid, nt, _n in usr_nodes[:60]:
            print(f"[query]    node: {nid}  (type={nt})")

        type_counts: dict[str, int] = {}
        for _nid, nt, _n in nodes:
            type_counts[nt] = type_counts.get(nt, 0) + 1
        print(f"[query]  Node type histogram: {type_counts}")

        if usr_nodes:
            sample = "; ".join(f"{n[0]}({n[1]})" for n in usr_nodes[:8])
            hint = f" | User-area nodes ({len(usr_nodes)}): {sample}"
        elif nodes:
            hint = (
                f" | Walked {len(nodes)} nodes, none under wnd[0]/usr. "
                f"Types: {type_counts}. "
                f"Agent may be on a popup/dialog — check active window."
            )
        else:
            hint = (
                f" | Tree walk returned 0 nodes"
                + (f" (error: {walk_err})" if walk_err else "")
                + ". Agent may be on a dialog/popup — check active window."
            )
        raise Exception(
            "Could not find ALV grid or GuiTableControl on current screen." + hint
        )

    print(f"[query]  Extracting ALV grid from '{matched_id}'")

    columns = []
    try:
        col_order = list(grid.ColumnOrder)
        for col_id in col_order:
            title = col_id
            try:
                title = grid.GetColumnTitles(col_id)[0] or col_id
            except Exception:
                try:
                    title = grid.GetColumnTooltip(col_id) or col_id
                except Exception:
                    pass
            columns.append({"id": col_id, "title": str(title)})
    except Exception as e:
        raise Exception(f"Could not read ALV columns: {e}")

    rows = []
    try:
        row_count = int(grid.RowCount)
    except Exception:
        row_count = 0

    for r in range(row_count):
        row: dict[str, Any] = {}
        for col in columns:
            try:
                val = grid.GetCellValue(r, col["id"])
                row[col["id"]] = str(val) if val is not None else ""
            except Exception:
                row[col["id"]] = ""
        rows.append(row)

    return {"columns": columns, "rows": rows, "total": row_count}


def _extract_table_control(sess, table_id: str, field_ids: list[str]) -> dict:
    """Extract rows from an older-style GuiTableControl (not ALV).

    field_ids are the field components within each row (e.g.
    ["ctxtLDKOMB-MATNR", "txtLDKOMB-VERME"]). Handles scrolling.
    """
    tbl = sess.findById(table_id)
    total = int(_safe_get(tbl, "RowCount", 0) or 0)
    visible = int(_safe_get(tbl, "VisibleRowCount", 0) or 0)
    rows = []

    for top in range(0, total, max(1, visible)):
        try:
            tbl.VerticalScrollbar.Position = top
        except Exception:
            pass
        # After scroll, rows are re-indexed 0..visible-1
        for r in range(min(visible, total - top)):
            row: dict[str, Any] = {"_rowIndex": top + r}
            for fid in field_ids:
                try:
                    cell = sess.findById(f"{table_id}/{fid}[{r}]")
                    row[fid] = str(_safe_get(cell, "Text", "") or "")
                except Exception:
                    row[fid] = ""
            rows.append(row)

    columns = [{"id": f, "title": f} for f in field_ids]
    return {"columns": columns, "rows": rows, "total": total}


# ── Handlers ─────────────────────────────────────────────────────────
# Each handler: sess (SAP session) + params (dict) → dict with
# {columns, rows, total, meta?}. Errors raise exceptions.

def handler_lt10(sess, params: dict) -> dict:
    """LT10 — Stock Transfer: Start (single-screen bin stock lookup).

    Flow recorded in omni_bridge/sap_scripts/LT10xScript.vbs:

      1. /nLT10 → opens the Stock Transfer: Start selection screen
      2. Fill direct fields (no Dynamic Selections needed):
           S1_LGNUM     → Warehouse number (e.g. WH5)
           S1_LGTYP-LOW → Storage type (default '*' = all)
           MATNR-LOW    → Material number
      3. Press F8 (btn[8]) to execute → Stock Transfer: Overview grid.

    Output columns (from the Overview screen):
        I, Typ, St, Material, Plnt, SLoc, StorageBin, Avail.st, Stock,
        Inv.D, S, TO number, Special Stock Number, Last mvmt, Batch,
        Last inv., PutawayS, Pick qty, Last changer

    Why LT10 over LX03: single-screen (no Dynamic Selections dance),
    returns TO number column directly, and uses standard context fields
    so the script is portable across users/SAP versions.

    Params:
        material: str     (required)
        warehouse: str    (LGNUM, required, default WH5)
        storage_type: str (LGTYP, default '*' = all types)
    """
    material = str(params.get("material", "")).strip()
    warehouse = str(params.get("warehouse", "")).strip()
    storage_type = str(params.get("storage_type", "*")).strip() or "*"

    if not material:
        raise Exception("Material number (material) is required")
    if not warehouse:
        raise Exception("Warehouse (warehouse) is required")

    # Step 1: Navigate to LT10
    sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT10"
    sess.findById("wnd[0]").sendVKey(0)
    _wait_for_session(sess, 15)

    # Resize the working pane so SAP renders ~100 rows per page on the
    # subsequent list output. Default is ~25, so this cuts the number
    # of Ctrl+PgDn round-trips needed for big warehouse-wide queries
    # by 4x. Best-effort — some SAP/Citrix configs cap the height.
    try:
        sess.findById("wnd[0]").resizeWorkingPane(180, 100, False)
    except Exception:
        pass

    # Step 2: Fill selection screen fields
    try:
        sess.findById("wnd[0]/usr/ctxtS1_LGNUM").text = warehouse
    except Exception as e:
        raise Exception(f"Could not set warehouse field S1_LGNUM: {e}")

    try:
        sess.findById("wnd[0]/usr/ctxtS1_LGTYP-LOW").text = storage_type
    except Exception:
        pass  # Storage type is optional

    try:
        sess.findById("wnd[0]/usr/ctxtMATNR-LOW").text = material
    except Exception as e:
        raise Exception(f"Could not set material field MATNR-LOW: {e}")

    # Step 3: Execute (F8)
    try:
        sess.findById("wnd[0]/tbar[1]/btn[8]").press()
    except Exception:
        sess.findById("wnd[0]").sendVKey(8)
    _wait_for_session(sess, 30)

    # Handle "no data" status bar message
    try:
        sbar = sess.findById("wnd[0]/sbar").Text or ""
        if any(k in sbar.lower() for k in ("no data", "no records", "no objects", "no quants")):
            return {
                "columns": [],
                "rows": [],
                "total": 0,
                "meta": {
                    "transaction": "LT10",
                    "material": material,
                    "warehouse": warehouse,
                    "storage_type": storage_type,
                    "status": sbar,
                    "empty": True,
                },
            }
    except Exception:
        pass

    # Step 4: Extract data from the Stock Transfer: Overview screen.
    #
    # v1.7.5 — Always use bulk export for LT10. The v1.7.3 gate
    # `if storage_type == "*"` was based on the wrong assumption that
    # specific-type queries return small result sets. Production
    # disproved this: a `storage_type='999'` warehouse-wide query
    # returned 234 rows across 7 pages (~30s of Ctrl+PgDn pagination)
    # when bulk export would have completed in <5s. Bulk export is
    # also more reliable: no Ctrl+PgDn timing races, no missed rows on
    # the last page, no COM bridge thrashing.
    #
    # The v1.7.3 pre/post-commit error split (`_PcPreCommitError` vs
    # `_PcPostCommitError`) ensures we still fall back to pagination
    # if the export trigger fails BEFORE any file is saved (a SAP
    # variant with neither menu nor `%pc` working keeps functioning,
    # just slower). Post-commit failures still raise — the file was
    # already burned and pagination would re-walk the same data.
    #
    # NO ALV probe: LT10 always renders a classic list output
    # (lbl[x,y] grid), never an ALV grid.
    state._use_bulk_export = True
    extraction_path = "pc_bulk_export"
    try:
        result = _extract_via_pc_export(sess)
    except _PcPreCommitError as pre_err:
        # %pc dialog never opened — SAP is still on the source
        # screen so pagination is a safe last-resort here.
        print(
            f"[query]  LT10 %pc pre-commit failed, falling back to "
            f"lbl[x,y] pagination: {pre_err}"
        )
        result = _extract_sap_list_output(sess)
        extraction_path = "lbl_paginated_fallback"
    finally:
        state._use_bulk_export = False

    result["meta"] = {
        "transaction": "LT10",
        "material": material,
        "warehouse": warehouse,
        "storage_type": storage_type,
        "extraction_path": extraction_path,
    }
    return result


def handler_mb52(sess, params: dict) -> dict:
    """MB52 — List of Warehouse Stocks on Hand.

    Params:
        material: str  (optional)
        plant: str     (optional)
        storage_location: str (optional)
    """
    material = str(params.get("material", "")).strip()
    plant = str(params.get("plant", "")).strip()
    storage_loc = str(params.get("storage_location", "")).strip()

    sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMB52"
    sess.findById("wnd[0]").sendVKey(0)
    _wait_for_session(sess, 15)

    def _try_set(ids: list[str], value: str):
        for fid in ids:
            try:
                sess.findById(fid).text = value
                return True
            except Exception:
                continue
        return False

    if material:
        _try_set(
            ["wnd[0]/usr/ctxtMATNR_S-LOW", "wnd[0]/usr/ctxtS_MATNR-LOW"],
            material,
        )
    if plant:
        _try_set(
            ["wnd[0]/usr/ctxtWERKS_S-LOW", "wnd[0]/usr/ctxtS_WERKS-LOW"],
            plant,
        )
    if storage_loc:
        _try_set(
            ["wnd[0]/usr/ctxtLGORT_S-LOW", "wnd[0]/usr/ctxtS_LGORT-LOW"],
            storage_loc,
        )

    try:
        sess.findById("wnd[0]/tbar[1]/btn[8]").press()
    except Exception:
        sess.findById("wnd[0]").sendVKey(8)
    _wait_for_session(sess, 30)

    # v1.7.5 — Always use bulk export for MB52. MB52 is a classic
    # list-output report (List of Warehouse Stocks on Hand) that
    # commonly returns thousands of rows; the canonical menu path
    # (List → Save → File...) yields a single-shot file save in
    # seconds vs minutes of Ctrl+PgDn pagination. The v1.7.3
    # pre/post-commit error split ensures we only fall back to
    # ALV/list extraction on PRE-commit failures (dialog never
    # opened, GUI still on source screen).
    state._use_bulk_export = True
    extraction_path = "pc_bulk_export"
    try:
        result = _extract_via_pc_export(sess)
    except _PcPreCommitError as pre_err:
        print(
            f"[query]  MB52 %pc pre-commit failed, falling back to "
            f"ALV/list extraction: {pre_err}"
        )
        result = _extract_alv_grid(sess)
        extraction_path = "alv_grid_fallback"
    finally:
        state._use_bulk_export = False

    result["meta"] = {
        "transaction": "MB52",
        "material": material or None,
        "plant": plant or None,
        "storage_location": storage_loc or None,
        "extraction_path": extraction_path,
    }
    return result


def handler_mmbe(sess, params: dict) -> dict:
    """MMBE — Stock Overview (single material).

    MMBE output is a tree, not ALV. This handler navigates and returns
    the tree as hierarchical rows. Works best for quick single-material
    lookups; use MB52 or LT10 for multi-material or per-bin lists.

    Params:
        material: str (MATNR, required)
        plant: str    (WERKS, optional)
    """
    material = str(params.get("material", "")).strip()
    plant = str(params.get("plant", "")).strip()

    if not material:
        raise Exception("Material number (material) is required")

    sess.findById("wnd[0]/tbar[0]/okcd").text = "/nMMBE"
    sess.findById("wnd[0]").sendVKey(0)
    _wait_for_session(sess, 15)

    try:
        sess.findById("wnd[0]/usr/ctxtRMMG1-MATNR").text = material
    except Exception:
        pass
    if plant:
        try:
            sess.findById("wnd[0]/usr/ctxtRMMG1-WERKS").text = plant
        except Exception:
            pass

    try:
        sess.findById("wnd[0]/tbar[1]/btn[8]").press()
    except Exception:
        sess.findById("wnd[0]").sendVKey(8)
    _wait_for_session(sess, 30)

    # MMBE uses a tree widget; try to extract
    tree_candidates = [
        "wnd[0]/usr/shellcont[1]/shell",
        "wnd[0]/usr/cntlGRID1/shellcont/shell",
    ]
    for cand in tree_candidates:
        try:
            tree = sess.findById(cand)
            nodes = list(tree.GetAllNodeKeys())
            rows = []
            cols_set: set[str] = set()
            for nk in nodes:
                row: dict[str, Any] = {"_node": nk}
                try:
                    row["text"] = str(tree.GetNodeTextByKey(nk) or "")
                except Exception:
                    pass
                # Try to read columns if this is a tree+columns widget
                try:
                    col_names = list(tree.GetColumnNames())
                    for c in col_names:
                        cols_set.add(c)
                        try:
                            row[c] = str(tree.GetItemText(nk, c) or "")
                        except Exception:
                            row[c] = ""
                except Exception:
                    pass
                rows.append(row)
            cols = [{"id": c, "title": c} for c in sorted(cols_set)] or [
                {"id": "text", "title": "Text"}
            ]
            return {
                "columns": cols,
                "rows": rows,
                "total": len(rows),
                "meta": {"transaction": "MMBE", "material": material},
            }
        except Exception:
            continue

    # Fallback to ALV
    result = _extract_alv_grid(sess)
    result["meta"] = {"transaction": "MMBE", "material": material}
    return result


def _rows_to_graph(rows: list[dict], focus: dict) -> dict:
    """Convert LT24 flat rows into a graph payload of unique nodes + edges.

    Each row from LT24 typically contains columns like:
      TO number, Material, Source Stor.Type, Source Bin, Dest. Stor.Type,
      Dest. Bin, Warehouse, Plant, SLoc, Qty, UoM, Status, Created by,
      Confirmed by, Delivery, Movement type, etc.

    We normalise column headers to lowercase and strip whitespace to match
    the keys that _extract_sap_list_output produces (e.g. 'MATNR' or the
    display title like 'Material').

    Returns {focus, nodes: [...], edges: [...]} with deterministic IDs.
    """
    nodes_map: dict[str, dict] = {}
    edges_list: list[dict] = []
    seen_edges: set[tuple[str, str, str]] = set()

    def _add_node(nid: str, ntype: str, label: str, **meta):
        if nid not in nodes_map:
            nodes_map[nid] = {"id": nid, "type": ntype, "label": label, "meta": meta}
        else:
            nodes_map[nid]["meta"].update(meta)

    def _add_edge(source: str, target: str, relation: str):
        key = (source, target, relation)
        if key not in seen_edges:
            seen_edges.add(key)
            edges_list.append({"source": source, "target": target, "relation": relation})

    def _col(row: dict, *candidates: str) -> str:
        """Find the first matching column by trying each candidate as a
        substring match against the row's keys. LT24 column IDs vary
        between SAP list extraction (e.g. 'c3_12') and ALV extraction
        (e.g. 'TANUM'). We match both by checking titles embedded in
        the key or doing a loose lookup."""
        for cand in candidates:
            cand_l = cand.lower()
            for k, v in row.items():
                if k.startswith("_"):
                    continue
                if cand_l == k.lower() or cand_l in k.lower():
                    return str(v or "").strip()
        return ""

    for row in rows:
        to_num = _col(row, "TANUM", "TO number", "Transfer Order")
        material = _col(row, "MATNR", "Material")
        src_type = _col(row, "VLTYP", "Source Stor.Type", "Src STyp", "SrcSTyp")
        src_bin = _col(row, "VLPLA", "Source Bin", "SrcBin")
        dst_type = _col(row, "NLTYP", "Dest. Stor.Type", "DstSTyp")
        dst_bin = _col(row, "NLPLA", "Dest. Bin", "DstBin", "Dest Bin")
        warehouse = _col(row, "LGNUM", "Warehouse", "WhN")
        plant = _col(row, "WERKS", "Plant", "Plnt")
        status = _col(row, "KZSUB", "Status", "Stat")
        created_by = _col(row, "UNAME", "Created by", "Created")
        confirmed_by = _col(row, "BNAME", "Confirmed by", "Conf.by")
        delivery = _col(row, "VBELN", "Delivery", "Ref.Doc", "Ref. Doc")
        qty = _col(row, "VSOLM", "Qty", "Quantity", "TrQty")
        uom = _col(row, "MEINS", "UoM", "Unit")
        mvt_type = _col(row, "BWLVS", "Mvt Type", "Movement type", "MvT")
        created_date = _col(row, "BDATU", "Created on", "Cr.Date", "CrDate")
        confirmed_date = _col(row, "KQDAT", "Conf. date", "Confirmed on", "ConfDate")

        # -- TO node (always present) --
        if to_num:
            to_id = f"to:{to_num}"
            status_label = status or "Open"
            _add_node(to_id, "to", f"TO {to_num}", status=status_label,
                      qty=qty, uom=uom, mvt_type=mvt_type,
                      created_date=created_date, confirmed_date=confirmed_date)

            # Material
            if material:
                mat_id = f"material:{material}"
                _add_node(mat_id, "material", material, plant=plant)
                _add_edge(to_id, mat_id, "moves")

            # Source bin
            if src_bin:
                src_label = f"{src_bin}" + (f" ({src_type})" if src_type else "")
                src_id = f"bin:{warehouse}/{src_type}/{src_bin}" if warehouse else f"bin:{src_type}/{src_bin}"
                _add_node(src_id, "bin", src_label, storage_type=src_type, warehouse=warehouse)
                _add_edge(to_id, src_id, "picks_from")

            # Dest bin
            if dst_bin:
                dst_label = f"{dst_bin}" + (f" ({dst_type})" if dst_type else "")
                dst_id = f"bin:{warehouse}/{dst_type}/{dst_bin}" if warehouse else f"bin:{dst_type}/{dst_bin}"
                _add_node(dst_id, "bin", dst_label, storage_type=dst_type, warehouse=warehouse)
                _add_edge(to_id, dst_id, "puts_to")

            # Created by user
            if created_by:
                user_id = f"user:{created_by}"
                _add_node(user_id, "user", created_by)
                _add_edge(to_id, user_id, "created_by")

            # Confirmed by user (may differ from creator)
            if confirmed_by and confirmed_by != created_by:
                conf_user_id = f"user:{confirmed_by}"
                _add_node(conf_user_id, "user", confirmed_by)
                _add_edge(to_id, conf_user_id, "confirmed_by")

            # Delivery reference
            if delivery:
                del_id = f"delivery:{delivery}"
                _add_node(del_id, "delivery", f"Del {delivery}")
                _add_edge(to_id, del_id, "references")

    return {
        "focus": focus,
        "nodes": list(nodes_map.values()),
        "edges": edges_list,
    }


def _format_sap_date(value: str) -> str:
    """Convert an ISO 8601 date (`YYYY-MM-DD`) to the SAP US format
    (`MM/DD/YYYY`) the LT24 selection screen expects.

    Why this helper exists (2026-05-09):
      The LT24 BDATU range fields render in the user's SAP profile
      date format. The `LT24ExportingwithDateRange.vbs` recording
      captured `01/01/2025` and `05/09/2026` — confirming
      MM/DD/YYYY (US locale) is what the field accepts. The frontend
      `<input type="date">` emits ISO 8601 (`YYYY-MM-DD`) regardless
      of the user's browser locale, so we MUST normalise here before
      writing to the GUI control or SAP rejects the value with
      "Invalid date" and the F8 execute fails the selection.

    Behaviour:
      - Empty / whitespace → returns "" (caller should skip the
        write entirely; the field-write block already gates on
        truthy values so an empty return is safe).
      - Already in MM/DD/YYYY (e.g. legacy callers passing pre-
        formatted dates) → returned unchanged.
      - ISO `YYYY-MM-DD` → split + reorder + zero-pad → MM/DD/YYYY.
      - Anything else → returned unchanged so we don't mask user
        input that ALREADY happens to match SAP's expected format
        for a non-US profile (the field-set is wrapped in try/
        except — a bad value will surface as a SAP "Invalid date"
        message in the status bar).
    """
    s = (value or "").strip()
    if not s:
        return ""
    if "/" in s and "-" not in s:
        return s
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            y, m, d = s.split("-")
            if len(y) == 4 and len(m) == 2 and len(d) == 2:
                return f"{m}/{d}/{y}"
        except Exception:
            pass
    return s


def handler_lt24(sess, params: dict) -> dict:
    """LT24 — Display Transfer Orders (TO history / tracking).

    Selection modes (param `mode`, optional — inferred from supplied
    params when not explicitly set):
      - by_to       → warehouse + to_number
      - by_material → warehouse + material + optional date_from / date_to
      - by_bin      → warehouse + storage_type + storage_bin + optional dates
      - by_delivery → warehouse + delivery

    Always returns {columns, rows, total, meta, graph}.
    The graph payload is shaped by _rows_to_graph() for the frontend's
    force-directed graph component.

    2026-05-09 — `mode` is now optional. The new "TO History" entry in
    the Inventory Management Query Library posts a flat
    `{material, warehouse, to_number}` shape (no `mode`), matching how
    LT10 / MB52 / MMBE entries dispatch. We infer the mode from the
    most-specific input present (TO number wins, then material, then
    bin, then delivery) so both call shapes work. Legacy callers that
    pass an explicit `mode` keep their current behaviour.
    """
    warehouse = str(params.get("warehouse", "")).strip()
    to_number = str(params.get("to_number", "")).strip()
    material = str(params.get("material", "")).strip()
    storage_type = str(params.get("storage_type", "")).strip()
    storage_bin = str(params.get("storage_bin", "")).strip()
    delivery = str(params.get("delivery", "")).strip()
    date_from = str(params.get("date_from", "")).strip()
    date_to = str(params.get("date_to", "")).strip()
    # Optional custom layout (ctxtLISTV) — user-specific, never hardcoded.
    # Each user maintains their own column arrangement (e.g. "JSINGHX")
    # under their account; we only apply it when the caller passes one.
    layout = str(params.get("layout", "")).strip()

    raw_mode = str(params.get("mode", "")).strip().lower()
    # Infer mode from the most-specific input when caller didn't set it.
    # TO number wins because a single TO is always the cheapest LT24
    # query (selection screen filters to one row at the source). Bin
    # comes before material so a (storage_type, storage_bin) pair —
    # which uniquely identifies a physical location — doesn't get
    # demoted to the much-broader by-material query when the user
    # also happened to type a material on the form.
    if raw_mode in ("by_to", "by_material", "by_bin", "by_delivery"):
        mode = raw_mode
    elif to_number:
        mode = "by_to"
    elif storage_bin:
        mode = "by_bin"
    elif material:
        mode = "by_material"
    elif delivery:
        mode = "by_delivery"
    else:
        mode = "by_to"  # falls through to the validation below

    if not warehouse:
        raise Exception("Warehouse (warehouse) is required")

    # Validate per mode
    if mode == "by_to" and not to_number:
        raise Exception(
            "Provide at least one of: TO Number, Material, Storage Bin, or Delivery"
        )
    if mode == "by_material" and not material:
        raise Exception("Material (material) is required for mode 'by_material'")
    if mode == "by_bin" and not storage_bin:
        raise Exception("Storage bin (storage_bin) is required for mode 'by_bin'")
    if mode == "by_delivery" and not delivery:
        raise Exception("Delivery (delivery) is required for mode 'by_delivery'")

    # Step 1: Navigate to LT24
    sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT24"
    sess.findById("wnd[0]").sendVKey(0)
    _wait_for_session(sess, 15)

    # Step 1b: Switch to the "All Transfer Orders" sub-screen.
    # 2026-05-09 — fix for "Could not set warehouse S1_LGNUM" reported
    # by the user against `USINDPR-CXA106V`. The LT24 selection screen
    # has TWO field-group variants:
    #   - radS1_*  (single TO sub-screen) — exposes ctxtS1_LGNUM,
    #     ctxtS1_TANUM-LOW, ctxtMATNR-LOW, etc.
    #   - radT2_ALLTA  (All TAs sub-screen) — exposes ctxtT2_LGNUM,
    #     ctxtT2_TANUM-LOW, ctxtT2_MATNR-LOW, etc.
    # The user's SAP variant opens on a layout that requires the radio
    # toggle to expose the T2_* fields. Recorded in the user's
    # `LT24Exporting.vbs`:
    #     session.findById("wnd[0]/usr/radT2_ALLTA").select
    #     session.findById("wnd[0]/usr/ctxtT2_LGNUM").text = "WH5"
    #     session.findById("wnd[0]/usr/ctxtT2_MATNR-LOW").text = ...
    # Best-effort: if the radio is missing, the screen is already on
    # the All-TAs variant (the radio is only rendered when the layout
    # toggle is needed). Let any T2_* field-set raise a clearer error
    # below if the screen is genuinely unsupported.
    try:
        sess.findById("wnd[0]/usr/radT2_ALLTA").select()
        # The radio button triggers a screen redraw to enable the T2_*
        # fields — wait briefly so the next findById doesn't race the
        # repaint.
        _wait_for_session(sess, 5)
    except Exception:
        pass

    # Step 2: Fill selection screen fields.
    # LT24 "All TAs" sub-screen field IDs:
    #   ctxtT2_LGNUM       - Warehouse number
    #   ctxtT2_TANUM-LOW   - TO number (from)
    #   ctxtT2_TANUM-HIGH  - TO number (to)
    #   ctxtT2_MATNR-LOW   - Material (from)
    #   ctxtT2_MATNR-HIGH  - Material (to)
    #   ctxtT2_LGTYP-LOW   - Storage type (from)
    #   ctxtT2_LGPLA-LOW   - Storage bin (from)
    #   ctxtT2_VBELN-LOW   - Delivery number (from)
    #   ctxtBDATU-LOW      - Creation date (from) — NOT T2_-prefixed
    #   ctxtBDATU-HIGH     - Creation date (to)   — NOT T2_-prefixed
    #   ctxtLISTV          - Custom layout (optional, user-specific)
    #
    # 2026-05-09 — date field ID correction. The `radT2_ALLTA` sub-screen
    # exposes the BDATU range OUTSIDE the T2_* group: the recorded
    # `LT24ExportingwithDateRange.vbs` (2026-05-09 user capture) writes
    # `wnd[0]/usr/ctxtBDATU-LOW` and `wnd[0]/usr/ctxtBDATU-HIGH`
    # WITHOUT the `T2_` prefix the other range fields carry. The
    # previous code wrote `ctxtT2_BDATU-LOW/HIGH` — the lookup raised
    # a "field not found" exception that was silently swallowed by the
    # surrounding try/except, so no date filter was ever applied.
    # Confirmed by the .vbs:
    #   session.findById("wnd[0]/usr/ctxtBDATU-LOW").text  = "01/01/2025"
    #   session.findById("wnd[0]/usr/ctxtBDATU-HIGH").text = "05/09/2026"

    try:
        sess.findById("wnd[0]/usr/ctxtT2_LGNUM").text = warehouse
    except Exception as e:
        raise Exception(f"Could not set warehouse T2_LGNUM: {e}")

    if mode == "by_to":
        try:
            sess.findById("wnd[0]/usr/ctxtT2_TANUM-LOW").text = to_number
        except Exception as e:
            raise Exception(f"Could not set TO number T2_TANUM-LOW: {e}")

    elif mode == "by_material":
        try:
            sess.findById("wnd[0]/usr/ctxtT2_MATNR-LOW").text = material
        except Exception as e:
            raise Exception(f"Could not set material T2_MATNR-LOW: {e}")

    elif mode == "by_bin":
        if storage_type:
            try:
                sess.findById("wnd[0]/usr/ctxtT2_LGTYP-LOW").text = storage_type
            except Exception:
                pass
        try:
            sess.findById("wnd[0]/usr/ctxtT2_LGPLA-LOW").text = storage_bin
        except Exception as e:
            raise Exception(f"Could not set storage bin T2_LGPLA-LOW: {e}")

    elif mode == "by_delivery":
        try:
            sess.findById("wnd[0]/usr/ctxtT2_VBELN-LOW").text = delivery
        except Exception as e:
            raise Exception(f"Could not set delivery T2_VBELN-LOW: {e}")

    # Date range (optional, applied to any mode). The frontend
    # `<input type="date">` emits ISO 8601 (`YYYY-MM-DD`) regardless
    # of the user's browser locale; SAP's selection screen wants
    # MM/DD/YYYY in the captured `.vbs`. `_format_sap_date` normalises
    # ISO → US, leaves already-US strings untouched, and returns ""
    # for empty input so the truthy gate skips the write entirely.
    sap_date_from = _format_sap_date(date_from)
    sap_date_to = _format_sap_date(date_to)
    if sap_date_from:
        try:
            sess.findById("wnd[0]/usr/ctxtBDATU-LOW").text = sap_date_from
        except Exception:
            pass
    if sap_date_to:
        try:
            sess.findById("wnd[0]/usr/ctxtBDATU-HIGH").text = sap_date_to
        except Exception:
            pass

    # Optional custom display layout. Best-effort — silently skip if
    # the field is missing or the layout doesn't exist for this user.
    if layout:
        try:
            sess.findById("wnd[0]/usr/ctxtLISTV").text = layout
        except Exception:
            pass

    # Step 3: Execute (F8)
    try:
        sess.findById("wnd[0]/tbar[1]/btn[8]").press()
    except Exception:
        sess.findById("wnd[0]").sendVKey(8)
    _wait_for_session(sess, 30)

    # Handle "no data" status bar
    try:
        sbar = sess.findById("wnd[0]/sbar").Text or ""
        if any(k in sbar.lower() for k in ("no data", "no records", "no objects", "no transfer orders")):
            focus = _lt24_focus(mode, to_number, material, storage_bin, delivery)
            return {
                "columns": [], "rows": [], "total": 0,
                "graph": {"focus": focus, "nodes": [], "edges": []},
                "meta": {
                    "transaction": "LT24", "mode": mode,
                    "warehouse": warehouse, "status": sbar, "empty": True,
                },
            }
    except Exception:
        pass

    # Step 4: Extract the result.
    #
    # 2026-05-09 — Force menu-driven bulk export FIRST (mirrors the LT10
    # / MB52 v1.7.4-v1.7.5 fix). The user's `LT24Exporting.vbs`
    # recording uses the canonical export path:
    #     wnd[0]/mbar/menu[0]/menu[1]/menu[2]   (List → Save → File...)
    #     → "Unconverted" radio → Enter → save
    # which `_extract_via_pc_export` already supports as its primary
    # trigger (v1.7.4). The previous behaviour here — `_extract_alv_grid`
    # straight to result — cascaded down to `_extract_sap_list_output`
    # on this user's variant (no ALV grid, classic list output), which
    # paginated with Ctrl+PgDn for many seconds instead of doing a
    # single-shot bulk export.
    #
    # The pre/post-commit error split keeps the Ctrl+PgDn path as a
    # last-resort fallback ONLY when the export dialog never opened
    # (variant has neither menu nor `%pc` registered). Post-commit
    # failures (file saved but parse failed) deliberately surface
    # rather than re-walking the same data slowly from a GUI that may
    # have already advanced past the source screen.
    state._use_bulk_export = True
    extraction_path = "pc_bulk_export"
    try:
        result = _extract_via_pc_export(sess)
    except _PcPreCommitError as pre_err:
        print(
            f"[query]  LT24 %pc pre-commit failed, falling back to "
            f"lbl[x,y] pagination: {pre_err}"
        )
        result = _extract_sap_list_output(sess)
        extraction_path = "lbl_paginated_fallback"
    finally:
        state._use_bulk_export = False

    focus = _lt24_focus(mode, to_number, material, storage_bin, delivery)
    graph = _rows_to_graph(result.get("rows", []), focus)
    result["graph"] = graph
    result["meta"] = {
        "transaction": "LT24", "mode": mode,
        "warehouse": warehouse,
        "to_number": to_number, "material": material,
        "storage_bin": storage_bin, "delivery": delivery,
        # Echo BOTH the raw request (ISO from the browser) and the
        # SAP-formatted value the agent actually wrote to BDATU-LOW/
        # HIGH. Lets the frontend render "Filtered 01/01/2025 →
        # 05/09/2026" without a second format pass, while preserving
        # the canonical ISO for any audit / replay tooling that wants
        # a locale-independent value.
        "date_from": date_from, "date_to": date_to,
        "date_from_sap": sap_date_from, "date_to_sap": sap_date_to,
        "extraction_path": extraction_path,
    }
    return result


def _lt24_focus(mode: str, to_number: str, material: str,
                storage_bin: str, delivery: str) -> dict:
    """Build the focus descriptor for the graph based on the query mode."""
    if mode == "by_to":
        return {"type": "to", "id": to_number}
    elif mode == "by_material":
        return {"type": "material", "id": material}
    elif mode == "by_bin":
        return {"type": "bin", "id": storage_bin}
    elif mode == "by_delivery":
        return {"type": "delivery", "id": delivery}
    return {"type": "to", "id": to_number or "unknown"}


# Registry of all available query handlers. Add new handlers here.
QUERY_HANDLERS: dict[str, Any] = {
    "lt10": handler_lt10,
    "lt24": handler_lt24,
    "mb52": handler_mb52,
    "mmbe": handler_mmbe,
}


@app.post("/sap/query")
def run_sap_query(req: QueryRequest) -> dict:
    """Run a registered data-pulling handler and return rows+columns.

    Handler names are lowercase transaction codes (e.g. 'lt10', 'mb52').
    Handlers are defined above in QUERY_HANDLERS. Each handler returns
    {columns, rows, total, meta?} or raises an exception.
    """
    handler = QUERY_HANDLERS.get(req.handler.lower())
    if handler is None:
        return {
            "ok": False,
            "error": f"Unknown handler '{req.handler}'. Available: {list(QUERY_HANDLERS.keys())}",
        }

    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected. Click SAP Connect first."}

    try:
        sess, _ = _get_sap_session()
    except Exception as e:
        return {"ok": False, "error": f"SAP session: {e}"}

    try:
        print(f"\n[query]  Running handler '{req.handler}' with params: {req.params} "
              f"(bulk_export={req.use_bulk_export})")
        # Stash a thread-local flag so handlers downstream can opt-in to
        # the %pc fast path. We avoid a fancy contextvar — `state` is
        # process-wide and the agent runs single-threaded for SAP work.
        prior_flag = getattr(state, "_use_bulk_export", False)
        state._use_bulk_export = bool(req.use_bulk_export)
        try:
            result = handler(sess, req.params)
        finally:
            state._use_bulk_export = prior_flag
        print(f"[query]  Returned {result.get('total', 0)} rows, {len(result.get('columns', []))} columns")
        return {"ok": True, **result}
    except Exception as e:
        err = str(e)
        print(f"[query]  ERROR: {err}")
        return {"ok": False, "error": err}


@app.get("/sap/query-handlers")
def list_query_handlers() -> dict:
    """List registered query handlers. Used by the frontend to know
    what's available without hardcoding on the client side."""
    return {
        "ok": True,
        "handlers": [
            {"id": h, "name": h.upper()} for h in QUERY_HANDLERS.keys()
        ],
    }


# ---------------------------------------------------------------------------
#  Full Shipment Process (based on Finaltesting.vbs)
# ---------------------------------------------------------------------------
@app.post("/sap/process-shipment")
@_track_metric("process_shipment")
def process_shipment(req: ShipmentRequest) -> dict:
    if not state.sap_connected:
        return {"ok": False, "failed_step": 0, "error": "SAP not connected"}

    delivery = str(req.delivery)
    item = str(req.item or "0010")
    serials = req.serials or []
    to_number = str(req.to_number)
    warehouse = str(req.warehouse)
    tracking = str(req.tracking or "Tracking")

    if not delivery:
        return {"ok": False, "failed_step": 0, "error": "Delivery number required"}
    if not to_number:
        return {"ok": False, "failed_step": 0, "error": "TO number required"}
    if not warehouse:
        return {"ok": False, "failed_step": 0, "error": "Warehouse required"}

    _reset_progress(delivery)
    results = []

    def record_step(step: int, name: str, status: str, msg: str):
        """Record a step result for both the final response and live progress."""
        r = {"step": step, "name": name, "status": status, "msg": msg}
        results.append(r)
        _append_step_result(r)

    try:
        sess, conn = _get_sap_session()
    except Exception as e:
        _finalize_progress(False, f"SAP session: {e}")
        return {"ok": False, "failed_step": 0, "error": f"SAP session: {e}"}

    # --- Diagnostic: log what we're attached to ---
    try:
        info = sess.Info
        print(f"\n[shipment] Using conn[{_sap_conn_idx}] sess[{_sap_sess_idx}] "
              f"sys={info.SystemName} client={info.Client} user={info.User} tx={info.Transaction}")
        print(f"[shipment] Current window: '{sess.findById('wnd[0]').Text or '(untitled)'}'")
        print(f"[shipment] Processing delivery={delivery}, TO={to_number}, WH={warehouse}")
    except Exception as e:
        print(f"[shipment] Could not read session info: {e}")

    def check_sbar() -> str:
        try:
            return sess.findById("wnd[0]/sbar").Text or ""
        except Exception:
            return ""

    def dismiss_popups():
        """Close any modal popups (wnd[1]) by pressing Enter."""
        for _ in range(5):
            try:
                sess.findById("wnd[1]").sendVKey(0)
                _wait_for_session(sess, 5)
            except Exception:
                break

    def reset_to_easy_access():
        """Return to SAP Easy Access (home screen) from wherever SAP is.
        Handles partial-run leftovers, stuck subscreens, and modal dialogs."""
        dismiss_popups()
        # Send /n via OK Code to force-return to menu — most reliable method
        for attempt in range(3):
            try:
                sess.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 10)
                dismiss_popups()
                # If a "data will be lost, save?" dialog appears, press No
                try:
                    sess.findById("wnd[1]/usr/btnSPOP-OPTION2").press()
                    _wait_for_session(sess, 5)
                except Exception:
                    pass
                dismiss_popups()
                return
            except Exception:
                # Maybe we're in a modal — press F12 (cancel) and try again
                try:
                    sess.findById("wnd[0]/tbar[0]/btn[12]").press()
                    _wait_for_session(sess, 5)
                except Exception:
                    pass
                time.sleep(1)

    def safe_set_text(control_id: str, value: str, label: str = ""):
        """Wait for control, then set its text. Raises informative error."""
        if not _wait_for_control(sess, control_id, 15):
            raise Exception(
                f"Control not found: {label or control_id}. "
                f"SAP status: {check_sbar()}. "
                f"If SAP showed a scripting prompt, click OK and retry. "
                f"To avoid prompts, disable 'Notify when a script attaches' "
                f"in SAP GUI > Options > Accessibility & Scripting."
            )
        sess.findById(control_id).text = value

    def safe_press(control_id: str, label: str = ""):
        """Wait for control, then press it. Raises informative error."""
        if not _wait_for_control(sess, control_id, 15):
            raise Exception(
                f"Button not found: {label or control_id}. "
                f"SAP status: {check_sbar()}"
            )
        sess.findById(control_id).press()

    def open_vl02n(dlv: str):
        """Navigate to VL02N and load the delivery. Resilient to partial
        runs, stuck screens, and SAP scripting popups."""
        # 1. Return to clean state first
        reset_to_easy_access()

        # 2. Type /nVL02N in OK Code
        safe_set_text("wnd[0]/tbar[0]/okcd", "/nVL02N", "OK Code field")
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
        dismiss_popups()

        # 3. Wait for the delivery field, enter delivery, press Enter
        safe_set_text("wnd[0]/usr/ctxtLIKP-VBELN", dlv, "VL02N delivery field")
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 20)

        # 4. Dismiss any popups (incompletion warning, goods issue confirmation, etc.)
        dismiss_popups()
        for _ in range(3):
            try:
                title = sess.findById("wnd[0]").Text or ""
                if "ncompl" in title.lower() or "incompletion" in title.lower():
                    # On incompletion screen — press Back to continue past it
                    sess.findById("wnd[0]/tbar[0]/btn[3]").press()
                    _wait_for_session(sess, 10)
                    dismiss_popups()
                else:
                    break
            except Exception:
                break

    # Step 1: ZV26 Serials (optional)
    _set_step(1, "ZV26 — Serial Numbers", "running")
    if serials:
        try:
            sess.findById("wnd[0]/tbar[0]/okcd").text = "/nZV26"
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 15)
            sess.findById("wnd[0]/usr/ctxtPA_DELIV").text = delivery
            sess.findById("wnd[0]/tbar[1]/btn[8]").press()
            _wait_for_session(sess, 15)
            sess.findById("wnd[0]/usr/ctxtPA_ITEM").text = item
            sess.findById("wnd[0]/usr/ctxtPA_ITEM").setFocus()
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)
            sess.findById("wnd[0]").sendVKey(0)
            _wait_for_session(sess, 10)

            for idx, sn in enumerate(serials):
                sn = str(sn).strip()
                if not sn:
                    continue
                try:
                    sess.findById(f"wnd[0]/usr/tblZVBF9000TC_OUTINS/txtW_TEI_SERNO[1,{idx}]").text = sn
                    sess.findById("wnd[0]").sendVKey(0)
                    _wait_for_session(sess, 5)
                except Exception:
                    break

            sess.findById("wnd[0]/tbar[0]/btn[11]").press()
            _wait_for_session(sess, 15)
            record_step(1, "ZV26 Serials", "ok", check_sbar())
        except Exception as e:
            record_step(1, "ZV26 Serials", "error", str(e))
            _finalize_progress(False, str(e))
            return {"ok": False, "failed_step": 1, "error": str(e), "results": results}
    else:
        record_step(1, "ZV26 Serials", "skipped", "No serial numbers")

    # Step 2: VL02N Pack BOX
    _set_step(2, "VL02N — Pack BOX", "running")
    try:
        open_vl02n(delivery)

        # Wait up to 30s for the Pack button to appear. This handles:
        #  - The SAP GUI scripting confirmation popup (user has to click OK)
        #  - Slow Citrix/WAN response times
        #  - Delivery load time
        if not _wait_for_control(sess, "wnd[0]/tbar[1]/btn[18]", 30):
            raise Exception(
                "Pack button did not appear within 30s after loading delivery "
                + delivery + ". Status: " + check_sbar() +
                ". If SAP asked 'A script is attempting to access SAP GUI', "
                "click OK and try again. To avoid the prompt, disable "
                "'Notify when a script attaches' in SAP GUI Options > "
                "Accessibility & Scripting."
            )

        sess.findById("wnd[0]/tbar[1]/btn[18]").press()
        _wait_for_session(sess, 15)

        # Wait for the packing material field to appear
        vhilm_field = "wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_001/ctxtV51VE-VHILM[2,0]"
        if not _wait_for_control(sess, vhilm_field, 15):
            raise Exception(
                "Packing material field did not appear. Status: " + check_sbar()
            )

        sess.findById(vhilm_field).text = "BOX"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_001").getAbsoluteRow(0).selected = True
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_002").getAbsoluteRow(0).selected = True
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_002/ctxtV51VP-MATNR[0,0]").setFocus()
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/btn%#AUTOTEXT001").press()
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)
        record_step(2, "VL02N Pack BOX", "ok", check_sbar())
    except Exception as e:
        record_step(2, "VL02N Pack BOX", "error", str(e))
        _finalize_progress(False, str(e))
        return {"ok": False, "failed_step": 2, "error": str(e), "results": results}

    # Step 3: LT12 Confirm TO
    _set_step(3, "LT12 — Confirm TO", "running")
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nLT12"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
        sess.findById("wnd[0]/usr/txtLTAK-TANUM").text = to_number
        sess.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = warehouse
        sess.findById("wnd[0]/usr/chkRL03T-OFPOS").setFocus()
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)
        try:
            sess.findById("wnd[1]/usr/btnSPOP-OPTION1").press()
            _wait_for_session(sess, 10)
        except Exception:
            pass
        record_step(3, "LT12 Confirm TO", "ok", check_sbar())
    except Exception as e:
        record_step(3, "LT12 Confirm TO", "error", str(e))
        _finalize_progress(False, str(e))
        return {"ok": False, "failed_step": 3, "error": str(e), "results": results}

    # Step 4: VT01N Create Shipment + Tracking
    _set_step(4, "VT01N — Create Shipment + Tracking", "running")
    shipment_number = ""
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVT01N"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
        dismiss_popups()

        sess.findById("wnd[0]/usr/ctxtVTTK-TPLST").text = "0001"
        sess.findById("wnd[0]/usr/cmbVTTK-SHTYP").key = "Z002"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/tbar[1]/btn[6]").press()
        _wait_for_session(sess, 10)
        sess.findById("wnd[1]/usr/ctxtS_VSTEL-LOW").text = "KY01"
        sess.findById("wnd[1]/usr/ctxtS_VBELN-LOW").text = delivery
        sess.findById("wnd[1]/tbar[0]/btn[8]").press()
        _wait_for_session(sess, 15)

        sess.findById("wnd[0]/tbar[1]/btn[16]").press()
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/usr/tabsHEADER_TABSTRIP1/tabpTABS_OV_PR/ssubG_HEADER_SUBSCREEN1:SAPMV56A:1021/ctxtVTTK-EXTI1").text = tracking
        _wait_for_session(sess, 5)

        for btn_id in (
            "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STDIS",
            "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STREG",
            "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STLBG",
            "wnd[0]/usr/tabsHEADER_TABSTRIP2/tabpTABS_OV_DE/ssubG_HEADER_SUBSCREEN2:SAPMV56A:1025/btn*RV56A-ICON_STLAD",
        ):
            try:
                sess.findById(btn_id).press()
                _wait_for_session(sess, 5)
            except Exception:
                pass

        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)

        sbar4 = check_sbar()
        match = re.search(r"(\d{7,})", sbar4)
        if match:
            shipment_number = match.group(1)
        record_step(4, "VT01N Shipment", "ok", sbar4)
        if shipment_number:
            with _progress_lock:
                _shipment_progress["shipment_number"] = shipment_number
    except Exception as e:
        record_step(4, "VT01N Shipment", "error", str(e))
        _finalize_progress(False, str(e))
        return {"ok": False, "failed_step": 4, "error": str(e), "results": results}

    # Step 5: Pack CASE + Dimensions + Output
    _set_step(5, "VL02N — Pack CASE + Output", "running")
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVT02N"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 10)
        dismiss_popups()

        if shipment_number:
            try:
                sess.findById("wnd[0]/usr/ctxtVTTK-TKNUM").text = shipment_number
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 10)
            except Exception:
                pass

        sess.findById("wnd[0]/tbar[1]/btn[21]").press()
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6POS/ssubTAB:SAPLV51G:6010/tblSAPLV51GTC_HU_001/ctxtV51VE-VHILM[2,0]").text = "CASE"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS").select()
        _wait_for_session(sess, 5)

        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/tblSAPLV51GTC_HU_003").getAbsoluteRow(0).selected = True
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/tblSAPLV51GTC_HU_004").getAbsoluteRow(0).selected = True
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/tblSAPLV51GTC_HU_004/ctxtVEKPVB-EXIDV[0,0]").setFocus()
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/btn%#AUTOTEXT004").press()
        _wait_for_session(sess, 5)
        sess.findById("wnd[0]/usr/tabsTS_HU_VERP/tabpUE6HUS/ssubTAB:SAPLV51G:6020/btn%#AUTOTEXT011").press()
        _wait_for_session(sess, 5)

        det = "wnd[0]/usr/tabsTS_HU_DET/tabpDETVEKP/ssubTAB:SAPLV51G:6110"
        sess.findById(f"{det}/ctxtVEKPVB-GEWEI").text = "LB"
        sess.findById(f"{det}/ctxtVEKPVB-GEWEI_MAX").text = "LB"
        sess.findById(f"{det}/txtVEKPVB-NTGEW").text = ""
        sess.findById(f"{det}/txtVEKPVB-BRGEW").text = "10"
        sess.findById(f"{det}/txtVEKPVB-LAENG").text = "10"
        sess.findById(f"{det}/ctxtVEKPVB-MEABM").text = "IN"
        sess.findById(f"{det}/txtVEKPVB-BREIT").text = "10"
        sess.findById(f"{det}/txtVEKPVB-HOEHE").text = "4"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)

        # Output processing
        sess.findById("wnd[0]/tbar[1]/btn[18]").press()
        _wait_for_session(sess, 10)

        tbl = "wnd[0]/usr/tblSAPDV70ATC_NAST3"

        sess.findById(tbl).getAbsoluteRow(2).selected = True
        sess.findById(tbl).getAbsoluteRow(3).selected = True
        sess.findById("wnd[0]/tbar[1]/btn[6]").press()
        _wait_for_session(sess, 5)

        for copies in ("3", "4", "3"):
            sess.findById(tbl).getAbsoluteRow(2).selected = True
            sess.findById(tbl).getAbsoluteRow(4).selected = True
            sess.findById(tbl).getAbsoluteRow(7).selected = True
            sess.findById("wnd[0]/tbar[1]/btn[2]").press()
            _wait_for_session(sess, 5)
            sess.findById("wnd[0]/usr/ctxtNAST-LDEST").text = "PG44"
            sess.findById("wnd[0]/usr/txtNAST-ANZAL").text = copies
            sess.findById("wnd[0]/tbar[0]/btn[3]").press()
            _wait_for_session(sess, 5)

        sess.findById(tbl).getAbsoluteRow(7).selected = True
        sess.findById("wnd[0]/tbar[1]/btn[5]").press()
        _wait_for_session(sess, 5)
        sess.findById("wnd[0]/usr/cmbNAST-VSZTP").key = "4"
        sess.findById("wnd[0]/tbar[0]/btn[3]").press()
        _wait_for_session(sess, 5)

        sess.findById(tbl).getAbsoluteRow(2).selected = True
        sess.findById(tbl).getAbsoluteRow(4).selected = True
        sess.findById(tbl).getAbsoluteRow(7).selected = True
        sess.findById("wnd[0]/tbar[0]/btn[11]").press()
        _wait_for_session(sess, 15)

        record_step(5, "VL02N CASE+Output", "ok", check_sbar())
    except Exception as e:
        record_step(5, "VL02N CASE+Output", "error", str(e))
        _finalize_progress(False, str(e))
        return {"ok": False, "failed_step": 5, "error": str(e), "results": results}

    # Step 6: VL02N Tracking (BOLNR) + PGI
    _set_step(6, "VL02N — Post Goods Issue", "running")
    try:
        sess.findById("wnd[0]/tbar[0]/okcd").text = "/nVL02N"
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
        sess.findById("wnd[0]/usr/ctxtLIKP-VBELN").text = delivery
        sess.findById("wnd[0]").sendVKey(0)
        _wait_for_session(sess, 15)
        dismiss_popups()

        sess.findById("wnd[0]/tbar[1]/btn[8]").press()
        _wait_for_session(sess, 10)

        sess.findById("wnd[0]/usr/tabsTAXI_TABSTRIP_HEAD/tabpT\\04").select()
        _wait_for_session(sess, 5)
        sess.findById("wnd[0]/usr/tabsTAXI_TABSTRIP_HEAD/tabpT\\04/ssubSUBSCREEN_BODY:SAPMV50A:2108/txtLIKP-BOLNR").text = tracking
        _wait_for_session(sess, 5)

        sess.findById("wnd[0]/tbar[1]/btn[20]").press()
        _wait_for_session(sess, 20)

        sbar = check_sbar()
        record_step(6, "VL02N PGI", "ok", sbar)
        _log_sap_txn(delivery, "VL02N", "post_goods_issue", "success", f"PGI: {sbar}")
    except Exception as e:
        record_step(6, "VL02N PGI", "error", str(e))
        _finalize_progress(False, str(e))
        return {"ok": False, "failed_step": 6, "error": str(e), "results": results}

    _log_sap_txn(delivery, "ONE_CLICK_SHIP", "full_shipment", "success",
                 f"TO {to_number}, tracking {tracking}")
    _finalize_progress(True, "", shipment_number)
    return {"ok": True, "failed_step": 0, "error": "", "results": results, "shipment_number": shipment_number}


@app.post("/shutdown")
def shutdown_agent():
    def _die():
        time.sleep(1)
        os._exit(0)
    import threading
    threading.Thread(target=_die, daemon=True).start()
    return {"ok": True, "message": "shutting down"}


# ===========================================================================
#  Phase D #12 — Self-Recording Mode (v1.5.0)
# ===========================================================================
#
#  Captures every COM action a user performs in their open SAP GUI session,
#  persists the event stream to disk (encrypted at rest), and translates
#  it into a draft Python handler that follows existing OmniFrame
#  conventions (`@app.post`, `_with_retries`, `_classify_sbar`,
#  `_ack_save_warnings`, two-step / popup detection) plus a 1:1 VBS
#  replay for handing back to SAP admins.
#
#  Capture strategies (auto-fall-back chain):
#    1. **Hooks (preferred)** — `Connection.SetEvents("On")` makes
#       Session events fire on every user action. Subscribe via
#       `win32com.client.WithEvents()`. Most reliable on SAP GUI 7.50+.
#    2. **Polling (fallback)** — snapshot the GUI tree every 200ms and
#       diff with previous snapshot. Less precise (button presses are
#       inferred from screen + sbar transitions) but works on every
#       SAP/Citrix combination we've seen. Auto-stop after 30min.
#
#  Storage layout:
#    %LOCALAPPDATA%/OmniFrameAgent/recordings/<ts>-<uuid>.json.enc
#    %LOCALAPPDATA%/OmniFrameAgent/recordings/<ts>-<uuid>.meta.json (clear)
#
#  Encryption: AES-256-GCM. Key = SHA-256(agent_token + computer_name)[:32].
#  Key never written to disk; derived on demand from process state. Falls
#  back to plaintext write with a console warning if `cryptography` is
#  unavailable in the build (it's added to requirements.txt for v1.5.0).
# ===========================================================================


# Maximum recording duration / size — safety caps so a forgotten
# Record session doesn't fill the disk or hog COM forever.
RECORDING_MAX_DURATION_SEC = 30 * 60   # 30 minutes
RECORDING_MAX_BYTES = 50 * 1024 * 1024  # 50 MB
RECORDING_POLL_INTERVAL_SEC = 0.20
RECORDING_RETENTION_DAYS = 30


def _recordings_dir() -> str:
    """Per-user recordings folder. Lives next to the agent's install
    directory so `%LOCALAPPDATA%/OmniFrameAgent/recordings/` is the
    single source of truth. Created on first access."""
    base = os.path.join(os.getenv("LOCALAPPDATA") or os.getenv("APPDATA") or os.path.expanduser("~"),
                        "OmniFrameAgent", "recordings")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        pass
    return base


def _recording_key() -> bytes:
    """Derive the per-agent AES-256 key from `agent_token + computer_name`.

    Returns 32 raw bytes. When `agent_token` is empty (user hasn't logged in
    via /supabase/login yet) we still derive a key from machine_name alone
    — the key just isn't user-scoped in that case. Recordings created
    before login can still be read by the same machine after login.
    """
    secret = (state.agent_token or "") + "::" + (os.getenv("COMPUTERNAME") or socket.gethostname() or "")
    return hashlib.sha256(secret.encode("utf-8")).digest()


def _encrypt_recording(plaintext: bytes) -> tuple[bytes, str]:
    """Encrypt `plaintext` with AES-256-GCM. Returns (ciphertext, scheme).

    `scheme` is one of:
      - 'aes-256-gcm-v1' (12-byte nonce || ciphertext || 16-byte tag)
      - 'plaintext-v1'   (cryptography not available — written as-is)

    The scheme is stored in the sidecar `.meta.json` so decryption can
    pick the right code path later.
    """
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except Exception:
        return plaintext, "plaintext-v1"
    key = _recording_key()
    aes = AESGCM(key)
    nonce = secrets.token_bytes(12)
    ct = aes.encrypt(nonce, plaintext, associated_data=None)
    return nonce + ct, "aes-256-gcm-v1"


def _decrypt_recording(blob: bytes, scheme: str) -> bytes:
    """Inverse of `_encrypt_recording`. Raises on bad MAC / wrong key."""
    if scheme == "plaintext-v1":
        return blob
    if scheme == "aes-256-gcm-v1":
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = _recording_key()
        nonce, ct = blob[:12], blob[12:]
        return AESGCM(key).decrypt(nonce, ct, associated_data=None)
    raise ValueError(f"Unknown recording scheme: {scheme}")


def _purge_old_recordings():
    """Delete recordings older than `RECORDING_RETENTION_DAYS`. Best-effort."""
    cutoff = time.time() - (RECORDING_RETENTION_DAYS * 86400)
    base = _recordings_dir()
    try:
        for fn in os.listdir(base):
            full = os.path.join(base, fn)
            try:
                if os.path.isfile(full) and os.path.getmtime(full) < cutoff:
                    os.unlink(full)
            except Exception:
                continue
    except Exception:
        pass


# Noise filter for the *output* event stream. The raw stream keeps
# everything for debug; the translator and the UI's "events" tab use
# the filtered list. Standalone setFocus / caretPosition events that
# precede a real action add no information.
_RECORDING_NOISE_KINDS = frozenset({"set_focus", "caret_position"})


def _is_useful_event(ev: dict, prev_ev: Optional[dict]) -> bool:
    """Drop noise events from the translator-facing stream."""
    if ev.get("kind") in _RECORDING_NOISE_KINDS:
        return False
    # Drop sendVKey 0 immediately after a set_text on the same window —
    # SAP GUI fires both for the same physical Enter press.
    if (
        ev.get("kind") == "send_vkey"
        and ev.get("value") == 0
        and prev_ev is not None
        and prev_ev.get("kind") == "set_text"
        and prev_ev.get("wnd") == ev.get("wnd")
        and (ev.get("ts", 0) - prev_ev.get("ts", 0)) < 0.05
    ):
        return False
    return True


# ---------------------------------------------------------------------------
#  GUI snapshot helpers (used by polling capture + sanity checks)
# ---------------------------------------------------------------------------
_RECORDABLE_TYPES = (
    "GuiTextField",
    "GuiCTextField",       # context (LGPLA-style ctxt) fields
    "GuiPasswordField",
    "GuiTextEdit",
    "GuiCheckBox",
    "GuiRadioButton",
    "GuiComboBox",
)


def _snapshot_window(sess, wnd_idx: int) -> dict:
    """Walk every recordable control in `wnd[wnd_idx]` and return
    `{control_id: {type, value, label}}`. Skips unsupported types and
    swallows COM errors per-node so a single bad node doesn't break
    the whole snapshot."""
    out: dict[str, dict] = {}
    try:
        root = sess.findById(f"wnd[{wnd_idx}]")
    except Exception:
        return out

    def _walk(node, depth=0):
        if depth > 14:
            return
        try:
            t = getattr(node, "Type", "")
            cid = getattr(node, "Id", "")
        except Exception:
            return
        if t in _RECORDABLE_TYPES and cid:
            try:
                if t == "GuiCheckBox" or t == "GuiRadioButton":
                    val = bool(getattr(node, "Selected", False))
                elif t == "GuiComboBox":
                    val = str(getattr(node, "Key", "") or getattr(node, "Text", "") or "")
                else:
                    val = str(getattr(node, "Text", "") or "")
                label = ""
                try:
                    label = str(getattr(node, "Tooltip", "") or "")
                except Exception:
                    pass
                out[cid] = {"type": t, "value": val, "label": label}
            except Exception:
                pass
        try:
            children = node.Children
            n = children.Count
            for i in range(n):
                try:
                    _walk(children(i), depth + 1)
                except Exception:
                    continue
        except Exception:
            pass

    _walk(root)
    return out


def _capture_session_info(sess) -> dict:
    """Extract user-visible session info for the recording header."""
    try:
        info = sess.Info
        return {
            "system": str(getattr(info, "SystemName", "") or ""),
            "client": str(getattr(info, "Client", "") or ""),
            "user": str(getattr(info, "User", "") or ""),
            "language": str(getattr(info, "Language", "") or ""),
            "transaction": str(getattr(info, "Transaction", "") or ""),
            "program": str(getattr(info, "Program", "") or ""),
        }
    except Exception:
        return {}


def _capture_window_info(sess, wnd_idx: int = 0) -> dict:
    """Window title + status bar."""
    out: dict[str, str] = {}
    try:
        out["title"] = str(sess.findById(f"wnd[{wnd_idx}]").Text or "")
    except Exception:
        out["title"] = ""
    try:
        out["sbar"] = str(sess.findById(f"wnd[{wnd_idx}]/sbar").Text or "")
        out["sbar_type"] = str(getattr(sess.findById(f"wnd[{wnd_idx}]/sbar"), "MessageType", "") or "")
    except Exception:
        out["sbar"] = ""
        out["sbar_type"] = ""
    return out


# ---------------------------------------------------------------------------
#  Recorder state (single global session)
# ---------------------------------------------------------------------------
_RECORDING_LOCK = threading.Lock()


class _RecordingSession:
    """In-memory state for one active recording. Becomes a JSON document
    on stop. Only one session can be active at a time per agent."""

    def __init__(self, name: str, mode: str, sap_session_info: dict):
        self.id: str = f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
        self.name: str = name or f"Recording {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
        self.mode_requested: str = mode
        self.mode_used: str = mode  # may downgrade to 'polling' if hooks fail
        self.started_at: str = datetime.utcnow().isoformat() + "Z"
        self.started_perf: float = time.time()
        self.finished_at: Optional[str] = None
        self.sap_session_info: dict = sap_session_info
        self.events: list[dict] = []
        self.transactions: list[str] = []   # ordered list of unique tx codes
        self.status: str = "recording"      # recording|stopped|partial|error|aborted
        self.error: str = ""
        self.stop_event = threading.Event()
        self.poller_thread: Optional[threading.Thread] = None
        self.event_handler: Optional[Any] = None  # hooks-mode COM event sink

    def add_event(self, kind: str, **fields):
        ev = {
            "ts": round(time.time() - self.started_perf, 3),
            "kind": kind,
            **fields,
        }
        # Track transaction codes when we see them
        if kind == "transaction" and isinstance(fields.get("value"), str):
            tx = fields["value"].lstrip("/n").lstrip("/N").upper().strip()
            if tx and tx not in self.transactions:
                self.transactions.append(tx)
        # Honour the size cap
        approx = sum(len(json.dumps(e)) for e in self.events[-32:]) * (len(self.events) / 32 + 1)
        if approx > RECORDING_MAX_BYTES:
            self.error = f"recording exceeded {RECORDING_MAX_BYTES // (1024*1024)}MB cap"
            self.status = "partial"
            self.stop_event.set()
            return
        self.events.append(ev)

    def to_json(self) -> dict:
        return {
            "version": 1,
            "id": self.id,
            "name": self.name,
            "agent_version": AGENT_VERSION,
            "mode_requested": self.mode_requested,
            "mode_used": self.mode_used,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_ms": int((time.time() - self.started_perf) * 1000),
            "sap_session": self.sap_session_info,
            "transactions": self.transactions,
            "status": self.status,
            "error": self.error,
            "event_count": len(self.events),
            "events": self.events,
        }

    def meta_json(self) -> dict:
        """Sidecar metadata that lives unencrypted next to the .enc blob.
        Contains nothing sensitive — only what the UI needs to display the
        recording list without decrypting every file."""
        return {
            "id": self.id,
            "name": self.name,
            "agent_version": AGENT_VERSION,
            "mode_requested": self.mode_requested,
            "mode_used": self.mode_used,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration_ms": int((time.time() - self.started_perf) * 1000),
            "transactions": self.transactions,
            "event_count": len(self.events),
            "status": self.status,
            "encryption": "",  # filled in by _persist
            "size_bytes": 0,
        }


_active_recording: Optional[_RecordingSession] = None


def _persist_recording(rec: _RecordingSession) -> dict:
    """Encrypt + write the recording's events JSON and a sidecar meta file.
    Returns the sidecar dict (with encryption + size_bytes filled in)."""
    base = _recordings_dir()
    payload = json.dumps(rec.to_json(), separators=(",", ":")).encode("utf-8")
    blob, scheme = _encrypt_recording(payload)
    enc_path = os.path.join(base, f"{rec.id}.json.enc")
    meta_path = os.path.join(base, f"{rec.id}.meta.json")
    try:
        with open(enc_path, "wb") as f:
            f.write(blob)
        meta = rec.meta_json()
        meta["encryption"] = scheme
        meta["size_bytes"] = len(blob)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        return meta
    except Exception as e:
        print(f"[recorder] persist failed: {e}")
        return rec.meta_json()


def _load_recording(rec_id: str) -> dict:
    """Decrypt + return the full recording dict for a given id."""
    base = _recordings_dir()
    enc_path = os.path.join(base, f"{rec_id}.json.enc")
    meta_path = os.path.join(base, f"{rec_id}.meta.json")
    if not os.path.exists(enc_path):
        raise FileNotFoundError(f"recording '{rec_id}' not found")
    scheme = "aes-256-gcm-v1"
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                scheme = json.load(f).get("encryption") or scheme
        except Exception:
            pass
    with open(enc_path, "rb") as f:
        blob = f.read()
    pt = _decrypt_recording(blob, scheme)
    return json.loads(pt.decode("utf-8"))


def _list_recordings(limit: Optional[int] = None,
                     since_iso: Optional[str] = None) -> list[dict]:
    """Read every sidecar meta in the recordings dir, sorted newest first."""
    base = _recordings_dir()
    out = []
    try:
        for fn in os.listdir(base):
            if not fn.endswith(".meta.json"):
                continue
            full = os.path.join(base, fn)
            try:
                with open(full, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                if since_iso and meta.get("started_at", "") < since_iso:
                    continue
                out.append(meta)
            except Exception:
                continue
    except Exception:
        pass
    out.sort(key=lambda m: m.get("started_at", ""), reverse=True)
    if limit:
        out = out[:limit]
    return out


def _delete_recording(rec_id: str) -> bool:
    base = _recordings_dir()
    ok = False
    for suffix in (".json.enc", ".meta.json"):
        p = os.path.join(base, f"{rec_id}{suffix}")
        try:
            if os.path.exists(p):
                os.unlink(p)
                ok = True
        except Exception:
            pass
    return ok


# ---------------------------------------------------------------------------
#  Polling-based capture (always available, robust)
# ---------------------------------------------------------------------------
def _polling_capture_loop(rec: _RecordingSession):
    """Background thread that polls the SAP GUI tree every 200ms, diffs
    against the previous snapshot, and emits synthetic events for any
    detected change. Best-effort: COM errors are swallowed and reported
    as 'partial' status if they break capture entirely."""
    pythoncom_err = None
    try:
        import pythoncom
        pythoncom.CoInitialize()
    except Exception as e:
        pythoncom_err = e

    last_snapshots: dict[int, dict] = {}
    last_window_info: dict[int, dict] = {}
    last_okcd: str = ""
    last_active_wnd: int = 0
    consecutive_errors = 0

    while not rec.stop_event.is_set():
        # Honour duration cap
        if time.time() - rec.started_perf > RECORDING_MAX_DURATION_SEC:
            rec.error = f"auto-stopped after {RECORDING_MAX_DURATION_SEC // 60} minutes"
            rec.status = "partial"
            rec.stop_event.set()
            break

        try:
            sess, _ = _get_sap_session()
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors > 30:  # ~6 seconds of nothing
                rec.error = f"SAP session lost: {e}"
                rec.status = "partial"
                rec.stop_event.set()
                break
            time.sleep(RECORDING_POLL_INTERVAL_SEC)
            continue
        consecutive_errors = 0

        # Snapshot wnd[0]..wnd[3]
        for wnd_idx in range(4):
            try:
                snap = _snapshot_window(sess, wnd_idx)
            except Exception:
                continue
            if not snap and wnd_idx > 0:
                # Window doesn't exist — if we previously saw it, emit popup_close
                if wnd_idx in last_snapshots:
                    rec.add_event("popup_close", wnd=wnd_idx)
                    last_snapshots.pop(wnd_idx, None)
                    last_window_info.pop(wnd_idx, None)
                continue

            prev = last_snapshots.get(wnd_idx)
            if prev is None:
                # First time we see this window
                if wnd_idx > 0:
                    info = _capture_window_info(sess, wnd_idx)
                    rec.add_event("popup_open", wnd=wnd_idx,
                                  title=info.get("title", ""))
                last_snapshots[wnd_idx] = snap
                last_window_info[wnd_idx] = _capture_window_info(sess, wnd_idx)
                continue

            # Diff text/checkbox values
            for cid, cur in snap.items():
                old = prev.get(cid)
                if old is None:
                    continue
                if cur["value"] != old["value"]:
                    kind = "set_text"
                    if cur["type"] in ("GuiCheckBox", "GuiRadioButton"):
                        kind = "selected"
                    elif cur["type"] == "GuiComboBox":
                        kind = "select_dropdown"
                    rec.add_event(
                        kind,
                        target=cid,
                        value=cur["value"],
                        prev_value=old["value"],
                        wnd=wnd_idx,
                        control_type=cur["type"],
                        label=cur.get("label", ""),
                    )
            last_snapshots[wnd_idx] = snap

            # Detect okcd change → transaction event
            if wnd_idx == 0:
                okcd_val = snap.get("wnd[0]/tbar[0]/okcd", {}).get("value", "")
                if okcd_val and okcd_val != last_okcd:
                    rec.add_event("transaction", value=okcd_val, wnd=0)
                    last_okcd = okcd_val

            # Detect window-info change → screen / sbar event
            cur_info = _capture_window_info(sess, wnd_idx)
            old_info = last_window_info.get(wnd_idx, {})
            if cur_info.get("title") != old_info.get("title"):
                rec.add_event("screen_change", wnd=wnd_idx,
                              title=cur_info.get("title", ""),
                              prev_title=old_info.get("title", ""))
                # A title change without any preceding set_text is a strong
                # signal that the user pressed Enter (sendVKey 0) or a
                # function-key button. Emit a synthetic 'inferred_action'
                # so the translator knows to wrap navigation here.
                rec.add_event("inferred_action", wnd=wnd_idx,
                              hint="vkey0_or_button_press",
                              new_title=cur_info.get("title", ""))
            if cur_info.get("sbar") and cur_info.get("sbar") != old_info.get("sbar", ""):
                rec.add_event("sbar", wnd=wnd_idx,
                              text=cur_info.get("sbar", ""),
                              msg_type=cur_info.get("sbar_type", ""))
            last_window_info[wnd_idx] = cur_info

        time.sleep(RECORDING_POLL_INTERVAL_SEC)

    if pythoncom_err is None:
        try:
            import pythoncom
            pythoncom.CoUninitialize()
        except Exception:
            pass


# ---------------------------------------------------------------------------
#  Hooks-based capture (preferred when SAP scripting events are reliable)
# ---------------------------------------------------------------------------
def _try_start_hooks_capture(rec: _RecordingSession) -> bool:
    """Best-effort wrapper that enables COM event firing on the SAP
    Application object and hooks `OnHit` / `OnRecord` events to feed
    the recorder. Returns True if hooks engaged, False otherwise.

    pywin32's `WithEvents` requires the source object to expose a
    typelib-described event interface — SAP GUI's `Application` object
    exposes one but the events fire only if `Application.Record = True`
    is set. We try to flip the flag and subscribe; on any COM error
    we return False so the caller can fall back to polling.
    """
    try:
        w32 = _init_com()
        sap_gui = w32.GetObject("SAPGUI")
        sap_app = sap_gui.GetScriptingEngine

        class _SapEventSink:
            def OnHit(self, control, name, value):
                try:
                    rec.add_event(
                        "hooked",
                        kind_hint=str(name or ""),
                        target=str(getattr(control, "Id", "") or ""),
                        value=str(value or ""),
                        wnd=0,
                    )
                except Exception:
                    pass

            def OnRecord(self, action_text):
                try:
                    rec.add_event("hooked_record",
                                  text=str(action_text or ""))
                except Exception:
                    pass

        # Enable record mode + bind the event handler. Either step may
        # raise; in that case we cleanly fall back to polling.
        try:
            sap_app.Record = True
        except Exception:
            pass
        try:
            handler = w32.WithEvents(sap_app, _SapEventSink)
        except Exception:
            return False
        rec.event_handler = handler
        return True
    except Exception as e:
        print(f"[recorder] hooks init failed: {e} — falling back to polling")
        return False


def _stop_hooks_capture(rec: _RecordingSession):
    try:
        w32 = _init_com()
        sap_gui = w32.GetObject("SAPGUI")
        sap_app = sap_gui.GetScriptingEngine
        try:
            sap_app.Record = False
        except Exception:
            pass
    except Exception:
        pass
    rec.event_handler = None


# ---------------------------------------------------------------------------
#  Recording lifecycle
# ---------------------------------------------------------------------------
def _start_recording_session(name: str, mode: str) -> _RecordingSession:
    global _active_recording
    with _RECORDING_LOCK:
        if _active_recording is not None and _active_recording.status == "recording":
            raise RuntimeError("a recording is already in progress — stop it first")
        if not state.sap_connected:
            raise RuntimeError("SAP not connected — click SAP Connect first")
        try:
            sess, _ = _get_sap_session()
            sap_info = _capture_session_info(sess)
        except Exception as e:
            raise RuntimeError(f"could not attach to SAP session: {e}")

        rec = _RecordingSession(name=name, mode=(mode or "hooks"),
                                sap_session_info=sap_info)
        _active_recording = rec

        used_hooks = False
        if rec.mode_requested == "hooks":
            used_hooks = _try_start_hooks_capture(rec)
        rec.mode_used = "hooks+polling" if used_hooks else "polling"

        # Always start polling — even with hooks engaged, the polling
        # loop captures inferred screen-change / sbar events the hooks
        # don't surface, and provides the safety net if hooks die.
        rec.poller_thread = threading.Thread(
            target=_polling_capture_loop, args=(rec,), daemon=True
        )
        rec.poller_thread.start()
        rec.add_event("recording_start",
                      mode_used=rec.mode_used,
                      sap_session=sap_info)
        print(f"[recorder] started '{rec.name}' (id={rec.id}, mode={rec.mode_used})")
        return rec


def _stop_recording_session() -> _RecordingSession:
    global _active_recording
    with _RECORDING_LOCK:
        rec = _active_recording
        if rec is None:
            raise RuntimeError("no active recording")
        rec.stop_event.set()
        if rec.poller_thread:
            rec.poller_thread.join(timeout=3.0)
        _stop_hooks_capture(rec)
        rec.finished_at = datetime.utcnow().isoformat() + "Z"
        if rec.status == "recording":
            rec.status = "stopped"
        rec.add_event("recording_stop", status=rec.status)
        _persist_recording(rec)
        _active_recording = None
        print(f"[recorder] stopped '{rec.name}' "
              f"({len(rec.events)} events, {rec.status})")
        return rec


# ---------------------------------------------------------------------------
#  Translator — events → idiomatic Python handler + 1:1 VBS replay
# ---------------------------------------------------------------------------
# Maps SAP function-key codes to a comment shown in generated Python.
_VKEY_LABELS = {
    0: "Enter",
    1: "F1",
    2: "F2 (Choose)",
    3: "F3 (Back)",
    4: "F4 (Possible Entries)",
    5: "F5 (Enter values)",
    7: "F7",
    8: "F8 (Execute)",
    11: "Ctrl+S (Save)",
    12: "Esc",
    15: "Shift+F3 (Exit)",
    16: "Shift+F4",
    20: "Shift+F8",
}


def _slugify_handler_name(name: str) -> str:
    """Normalise a user-supplied handler name to a Python identifier."""
    s = (name or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    if not s:
        s = "recording"
    if s[0].isdigit():
        s = "h_" + s
    return s


def _infer_field_type(value: str) -> str:
    """Heuristic type for a Pydantic field given the captured value."""
    v = (value or "").strip()
    if not v:
        return "Optional[str]"
    if v.lower() in ("true", "false", "x", "1", "0"):
        return "bool"
    # Numeric but might have leading zeros (material/bin codes) → str
    if re.fullmatch(r"\d+", v) and v.startswith("0"):
        return "str"
    if re.fullmatch(r"-?\d+", v):
        return "int"
    if re.fullmatch(r"-?\d+\.\d+", v):
        return "float"
    return "str"


def _humanise_field_label(target_id: str, label_hint: str) -> str:
    """Pick a friendly Python identifier for a captured field.

    Strategy: take the last `-` segment of the SAP field id (e.g.
    `LTAK-LGNUM` → `lgnum`). Optionally use the tooltip `label_hint`
    if it's short and clean.
    """
    last = target_id.split("/")[-1]
    # Strip type prefix (ctxt, txt, chk, cmb...)
    for prefix in ("ctxt", "txt", "chk", "cmb", "btn", "rad"):
        if last.startswith(prefix):
            last = last[len(prefix):]
            break
    last = last.split("-")[-1].lower()
    last = re.sub(r"[^a-z0-9_]", "_", last).strip("_")
    if not last:
        last = "field"
    return last


# Mapping: SAP transaction code → suggested handler "kind" hint.
# Used by the confidence-scorer to flag mismatches.
_KNOWN_QUERY_TX = {"LT10", "LT24", "MB52", "MMBE", "LX03", "LX02"}


class _Translation:
    def __init__(self):
        self.python: str = ""
        self.vbs: str = ""
        self.request_model: dict = {}
        self.confidence: float = 0.0
        self.warnings: list[str] = []
        self.detected: dict = {
            "inputs": 0,
            "popups": 0,
            "soft_warnings": 0,
            "two_step": False,
            "transactions": [],
            "save_pressed": False,
            "kind": "unknown",
        }


def _translate_recording(rec_doc: dict, *, name: str, kind: str,
                         input_overrides: Optional[dict] = None) -> _Translation:
    """Analyse a recorded event stream and emit Python + VBS plus a
    confidence rating. `kind` is 'query' or 'mutation'. `input_overrides`
    lets the UI rename / re-type fields before generation.
    """
    overrides = input_overrides or {}
    events: list[dict] = rec_doc.get("events", [])

    # First pass: filter noise + segment into ordered "actions".
    filtered: list[dict] = []
    prev: Optional[dict] = None
    for e in events:
        if not _is_useful_event(e, prev):
            continue
        filtered.append(e)
        prev = e

    # Detect inputs (each set_text on a unique target → one variable)
    seen_inputs: "OrderedDict[str, dict]" = OrderedDict()
    save_pressed = False
    has_two_step = False
    sbar_messages: list[str] = []
    popup_count = 0
    soft_warning_hits = 0

    def _matches_soft_warning(text: str) -> bool:
        t = text.lower()
        return any(k in t for k in SAP_SOFT_WARNINGS.keys())

    for e in filtered:
        k = e.get("kind")
        if k == "set_text" and e.get("target"):
            tid = e["target"]
            seen_inputs.setdefault(tid, {
                "target": tid,
                "wnd": e.get("wnd", 0),
                "value": e.get("value", ""),
                "label": e.get("label", ""),
                "control_type": e.get("control_type", ""),
            })
            seen_inputs[tid]["value"] = e.get("value", "")
        elif k == "selected":
            tid = e.get("target", "")
            seen_inputs.setdefault(tid, {
                "target": tid,
                "wnd": e.get("wnd", 0),
                "value": e.get("value", ""),
                "label": e.get("label", ""),
                "control_type": e.get("control_type", "GuiCheckBox"),
            })
            seen_inputs[tid]["value"] = e.get("value", "")
        elif k == "press" and "btn[11]" in str(e.get("target", "")):
            save_pressed = True
        elif k == "popup_open":
            popup_count += 1
        elif k == "sbar":
            txt = str(e.get("text", "") or "")
            sbar_messages.append(txt)
            if _matches_soft_warning(txt):
                soft_warning_hits += 1
            if any(kw in txt.lower() for kw in _TWO_STEP_KEYWORDS):
                has_two_step = True

    # If no explicit Save event captured but the user clearly performed
    # a mutation (kind='mutation' override), trust the override.
    if kind == "mutation" and not save_pressed:
        # Look for inferred_action right after a set_text with no following
        # screen change — best-effort signal.
        for e in filtered:
            if e.get("kind") == "press" and "btn[" in str(e.get("target", "")):
                save_pressed = True
                break

    # Merge user-provided input metadata
    inputs_meta: list[dict] = []
    for idx, (tid, meta) in enumerate(seen_inputs.items()):
        ovr = overrides.get(tid) or {}
        py_name = ovr.get("name") or _humanise_field_label(tid, meta.get("label", ""))
        # Avoid collisions
        existing = {m["py_name"] for m in inputs_meta}
        candidate = py_name
        i = 2
        while candidate in existing:
            candidate = f"{py_name}_{i}"
            i += 1
        py_type = ovr.get("type") or _infer_field_type(meta.get("value", ""))
        required = bool(ovr.get("required", True))
        inputs_meta.append({
            "py_name": candidate,
            "py_type": py_type,
            "required": required,
            "default": ovr.get("default", meta.get("value", "")),
            "target": tid,
            "wnd": meta.get("wnd", 0),
            "label": meta.get("label", ""),
            "control_type": meta.get("control_type", ""),
            "captured_value": meta.get("value", ""),
        })

    # Build Python code
    handler_name = _slugify_handler_name(name)
    transactions = list(rec_doc.get("transactions") or [])
    primary_tx = transactions[0] if transactions else "UNKNOWN"

    py = _emit_python(
        rec_doc, filtered, inputs_meta,
        handler_name=handler_name,
        primary_tx=primary_tx,
        kind=kind,
        save_pressed=save_pressed,
        has_two_step=has_two_step,
        popup_count=popup_count,
        soft_warning_hits=soft_warning_hits,
    )
    vbs = _emit_vbs(events)

    # Confidence scoring — the user wants a single "I trust this" number.
    score = 0.6
    if inputs_meta:
        score += 0.1
    if save_pressed or kind == "query":
        score += 0.1
    if popup_count == 0 or popup_count <= 2:
        score += 0.05
    if soft_warning_hits > 0:
        score += 0.05  # we *handled* it via _ack_save_warnings
    if has_two_step:
        score += 0.05
    if kind == "query" and primary_tx in _KNOWN_QUERY_TX:
        score += 0.05
    if rec_doc.get("status") == "partial":
        score -= 0.2
    score = max(0.05, min(0.99, score))

    warnings: list[str] = []
    if rec_doc.get("status") == "partial":
        warnings.append("Recording status is 'partial' — some events may be missing.")
    if not inputs_meta:
        warnings.append("No user-input fields detected. Generated handler takes no parameters.")
    if popup_count > 2:
        warnings.append(f"{popup_count} popups detected — review the generated popup-handling block.")
    if has_two_step:
        warnings.append("Two-step confirmation pattern detected — added extra Enter step.")
    if kind == "mutation" and not save_pressed:
        warnings.append("Marked as mutation but no Save (btn[11]) was recorded — confirm the handler still posts.")
    if kind == "query" and save_pressed:
        warnings.append("Marked as query but a Save (btn[11]) was recorded — re-check the kind override.")

    t = _Translation()
    t.python = py
    t.vbs = vbs
    t.request_model = {
        "name": f"{handler_name.title().replace('_', '')}Request",
        "fields": inputs_meta,
        "kind": kind,
        "transaction": primary_tx,
    }
    t.confidence = round(score, 3)
    t.warnings = warnings
    t.detected = {
        "inputs": len(inputs_meta),
        "popups": popup_count,
        "soft_warnings": soft_warning_hits,
        "two_step": has_two_step,
        "transactions": transactions,
        "save_pressed": save_pressed,
        "kind": kind,
    }
    return t


def _emit_vbs(events: list[dict]) -> str:
    """1:1 VBS replay — exactly mirrors the recorded event stream so the
    user can hand it to a SAP admin or paste into SAP's "Run Script" UI."""
    lines = [
        'If Not IsObject(application) Then',
        '   Set SapGuiAuto  = GetObject("SAPGUI")',
        '   Set application = SapGuiAuto.GetScriptingEngine',
        'End If',
        'If Not IsObject(connection) Then',
        '   Set connection = application.Children(0)',
        'End If',
        'If Not IsObject(session) Then',
        '   Set session    = connection.Children(0)',
        'End If',
        'If IsObject(WScript) Then',
        '   WScript.ConnectObject session,     "on"',
        '   WScript.ConnectObject application, "on"',
        'End If',
    ]
    for e in events:
        k = e.get("kind")
        if k == "transaction":
            lines.append(f'session.findById("wnd[0]/tbar[0]/okcd").text = "{e.get("value", "")}"')
            lines.append('session.findById("wnd[0]").sendVKey 0')
        elif k == "set_text":
            tid = e.get("target", "")
            val = str(e.get("value", "")).replace('"', '""')
            lines.append(f'session.findById("{tid}").text = "{val}"')
        elif k == "selected":
            tid = e.get("target", "")
            val = "True" if str(e.get("value", "")).lower() in ("true", "1", "x") else "False"
            lines.append(f'session.findById("{tid}").selected = {val.lower()}')
        elif k == "select_dropdown":
            tid = e.get("target", "")
            val = str(e.get("value", "")).replace('"', '""')
            lines.append(f'session.findById("{tid}").key = "{val}"')
        elif k == "press":
            tid = e.get("target", "")
            lines.append(f'session.findById("{tid}").press')
        elif k == "send_vkey":
            wnd = e.get("wnd", 0)
            lines.append(f'session.findById("wnd[{wnd}]").sendVKey {int(e.get("value", 0))}')
        elif k == "set_focus":
            tid = e.get("target", "")
            lines.append(f'session.findById("{tid}").setFocus')
        elif k == "caret_position":
            tid = e.get("target", "")
            lines.append(f'session.findById("{tid}").caretPosition = {int(e.get("value", 0))}')
        elif k == "inferred_action":
            # Best-guess that the user pressed Enter
            lines.append('session.findById("wnd[0]").sendVKey 0  \' inferred')
    return "\n".join(lines) + "\n"


def _emit_python(rec_doc: dict, events: list[dict], inputs_meta: list[dict],
                 *, handler_name: str, primary_tx: str, kind: str,
                 save_pressed: bool, has_two_step: bool,
                 popup_count: int, soft_warning_hits: int) -> str:
    """Generate idiomatic OmniFrame Python following the same style as
    the existing handlers. The output is deterministic so users can diff
    translations between sessions.
    """
    transactions = rec_doc.get("transactions") or [primary_tx]
    sap_session = rec_doc.get("sap_session", {})

    is_mutation = (kind == "mutation")

    out: list[str] = []
    out.append("# " + "-" * 73)
    out.append(f"# Generated by OmniFrame Self-Recording Mode (v{rec_doc.get('agent_version', AGENT_VERSION)})")
    out.append(f"# Recording: {rec_doc.get('name', '')} (id={rec_doc.get('id', '')})")
    out.append(f"# Captured:  {rec_doc.get('started_at', '')}")
    out.append(f"# Mode:      {rec_doc.get('mode_used', '')}")
    out.append(f"# Tx codes:  {', '.join(transactions)}")
    if sap_session:
        out.append(f"# SAP:       sys={sap_session.get('system')} client={sap_session.get('client')} user={sap_session.get('user')}")
    out.append(f"# Events:    {rec_doc.get('event_count', 0)} raw, {len(events)} after noise filter")
    out.append("# " + "-" * 73)
    out.append("")

    # Pydantic request model (mutations only)
    if is_mutation:
        model_name = f"{handler_name.title().replace('_', '')}Request"
        out.append(f"class {model_name}(BaseModel):")
        out.append(f'    """Request body for /sap/{handler_name.replace("_", "-")} ({primary_tx}).')
        out.append("")
        out.append("    Generated from a recorded SAP session — adjust field names / types")
        out.append("    where the auto-inference picked something awkward.")
        out.append('    """')
        if not inputs_meta:
            out.append("    pass")
        for f in inputs_meta:
            t = f["py_type"]
            opt_marker = "Optional[" in t
            default = ""
            if not f["required"] or opt_marker:
                default = " = None"
            elif f["captured_value"]:
                lit = repr(f["captured_value"])
                default = f" = {lit}  # captured value (default — pass to override)"
            out.append(f'    {f["py_name"]}: {t}{default}')
        out.append("")
        out.append("")
        out.append(f'@app.post("/sap/{handler_name.replace("_", "-")}")')
        out.append(f'@_track_metric("{handler_name}")')
        out.append(f"def {handler_name}(req: {model_name}) -> dict:")
        out.append(f'    """Generated handler — runs {primary_tx} as recorded.')
        out.append("")
        out.append("    Steps reconstructed from the event stream (newest user action last):")
        for line in _summarise_steps(events)[:8]:
            out.append(f"      {line}")
        out.append('    """')
        out.append("    if not state.sap_connected:")
        out.append('        return {"ok": False, "error": "SAP not connected"}')
        out.append("")
        out.append("    try:")
        out.append("        sess, _ = _get_sap_session()")
        out.append("")
        out.extend(_emit_python_body(events, inputs_meta, primary_tx,
                                     save_pressed=save_pressed,
                                     has_two_step=has_two_step,
                                     popup_count=popup_count,
                                     soft_warning_hits=soft_warning_hits,
                                     indent="        "))
        out.append("    except Exception as e:")
        out.append(f'        _log_sap_txn("", "{primary_tx}", "{handler_name}", "error", str(e))')
        out.append('        return {"ok": False, "error": str(e)}')
    else:
        # Read-only handler — registered in QUERY_HANDLERS
        out.append(f"def handler_{handler_name}(sess, params: dict) -> dict:")
        out.append(f'    """Generated query handler for {primary_tx}.')
        out.append("")
        out.append("    Register by adding to QUERY_HANDLERS:")
        out.append(f'        QUERY_HANDLERS["{handler_name}"] = handler_{handler_name}')
        out.append("")
        out.append("    Steps reconstructed from the event stream:")
        for line in _summarise_steps(events)[:8]:
            out.append(f"      {line}")
        out.append('    """')
        # Pull params (uses the same inputs_meta as the mutation form)
        for f in inputs_meta:
            out.append(f'    {f["py_name"]} = str(params.get("{f["py_name"]}", "")).strip()')
            if f["required"]:
                out.append(f'    if not {f["py_name"]}:')
                out.append(f'        raise Exception("{f["py_name"]} is required")')
        out.append("")
        out.extend(_emit_python_body(events, inputs_meta, primary_tx,
                                     save_pressed=False,
                                     has_two_step=False,
                                     popup_count=popup_count,
                                     soft_warning_hits=0,
                                     indent="    "))
        out.append("    # Step: scrape the result grid")
        out.append("    result = _extract_alv_grid(sess)")
        out.append("    if not result.get('rows'):")
        out.append("        result = _extract_sap_list_output(sess)")
        out.append("    result['meta'] = {")
        out.append(f'        "transaction": "{primary_tx}",')
        for f in inputs_meta:
            out.append(f'        "{f["py_name"]}": {f["py_name"]},')
        out.append("    }")
        out.append("    return result")
        out.append("")
        out.append("")
        out.append("# Registry registration line — append to QUERY_HANDLERS dict in agent.py:")
        out.append(f'#   "{handler_name}": handler_{handler_name},')
    out.append("")
    return "\n".join(out)


def _summarise_steps(events: list[dict]) -> list[str]:
    """Compact human-readable summary of the captured event stream
    used in the generated handler's docstring."""
    out: list[str] = []
    step_no = 0
    for e in events:
        k = e.get("kind")
        if k == "transaction":
            step_no += 1
            out.append(f"{step_no}. /n{e.get('value', '')} — open transaction")
        elif k == "set_text" and e.get("target"):
            label = e.get("target", "").split("/")[-1]
            out.append(f"   • set {label} = {e.get('value', '')!r}")
        elif k == "selected":
            label = e.get("target", "").split("/")[-1]
            out.append(f"   • toggle {label} = {e.get('value', '')}")
        elif k == "press":
            out.append(f"   • press {e.get('target', '')}")
        elif k == "send_vkey":
            label = _VKEY_LABELS.get(int(e.get("value", 0)), f"VKey {e.get('value', 0)}")
            out.append(f"   • {label}")
        elif k == "popup_open":
            out.append(f"   • popup opened: {e.get('title', '')!r}")
        elif k == "sbar":
            txt = str(e.get("text", "") or "")
            if txt:
                out.append(f"   • sbar: {txt[:80]}")
    if not out:
        out.append("(no actionable events captured)")
    return out


def _emit_python_body(events: list[dict], inputs_meta: list[dict],
                      primary_tx: str, *, save_pressed: bool,
                      has_two_step: bool, popup_count: int,
                      soft_warning_hits: int, indent: str) -> list[str]:
    """Emit the body of the generated handler, replacing captured literal
    values with `req.<field>` references where they correspond to a
    detected user input.
    """
    by_target = {f["target"]: f for f in inputs_meta}

    def _value_ref(target: str, captured: str) -> str:
        f = by_target.get(target)
        if f is None:
            return repr(captured)
        if f.get("py_type", "str").startswith("Optional"):
            return f"(req.{f['py_name']} or '')"
        if f.get("py_type") == "str":
            return f"req.{f['py_name']}"
        return f"str(req.{f['py_name']})"

    lines: list[str] = []
    seen_first_tx = False
    last_tx_open: Optional[str] = None
    pending_save = False
    have_emitted_action = False

    def _emit(line: str):
        lines.append(f"{indent}{line}")

    for e in events:
        k = e.get("kind")
        if k == "transaction":
            tx = str(e.get("value", "")).strip()
            if tx:
                # Emit retry-wrapped open
                if seen_first_tx:
                    _emit("")
                seen_first_tx = True
                fn_name = f"_open_{tx.lstrip('/n').lstrip('/N').lower() or 'tx'}"
                _emit(f"# Step: open transaction {tx}")
                _emit(f"def {fn_name}():")
                _emit(f'    sess.findById("wnd[0]/tbar[0]/okcd").text = "{tx}"')
                _emit('    sess.findById("wnd[0]").sendVKey(0)')
                _emit("    _wait_for_session(sess, 15)")
                _emit(f'_with_retries({fn_name}, label="{tx} open")')
                last_tx_open = tx
                have_emitted_action = True
        elif k == "set_text":
            tid = e.get("target", "")
            val_ref = _value_ref(tid, e.get("value", ""))
            wnd = e.get("wnd", 0)
            _emit(f'sess.findById("{tid}").text = {val_ref}')
            have_emitted_action = True
        elif k == "selected":
            tid = e.get("target", "")
            f = by_target.get(tid)
            if f and f.get("py_type") == "bool":
                _emit(f'sess.findById("{tid}").selected = bool(req.{f["py_name"]})')
            else:
                val = "True" if str(e.get("value", "")).lower() in ("true", "1", "x") else "False"
                _emit(f'sess.findById("{tid}").selected = {val}')
            have_emitted_action = True
        elif k == "select_dropdown":
            tid = e.get("target", "")
            val_ref = _value_ref(tid, e.get("value", ""))
            _emit(f'sess.findById("{tid}").key = {val_ref}')
            have_emitted_action = True
        elif k == "send_vkey":
            wnd = e.get("wnd", 0)
            v = int(e.get("value", 0))
            note = _VKEY_LABELS.get(v, "")
            comment = f"  # {note}" if note else ""
            _emit(f'sess.findById("wnd[{wnd}]").sendVKey({v}){comment}')
            _emit("_wait_for_session(sess, 15)")
            have_emitted_action = True
        elif k == "press":
            tid = e.get("target", "")
            if "btn[11]" in tid:
                pending_save = True
                _emit("")
                _emit("# Save — wrap in soft-warning ack so SAP advisories don't")
                _emit("# block the commit. Do NOT wrap btn[11] in _with_retries —")
                _emit("# a retry after a partial commit could double-post.")
                _emit(f'sess.findById("{tid}").press()')
                _emit("_wait_for_session(sess, 25)")
                if has_two_step:
                    _emit("")
                    _emit("# Two-step confirm detected during recording — extra Enter")
                    _emit("# acknowledges the second leg before SAP commits.")
                    _emit('sess.findById("wnd[0]").sendVKey(0)')
                    _emit("_wait_for_session(sess, 15)")
                _emit("sbar, msg_type = _ack_save_warnings(sess)")
                _emit('if msg_type in ("E", "A"):')
                _emit(f'    _log_sap_txn("", "{primary_tx}", "{primary_tx.lower()}", "error", sbar)')
                _emit('    return {"ok": False, "error": sbar}')
                _emit(f'_log_sap_txn("", "{primary_tx}", "{primary_tx.lower()}", "success", sbar)')
                _emit('return {"ok": True, "message": sbar}')
            else:
                _emit(f'sess.findById("{tid}").press()')
                _emit("_wait_for_session(sess, 15)")
                have_emitted_action = True
        elif k == "popup_open":
            wnd = e.get("wnd", 1)
            title = str(e.get("title", "")).replace('"', '\\"')
            _emit("")
            _emit(f"# Popup detected: {title!r}")
            _emit(f"# Acknowledge with Enter — change to btnSPOP-OPTION1 for Yes/No popups.")
            _emit(f'try:')
            _emit(f'    sess.findById("wnd[{wnd}]").sendVKey(0)')
            _emit(f'except Exception:')
            _emit(f'    pass')
        elif k == "sbar":
            txt = str(e.get("text", "") or "")
            if txt:
                _emit(f'# sbar: {txt[:80]}  # TODO: review — was this an expected message?')

    if not have_emitted_action:
        _emit('# TODO: review — no actionable events were emitted.')

    if not save_pressed and inputs_meta:
        _emit("")
        _emit("# Read-only flow — no Save was pressed during recording.")
        _emit('# return {"ok": True, "message": "navigation completed"}')

    return lines


# ---------------------------------------------------------------------------
#  Recording API endpoints
# ---------------------------------------------------------------------------
class RecordingStartRequest(BaseModel):
    name: Optional[str] = None
    mode: Optional[str] = "hooks"   # 'hooks' | 'polling'


class RecordingTranslateRequest(BaseModel):
    name: str
    kind: str = "mutation"          # 'query' | 'mutation'
    input_overrides: Optional[dict] = None


@app.post("/sap/recording/start")
@_track_metric("recording_start")
def recording_start(req: RecordingStartRequest) -> dict:
    try:
        rec = _start_recording_session(name=req.name or "", mode=req.mode or "hooks")
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"unexpected: {e}"}
    return {
        "ok": True,
        "recording_id": rec.id,
        "name": rec.name,
        "mode_used": rec.mode_used,
        "session_info": rec.sap_session_info,
        "started_at": rec.started_at,
    }


@app.post("/sap/recording/stop")
@_track_metric("recording_stop")
def recording_stop() -> dict:
    try:
        rec = _stop_recording_session()
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": f"unexpected: {e}"}
    doc = rec.to_json()
    return {
        "ok": True,
        "recording_id": rec.id,
        "name": rec.name,
        "status": rec.status,
        "events": doc["events"],
        "event_count": doc["event_count"],
        "duration_ms": doc["duration_ms"],
        "transactions": doc["transactions"],
        "sap_session": doc["sap_session"],
        "mode_used": doc["mode_used"],
    }


@app.get("/sap/recording/status")
def recording_status() -> dict:
    """Polled by the UI while a recording is active to render the live
    event-count + elapsed-time pulse on the Record button."""
    rec = _active_recording
    if rec is None or rec.status != "recording":
        return {"ok": True, "active": False}
    return {
        "ok": True,
        "active": True,
        "recording_id": rec.id,
        "name": rec.name,
        "mode_used": rec.mode_used,
        "started_at": rec.started_at,
        "event_count": len(rec.events),
        "transactions": list(rec.transactions),
        "duration_ms": int((time.time() - rec.started_perf) * 1000),
    }


@app.get("/sap/recording/list")
def recording_list(limit: int = 50, since: str = "") -> dict:
    _purge_old_recordings()
    items = _list_recordings(limit=limit, since_iso=since or None)
    return {"ok": True, "items": items, "count": len(items)}


@app.get("/sap/recording/{rec_id}")
def recording_get(rec_id: str) -> dict:
    try:
        doc = _load_recording(rec_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="recording not found")
    except Exception as e:
        return {"ok": False, "error": f"could not read recording: {e}"}
    return {"ok": True, "recording": doc}


@app.delete("/sap/recording/{rec_id}")
def recording_delete(rec_id: str) -> dict:
    ok = _delete_recording(rec_id)
    if not ok:
        raise HTTPException(status_code=404, detail="recording not found")
    return {"ok": True, "deleted": rec_id}


@app.post("/sap/recording/{rec_id}/translate")
@_track_metric("recording_translate")
def recording_translate(rec_id: str, req: RecordingTranslateRequest) -> dict:
    try:
        doc = _load_recording(rec_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="recording not found")
    except Exception as e:
        return {"ok": False, "error": f"could not read recording: {e}"}
    try:
        t = _translate_recording(
            doc, name=req.name, kind=req.kind,
            input_overrides=req.input_overrides or {},
        )
    except Exception as e:
        return {"ok": False, "error": f"translation failed: {e}"}
    return {
        "ok": True,
        "python_code": t.python,
        "vbs_code": t.vbs,
        "suggested_request_model": t.request_model,
        "confidence": t.confidence,
        "warnings": t.warnings,
        "detected": t.detected,
    }


@app.post("/sap/recording/{rec_id}/replay")
@_track_metric("recording_replay")
def recording_replay(rec_id: str, request: Request) -> dict:
    """DRY-RUN replay of a recorded session in the *current* SAP session.

    SAFETY: rejected unless the caller sends `X-Recording-Allow-Replay: yes`.
    A bare GET / DELETE without this opt-in will not silently mutate SAP.
    """
    if request.headers.get("x-recording-allow-replay", "").lower() != "yes":
        return {
            "ok": False,
            "error": "Replay is opt-in. Send header 'X-Recording-Allow-Replay: yes' to confirm "
                     "you want to execute the recorded actions in your live SAP session.",
        }
    if not state.sap_connected:
        return {"ok": False, "error": "SAP not connected"}
    try:
        doc = _load_recording(rec_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="recording not found")
    try:
        sess, _ = _get_sap_session()
    except Exception as e:
        return {"ok": False, "error": f"SAP session: {e}"}

    errors_at_step: list[dict] = []
    step = 0
    for e in doc.get("events", []):
        step += 1
        try:
            k = e.get("kind")
            if k == "transaction":
                sess.findById("wnd[0]/tbar[0]/okcd").text = str(e.get("value", ""))
                sess.findById("wnd[0]").sendVKey(0)
                _wait_for_session(sess, 10)
            elif k == "set_text":
                sess.findById(e.get("target", "")).text = str(e.get("value", ""))
            elif k == "selected":
                val = str(e.get("value", "")).lower() in ("true", "1", "x")
                sess.findById(e.get("target", "")).selected = val
            elif k == "select_dropdown":
                sess.findById(e.get("target", "")).key = str(e.get("value", ""))
            elif k == "press":
                sess.findById(e.get("target", "")).press()
                _wait_for_session(sess, 15)
            elif k == "send_vkey":
                wnd = e.get("wnd", 0)
                sess.findById(f"wnd[{wnd}]").sendVKey(int(e.get("value", 0)))
                _wait_for_session(sess, 10)
            elif k == "set_focus":
                try:
                    sess.findById(e.get("target", "")).setFocus()
                except Exception:
                    pass
            # caret_position / inferred_action / sbar / popup_* are skipped
        except Exception as exc:
            errors_at_step.append({"step": step, "kind": e.get("kind"),
                                   "error": str(exc)})
    return {
        "ok": len(errors_at_step) == 0,
        "steps_executed": step,
        "errors_at_step": errors_at_step,
    }


# Mark any in-progress recording from a previous (crashed) agent run as
# 'partial' on this agent's startup. We can't recover the events, but we
# can flag the file as incomplete so the UI doesn't show it as healthy.
def _scan_for_orphaned_recordings():
    base = _recordings_dir()
    try:
        for fn in os.listdir(base):
            if not fn.endswith(".meta.json"):
                continue
            full = os.path.join(base, fn)
            try:
                with open(full, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                if meta.get("status") == "recording":
                    meta["status"] = "partial"
                    meta["error"] = "agent restarted while recording was active"
                    with open(full, "w", encoding="utf-8") as f:
                        json.dump(meta, f, indent=2)
            except Exception:
                continue
    except Exception:
        pass


# ---------------------------------------------------------------------------
#  Worker-B (Phase D #11) — Material-Master dry-run preview wiring.
#  WORKER-B-CAPABILITIES: 'mm03-read-bin', 'mm03-read-storage-types'
#  Foreground merges these into AGENT_CAPABILITIES at the next agent
#  bump. The router lives in `material_master_read.py` (read-only MM03
#  navigators) and is mounted lazily so a missing/broken module never
#  blocks the rest of the agent from booting.
# ---------------------------------------------------------------------------
try:
    from material_master_read import router as _mm_read_router  # type: ignore
    app.include_router(_mm_read_router)
    print("[boot]   Mounted material_master_read router (2 endpoints)")
except Exception as _mm_read_err:
    print(f"[boot]   WARN material_master_read import failed: {_mm_read_err}")


# ---------------------------------------------------------------------------
#  Worker-C (Phase D #15) — Reversal / Rollback Engine wiring
# ---------------------------------------------------------------------------
# The reversal engine lives in a sibling module so the diff against
# agent.py stays small and the unit-testable pure function
# `compute_inverse` is easy to grab from outside the FastAPI app.
#
# We import + mount its router here at the end of the module so the
# main agent surface (mutations, queue, recording, metrics) is wired
# up first and a missing/broken import doesn't take the whole agent
# down — only the reversal endpoint becomes unavailable.
#
# WORKER-C-CAPABILITIES: 'reversal-engine'
#   ↑ Foreground merge (after Workers A + B land) appends this id to
#     AGENT_CAPABILITIES so the frontend's `requiredCapability` gate
#     can light up the Reversal panel. Worker C does NOT touch
#     AGENT_CAPABILITIES directly per the integration contract.
try:
    from reversal_engine import router as _reversal_router
    app.include_router(_reversal_router)
    print("[boot]   Mounted reversal_engine router (1 endpoint: /sap/reversal/compute-inverse)")
except Exception as _e:
    print(f"[boot]   WARN reversal_engine import failed: {_e}")


# ---------------------------------------------------------------------------
#  Worker-D (Phase D outbound) — LT22 Open Transfer-Order import wiring.
#  Mounted lazily so a missing/broken module never blocks the rest of
#  the agent from booting. Same pattern as material_master_read +
#  reversal_engine. WORKER-D-CAPABILITIES is declared near the bottom
#  of this file for foreground merge.
# ---------------------------------------------------------------------------
try:
    from lt22_import import (  # type: ignore
        Lt22ImportRequest as _Lt22ImportRequest,
        router as _lt22_router,
    )
    app.include_router(_lt22_router)
    _JOB_ENDPOINT_MODELS["/sap/import-lt22"] = _Lt22ImportRequest
    print("[boot]   Mounted lt22_import router (1 endpoint: /sap/import-lt22)")
except Exception as _lt22_err:
    print(f"[boot]   WARN lt22_import import failed: {_lt22_err}")


# ---------------------------------------------------------------------------
#  Inventory Adjustment workflow (2026-05-07) — ZMM60 price lookup wiring.
#  Capability advertised: 'zmm60-price-lookup' (see AGENT_CAPABILITIES).
#  The router exposes POST /sap/zmm60/lookup; the FE writes the result
#  directly into `inventory_adjustment_staging` (migration 288) — the
#  agent itself doesn't touch that table. Mounted lazily so a missing
#  or broken module never blocks the rest of the agent from booting,
#  matching `material_master_read.py` / `lt22_import.py`.
# ---------------------------------------------------------------------------
try:
    from zmm60_lookup import (  # type: ignore
        router as _zmm60_router,
        Zmm60LookupRequest as _Zmm60LookupRequest,
    )
    app.include_router(_zmm60_router)
    # 2026-05-09 — register the Pydantic model in `_JOB_ENDPOINT_MODELS` so
    # `_dispatch_job` can run `/sap/zmm60/lookup` from a queue claim
    # (Inventory Management → Fleet Agent toggle path). Without this entry
    # the dispatcher falls through to `handler_fn(**payload)` which fails
    # on Pydantic-bound handlers — the FastAPI route declares
    # `def zmm60_lookup(req: Zmm60LookupRequest) -> dict`, so positional
    # kwargs hit `TypeError: unexpected keyword argument 'material'`.
    # Mirrors the LT22 import registration above. Pure additive change —
    # no AGENT_VERSION bump (the FE feature is opt-in via a localStorage
    # toggle; older agents will simply fail the queue claim with a clear
    # "no model registered" log line if a fleet user mistakenly picks
    # them, which is the right UX). See
    # [[Implementations/Implement-Inventory-Management-Fleet-Routing]].
    _JOB_ENDPOINT_MODELS["/sap/zmm60/lookup"] = _Zmm60LookupRequest
    print("[boot]   Mounted zmm60_lookup router (1 endpoint: /sap/zmm60/lookup)")
except Exception as _zmm60_err:
    print(f"[boot]   WARN zmm60_lookup import failed: {_zmm60_err}")


# ---------------------------------------------------------------------------
#  LX25 Inventory Completion (2026-05-10) — cross-warehouse cycle-count
#  summary backing the new "Inventory Completion" Query Library entry.
#  Capability advertised: 'lx25-inventory-completion' (see
#  AGENT_CAPABILITIES). The router exposes
#  POST /sap/lx25/inventory-completion which fans out across the 5
#  hardcoded warehouses (WH5/WH8/JSM/JSF/PDC) sequentially in a single
#  SAP session — the FE makes ONE call and the agent loops the variants
#  internally, returning a per-warehouse breakdown + cross-warehouse
#  totals. Mounted lazily so a missing/broken module never blocks the
#  rest of the agent from booting (matches zmm60_lookup.py /
#  material_master_read.py / lt22_import.py).
#
#  We register the Pydantic model in `_JOB_ENDPOINT_MODELS` so
#  `_dispatch_job` can run /sap/lx25/inventory-completion from a queue
#  claim (Inventory Management → Fleet Agent toggle path). Without
#  this entry the dispatcher falls through to handler_fn(**payload)
#  which fails on Pydantic-bound handlers.
# ---------------------------------------------------------------------------
try:
    from lx25_inventory_completion import (  # type: ignore
        router as _lx25_router,
        Lx25InventoryCompletionRequest as _Lx25InventoryCompletionRequest,
    )
    app.include_router(_lx25_router)
    _JOB_ENDPOINT_MODELS["/sap/lx25/inventory-completion"] = _Lx25InventoryCompletionRequest
    print("[boot]   Mounted lx25_inventory_completion router (1 endpoint: /sap/lx25/inventory-completion)")
except Exception as _lx25_err:
    print(f"[boot]   WARN lx25_inventory_completion import failed: {_lx25_err}")


# ---------------------------------------------------------------------------
#  LL01 Warehouse Activity Monitor (2026-05-22)
#  Capability: ll01-warehouse-activity-monitor
# ---------------------------------------------------------------------------
try:
    from ll01_warehouse_activity_monitor import (  # type: ignore
        router as _ll01_router,
        LL01WarehouseActivityRequest as _LL01WarehouseActivityRequest,
    )
    app.include_router(_ll01_router)
    _JOB_ENDPOINT_MODELS["/sap/ll01/warehouse-activity"] = _LL01WarehouseActivityRequest
    print("[boot]   Mounted ll01_warehouse_activity_monitor router (2 endpoints: /sap/ll01/warehouse-activity)")
except Exception as _ll01_err:
    print(f"[boot]   WARN ll01_warehouse_activity_monitor import failed: {_ll01_err}")


# ---------------------------------------------------------------------------
#  Main Entry
# ---------------------------------------------------------------------------
def main():
    citrix = detect_citrix()
    exe_path = sys.executable if getattr(sys, "frozen", False) else __file__

    print("=" * 64)
    print(f"  OmniFrame SAP Agent v{AGENT_VERSION}")
    print("=" * 64)
    print(f"  User:       {citrix.get('user_name', '?')}")
    print(f"  Computer:   {citrix.get('computer_name', '?')}")
    print(f"  Citrix:     {'YES' if citrix['is_citrix'] else 'no'}"
          + (f" (session {citrix.get('session_name')})" if citrix['is_citrix'] else ""))
    print(f"  Running:    {exe_path}")
    print(f"  Config:     {CONFIG_FILE}")
    print("-" * 64)

    if is_port_in_use(AGENT_PORT):
        print(f"[error]  Port {AGENT_PORT} already in use — another agent instance is running.")
        print(f"[error]  If this is unexpected, check for a running OmniFrame_Agent.exe in Task Manager.")
        time.sleep(5)
        sys.exit(0)

    print(f"[start]  Listening on http://127.0.0.1:{AGENT_PORT}")
    print(f"[start]  Health check: http://127.0.0.1:{AGENT_PORT}/health")
    if os.environ.get("OMNIFRAME_AGENT_PORT"):
        print(f"[boot]   Agent port override: {AGENT_PORT} (OMNIFRAME_AGENT_PORT)")
    print(f"[start]  Web app should detect this agent within 3 seconds.")
    print(f"[start]  Close this window (or press Ctrl+C) to stop the agent.")
    # v1.6.4 — diagnostic prints so the next time the auth middleware or
    # trigger evaluator misbehaves we can eyeball what's loaded without
    # cracking open the bundled agent.
    print(f"[boot]   Auth-exempt paths: {', '.join(sorted(_TOKEN_EXEMPT_PATHS))}")
    print(
        "[triggers] agent-side trigger evaluator removed (Phase 9 of the "
        "rust-work-service integration plan, 2026-05-07). Trigger rules now "
        "live in `public.agent_triggers` and are evaluated server-side by "
        "`rust-work-service::triggers::evaluator`. The agent only consumes "
        "the resulting `sap_agent_jobs` rows. See "
        "memorybank/OmniFrame/Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md."
    )
    # v1.6.5 — fleet hygiene + token persistence diagnostics.
    print(f"[boot]   Stable agent_id: {_agent_self_id()} (PID {os.getpid()}, started {_AGENT_PROCESS_STARTED_AT})")
    if _AGENT_TOKEN_FRESHLY_MINTED:
        print(
            "[boot]   Minted NEW per-machine agent_token (no prior token in "
            f"config.json). It will be reused across EXE rebuilds + restarts. "
            f"Stored at {CONFIG_FILE}."
        )
    else:
        print(
            "[boot]   Restored persistent agent_token from "
            f"{CONFIG_FILE} — browser sessions that already hold this "
            "token (X-Agent-Token in localStorage) keep working without "
            "re-login."
        )
    if state.supabase_token and state.user_email:
        print(f"[boot]   Restored Supabase session: {state.user_email} (org {state.org_id or '?'})")
    elif state.supabase_url:
        print(f"[boot]   No active Supabase session. URL configured: {state.supabase_url}")
    else:
        print("[boot]   No Supabase config yet — open the OmniFrame web app and Connect Account.")
    # v1.7.9 — surface the SAP session pin state at boot so the user
    # can tell at a glance whether the agent is dedicated to one
    # session (pinned) or will auto-select the first usable one.
    if state.pinned_session:
        pin = state.pinned_session
        print(
            f"[boot]   Pinned session config loaded: "
            f"sys={pin.get('system','?')} "
            f"client={pin.get('client','?')} "
            f"user={pin.get('user','?')} "
            f"(conn={pin.get('conn_idx','?')}, sess={pin.get('sess_idx','?')}, "
            f"by_criteria={pin.get('by_criteria', True)}, "
            f"pinned_at={pin.get('pinned_at','?')}). Agent will ONLY "
            "attach to this session — other SAP windows are safe from "
            "auto-select. POST /sap/unpin-session to release."
        )
    else:
        print(
            "[boot]   No session pin — auto-select mode active. The "
            "agent will attach to the first usable SAP GUI session it "
            "finds. POST /sap/select-session to pin a specific session "
            "(survives EXE restart)."
        )
    # v1.6.6 — surface the SAP auto-connect mode at boot so the user can
    # tell at a glance whether they need to click SAP Connect themselves
    # (disabled mode) or just wait for the loop to attach (default).
    if os.environ.get("OMNIFRAME_DISABLE_SAP_AUTOCONNECT", "") == "1":
        print(
            "[boot]   SAP auto-connect: DISABLED via "
            "OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 (use the SAP Connect "
            "button in the web app to attach manually)."
        )
    else:
        print(
            "[boot]   SAP auto-connect: ENABLED — daemon will attempt "
            "attach immediately after startup, then retry every 10-60s "
            "until SAP GUI is reachable. Set "
            "OMNIFRAME_DISABLE_SAP_AUTOCONNECT=1 to disable."
        )
    # Phase 9 (rust-work-service integration plan, 2026-05-07) —
    # the agent's v1.6.9 trigger backfill poller was retired when
    # trigger evaluation moved server-side. The new evaluator
    # (`rust-work-service::triggers::evaluator`) consumes
    # `<table>_changed` Postgres NOTIFY directly and INSERTs
    # `sap_agent_jobs` rows on every match; the agent only drains
    # the queue. See Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md
    # for the architecture.
    print(
        "[boot]   Trigger backfill: SERVER-SIDE — Phase 9 evaluator "
        "subscribes to per-table NOTIFY channels and INSERTs "
        "sap_agent_jobs rows; agent only drains the queue."
    )
    # v1.7.0 — throughput + watchdog diagnostics so ops can see the
    # drain-mode config and the watchdog timeout at a glance. Three
    # one-line entries instead of one tall paragraph.
    print(
        f"[boot]   Job drain mode: ENABLED — idle backoff "
        f"{int(_DRAIN_MIN_IDLE_SEC)}→{int(_DRAIN_MAX_IDLE_SEC)}s "
        f"(exponential on consecutive empty polls), drain chain cap "
        f"{_DRAIN_MAX_CHAIN} jobs/burst. Bursts of 5+ log "
        "`[jobs] Drain mode: <N> jobs claimed in last burst.`."
    )
    print(
        f"[boot]   Stuck-job watchdog: ENABLED — tick every "
        f"{int(_WATCHDOG_TICK_SEC)}s; jobs running >"
        f"{int(_WATCHDOG_TIMEOUT_SEC)}s are marked `failed` via "
        "`jobs_fail()` and released. Override timeout via "
        "OMNIFRAME_JOB_WATCHDOG_TIMEOUT_SECONDS."
    )
    print(
        f"[boot]   HTTP timeouts: {int(_DEFAULT_HTTP_TIMEOUT_SEC)}s "
        f"(was 4-10s spread across call sites); single-retry on "
        f"Timeout/ConnectionError after {_HTTP_RETRY_SLEEP_SEC:.0f}s. "
        "Corporate proxy + Citrix latency no longer produces spurious "
        "`[triggers] enqueue error` lines."
    )
    # v2.0.0 (Phase 11) — surface the architecture-defaults posture.
    # The agent is on rust-work-service for both event delivery (Phase
    # 4) and queue control plane (Phase 7); legacy Supabase Realtime +
    # direct-PostgREST RPC are gated behind explicit env-var opt-out
    # (and the latter is now stub-only — Phase 11 deleted the legacy
    # claim/complete/fail/lease-bump fallback bodies).
    try:
        import work_service_ws as _work_ws_module  # type: ignore  # noqa: F401
        _work_service_url = getattr(_work_ws_module, "WORK_SERVICE_URL", "?")
    except Exception:
        _work_service_url = "(work_service_ws import failed — see [work-ws] logs)"
    print(
        "[boot]   v2.0.0 architecture defaults active: rust-work-service "
        "WS for row events (Phase 4), rust-work-service REST for queue "
        "control plane (Phase 7), server-side trigger evaluator (Phase "
        "9), agent-owned service-key identity (Phase 10, soft fallback). "
        f"Targeting {_work_service_url}."
    )
    if _USE_RUST_WS:
        print(
            "[boot]   Event source: rust-work-service /ws "
            "(OMNIFRAME_AGENT_USE_RUST_WS default ON in v2.0.0). "
            "Subscribed events: WsEvent::SapJobStatusChanged + "
            "WsEvent::RfPutawayChanged. Legacy Supabase Realtime path is "
            "INACTIVE for this run."
        )
    else:
        print(
            "[boot]   Event source: Supabase Realtime — DEPRECATED. "
            "Operator explicitly set OMNIFRAME_AGENT_USE_RUST_WS=0; this "
            "fallback is scheduled for removal in v2.1.0. Unset the env "
            "var to use the rust-work-service /ws path."
        )
    if _CLAIM_VIA_RUST:
        print(
            "[boot]   Claim path: rust-work-service /api/v1/sap-agents/jobs "
            "(OMNIFRAME_AGENT_CLAIM_VIA_RUST default ON in v2.0.0). "
            "Endpoints: /jobs/claim, /jobs/<id>/complete, "
            "/jobs/<id>/fail, /jobs/<id>/heartbeat. Legacy "
            "direct-PostgREST claim fallback was DELETED in Phase 11."
        )
    else:
        print(
            "[boot]   Claim path: DISABLED. Operator explicitly set "
            "OMNIFRAME_AGENT_CLAIM_VIA_RUST=0; the legacy "
            "direct-PostgREST fallback was DELETED in Phase 11, so "
            "/jobs/claim, /complete, /fail, /heartbeat will return "
            "errors. Unset the env var to use the canonical path."
        )
    # Legacy Phase-7 escape hatch banner kept as a no-op below for
    # operators grepping their boot logs for the historical line.
    if False:  # noqa: SIM108
        print(
            "[boot]   Claim path: direct PostgREST (default). Phase 7 "
            "endpoints are BUILT-IN but inactive — set "
            "OMNIFRAME_AGENT_CLAIM_VIA_RUST=1 to switch to "
            f"rust-work-service /api/v1/sap-agents/jobs/... ({_work_service_url})."
        )
    # Phase 6 (rust-work-service integration plan, 2026-05-07) —
    # surface the console-relay posture so an operator pulling the
    # boot log can tell whether the SAP Console card will see this
    # agent's stdout in real time. We use `_log()` here (not bare
    # `print()`) as the canonical example of the new helper —
    # future phase migrates the rest of the agent's prints to this
    # API. Until then the `_ConsoleRelayStream` wrapper installed in
    # `_on_startup()` captures everything via stdout interception.
    if _CONSOLE_RELAY_ENABLED:
        _log(
            "[boot]   Console relay: ENABLED "
            "(OMNIFRAME_AGENT_CONSOLE_RELAY default ON in v2.0.0). "
            "Selected print() lines mirror to rust-work-service "
            "/api/v1/sap-console/lines; the SAP Console card in the "
            f"web app will see live stdout. Targeting {_work_service_url}. "
            f"Buffer cap {_CONSOLE_RELAY_BUFFER_CAP} lines, batch size "
            f"{_CONSOLE_RELAY_BATCH_SIZE}, flush every "
            f"{_CONSOLE_RELAY_FLUSH_INTERVAL_SEC * 1000:.0f}ms."
        )
    else:
        print(
            "[boot]   Console relay: DISABLED — operator explicitly "
            "set OMNIFRAME_AGENT_CONSOLE_RELAY=0. The env var is "
            "scheduled for removal in v2.1.0; unset to enable the "
            "default Phase 6 path."
        )
    # v1.7.1 — Realtime crash-loop containment posture.
    # v1.8.4 — boot prints now reflect the new aggressive
    # clean-close thresholds + the exponential cooldown ladder.
    if _is_realtime_disabled_via_env():
        print(
            "[boot]   Realtime: DISABLED via OMNIFRAME_DISABLE_REALTIME=1 — "
            "using polling-only mode (job poller 5-15s, backfill poller 60s). "
            "Agent stays fully functional — only sub-second Realtime push "
            "wakes are lost; backfill poller covers missed events. Unset "
            "the env var and restart to re-enable Realtime."
        )
    else:
        print(
            f"[boot]   Realtime crash-loop containment: ENABLED — "
            f"asyncio loop exception handler suppresses known "
            f"`realtime>=2.x` library bugs + WebSocket close bursts. "
            f"v1.8.4 thresholds: clean-close window "
            f"{int(_REALTIME_SPURIOUS_CLOSE_WINDOW_SECONDS)}s / "
            f"threshold {_REALTIME_SPURIOUS_CLOSE_THRESHOLD} closes / "
            f"min-connect-age {int(_REALTIME_SPURIOUS_MIN_CONNECT_AGE_SEC)}s; "
            f"exception window {int(_REALTIME_ERROR_WINDOW_SECONDS)}s / "
            f"threshold {_REALTIME_ERROR_THRESHOLD} errors. Tripped "
            f"state falls back to polling-only mode (job poller idle "
            f"ceiling shrinks to "
            f"{int(_REALTIME_FALLBACK_POLL_MAX_IDLE_SEC)}s). Auto-retry "
            f"uses exponential cooldown — "
            f"{int(_REALTIME_CIRCUIT_INITIAL_COOLDOWN_SEC // 60)}min "
            f"after first trip, doubles each consecutive trip, capped "
            f"at {int(_REALTIME_CIRCUIT_MAX_COOLDOWN_SEC // 60)}min "
            f"(~6h). Reconnect backoff: "
            f"{int(_REALTIME_RECONNECT_INITIAL_DELAY_SEC)}s initial, "
            f"+{int(_REALTIME_RECONNECT_DELAY_INCREMENT_SEC)}s additive "
            f"per attempt, capped at "
            f"{int(_REALTIME_RECONNECT_MAX_DELAY_SEC)}s; resets to "
            f"{int(_REALTIME_RECONNECT_INITIAL_DELAY_SEC)}s only after "
            f"{int(_REALTIME_STABLE_CONNECTION_SEC)}s stable. Set "
            "OMNIFRAME_DISABLE_REALTIME=1 to skip Realtime entirely."
        )
    print("-" * 64)

    # In windowed mode, stdout/stderr are already redirected to devnull at
    # module load, so uvicorn's default logging won't crash. In console mode,
    # we get nice colorized request logs in the terminal.
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=AGENT_PORT,
        log_level="info" if not IS_WINDOWED else "warning",
        access_log=not IS_WINDOWED,
    )


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
#  Worker-A handoff: capability ids to merge into AGENT_CAPABILITIES
# ---------------------------------------------------------------------------
# Worker-A (this file) added queue-side multi-agent coordination, lease-aware
# claims, scheduled-jobs consumption, and an agent-direct Realtime
# subscription. The foreground will bump AGENT_VERSION to 1.6.0 after all
# workers merge; do NOT bump here.
#
# WORKER-A-CAPABILITIES: 'agents-fleet', 'job-claim-lease', 'agent-direct-realtime', 'scheduled-jobs'

# ---------------------------------------------------------------------------
#  Worker-D handoff: capability ids to merge into AGENT_CAPABILITIES
# ---------------------------------------------------------------------------
# Worker-D added the LT22 Open Transfer-Order import endpoint plus
# Supabase persistence / per-job ledger tracking. Mounted near the
# bottom of agent.py alongside material_master_read and reversal_engine
# so the boot prints stay grouped. Foreground will merge into
# AGENT_CAPABILITIES at the next bump; do NOT bump AGENT_VERSION here.
#
# WORKER-D-CAPABILITIES: 'import-lt22'

# Created and developed by Jai Singh
