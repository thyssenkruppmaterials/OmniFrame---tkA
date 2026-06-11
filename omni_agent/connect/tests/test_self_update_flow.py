# Created and developed by Jai Singh
"""Self-update orchestrator flow tests (mocked download/swap)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.connect.manifest import ChannelEntry  # noqa: E402
from omni_agent.connect.self_update import (  # noqa: E402
    SelfUpdateController,
    check_for_update,
    compute_sha256,
)


def _entry(**overrides) -> ChannelEntry:
    base = dict(
        version="0.2.0",
        exe_url="https://example.com/OmniFrame_Connect_0.2.0.exe",
        exe_sha256="aa" * 32,
        exe_size_bytes=10,
    )
    base.update(overrides)
    return ChannelEntry(**base)


def test_check_for_update_available():
    manifest_text = """
    {
      "schema_version": 1,
      "current_version": "0.2.0",
      "minimum_required_version": "0.1.0",
      "released_at": "2026-05-21T22:00:00Z",
      "channels": {
        "stable": {
          "version": "0.2.0",
          "exe_url": "https://example.com/a.exe",
          "exe_sha256": "%s",
          "exe_size_bytes": 4
        }
      }
    }
    """ % ("bb" * 32)
    from omni_agent.connect.manifest import parse_manifest

    available, manifest, entry, result = check_for_update(
        installed="0.1.0",
        fetch_fn=lambda: parse_manifest(manifest_text),
    )
    assert available is True
    assert manifest is not None
    assert entry is not None
    assert result.ok is True


def test_hash_mismatch_bails_before_swap(tmp_path):
    entry = _entry(exe_sha256="cc" * 32)
    target = tmp_path / "OmniFrame_Connect.exe"
    target.write_bytes(b"x")
    errors: list[str] = []
    shutdown_called = {"n": 0}
    popen_called = {"n": 0}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield b"payload"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    controller = SelfUpdateController(
        on_updating=lambda: None,
        on_error=lambda msg: errors.append(msg),
        supervisor_shutdown=lambda: shutdown_called.__setitem__("n", shutdown_called["n"] + 1),
    )

    with mock.patch("omni_agent.connect.self_update.httpx.stream", return_value=FakeResponse()):
        controller.start_install(entry, target, synchronous=True)

    assert errors
    assert shutdown_called["n"] == 0


def test_successful_flow_spawns_helper(tmp_path):
    payload = b"verified-binary"
    import hashlib

    sha = hashlib.sha256(payload).hexdigest()
    entry = _entry(exe_sha256=sha)
    target = tmp_path / "OmniFrame_Connect.exe"
    target.write_bytes(b"old")
    exited = {"n": 0}
    shutdown_called = {"n": 0}
    popen_args: list[list[str]] = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield payload

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    controller = SelfUpdateController(
        on_updating=lambda: None,
        on_error=lambda _msg: None,
        on_exit_for_replace=lambda: exited.__setitem__("n", exited["n"] + 1),
        supervisor_shutdown=lambda: shutdown_called.__setitem__("n", shutdown_called["n"] + 1),
    )

    with mock.patch("omni_agent.connect.self_update.current_exe_path", return_value=target), mock.patch(
        "omni_agent.connect.self_update.httpx.stream", return_value=FakeResponse()
    ), mock.patch(
        "omni_agent.connect.self_update.subprocess.Popen",
        lambda argv, **kwargs: popen_args.append(list(argv)),
    ):
        controller.start_install(entry, target, synchronous=True)

    assert shutdown_called["n"] == 1
    assert exited["n"] == 1
    assert popen_args
    assert "--replace-helper" in popen_args[0]

# Created and developed by Jai Singh
