# Created and developed by Jai Singh
"""Pure network diagnostics for rust-work-service reachability (Phase D3).

No Tk — all functions are unit-testable. Used by the master Fix FSM failure
mode H (fleet-wide WS down) to classify DNS vs firewall vs service outages.
"""

from __future__ import annotations

import os
import socket
import time
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlparse

import httpx

DEFAULT_WORK_SERVICE_URL = (
    "https://rust-work-service-production.up.railway.app"
)

DNS_CHECK = "dns"
TCP_CHECK = "tcp"
HEALTH_CHECK = "service_health"


class CheckStatus(str, Enum):
    PENDING = "pending"
    OK = "ok"
    FAIL = "fail"


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: CheckStatus
    detail: str
    latency_ms: float | None = None


def resolve_work_service_url() -> str:
    """Full base URL for rust-work-service (scheme + host, optional path)."""
    raw = os.environ.get("OMNIFRAME_WORK_SERVICE_URL", DEFAULT_WORK_SERVICE_URL)
    return raw.strip() or DEFAULT_WORK_SERVICE_URL


def resolve_work_service_host() -> str:
    """Hostname extracted from ``OMNIFRAME_WORK_SERVICE_URL`` (or production default)."""
    parsed = urlparse(resolve_work_service_url())
    host = parsed.hostname
    if not host:
        # Bare hostname without scheme (e.g. rust-work-service.example.com)
        path_host = (parsed.path or "").split("/")[0]
        host = path_host or None
    if not host:
        raise ValueError(
            "OMNIFRAME_WORK_SERVICE_URL must include a hostname "
            f"(got {resolve_work_service_url()!r})"
        )
    return host


def run_dns_check(host: str) -> CheckResult:
    """Resolve ``host`` via ``socket.getaddrinfo`` (port hint 443)."""
    started = time.perf_counter()
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        elapsed_ms = (time.perf_counter() - started) * 1000
        addrs = sorted({info[4][0] for info in infos})
        preview = ", ".join(addrs[:5])
        if len(addrs) > 5:
            preview = f"{preview} (+{len(addrs) - 5} more)"
        return CheckResult(
            name=DNS_CHECK,
            status=CheckStatus.OK,
            detail=f"{host} → {preview}",
            latency_ms=round(elapsed_ms, 1),
        )
    except OSError as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return CheckResult(
            name=DNS_CHECK,
            status=CheckStatus.FAIL,
            detail=f"{host}: {exc}",
            latency_ms=round(elapsed_ms, 1),
        )


def run_tcp_check(host: str, port: int = 443, timeout: float = 3) -> CheckResult:
    """TCP connect probe to ``host:port``."""
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
        elapsed_ms = (time.perf_counter() - started) * 1000
        return CheckResult(
            name=TCP_CHECK,
            status=CheckStatus.OK,
            detail=f"{host}:{port} reachable",
            latency_ms=round(elapsed_ms, 1),
        )
    except OSError as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return CheckResult(
            name=TCP_CHECK,
            status=CheckStatus.FAIL,
            detail=f"{host}:{port}: {exc}",
            latency_ms=round(elapsed_ms, 1),
        )


def run_service_health_check(
    base_url: str,
    timeout: float = 5,
) -> CheckResult:
    """``GET {base_url}/health`` — success on HTTP 200."""
    url = f"{base_url.rstrip('/')}/health"
    started = time.perf_counter()
    try:
        resp = httpx.get(url, timeout=timeout)
        elapsed_ms = (time.perf_counter() - started) * 1000
        if resp.status_code == 200:
            return CheckResult(
                name=HEALTH_CHECK,
                status=CheckStatus.OK,
                detail=f"HTTP {resp.status_code}",
                latency_ms=round(elapsed_ms, 1),
            )
        return CheckResult(
            name=HEALTH_CHECK,
            status=CheckStatus.FAIL,
            detail=f"HTTP {resp.status_code}",
            latency_ms=round(elapsed_ms, 1),
        )
    except httpx.HTTPError as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return CheckResult(
            name=HEALTH_CHECK,
            status=CheckStatus.FAIL,
            detail=str(exc),
            latency_ms=round(elapsed_ms, 1),
        )


def compose_verdict(results: list[CheckResult]) -> str:
    """Map ordered check outcomes to an operator-facing headline."""
    by_name = {r.name: r for r in results}
    dns = by_name.get(DNS_CHECK)
    tcp = by_name.get(TCP_CHECK)
    health = by_name.get(HEALTH_CHECK)

    if dns is not None and dns.status == CheckStatus.FAIL:
        return "DNS failure → call IT"
    if tcp is not None and tcp.status == CheckStatus.FAIL:
        return "TCP blocked → check firewall/VPN"
    if health is not None and health.status == CheckStatus.FAIL:
        return "Service health failed → check Railway status"
    return "All checks passed — verify per-agent network state"


def run_all_checks() -> tuple[list[CheckResult], str]:
    """Run DNS → TCP → service health and return results + verdict."""
    base_url = resolve_work_service_url()
    host = resolve_work_service_host()
    results = [
        run_dns_check(host),
        run_tcp_check(host),
        run_service_health_check(base_url),
    ]
    return results, compose_verdict(results)

# Created and developed by Jai Singh
