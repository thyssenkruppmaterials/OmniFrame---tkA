---
tags: [type/decision, status/active, domain/backend, domain/infra]
created: 2026-05-30
---
# ADR — Rust Dependency Modernization Roadmap (7 crates × 6 services)

## Purpose / Context
A comprehensive review (2026-05-30) of seven candidate crates across the six Rust services (`rust-core`, `rust-work`, `rust-streaming`, `rust-ai`, `rust-mdm`, `rust-dashboard`). Goal: real latency/correctness/observability wins without breaking the consumer contracts (FastAPI `api/lib/rust_core`, FE `src/lib/rust-core` + `src/lib/work-service`). Extends the prior [[Review-rust-dashboard-service-And-Consumer-Integration-utoipa]].

## Per-crate verdicts

| Crate | Verdict | Where / notes |
|---|---|---|
| **mimalloc** | ✅ Adopt fleet-wide | 3-line `#[global_allocator]`. glibc/bookworm everywhere → no musl pain, no Dockerfile change. Lands hardest on `rust-work` (WS fan-out) + `rust-streaming` (Bytes churn). **Shipped on rust-work 2026-05-30.** |
| **moka** | ✅ Adopt (selective) | In-process L1. `rust-core` RBAC cache (currently **unbounded** DashMap) + profile; `rust-work` **JWT-validation cache**; `rust-streaming` ExacqVision session (fixes 503/1611ms); `rust-mdm` `resolve_device_org`; `rust-dashboard` `/stats`. **Do NOT cache live work-queue/dispatch state** (realtime → staleness vs WS). **Shipped on rust-work 2026-05-30.** |
| **rust_decimal** | ⚠️ Scoped | Real latent bug: cycle-count `counted_quantity` + lx03/warehouse `SUM(...)::float8` round through binary `f64`. Scope to the **cycle-count write path** first. **Gotcha:** default serde emits a JSON *string* → would break Python `data.get()` + TS arithmetic. Use `serde-float` (number) or convert `Decimal→f64` at the DTO boundary. **Not** mdm (physical measurements) / dashboard (integer COUNT/SUM). |
| **utoipa** | ✅ Adopt, additive | Target **rust-core first** (most endpoints, 2 consumers). Feeds `openapi-typescript`+`openapi-fetch`+`openapi-react-query` → eliminates the ~600 lines of hand-mirrored TS DTOs; turns a future `Decimal`-as-string slip into a `tsc` compile error. **Landmine:** rust-core mixes per-struct `camelCase`/`snake_case` — codegen must respect it. Does NOT cover the `WsEvent` union. |
| **opentelemetry** | ⚙️ Needs own ADR | Today observability is **Prometheus-pull** (`metrics-exporter-prometheus`) — OTLP-push is a net-new direction. Env-gate (`OTEL_EXPORTER_OTLP_ENDPOINT`, no-op when unset). Wire FastAPI `traceparent` → Rust inbound-extract → reqwest/tonic inject. Collector on Railway → Tempo/Honeycomb. `tracing` registry already otel-ready. Would localize the FastAPI p99≈1s tail + the per-WS-connect auth chain. |
| **candle / ort** | 🛑 Defer | `rust-ai` is a **remote-inference proxy** (Qwen3-VL-8B via HF/Novita), never has pixels in hand. Local 8B on CPU-only Railway not viable. If local ever needed, **`ort` > candle** (ONNX model availability + CPU kernels + GPU-EP path). No prod evidence of slow inference calls yet. |
| **rqrr / bardecoder** | ✅ Adopt for barcode decode | Replace the model-based "barcode reading" prompt in `rust-ai` with deterministic, checksum-validated decode. **Format gap (be honest):** `rqrr`=QR only, `bardecoder`=EAN-13/EAN-8 only — **Code128/Code39/DataMatrix not covered**; warehouses need those → use `rxing`/zxing for the 1D family + DataMatrix. |

## Sequencing
Prod fixes ([[Fix-Work-Service-Monorepo-Root-Directory-Misdeploy-2026-05-30]]) → **mimalloc** (fleet) → **moka** (auth/settings/session/metadata) → **utoipa** on rust-core + typed FE client → **rust_decimal** (cycle-count write path) → **rqrr/rxing** barcode decode → **opentelemetry** (after ADR + collector) → candle/ort (only with traffic evidence).

## Constraints this initiative MUST respect
- **sqlx pinned `=0.8.6`** fleet-wide — do not unpin (see [[Upgrade-Sqlx-08-Core-Service]]).
- **Listener pool stays session-mode/direct** — never route `PgListener` through transaction-mode pooling.
- **Bounded Prometheus labels** — use `org_hash_label()`; no raw UUIDs.
- **No decimal crate by default** — accepted pattern is `NUMERIC::float8` in SQL; `rust_decimal` needs a concrete money/qty-SUM justification.
- **`WsEvent` is a closed typed enum** (envelope rejected) — keep that shape; utoipa won't cover WS.
- **Fleet uniformity** — axum 0.7 / tower 0.4 / tower-http 0.5; utoipa 4.x is compatible.
- Respect the [[ADR-Rust-Work-Service-Availability-SLO]] (`/ws` ≥ 99.9%, p95 < 200ms) for anything landing on rust-work.

## Status
- **mimalloc + moka shipped on `rust-work-service` (v0.1.44, 2026-05-30)** — see [[Implement-Mimalloc-And-Moka-Auth-Cache-Work-Service]]. Live cache hit rate ~85% immediately post-deploy.

## Related
- [[Review-rust-dashboard-service-And-Consumer-Integration-utoipa]]
- [[Implement-Mimalloc-And-Moka-Auth-Cache-Work-Service]]
- [[ADR-Rust-Work-Service-Availability-SLO]]
- [[Roadmap-Rust-WS-Unlocks]]
- [[Upgrade-Sqlx-08-Core-Service]]
