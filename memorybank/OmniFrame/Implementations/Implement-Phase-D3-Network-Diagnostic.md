---
tags: [type/implementation, status/active, domain/agent]
created: 2026-05-21
---
# Implement — Phase D3 Network Diagnostic

## Purpose / Context

Phase D3 of [[Plan-Multi-Session-Agent-Master]] adds **pure, testable** network diagnostics for failure mode **H** (fleet-wide work-service unreachable). Operators need to distinguish DNS (call IT) vs TCP/firewall vs Railway service health without Tk in the test path.

## Details

### Module: `omni_agent/master/network_diag.py`

| Symbol | Role |
|--------|------|
| `CheckStatus` | `pending`, `ok`, `fail` |
| `CheckResult` | `name`, `status`, `detail`, `latency_ms` |
| `resolve_work_service_host()` | Host from `OMNIFRAME_WORK_SERVICE_URL` (default production Railway URL) |
| `run_dns_check(host)` | `socket.getaddrinfo` |
| `run_tcp_check(host, port=443, timeout=3)` | `socket.create_connection` |
| `run_service_health_check(base_url, timeout=5)` | `httpx.get(f"{base_url}/health")` — OK on HTTP 200 |
| `compose_verdict(results)` | Operator headline (DNS → TCP → health precedence) |
| `run_all_checks()` | Orchestrator returning `(results, verdict)` |

### Verdict strings

1. `DNS failure → call IT`
2. `TCP blocked → check firewall/VPN`
3. `Service health failed → check Railway status`
4. `All checks passed — verify per-agent network state`

### Tests

`omni_agent/master/tests/test_network_diag.py` — 17 cases; mocks `socket.getaddrinfo`, `socket.create_connection`, `httpx.get` via `monkeypatch`. No Tk.

```bash
python3 -m pytest omni_agent/master/tests/test_network_diag.py -v
```

## Related

- [[Plan-Multi-Session-Agent-Master]] — Section 5 failure mode H
- [[Implement-Phase-B-Master-GUI-Skeleton]] — GUI will wire `show_network_diagnostic_dialog` in a later Phase D slice
- [[Implement-Phase-A-Worker-Hardening]]
