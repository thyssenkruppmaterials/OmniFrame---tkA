---
tags: [type/decision, status/active, domain/backend, domain/api, domain/frontend, domain/infra]
created: 2026-05-30
---
# Review: rust-dashboard-service + Consumer Integration (utoipa payoff)

## Purpose / Context
Crate/dependency review of `rust-dashboard-service` plus the consumer integration
surface (FastAPI + React) to assess utoipa/moka/otel/mimalloc/rust_decimal and
whether a utoipa→typed-frontend-client effort is worth it. Captures the
ground-truth contract shapes so any future codegen migration is additive and
non-breaking.

## Key facts found
- Crate is actually named **`drone-dashboard-service`** (binary `dashboard-service`),
  not a generic KPI service. Source is `main.rs` (stats/aggregation), `omnibelt.rs`
  (the real hot endpoint), `auth.rs`, `middleware.rs`. There is **no** `handlers/kpis.rs`
  or `services/metrics_service.rs`.
- Deps differ from the brief: tower-http **0.5** (not 0.6), **no `tower`** direct dep,
  **bb8 + bb8-redis 0.16** (not `redis 0.27`), **no moka**, **no otel**, **no mimalloc**,
  **no rust_decimal**, **no utoipa**, reqwest **0.11** (older than core's 0.11 too).

## Cross-service version spread (matters for utoipa/otel)
All six services: **axum 0.7**, **tower 0.4** (dashboard has none), **tower-http 0.5**.
The brief's premise that dashboard runs newer tower 0.5/tower-http 0.6 is FALSE —
the whole fleet is uniform. utoipa 4.x + utoipa-swagger-ui 6/7 work fine on axum 0.7.
utoipa-axum (router-binding helper) needs axum 0.7 — fine. No version-alignment
work is required to add utoipa.

## Consumer integration map (file:line evidence)
- FastAPI→rust-core: `api/lib/rust_core/__init__.py` (was the brief's "rust_core.py";
  now a package). Plain **httpx HTTP** client, hand-written `@dataclass` result types
  (`ValidationResult` L33, `AuthenticatedUserResult` L45, `WarehouseStats` L79).
  Calls `POST /api/v1/auth/validate-with-profile` (L327), `/api/v1/auth/validate`,
  `/api/v1/cache/{key}`, `/api/v1/warehouse/*`, `POST /api/v1/query`. Parses with
  `data.get(...)` — loosely typed, drops unknown fields.
- FastAPI→rust-dashboard: `api/routers/omnibelt.py` L388 `bootstrap_proxy` →
  `GET {RUST_DASHBOARD_SERVICE_URL}/omnibelt/bootstrap` (L410), forwards JWT verbatim,
  falls back to direct Supabase read on 5xx/unreachable. Default URL
  `http://rust-dashboard-service:8002` (L83-85).
- FE→rust-core: `src/lib/rust-core/client.ts` — hand-written `fetch` wrapper +
  hand-written interfaces (`InboundScan`, `TransferOrder`, `WarehouseStats`,
  `DashboardStats` etc.). Gated by `VITE_RUST_CORE_ENABLED` (`config.ts` L9-10),
  `VITE_RUST_CORE_URL` (L14). `SUPPORTED_RUST_QUERIES` allowlist in config.ts.
- FE→work-service: `src/lib/work-service/client.ts` + ~12 sibling clients — hand-written
  `fetchWithAuth`, hand-written types in `types.ts`/`work-task-types.ts`. Gated by
  `VITE_WORK_SERVICE_URL` (default :8030).
- FE→dashboard: only via FastAPI proxy. `src/features/omnibelt/hooks/useOmnibeltBootstrap.ts`
  L63 `OmnibeltBootstrap` interface is explicitly **"Mirror of the Rust struct in
  rust-dashboard-service/src/omnibelt.rs"** (hand-maintained drift risk). Calls
  `apiFetch('/api/omnibelt/bootstrap')` L279.
- Vite proxy (`vite.config.ts` L89-92): only `/api → http://localhost:8000` (FastAPI).
  Rust services are NOT proxied through Vite — FE hits them directly via VITE_* URLs.

## Codegen tooling
**None.** No openapi/swagger/orval/openapi-typescript/hey-api/kubb/codegen anywhere in
package.json. 100% of cross-service types are hand-written and manually kept in sync.

## serde casing (utoipa documents whatever serde emits)
Dashboard structs use **default snake_case** (no `rename_all`) — matches the FE
hand-written snake_case interfaces exactly, so utoipa would be a clean drop-in for
this service. BUT rust-core-service uses `#[serde(rename_all = "camelCase")]` heavily
(`smartsheet.rs`, `lx03.rs`) — any core-service codegen must respect that or it breaks
FE consumers expecting camelCase.

## rust_decimal audit (dashboard)
KPI numbers are **f64**, not Decimal:
- `main.rs:61` `avg_processing_time_ms: f64`
- `main.rs:328/384` SQL `AVG(ai_processing_time_ms)::float8`
- `omnibelt.rs:95` `ActiveJob.progress: f64`
These are timings/progress %, NOT money or summed quantities — f64 is acceptable here.
There are no money/quantity SUMs in this service, so the rust_decimal concern doesn't
bite for dashboard. (Counts are i64 via COUNT/SUM-of-int — correct.)

## Recommendation
utoipa is **additive and safe** (a spec generator doesn't change runtime JSON), but the
**payoff is low for dashboard specifically** — its only consumer-facing contract is one
endpoint (`/omnibelt/bootstrap`) already mirrored by a single FE interface. The higher-ROI
target is **rust-core-service** (many endpoints, camelCase, two consumers FastAPI+FE).
If pursued: utoipa derive on response structs → `/api-docs/openapi.json` → `openapi-typescript`
(lighter than orval; orval if TanStack hooks wanted) checked into CI to diff against committed
types. Biggest breakage risk = serde casing mismatch on core-service.

## Related
- [[Roadmap-Rust-WS-Unlocks]]
- [[ADR-Presence-Architecture-Next-Steps]]
