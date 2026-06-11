# Created and developed by Jai Singh
"""Pure settings validation, diffing, and workers-count helpers (Phase F1)."""

from __future__ import annotations

import copy
import json
import re
from dataclasses import replace
from typing import Any

from omni_agent.master.config import (
    MAX_WORKERS,
    MIN_WORKERS,
    MasterConfig,
    MasterSettings,
    WorkerConfig,
    default_host_prefix,
    validate_config,
)
from omni_agent.master.pair_sessions_logic import default_worker_pairings
from omni_agent.master.ports import default_port_for_index

# Hot-apply: reflected in running master without worker restart.
HOT_APPLY_FIELDS: frozenset[str] = frozenset(
    {
        "workers[].label",
        "workers[].auto_start",
        "master.ui_refresh_ms",
        "master.health_probe_interval_ms",
        "master.fix_admin_confirm_required",
        "master.log_retention_days",
        "master.sap_logon_path",
        "master.parallel_spawn_concurrency",
        "master.workers_decrement_policy",
    }
)

# Restart-required: worker process must be recycled to pick up change.
RESTART_REQUIRED_FIELDS: frozenset[str] = frozenset(
    {
        "workers[].health_port",
        "workers[].sap_conn_idx",
        "workers[].sap_session_index",
        "workers[].extra_env",
        "master.workers",
        "master.agent_exe_path",
        "master.require_service_keys",
    }
)

RestartRequiredSet = frozenset[str]

MIN_UI_REFRESH_MS = 250
MAX_UI_REFRESH_MS = 5000
MIN_PROBE_MS = 500
MAX_PROBE_MS = 30_000
MAX_LABEL_LEN = 30


def clamp_ui_refresh_ms(value: int) -> int:
    return max(MIN_UI_REFRESH_MS, min(MAX_UI_REFRESH_MS, int(value)))


def clamp_health_probe_interval_ms(value: int) -> int:
    return max(MIN_PROBE_MS, min(MAX_PROBE_MS, int(value)))


def clamp_parallel_spawn_concurrency(value: int) -> int:
    return max(1, min(12, int(value)))


def clamp_log_retention_days(value: int) -> int:
    return max(1, min(365, int(value)))


def clamp_workers(value: int) -> int:
    return max(MIN_WORKERS, min(MAX_WORKERS, int(value)))


def validate_settings_form(cfg: MasterConfig) -> list[str]:
    """Return human-readable validation errors (empty when valid)."""
    errors: list[str] = []
    n = cfg.master.workers
    if n < MIN_WORKERS or n > MAX_WORKERS:
        errors.append(f"master.workers must be in [{MIN_WORKERS}, {MAX_WORKERS}]")
    workers = cfg.workers[:n]
    if len(workers) < n:
        errors.append(f"Expected at least {n} worker entries, found {len(cfg.workers)}")
    ports: list[int] = []
    sap_pairs: list[tuple[int, int]] = []
    for w in workers:
        label = (w.label or "").strip()
        if not label:
            errors.append(f"Label required for {w.id}")
        elif len(label) > MAX_LABEL_LEN:
            errors.append(f"label must be at most 30 characters for {w.id}")
        ports.append(w.health_port)
        sap_pairs.append((w.sap_conn_idx, w.sap_session_index))
        for key, val in (w.extra_env or {}).items():
            if not isinstance(val, str):
                errors.append(f"extra_env values must be strings ({w.id}.{key})")
        if w.extra_env:
            try:
                parsed = json.loads(json.dumps(w.extra_env))
                if not isinstance(parsed, dict):
                    errors.append(f"extra_env for {w.id} must be a JSON object")
            except (TypeError, ValueError):
                errors.append(f"extra_env for {w.id} must be valid JSON object")
    if len(set(ports)) != len(ports):
        errors.append("Duplicate health_port")
    if len(set(sap_pairs)) != len(sap_pairs):
        errors.append("Duplicate (sap_conn_idx, sap_session_index)")
    return errors


def apply_workers_count_change(
    old_cfg: MasterConfig,
    new_count: int,
    host_prefix: str | None = None,
) -> MasterConfig:
    """Resize worker rows; new slots get default W<N> pairing metadata."""
    new_count = clamp_workers(new_count)
    prefix = host_prefix or default_host_prefix()
    policy = getattr(old_cfg.master, "workers_decrement_policy", "keep")
    new_master = replace(old_cfg.master, workers=new_count)
    existing_by_id = {w.id: w for w in old_cfg.workers}
    default_pairings = default_worker_pairings(new_count, host_prefix=prefix)
    workers: list[WorkerConfig] = []
    for pairing in default_pairings:
        prior = existing_by_id.get(pairing.worker_id)
        if prior is not None:
            workers.append(copy.deepcopy(prior))
        else:
            workers.append(
                WorkerConfig(
                    id=pairing.worker_id,
                    label=pairing.label,
                    sap_conn_idx=pairing.conn_idx,
                    sap_session_index=pairing.sess_idx,
                    auto_start=pairing.auto_start,
                    health_port=pairing.health_port,
                    extra_env={},
                )
            )
    if new_count < old_cfg.master.workers and policy == "keep":
        for w in old_cfg.workers[new_count:]:
            if w.id not in {row.id for row in workers}:
                workers.append(copy.deepcopy(w))
    elif new_count < old_cfg.master.workers and policy == "delete":
        workers = workers[:new_count]
    return MasterConfig(
        master=new_master,
        workers=workers,
        source_path=old_cfg.source_path,
        using_builtin_defaults=old_cfg.using_builtin_defaults,
    )


def removed_worker_ids(old_cfg: MasterConfig, new_cfg: MasterConfig) -> list[str]:
    """Worker ids present in old config but dropped after count decrease."""
    old_ids = {w.id for w in old_cfg.workers[: old_cfg.master.workers]}
    new_ids = {w.id for w in new_cfg.workers[: new_cfg.master.workers]}
    return sorted(old_ids - new_ids)


def added_worker_ids(old_cfg: MasterConfig, new_cfg: MasterConfig) -> list[str]:
    old_ids = {w.id for w in old_cfg.workers[: old_cfg.master.workers]}
    new_ids = {w.id for w in new_cfg.workers[: new_cfg.master.workers]}
    return sorted(new_ids - old_ids)


def cleanup_removed_worker_keys(
    removed_ids: list[str],
    *,
    policy: str,
) -> list[str]:
    """Apply keep/delete policy for service-key files of removed workers."""
    from omni_agent.master.config import canonical_service_key_path

    deleted: list[str] = []
    if policy != "delete":
        return deleted
    for worker_id in removed_ids:
        path = canonical_service_key_path(worker_id)
        if path.is_file():
            path.unlink(missing_ok=True)
            deleted.append(worker_id)
    return deleted


def _worker_field_changed(old: WorkerConfig, new: WorkerConfig, field: str) -> bool:
    if field == "label":
        return (old.label or "").strip() != (new.label or "").strip()
    if field == "auto_start":
        return old.auto_start != new.auto_start
    if field == "health_port":
        return old.health_port != new.health_port
    if field == "sap_conn_idx":
        return old.sap_conn_idx != new.sap_conn_idx
    if field == "sap_session_index":
        return old.sap_session_index != new.sap_session_index
    if field == "extra_env":
        return dict(old.extra_env) != dict(new.extra_env)
    return False


def detect_restart_required(old: MasterConfig, new: MasterConfig) -> set[str]:
    """Return dotted/indexed field paths that require worker restart."""
    required: set[str] = set()
    if old.master.workers != new.master.workers:
        required.add("master.workers")
    if old.master.agent_exe_path != new.master.agent_exe_path:
        required.add("master.agent_exe_path")
    if old.master.require_service_keys != new.master.require_service_keys:
        required.add("master.require_service_keys")

    old_active = old.workers[: old.master.workers]
    new_active = new.workers[: new.master.workers]
    for idx, (o, n) in enumerate(zip(old_active, new_active)):
        for field in ("health_port", "sap_conn_idx", "sap_session_index", "extra_env"):
            if _worker_field_changed(o, n, field):
                required.add(f"workers[{idx}].{field}")
    return required


def detect_config_diff(old: MasterConfig, new: MasterConfig) -> RestartRequiredSet:
    return frozenset(detect_restart_required(old, new))


def validate_config_safe(cfg: MasterConfig) -> list[str]:
    """Combine form validation + validate_config errors."""
    errors = validate_settings_form(cfg)
    try:
        validate_config(cfg)
    except ValueError as exc:
        errors.append(str(exc))
    return errors

# Created and developed by Jai Singh
