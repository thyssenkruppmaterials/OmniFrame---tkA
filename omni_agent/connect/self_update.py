# Created and developed by Jai Singh
"""Self-update orchestrator: check, download, verify, swap, respawn."""

from __future__ import annotations

import hashlib
import logging
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Callable, Optional

import httpx

from omni_agent.connect.manifest import (
    ChannelEntry,
    Manifest,
    ManifestResult,
    fetch_manifest,
    installed_version,
    is_update_available,
)
from omni_agent.connect.self_replace import build_replace_argv
from omni_agent.connect.update_state import (
    UpdateState,
    is_dismissed_for_version,
    read_update_state,
    utc_now_iso,
    write_update_state,
)

LOG = logging.getLogger("omniframe.connect.self_update")

PILL_UPDATING_COLOR = "#3b82f6"
UPDATING_LABEL = "Updating…"


def current_exe_path() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable)
    return Path(__file__).resolve().parents[1] / "OmniFrame_Connect.exe"


def compute_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def check_for_update(
    *,
    installed: Optional[str] = None,
    fetch_fn: Callable[[], ManifestResult] = fetch_manifest,
) -> tuple[bool, Optional[Manifest], Optional[ChannelEntry], ManifestResult]:
    """Return ``(available, manifest, stable_entry, fetch_result)``."""
    installed_ver = installed or installed_version()
    result = fetch_fn()
    if not result.ok or result.manifest is None:
        return False, None, None, result
    manifest = result.manifest
    entry = manifest.stable
    available = is_update_available(installed_ver, entry.version)
    return available, manifest, entry, result


def record_check(
    *,
    offered_version: Optional[str] = None,
    state: Optional[UpdateState] = None,
) -> UpdateState:
    current = state or read_update_state()
    current.last_check_utc = utc_now_iso()
    if offered_version:
        current.last_offered_version = offered_version
    write_update_state(current)
    return current


def dismiss_update_for_version(version: str) -> None:
    state = read_update_state()
    state.user_dismissed_for_version = version
    write_update_state(state)


def clear_dismiss_if_installed_matches() -> None:
    state = read_update_state()
    installed = installed_version()
    if state.last_offered_version == installed and state.user_dismissed_for_version:
        state.user_dismissed_for_version = None
        write_update_state(state)


def should_offer_update(state: UpdateState, version: str) -> bool:
    return not is_dismissed_for_version(state, version)


class SelfUpdateController:
    """Coordinates background checks and install flow with GUI callbacks."""

    def __init__(
        self,
        *,
        on_updating: Optional[Callable[[], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
        on_exit_for_replace: Optional[Callable[[], None]] = None,
        supervisor_shutdown: Optional[Callable[[], None]] = None,
    ) -> None:
        self._on_updating = on_updating
        self._on_error = on_error
        self._on_exit_for_replace = on_exit_for_replace
        self._supervisor_shutdown = supervisor_shutdown
        self._install_lock = threading.Lock()
        self._install_thread: Optional[threading.Thread] = None

    def start_install(
        self,
        manifest_entry: ChannelEntry,
        exe_path: Optional[Path] = None,
        *,
        synchronous: bool = False,
    ) -> None:
        target_exe = exe_path or current_exe_path()
        if synchronous:
            self._download_and_swap(manifest_entry, target_exe)
            return
        with self._install_lock:
            if self._install_thread and self._install_thread.is_alive():
                LOG.info("[OK] install already running")
                return
            self._install_thread = threading.Thread(
                target=self._download_and_swap,
                args=(manifest_entry, target_exe),
                daemon=True,
                name="connect-self-update",
            )
            self._install_thread.start()

    def _download_and_swap(self, entry: ChannelEntry, target_exe: Path) -> None:
        if self._on_updating:
            self._on_updating()
        partial_path: Optional[Path] = None
        verified_path: Optional[Path] = None
        try:
            temp_dir = Path(tempfile.mkdtemp(prefix="omniframe_connect_update_"))
            partial_path = temp_dir / f"OmniFrame_Connect_{entry.version}.exe.partial"
            verified_path = temp_dir / f"OmniFrame_Connect_{entry.version}.exe.verified"
            with httpx.stream("GET", entry.exe_url, follow_redirects=True, timeout=60.0) as response:
                response.raise_for_status()
                with partial_path.open("wb") as handle:
                    for chunk in response.iter_bytes():
                        handle.write(chunk)
            actual_hash = compute_sha256(partial_path)
            if actual_hash != entry.exe_sha256.lower():
                LOG.error(
                    "[ERR] update hash mismatch expected=%s actual=%s",
                    entry.exe_sha256,
                    actual_hash,
                )
                if self._on_error:
                    self._on_error(
                        "Update couldn't be verified. Try again later."
                    )
                return
            partial_path.rename(verified_path)
            if self._supervisor_shutdown:
                self._supervisor_shutdown()
            helper_exe = current_exe_path()
            argv = build_replace_argv(
                helper_exe,
                target=target_exe,
                source=verified_path,
                restart=True,
            )
            subprocess.Popen(argv, close_fds=True)
            LOG.info("[OK] spawned replace helper -> %s", argv)
            if self._on_exit_for_replace:
                self._on_exit_for_replace()
        except Exception as exc:
            LOG.exception("[ERR] self-update failed -> %s", exc)
            if self._on_error:
                self._on_error("Update couldn't be verified. Try again later.")


_default_controller: Optional[SelfUpdateController] = None


def get_controller() -> SelfUpdateController:
    global _default_controller
    if _default_controller is None:
        _default_controller = SelfUpdateController()
    return _default_controller


def configure_controller(controller: SelfUpdateController) -> None:
    global _default_controller
    _default_controller = controller


def start_install(
    manifest_entry: ChannelEntry,
    exe_path: Optional[Path] = None,
    *,
    synchronous: bool = False,
) -> None:
    get_controller().start_install(manifest_entry, exe_path, synchronous=synchronous)

# Created and developed by Jai Singh
