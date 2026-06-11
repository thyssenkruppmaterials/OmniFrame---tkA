# Created and developed by Jai Singh
"""Phase F3 — Master Settings dialog (CTk modal).

Pure validation/diffing delegates to ``settings_logic`` when Phase F1 is
present; inline fallbacks below keep the dialog functional until then.
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Optional

from omni_agent.master.config import (
    MAX_WORKERS,
    MIN_WORKERS,
    MasterConfig,
    MasterSettings,
    WorkerConfig,
    default_host_prefix,
    load_config,
    validate_config,
    write_master_config,
)
from omni_agent.master.ports import default_port_for_index

LOG = logging.getLogger("omniframe.master.settings_dialog")

# Phase F1 dependency — replaced when settings_logic.py lands.
try:
    from omni_agent.master.settings_logic import (
        HOT_APPLY_FIELDS,
        RESTART_REQUIRED_FIELDS,
        apply_workers_count_change,
        clamp_health_probe_interval_ms,
        clamp_log_retention_days,
        clamp_parallel_spawn_concurrency,
        clamp_ui_refresh_ms,
        cleanup_removed_worker_keys,
        detect_restart_required,
        removed_worker_ids,
        validate_settings_form,
    )
except ImportError:  # pragma: no cover — until F1 ships
    HOT_APPLY_FIELDS = frozenset(
        {
            "workers[].label",
            "workers[].auto_start",
            "master.ui_refresh_ms",
            "master.health_probe_interval_ms",
            "master.fix_admin_confirm_required",
            "master.log_retention_days",
            "master.sap_logon_path",
            "master.parallel_spawn_concurrency",
        }
    )
    RESTART_REQUIRED_FIELDS = frozenset(
        {
            "workers[].health_port",
            "workers[].sap_conn_idx",
            "workers[].sap_session_index",
            "workers[].extra_env",
            "master.workers",
            "master.agent_exe_path",
        }
    )

    def clamp_ui_refresh_ms(value: int) -> int:
        return max(250, min(5000, int(value)))

    def clamp_health_probe_interval_ms(value: int) -> int:
        return max(500, min(30_000, int(value)))

    def clamp_parallel_spawn_concurrency(value: int) -> int:
        return max(1, min(MAX_WORKERS, int(value)))

    def clamp_log_retention_days(value: int) -> int:
        return max(1, min(365, int(value)))

    def removed_worker_ids(old: MasterConfig, new: MasterConfig) -> list[str]:
        old_ids = {w.id for w in old.workers[: old.master.workers]}
        new_ids = {w.id for w in new.workers[: new.master.workers]}
        return sorted(old_ids - new_ids)

    def cleanup_removed_worker_keys(
        removed_ids: list[str], *, policy: str
    ) -> list[str]:
        if policy != "delete":
            return []
        deleted: list[str] = []
        from omni_agent.master.config import canonical_service_key_path

        for worker_id in removed_ids:
            path = canonical_service_key_path(worker_id)
            if path.is_file():
                path.unlink(missing_ok=True)
                deleted.append(worker_id)
        return deleted

    def validate_settings_form(cfg: MasterConfig) -> list[str]:
        errors: list[str] = []
        n = cfg.master.workers
        if n < MIN_WORKERS or n > MAX_WORKERS:
            errors.append(f"master.workers must be in [{MIN_WORKERS}, {MAX_WORKERS}]")
        workers = cfg.workers[:n]
        ports: list[int] = []
        sap_pairs: list[tuple[int, int]] = []
        for w in workers:
            label = w.label.strip()
            if not label:
                errors.append(f"{w.id}: label cannot be empty")
            elif len(label) > 30:
                errors.append(f"{w.id}: label must be at most 30 characters")
            ports.append(w.health_port)
            sap_pairs.append((w.sap_conn_idx, w.sap_session_index))
            if w.extra_env:
                try:
                    blob = json.dumps(w.extra_env)
                    parsed = json.loads(blob)
                    if not isinstance(parsed, dict):
                        errors.append(f"{w.id}: extra_env must be a JSON object")
                except (TypeError, ValueError) as exc:
                    errors.append(f"{w.id}: extra_env invalid JSON — {exc}")
        if len(set(ports)) != len(ports):
            errors.append("Duplicate health_port across workers")
        if len(set(sap_pairs)) != len(sap_pairs):
            errors.append("Duplicate (sap_conn_idx, sap_session_index) pair")
        try:
            validate_config(cfg)
        except ValueError as exc:
            errors.append(str(exc))
        return errors

    def detect_restart_required(old: MasterConfig, new: MasterConfig) -> frozenset[str]:
        changed: set[str] = set()
        om, nm = old.master, new.master
        if om.workers != nm.workers:
            changed.add("master.workers")
        if om.agent_exe_path != nm.agent_exe_path:
            changed.add("master.agent_exe_path")
        n = max(om.workers, nm.workers, len(old.workers), len(new.workers))
        for i in range(n):
            ow = old.workers[i] if i < len(old.workers) else None
            nw = new.workers[i] if i < len(new.workers) else None
            if ow is None or nw is None:
                continue
            prefix = f"workers[{nw.id}]"
            if ow.health_port != nw.health_port:
                changed.add(f"{prefix}.health_port")
            if ow.sap_conn_idx != nw.sap_conn_idx:
                changed.add(f"{prefix}.sap_conn_idx")
            if ow.sap_session_index != nw.sap_session_index:
                changed.add(f"{prefix}.sap_session_index")
            if dict(ow.extra_env) != dict(nw.extra_env):
                changed.add(f"{prefix}.extra_env")
        return frozenset(changed & RESTART_REQUIRED_FIELDS)

    def apply_workers_count_change(
        old_cfg: MasterConfig,
        new_count: int,
        host_prefix: str,
        *,
        decrement_policy: str = "keep",
    ) -> MasterConfig:
        new_count = max(MIN_WORKERS, min(MAX_WORKERS, int(new_count)))
        host = host_prefix or default_host_prefix()
        workers: list[WorkerConfig] = list(old_cfg.workers[:new_count])
        old_n = old_cfg.master.workers
        if new_count > len(workers):
            for slot in range(len(workers), new_count):
                n = slot + 1
                auto = not (new_count >= 6 and n == 6)
                workers.append(
                    WorkerConfig(
                        id=f"{host}-W{n}",
                        label=f"Bay {n} — Generic",
                        sap_conn_idx=0,
                        sap_session_index=slot,
                        auto_start=auto,
                        health_port=default_port_for_index(slot),
                    )
                )
        if new_count < old_n and decrement_policy == "delete":
            for w in old_cfg.workers[new_count:old_n]:
                key_path = canonical_service_key_path(w.id)
                try:
                    if key_path.is_file():
                        key_path.unlink()
                except OSError as exc:
                    LOG.warning("Failed to delete key for %s: %s", w.id, exc)
        master = replace(old_cfg.master, workers=new_count)
        cfg = MasterConfig(
            master=master,
            workers=workers,
            source_path=old_cfg.source_path,
            using_builtin_defaults=False,
        )
        validate_config(cfg)
        return cfg


def read_workers_decrement_policy(cfg: MasterConfig) -> str:
    raw = getattr(cfg.master, "workers_decrement_policy", "keep")
    return "delete" if str(raw).lower() == "delete" else "keep"


def write_master_config_with_policy(
    cfg: MasterConfig,
    *,
    decrement_policy: str = "keep",
    path: Path | None = None,
) -> Path:
    """Persist YAML including ``master.workers_decrement_policy``."""

    patched = MasterConfig(
        master=replace(
            cfg.master,
            workers_decrement_policy=(
                "delete" if decrement_policy == "delete" else "keep"
            ),
        ),
        workers=cfg.workers,
        source_path=cfg.source_path,
        using_builtin_defaults=cfg.using_builtin_defaults,
    )
    return write_master_config(patched, path)


def parse_extra_env(raw: str) -> dict[str, str]:
    text = raw.strip() or "{}"
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("extra_env must be a JSON object")
    return {str(k): str(v) for k, v in parsed.items()}


# ---------------------------------------------------------------------------
# CTk dialog
# ---------------------------------------------------------------------------

try:
    import customtkinter as ctk
    from tkinter import filedialog

    from omni_agent.master import theme

    _STRICT_SERVICE_KEY_TOOLTIP = (
        "When enabled, master spawns workers with OMNIFRAME_AGENT_REQUIRE_SERVICE_KEY=1 "
        "and each worker must have a provisioned service key under "
        "%USERPROFILE%\\.omniframe\\agents\\<id>\\. "
        "Disabling allows Supabase session fallback until keys are registered."
    )

    class _WorkerRowWidgets:
        def __init__(
            self,
            parent: ctk.CTkFrame,
            worker: WorkerConfig,
            *,
            row: int,
        ) -> None:
            self.worker_id = worker.id
            ctk.CTkLabel(
                parent,
                text=worker.id,
                text_color=theme.TEXT_MUTED,
                width=120,
                anchor="w",
            ).grid(row=row, column=0, padx=4, pady=2, sticky="w")
            self.label_var = ctk.StringVar(value=worker.label)
            ctk.CTkEntry(parent, textvariable=self.label_var, width=160).grid(
                row=row, column=1, padx=4, pady=2
            )
            self.port_var = ctk.StringVar(value=str(worker.health_port))
            ctk.CTkEntry(parent, textvariable=self.port_var, width=70).grid(
                row=row, column=2, padx=4, pady=2
            )
            self.conn_var = ctk.StringVar(value=str(worker.sap_conn_idx))
            ctk.CTkEntry(parent, textvariable=self.conn_var, width=50).grid(
                row=row, column=3, padx=4, pady=2
            )
            self.sess_var = ctk.StringVar(value=str(worker.sap_session_index))
            ctk.CTkEntry(parent, textvariable=self.sess_var, width=50).grid(
                row=row, column=4, padx=4, pady=2
            )
            self.auto_var = ctk.BooleanVar(value=worker.auto_start)
            ctk.CTkCheckBox(parent, text="", variable=self.auto_var, width=24).grid(
                row=row, column=5, padx=4, pady=2
            )
            self.extra_text = ctk.CTkTextbox(parent, height=36, width=140)
            self.extra_text.grid(row=row, column=6, padx=4, pady=2, sticky="ew")
            self.extra_text.insert("1.0", json.dumps(worker.extra_env or {}, indent=0))

        def to_worker_config(self) -> WorkerConfig:
            extra_raw = self.extra_text.get("1.0", "end").strip()
            return WorkerConfig(
                id=self.worker_id,
                label=self.label_var.get().strip(),
                health_port=int(self.port_var.get().strip()),
                sap_conn_idx=int(self.conn_var.get().strip()),
                sap_session_index=int(self.sess_var.get().strip()),
                auto_start=bool(self.auto_var.get()),
                extra_env=parse_extra_env(extra_raw),
            )

    class MasterSettingsDialog(ctk.CTkToplevel):
        """Modal editor for ``master_config.yaml``."""

        def __init__(
            self,
            master: ctk.CTk,
            cfg: MasterConfig,
            *,
            on_saved: Callable[[MasterConfig, frozenset[str], bool], None],
            on_rerun_wizard: Callable[[], None],
            host_prefix: str | None = None,
        ) -> None:
            super().__init__(master)
            self._original_cfg = cfg
            self._on_saved = on_saved
            self._on_rerun_wizard = on_rerun_wizard
            self._host_prefix = host_prefix or self._infer_host_prefix(cfg)
            self._decrement_policy = read_workers_decrement_policy(cfg)
            self._pending_restart_fields: frozenset[str] = frozenset()
            self._worker_rows: list[_WorkerRowWidgets] = []

            self.title("Master Settings")
            self.geometry("980x720")
            self.minsize(860, 600)
            self.configure(fg_color=theme.BG_WINDOW)
            self.transient(master)
            self.grab_set()

            outer = ctk.CTkScrollableFrame(self, fg_color=theme.BG_WINDOW)
            outer.pack(fill="both", expand=True, padx=12, pady=12)

            self._build_master_section(outer)
            self._build_worker_section(outer)
            self._build_restart_panel(outer)
            self._build_error_label(outer)
            self._build_actions(outer)

            self._rebuild_worker_rows(int(cfg.master.workers))
            self.protocol("WM_DELETE_WINDOW", self._on_cancel)

        def _infer_host_prefix(self, cfg: MasterConfig) -> str:
            if cfg.workers:
                wid = cfg.workers[0].id
                if "-W" in wid:
                    return wid.rsplit("-W", 1)[0]
            return default_host_prefix()

        def _build_master_section(self, parent: ctk.CTkScrollableFrame) -> None:
            m = self._original_cfg.master
            frame = ctk.CTkFrame(parent, fg_color=theme.BG_TILE)
            frame.pack(fill="x", pady=(0, 12))
            ctk.CTkLabel(
                frame,
                text="Master globals",
                font=ctk.CTkFont(size=14, weight="bold"),
                text_color=theme.TEXT_PRIMARY,
            ).grid(row=0, column=0, columnspan=4, sticky="w", padx=12, pady=(10, 8))

            self._workers_var = ctk.StringVar(value=str(m.workers))
            self._ui_refresh_var = ctk.StringVar(value=str(m.ui_refresh_ms))
            self._probe_var = ctk.StringVar(value=str(m.health_probe_interval_ms))
            self._spawn_var = ctk.StringVar(value=str(m.parallel_spawn_concurrency))
            self._retention_var = ctk.StringVar(value=str(m.log_retention_days))
            self._sap_path_var = ctk.StringVar(value=m.sap_logon_path)
            self._agent_path_var = ctk.StringVar(value=m.agent_exe_path)
            self._fix_confirm_var = ctk.BooleanVar(value=m.fix_admin_confirm_required)
            self._require_keys_var = ctk.BooleanVar(value=m.require_service_keys)

            fields = [
                ("Workers (1–12)", self._workers_var, "spin"),
                ("UI refresh (ms)", self._ui_refresh_var, "entry"),
                ("Health probe (ms)", self._probe_var, "entry"),
                ("Parallel spawn", self._spawn_var, "entry"),
                ("Log retention (days)", self._retention_var, "entry"),
            ]
            for i, (label, var, kind) in enumerate(fields):
                r = 1 + i // 2
                c = (i % 2) * 2
                ctk.CTkLabel(frame, text=label, text_color=theme.TEXT_MUTED).grid(
                    row=r, column=c, padx=12, pady=4, sticky="w"
                )
                if kind == "spin":
                    spin = ctk.CTkEntry(frame, textvariable=var, width=80)
                    spin.grid(row=r, column=c + 1, padx=4, pady=4, sticky="w")
                    spin.bind("<FocusOut>", lambda _e: self._on_workers_changed())
                    spin.bind("<Return>", lambda _e: self._on_workers_changed())
                else:
                    ctk.CTkEntry(frame, textvariable=var, width=120).grid(
                        row=r, column=c + 1, padx=4, pady=4, sticky="w"
                    )

            ctk.CTkCheckBox(
                frame,
                text="Require admin confirm for destructive fixes",
                variable=self._fix_confirm_var,
            ).grid(row=4, column=0, columnspan=4, padx=12, pady=4, sticky="w")

            self._require_keys_cb = ctk.CTkCheckBox(
                frame,
                text="Require service keys for spawned workers (recommended)",
                variable=self._require_keys_var,
            )
            self._require_keys_cb.grid(row=5, column=0, columnspan=3, padx=12, pady=4, sticky="w")
            info = ctk.CTkLabel(
                frame,
                text="ⓘ",
                text_color=theme.TEXT_MUTED,
                cursor="question_arrow",
            )
            info.grid(row=5, column=3, padx=4, pady=4, sticky="w")
            tip = ctk.CTkToplevel(self)
            tip.withdraw()
            tip.overrideredirect(True)
            tip.configure(fg_color=theme.BG_TILE)
            tip_lbl = ctk.CTkLabel(
                tip,
                text=_STRICT_SERVICE_KEY_TOOLTIP,
                wraplength=360,
                justify="left",
                text_color=theme.TEXT_PRIMARY,
            )
            tip_lbl.pack(padx=8, pady=8)

            def _show_tip(_event: Any) -> None:
                x = info.winfo_rootx() + 20
                y = info.winfo_rooty() + 20
                tip.geometry(f"+{x}+{y}")
                tip.deiconify()
                tip.lift()

            def _hide_tip(_event: Any) -> None:
                tip.withdraw()

            info.bind("<Enter>", _show_tip)
            info.bind("<Leave>", _hide_tip)

            self._path_row(frame, 6, "SAP Logon path", self._sap_path_var)
            self._path_row(frame, 7, "Agent.exe path", self._agent_path_var)

        def _path_row(
            self,
            parent: ctk.CTkFrame,
            row: int,
            label: str,
            var: ctk.StringVar,
        ) -> None:
            ctk.CTkLabel(parent, text=label, text_color=theme.TEXT_MUTED).grid(
                row=row, column=0, padx=12, pady=4, sticky="w"
            )
            ctk.CTkEntry(parent, textvariable=var, width=420).grid(
                row=row, column=1, columnspan=2, padx=4, pady=4, sticky="ew"
            )
            ctk.CTkButton(
                parent,
                text="Browse…",
                width=80,
                fg_color=theme.BTN_SECONDARY,
                command=lambda v=var: self._browse_exe(v),
            ).grid(row=row, column=3, padx=8, pady=4, sticky="e")

        def _browse_exe(self, var: ctk.StringVar) -> None:
            path = filedialog.askopenfilename(
                parent=self,
                title="Select executable",
                filetypes=[("Executables", "*.exe"), ("All files", "*.*")],
            )
            if path:
                var.set(path)

        def _build_worker_section(self, parent: ctk.CTkScrollableFrame) -> None:
            self._worker_section = ctk.CTkFrame(parent, fg_color=theme.BG_TILE)
            self._worker_section.pack(fill="x", pady=(0, 12))
            ctk.CTkLabel(
                self._worker_section,
                text="Per-worker settings",
                font=ctk.CTkFont(size=14, weight="bold"),
                text_color=theme.TEXT_PRIMARY,
            ).grid(row=0, column=0, columnspan=7, sticky="w", padx=12, pady=(10, 8))
            headers = ["ID", "Label", "Port", "Conn", "Sess", "Auto", "extra_env (JSON)"]
            for col, hdr in enumerate(headers):
                ctk.CTkLabel(
                    self._worker_section,
                    text=hdr,
                    text_color=theme.TEXT_MUTED,
                    font=ctk.CTkFont(size=11, weight="bold"),
                ).grid(row=1, column=col, padx=4, pady=2)
            self._worker_rows_host = ctk.CTkFrame(
                self._worker_section, fg_color="transparent"
            )
            self._worker_rows_host.grid(
                row=2, column=0, columnspan=7, sticky="ew", padx=8, pady=4
            )
            for c in range(7):
                self._worker_section.grid_columnconfigure(c, weight=1 if c == 6 else 0)

        def _build_restart_panel(self, parent: ctk.CTkScrollableFrame) -> None:
            self._restart_panel = ctk.CTkFrame(
                parent, fg_color=theme.BANNER_WARNING_BG, corner_radius=8
            )
            self._restart_label = ctk.CTkLabel(
                self._restart_panel,
                text="",
                wraplength=900,
                justify="left",
                text_color=theme.BANNER_WARNING_FG,
            )
            self._restart_label.pack(padx=12, pady=(10, 4), anchor="w")
            self._auto_restart_var = ctk.BooleanVar(value=False)
            self._auto_restart_cb = ctk.CTkCheckBox(
                self._restart_panel,
                text="Auto-restart affected workers after save",
                variable=self._auto_restart_var,
                text_color=theme.BANNER_WARNING_FG,
            )
            self._auto_restart_cb.pack(padx=12, pady=(0, 10), anchor="w")

        def _build_error_label(self, parent: ctk.CTkScrollableFrame) -> None:
            self._error_lbl = ctk.CTkLabel(
                parent, text="", text_color=theme.PILL_DISCONNECTED, wraplength=900
            )
            self._error_lbl.pack(fill="x", pady=4)

        def _build_actions(self, parent: ctk.CTkScrollableFrame) -> None:
            row = ctk.CTkFrame(parent, fg_color="transparent")
            row.pack(fill="x", pady=(8, 0))
            ctk.CTkButton(
                row,
                text="Re-run Setup Wizard",
                fg_color=theme.BTN_SECONDARY,
                command=self._rerun_wizard,
            ).pack(side="left", padx=(0, 8))
            ctk.CTkButton(
                row,
                text="Cancel",
                fg_color=theme.BTN_SECONDARY,
                command=self._on_cancel,
            ).pack(side="right", padx=(8, 0))
            self._save_btn = ctk.CTkButton(
                row,
                text="Save",
                fg_color=theme.BTN_FIX,
                command=self._on_save_click,
            )
            self._save_btn.pack(side="right")

        def _on_workers_changed(self) -> None:
            try:
                n = int(str(self._workers_var.get()).strip())
            except ValueError:
                return
            n = max(MIN_WORKERS, min(MAX_WORKERS, n))
            self._workers_var.set(n)
            self._rebuild_worker_rows(n)

        def _rebuild_worker_rows(self, count: int) -> None:
            for child in self._worker_rows_host.winfo_children():
                child.destroy()
            self._worker_rows.clear()
            base_workers = list(self._original_cfg.workers)
            host = self._host_prefix
            while len(base_workers) < count:
                slot = len(base_workers)
                n = slot + 1
                base_workers.append(
                    WorkerConfig(
                        id=f"{host}-W{n}",
                        label=f"Bay {n} — Generic",
                        sap_conn_idx=0,
                        sap_session_index=slot,
                        auto_start=not (count >= 6 and n == 6),
                        health_port=default_port_for_index(slot),
                    )
                )
            for i in range(count):
                row_w = _WorkerRowWidgets(
                    self._worker_rows_host,
                    base_workers[i],
                    row=i,
                )
                self._worker_rows.append(row_w)

        def _collect_config(self) -> MasterConfig:
            try:
                worker_count = int(str(self._workers_var.get()).strip())
            except ValueError as exc:
                raise ValueError("Workers must be an integer") from exc
            worker_count = max(MIN_WORKERS, min(MAX_WORKERS, worker_count))
            master = MasterSettings(
                workers=worker_count,
                ui_refresh_ms=clamp_ui_refresh_ms(int(self._ui_refresh_var.get())),
                health_probe_interval_ms=clamp_health_probe_interval_ms(
                    int(self._probe_var.get())
                ),
                parallel_spawn_concurrency=clamp_parallel_spawn_concurrency(
                    int(self._spawn_var.get())
                ),
                fix_admin_confirm_required=bool(self._fix_confirm_var.get()),
                require_service_keys=bool(self._require_keys_var.get()),
                log_retention_days=clamp_log_retention_days(int(self._retention_var.get())),
                sap_logon_path=self._sap_path_var.get().strip(),
                agent_exe_path=self._agent_path_var.get().strip(),
                log_dir=self._original_cfg.master.log_dir,
                console_ring_size=self._original_cfg.master.console_ring_size,
                console_tail_queue_size=self._original_cfg.master.console_tail_queue_size,
            )
            workers = [row.to_worker_config() for row in self._worker_rows[:worker_count]]
            if worker_count != self._original_cfg.master.workers:
                sized = apply_workers_count_change(
                    self._original_cfg,
                    worker_count,
                    self._host_prefix,
                )
                merged: list[WorkerConfig] = []
                for i, form_w in enumerate(workers):
                    base = sized.workers[i]
                    merged.append(
                        replace(
                            base,
                            label=form_w.label,
                            health_port=form_w.health_port,
                            sap_conn_idx=form_w.sap_conn_idx,
                            sap_session_index=form_w.sap_session_index,
                            auto_start=form_w.auto_start,
                            extra_env=form_w.extra_env,
                        )
                    )
                workers = merged
            return MasterConfig(
                master=master,
                workers=workers,
                source_path=self._original_cfg.source_path,
                using_builtin_defaults=False,
            )

        def _confirm_workers_decrease(self, new_count: int) -> bool:
            old_count = self._original_cfg.master.workers
            if new_count >= old_count:
                return True

            dialog = ctk.CTkToplevel(self)
            dialog.title("Remove workers?")
            dialog.geometry("480x220")
            dialog.transient(self)
            dialog.grab_set()
            dialog.configure(fg_color=theme.BG_WINDOW)
            ctk.CTkLabel(
                dialog,
                text=(
                    f"Lowering workers from {old_count} to {new_count} removes "
                    f"W{new_count + 1}..W{old_count} from config.\n"
                    "What should happen to their service key files?"
                ),
                wraplength=440,
                justify="left",
                text_color=theme.TEXT_PRIMARY,
            ).pack(padx=16, pady=(16, 8), anchor="w")
            choice = {"proceed": False}

            def _pick(policy: str) -> None:
                self._decrement_policy = policy
                choice["proceed"] = True
                dialog.destroy()

            btn_row = ctk.CTkFrame(dialog, fg_color="transparent")
            btn_row.pack(padx=16, pady=12, fill="x")
            ctk.CTkButton(
                btn_row,
                text="Keep key files",
                fg_color=theme.BTN_SECONDARY,
                command=lambda: _pick("keep"),
            ).pack(side="left", padx=(0, 8))
            ctk.CTkButton(
                btn_row,
                text="Delete key files",
                fg_color=theme.BTN_FIX,
                command=lambda: _pick("delete"),
            ).pack(side="left")
            ctk.CTkButton(
                btn_row,
                text="Cancel",
                fg_color=theme.BTN_SECONDARY,
                command=dialog.destroy,
            ).pack(side="right")
            dialog.wait_window()
            return bool(choice["proceed"])

        def _show_restart_panel(self, fields: frozenset[str]) -> None:
            lines = "\n".join(f"• {f}" for f in sorted(fields))
            self._restart_label.configure(
                text=(
                    "The following changes require worker restart to take effect:\n"
                    f"{lines}"
                )
            )
            self._restart_panel.pack(fill="x", pady=(0, 8), before=self._error_lbl)
            self._save_btn.configure(text="Confirm Save")

        def _hide_restart_panel(self) -> None:
            self._restart_panel.pack_forget()
            self._save_btn.configure(text="Save")
            self._pending_restart_fields = frozenset()

        def _on_save_click(self) -> None:
            self._error_lbl.configure(text="")
            try:
                new_count = int(str(self._workers_var.get()).strip())
            except ValueError:
                self._error_lbl.configure(text="Workers must be an integer.")
                return
            if new_count < self._original_cfg.master.workers:
                if not self._confirm_workers_decrease(new_count):
                    return
            try:
                draft = self._collect_config()
            except (ValueError, json.JSONDecodeError) as exc:
                self._error_lbl.configure(text=str(exc))
                return
            errors = validate_settings_form(draft)
            if errors:
                self._error_lbl.configure(text="; ".join(errors))
                return
            restart_fields = frozenset(
                detect_restart_required(self._original_cfg, draft)
            )
            if restart_fields and not self._pending_restart_fields:
                self._pending_restart_fields = restart_fields
                self._show_restart_panel(restart_fields)
                return
            self._persist(draft, restart_fields or self._pending_restart_fields)

        def _persist(self, draft: MasterConfig, restart_fields: frozenset[str]) -> None:
            removed = removed_worker_ids(self._original_cfg, draft)
            cleanup_removed_worker_keys(removed, policy=self._decrement_policy)
            write_master_config_with_policy(
                draft,
                decrement_policy=self._decrement_policy,
                path=draft.source_path,
            )
            auto_restart = bool(self._auto_restart_var.get()) and bool(restart_fields)
            try:
                self.grab_release()
            except Exception:
                pass
            self.destroy()
            self._on_saved(draft, restart_fields, auto_restart)

        def _rerun_wizard(self) -> None:
            try:
                self.grab_release()
            except Exception:
                pass
            self.destroy()
            self._on_rerun_wizard()

        def _on_cancel(self) -> None:
            try:
                self.grab_release()
            except Exception:
                pass
            self.destroy()

    def open_settings_dialog(
        master: ctk.CTk,
        cfg: MasterConfig,
        *,
        on_saved: Callable[[MasterConfig, frozenset[str], bool], None],
        on_rerun_wizard: Callable[[], None],
        host_prefix: str | None = None,
    ) -> MasterSettingsDialog:
        return MasterSettingsDialog(
            master,
            cfg,
            on_saved=on_saved,
            on_rerun_wizard=on_rerun_wizard,
            host_prefix=host_prefix,
        )

except ImportError:  # pragma: no cover
    MasterSettingsDialog = None  # type: ignore[misc, assignment]

    def open_settings_dialog(*_args: Any, **_kwargs: Any) -> None:  # type: ignore[misc]
        raise RuntimeError("customtkinter is required for Master Settings")

# Created and developed by Jai Singh
