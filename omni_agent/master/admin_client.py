# Created and developed by Jai Singh
"""HTTP client for master-controller admin endpoints on worker agents."""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

import httpx

_ADMIN_TOKEN_DIR = Path(
    os.environ.get("USERPROFILE")
    or os.environ.get("HOME")
    or os.path.expanduser("~")
) / ".omniframe"
_ADMIN_TOKEN_FILE = _ADMIN_TOKEN_DIR / "master_admin_token.txt"

_DEFAULT_TIMEOUT_S = 30.0


def _restrict_token_file_permissions(path: Path) -> None:
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
            # Best-effort on Windows — token file still created.
            pass
    else:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def load_or_create_master_admin_token() -> str:
    """Read or mint the master admin token persisted under ~/.omniframe/."""
    env_token = os.environ.get("OMNIFRAME_AGENT_ADMIN_TOKEN", "").strip()
    if env_token:
        return env_token
    if _ADMIN_TOKEN_FILE.is_file():
        token = _ADMIN_TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            return token

    _ADMIN_TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    _ADMIN_TOKEN_FILE.write_text(token, encoding="utf-8")
    _restrict_token_file_permissions(_ADMIN_TOKEN_FILE)
    return token


class AdminClient:
    """POST helper for worker /admin/* endpoints."""

    def __init__(
        self,
        admin_token: str,
        *,
        client: Optional[httpx.Client] = None,
        timeout_s: float = _DEFAULT_TIMEOUT_S,
    ) -> None:
        self._admin_token = admin_token
        self._timeout_s = timeout_s
        self._client = client
        self._owns_client = client is None

    def _headers(self) -> dict[str, str]:
        return {"X-Agent-Token": self._admin_token}

    def _base_url(self, port: int) -> str:
        return f"http://127.0.0.1:{port}"

    def _post(self, url: str, *, json: Optional[dict[str, Any]] = None) -> httpx.Response:
        if self._client is not None:
            return self._client.post(url, headers=self._headers(), json=json)
        with httpx.Client(timeout=self._timeout_s) as client:
            return client.post(url, headers=self._headers(), json=json)

    def ws_reconnect(self, port: int) -> dict[str, Any]:
        resp = self._post(f"{self._base_url(port)}/admin/ws/reconnect")
        resp.raise_for_status()
        return resp.json()

    def job_abort(self, port: int, *, detail: str = "aborted by master controller") -> dict[str, Any]:
        resp = self._post(
            f"{self._base_url(port)}/admin/job/abort",
            json={"detail": detail},
        )
        resp.raise_for_status()
        return resp.json()

    def sap_reattach(self, port: int) -> dict[str, Any]:
        resp = self._post(f"{self._base_url(port)}/admin/sap/reattach")
        resp.raise_for_status()
        return resp.json()

    def fetch_sap_sessions(self, port: int) -> dict[str, Any]:
        """GET ``/sap/sessions`` on a healthy peer (token-exempt)."""
        url = f"{self._base_url(port)}/sap/sessions"
        if self._client is not None:
            resp = self._client.get(url, timeout=self._timeout_s)
        else:
            with httpx.Client(timeout=self._timeout_s) as client:
                resp = client.get(url)
        resp.raise_for_status()
        return resp.json()

    def close(self) -> None:
        if self._owns_client and self._client is not None:
            self._client.close()


class WorkerAdminClient:
    """Soft-error admin client for FixActionDispatcher (Phase D1 compat)."""

    def __init__(self, admin_token: str = "") -> None:
        self._token = admin_token or os.environ.get("OMNIFRAME_AGENT_ADMIN_TOKEN", "")

    @property
    def admin_token(self) -> str:
        return self._token

    def _headers(self) -> dict[str, str]:
        if self._token:
            return {"X-Agent-Token": self._token}
        return {}

    def _post(self, port: int, path: str, *, json: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        url = f"http://127.0.0.1:{port}{path}"
        try:
            resp = httpx.post(
                url,
                json=json,
                headers=self._headers(),
                timeout=_DEFAULT_TIMEOUT_S,
            )
            if resp.status_code >= 400:
                return {"ok": False, "error": f"HTTP {resp.status_code}", "body": resp.text}
            return resp.json()
        except Exception as exc:
            return {"ok": False, "error": repr(exc)}

    def ws_reconnect(self, port: int) -> dict[str, Any]:
        return self._post(port, "/admin/ws/reconnect")

    def sap_reattach(self, port: int) -> dict[str, Any]:
        return self._post(port, "/admin/sap/reattach")

    def job_abort(
        self,
        port: int,
        *,
        detail: str = "aborted by master controller",
    ) -> dict[str, Any]:
        return self._post(port, "/admin/job/abort", json={"detail": detail})

# Created and developed by Jai Singh
