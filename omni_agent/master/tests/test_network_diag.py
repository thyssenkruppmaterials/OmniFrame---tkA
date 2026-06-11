# Created and developed by Jai Singh
"""Phase D3 network diagnostic pure-function tests."""

from __future__ import annotations

import socket
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from omni_agent.master import network_diag as nd  # noqa: E402

HOST = "rust-work-service-production.up.railway.app"
BASE_URL = f"https://{HOST}"


@pytest.fixture(autouse=True)
def _clear_work_service_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OMNIFRAME_WORK_SERVICE_URL", raising=False)


def test_resolve_work_service_host_default() -> None:
    assert nd.resolve_work_service_host() == HOST


def test_resolve_work_service_host_from_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "OMNIFRAME_WORK_SERVICE_URL",
        "http://localhost:8030",
    )
    assert nd.resolve_work_service_host() == "localhost"


def test_compose_verdict_dns_failure() -> None:
    results = [
        nd.CheckResult("dns", nd.CheckStatus.FAIL, "no such host"),
        nd.CheckResult("tcp", nd.CheckStatus.OK, "ok", 1.0),
        nd.CheckResult("service_health", nd.CheckStatus.OK, "ok", 2.0),
    ]
    assert nd.compose_verdict(results) == "DNS failure → call IT"


def test_compose_verdict_tcp_blocked() -> None:
    results = [
        nd.CheckResult("dns", nd.CheckStatus.OK, "resolved", 1.0),
        nd.CheckResult("tcp", nd.CheckStatus.FAIL, "timed out"),
        nd.CheckResult("service_health", nd.CheckStatus.OK, "ok", 2.0),
    ]
    assert nd.compose_verdict(results) == "TCP blocked → check firewall/VPN"


def test_compose_verdict_service_health_failed() -> None:
    results = [
        nd.CheckResult("dns", nd.CheckStatus.OK, "resolved", 1.0),
        nd.CheckResult("tcp", nd.CheckStatus.OK, "reachable", 2.0),
        nd.CheckResult("service_health", nd.CheckStatus.FAIL, "HTTP 503"),
    ]
    assert (
        nd.compose_verdict(results)
        == "Service health failed → check Railway status"
    )


def test_compose_verdict_all_passed() -> None:
    results = [
        nd.CheckResult("dns", nd.CheckStatus.OK, "resolved", 1.0),
        nd.CheckResult("tcp", nd.CheckStatus.OK, "reachable", 2.0),
        nd.CheckResult("service_health", nd.CheckStatus.OK, "HTTP 200", 3.0),
    ]
    assert (
        nd.compose_verdict(results)
        == "All checks passed — verify per-agent network state"
    )


def test_run_dns_check_ok_populates_latency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("203.0.113.1", 443)),
        ],
    )
    result = nd.run_dns_check(HOST)
    assert result.status == nd.CheckStatus.OK
    assert result.latency_ms is not None
    assert result.latency_ms >= 0
    assert "203.0.113.1" in result.detail


def test_run_dns_check_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(*_a: object, **_k: object) -> None:
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr(socket, "getaddrinfo", _raise)
    result = nd.run_dns_check(HOST)
    assert result.status == nd.CheckStatus.FAIL
    assert result.name == nd.DNS_CHECK


def test_run_tcp_check_ok_populates_latency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Conn:
        def __enter__(self) -> _Conn:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(
        socket,
        "create_connection",
        lambda *args, **kwargs: _Conn(),
    )
    result = nd.run_tcp_check(HOST)
    assert result.status == nd.CheckStatus.OK
    assert result.latency_ms is not None
    assert result.latency_ms >= 0


def test_run_tcp_check_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(*_a: object, **_k: object) -> None:
        raise TimeoutError("timed out")

    monkeypatch.setattr(socket, "create_connection", _raise)
    result = nd.run_tcp_check(HOST)
    assert result.status == nd.CheckStatus.FAIL


def test_run_service_health_check_ok(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_get(url: str, *, timeout: float) -> SimpleNamespace:
        assert url == f"{BASE_URL}/health"
        assert timeout == 5
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(httpx, "get", _fake_get)
    result = nd.run_service_health_check(BASE_URL)
    assert result.status == nd.CheckStatus.OK
    assert result.latency_ms is not None
    assert result.latency_ms >= 0


def test_run_service_health_check_non_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout: SimpleNamespace(status_code=503),
    )
    result = nd.run_service_health_check(BASE_URL)
    assert result.status == nd.CheckStatus.FAIL
    assert "503" in result.detail


def test_run_service_health_check_http_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(url: str, timeout: float) -> None:
        raise httpx.ConnectTimeout("connect timed out")

    monkeypatch.setattr(httpx, "get", _raise)
    result = nd.run_service_health_check(BASE_URL)
    assert result.status == nd.CheckStatus.FAIL


def test_run_all_checks_dns_verdict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _dns_fail(*_a: object, **_k: object) -> None:
        raise socket.gaierror("fail")

    class _Conn:
        def __enter__(self) -> _Conn:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(socket, "getaddrinfo", _dns_fail)
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: _Conn())
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout: SimpleNamespace(status_code=200),
    )
    results, verdict = nd.run_all_checks()
    assert len(results) == 3
    assert results[0].status == nd.CheckStatus.FAIL
    assert verdict == "DNS failure → call IT"


def test_run_all_checks_tcp_verdict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.2.3.4", 443)),
        ],
    )

    def _tcp_fail(*_a: object, **_k: object) -> None:
        raise OSError("connection refused")

    monkeypatch.setattr(socket, "create_connection", _tcp_fail)
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout: SimpleNamespace(status_code=200),
    )
    results, verdict = nd.run_all_checks()
    assert results[1].status == nd.CheckStatus.FAIL
    assert verdict == "TCP blocked → check firewall/VPN"


def test_run_all_checks_health_verdict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Conn:
        def __enter__(self) -> _Conn:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.2.3.4", 443)),
        ],
    )
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: _Conn())
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout: SimpleNamespace(status_code=500),
    )
    results, verdict = nd.run_all_checks()
    assert results[2].status == nd.CheckStatus.FAIL
    assert verdict == "Service health failed → check Railway status"


def test_run_all_checks_all_passed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Conn:
        def __enter__(self) -> _Conn:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.2.3.4", 443)),
        ],
    )
    monkeypatch.setattr(socket, "create_connection", lambda *a, **k: _Conn())
    monkeypatch.setattr(
        httpx,
        "get",
        lambda url, timeout: SimpleNamespace(status_code=200),
    )
    results, verdict = nd.run_all_checks()
    assert all(r.status == nd.CheckStatus.OK for r in results)
    assert (
        verdict == "All checks passed — verify per-agent network state"
    )

# Created and developed by Jai Singh
