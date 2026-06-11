# Created and developed by Jai Singh
"""YAML loader/validator for ``master_config.yaml`` (Plan Section 7)."""

from __future__ import annotations

import os
import re
import socket
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

MIN_WORKERS = 1
MAX_WORKERS = 12
DEFAULT_WORKERS = 6

MIN_CONSOLE_RING_SIZE = 100
MAX_CONSOLE_RING_SIZE = 50_000
DEFAULT_CONSOLE_RING_SIZE = 10_000

MIN_CONSOLE_TAIL_QUEUE_SIZE = 100
MAX_CONSOLE_TAIL_QUEUE_SIZE = 10_000
DEFAULT_CONSOLE_TAIL_QUEUE_SIZE = 2000


def omniframe_home() -> Path:
    """``%USERPROFILE%\\.omniframe`` or ``~/.omniframe``."""
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(profile) / ".omniframe"


def master_config_path() -> Path:
    return omniframe_home() / "master_config.yaml"


def expand_path(value: str) -> str:
    """Expand ``%USERPROFILE%`` / ``~`` in config path strings."""
    if not value:
        return value
    profile = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    out = value.replace("%USERPROFILE%", profile).replace("\\", os.sep)
    out = os.path.expanduser(out)
    return out


def default_host_prefix() -> str:
    return os.environ.get("COMPUTERNAME") or socket.gethostname() or "HOST"


@dataclass
class MasterSettings:
    workers: int = DEFAULT_WORKERS
    ui_refresh_ms: int = 1000
    health_probe_interval_ms: int = 2000
    log_retention_days: int = 7
    log_dir: str = ""
    sap_logon_path: str = (
        r"C:\Program Files (x86)\SAP\FrontEnd\SapGui\saplogon.exe"
    )
    agent_exe_path: str = ""
    parallel_spawn_concurrency: int = 2
    fix_admin_confirm_required: bool = True
    require_service_keys: bool = True
    console_ring_size: int = DEFAULT_CONSOLE_RING_SIZE
    console_tail_queue_size: int = DEFAULT_CONSOLE_TAIL_QUEUE_SIZE
    workers_decrement_policy: str = "keep"  # keep | delete (Phase F Settings)

    def resolved_log_dir(self) -> Path:
        raw = self.log_dir or str(omniframe_home() / "logs")
        return Path(expand_path(raw))


@dataclass
class WorkerConfig:
    id: str
    label: str
    sap_conn_idx: int = 0
    sap_session_index: int = 0
    auto_start: bool = True
    health_port: int = 8765
    extra_env: dict[str, str] = field(default_factory=dict)

    def slot_index(self) -> int:
        m = re.search(r"-W(\d+)$", self.id, re.IGNORECASE)
        if m:
            return max(0, int(m.group(1)) - 1)
        return 0


@dataclass
class MasterConfig:
    master: MasterSettings
    workers: list[WorkerConfig]
    source_path: Path | None = None
    using_builtin_defaults: bool = False


def _default_workers(host: str | None = None) -> list[WorkerConfig]:
    prefix = host or default_host_prefix()
    workers: list[WorkerConfig] = []
    for n in range(1, DEFAULT_WORKERS + 1):
        workers.append(
            WorkerConfig(
                id=f"{prefix}-W{n}",
                label=f"Bay {n} — Generic",
                sap_conn_idx=0,
                sap_session_index=n - 1,
                auto_start=n != 6,
                health_port=8764 + n,
            )
        )
    return workers


def default_config() -> MasterConfig:
    return MasterConfig(
        master=MasterSettings(
            log_dir=str(omniframe_home() / "logs"),
        ),
        workers=_default_workers(),
        using_builtin_defaults=True,
    )


def canonical_service_key_path(worker_id: str) -> Path:
    """``%USERPROFILE%\\.omniframe\\agents\\<id>\\agent_service_key.txt``."""
    return omniframe_home() / "agents" / worker_id / "agent_service_key.txt"


def _restrict_key_file_permissions(path: Path) -> None:
    """Mirror Phase 10 runbook ACL (0600 / icacls-restricted)."""
    import subprocess
    import sys

    if sys.platform == "win32":
        try:
            subprocess.run(
                [
                    "icacls",
                    str(path),
                    "/inheritance:r",
                    "/grant:r",
                    f"{os.environ.get('USERNAME', os.getlogin())}:F",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        except Exception:
            pass
    else:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def write_service_key(worker_id: str, key: str) -> Path:
    """Persist pasted ``omni_sk_*`` for a worker (Phase D mode F)."""
    path = canonical_service_key_path(worker_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(key.strip(), encoding="utf-8")
    _restrict_key_file_permissions(path)
    return path


def _coerce_master(raw: dict[str, Any]) -> MasterSettings:
    m = raw or {}
    return MasterSettings(
        workers=int(m.get("workers", DEFAULT_WORKERS)),
        ui_refresh_ms=int(m.get("ui_refresh_ms", 1000)),
        health_probe_interval_ms=int(m.get("health_probe_interval_ms", 2000)),
        log_retention_days=int(m.get("log_retention_days", 7)),
        log_dir=str(m.get("log_dir", "")),
        sap_logon_path=str(
            m.get(
                "sap_logon_path",
                MasterSettings.sap_logon_path,
            )
        ),
        agent_exe_path=str(m.get("agent_exe_path", "")),
        parallel_spawn_concurrency=int(m.get("parallel_spawn_concurrency", 2)),
        fix_admin_confirm_required=bool(
            m.get("fix_admin_confirm_required", True)
        ),
        require_service_keys=bool(m.get("require_service_keys", True)),
        console_ring_size=max(
            MIN_CONSOLE_RING_SIZE,
            min(
                MAX_CONSOLE_RING_SIZE,
                int(m.get("console_ring_size", DEFAULT_CONSOLE_RING_SIZE)),
            ),
        ),
        console_tail_queue_size=max(
            MIN_CONSOLE_TAIL_QUEUE_SIZE,
            min(
                MAX_CONSOLE_TAIL_QUEUE_SIZE,
                int(m.get("console_tail_queue_size", DEFAULT_CONSOLE_TAIL_QUEUE_SIZE)),
            ),
        ),
        workers_decrement_policy=str(m.get("workers_decrement_policy", "keep")),
    )


def _coerce_workers(raw: list[Any] | None, host: str) -> list[WorkerConfig]:
    if not raw:
        return _default_workers(host)
    out: list[WorkerConfig] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        extra = item.get("extra_env") or {}
        if not isinstance(extra, dict):
            extra = {}
        extra_env = {str(k): str(v) for k, v in extra.items()}
        port = int(item.get("health_port", 8765 + i))
        out.append(
            WorkerConfig(
                id=str(item.get("id", f"{host}-W{i + 1}")),
                label=str(item.get("label", f"Bay {i + 1} — Generic")),
                sap_conn_idx=int(item.get("sap_conn_idx", 0)),
                sap_session_index=int(item.get("sap_session_index", i)),
                auto_start=bool(item.get("auto_start", True)),
                health_port=port,
                extra_env=extra_env,
            )
        )
    return out


RestartRequiredSet = frozenset[str]


def apply_config_diff(old: MasterConfig, new: MasterConfig) -> RestartRequiredSet:
    """Return field paths that require worker restart if changed (Phase F1)."""
    from omni_agent.master.settings_logic import detect_restart_required

    return frozenset(detect_restart_required(old, new))


def validate_config(cfg: MasterConfig) -> None:
    """Raise ``ValueError`` on duplicate ids/ports/SAP pairs or bad counts."""
    n = cfg.master.workers
    if n < MIN_WORKERS or n > MAX_WORKERS:
        raise ValueError(
            f"master.workers must be in [{MIN_WORKERS}, {MAX_WORKERS}], got {n}"
        )
    workers = cfg.workers[:n]
    if len(workers) < n:
        raise ValueError(
            f"Expected at least {n} worker entries, found {len(cfg.workers)}"
        )
    ids = [w.id for w in workers]
    ports = [w.health_port for w in workers]
    sap_pairs = [(w.sap_conn_idx, w.sap_session_index) for w in workers]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate worker id")
    if len(set(ports)) != len(ports):
        raise ValueError("Duplicate health_port")
    if len(set(sap_pairs)) != len(sap_pairs):
        raise ValueError("Duplicate (sap_conn_idx, sap_session_index)")


def config_to_yaml_dict(cfg: MasterConfig) -> dict[str, Any]:
    """Serialize ``MasterConfig`` for YAML write (wizard / Phase F)."""
    n = cfg.master.workers
    workers = cfg.workers[:n]
    m = cfg.master
    return {
        "master": {
            "workers": m.workers,
            "ui_refresh_ms": m.ui_refresh_ms,
            "health_probe_interval_ms": m.health_probe_interval_ms,
            "log_retention_days": m.log_retention_days,
            "log_dir": m.log_dir or str(omniframe_home() / "logs"),
            "sap_logon_path": m.sap_logon_path,
            "agent_exe_path": m.agent_exe_path,
            "parallel_spawn_concurrency": m.parallel_spawn_concurrency,
            "fix_admin_confirm_required": m.fix_admin_confirm_required,
            "require_service_keys": m.require_service_keys,
            "console_ring_size": m.console_ring_size,
            "console_tail_queue_size": m.console_tail_queue_size,
            "workers_decrement_policy": m.workers_decrement_policy,
        },
        "workers": [
            {
                "id": w.id,
                "label": w.label,
                "sap_conn_idx": w.sap_conn_idx,
                "sap_session_index": w.sap_session_index,
                "auto_start": w.auto_start,
                "health_port": w.health_port,
                "extra_env": dict(w.extra_env),
            }
            for w in workers
        ],
    }


def write_master_config(cfg: MasterConfig, path: Path | None = None) -> Path:
    """Write ``master_config.yaml`` (Phase E wizard first-run; Phase F Settings reuse)."""
    from datetime import datetime, timezone

    cfg_path = path or master_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    header = f"# Generated by Setup Wizard {stamp} UTC\n"
    body = yaml.safe_dump(
        config_to_yaml_dict(cfg),
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
    )
    cfg_path.write_text(header + body, encoding="utf-8")
    return cfg_path


def load_config(path: Path | None = None) -> MasterConfig:
    """Load YAML from disk or return built-in defaults (W1..W6, W6 no auto_start)."""
    cfg_path = path or master_config_path()
    host = default_host_prefix()
    if not cfg_path.is_file():
        cfg = default_config()
        cfg.source_path = None
        return cfg
    with cfg_path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    master = _coerce_master(data.get("master") or {})
    workers = _coerce_workers(data.get("workers"), host)
    cfg = MasterConfig(
        master=master,
        workers=workers,
        source_path=cfg_path,
        using_builtin_defaults=False,
    )
    validate_config(cfg)
    return cfg

# Created and developed by Jai Singh
