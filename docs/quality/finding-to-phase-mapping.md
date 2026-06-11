# Finding-to-Phase Mapping

Frozen: 2026-03-05

## Register

| Finding | Severity | Owner Phase | Description |
| ------- | -------- | ----------- | ----------- |
| A-01 | Critical | Phase 01 | Production runtime uses a second FastAPI app path and bypasses canonical middleware topology |
| A-02 | High | Phase 01 | Unified deployment path does not register the full router set (missing `customer_tickets`, `webhooks`) |
| A-03 | High | Phase 03 | Audit writes can fail without surfacing hard enough in permission-validation results |
| A-04 | Medium | Phase 02 | `PermissionProvider` is mounted twice, creating duplicate permission-loading side effects |
| A-05 | Medium | Phase 05 | Rust service browser ingress is too permissive (`allow_origin(Any)`) in core/work/streaming |
| A-06 | Low | Phase 06 | Repo lacks `.gitignore` coverage for common transient artifact patterns |
| A-07 | Medium | Phase 07 | Several large frontend and Python files concentrate too much logic |
| A-08 | Medium | Phase 08 | Test coverage breadth is too narrow for repo size and critical flows |
| A-09 | Low | Phase 10 | Residual lint and build warnings remain |
| A-10 | Low | Phase 04 | Browser env warns about service-role exposure; Python auth fallback remains risky |
| A-11 | High | Phase 06 | Documentation files contain real Supabase service-role keys and credentials |
| A-12 | Low | Phase 02 | Legacy auth provider still in use alongside canonical unified provider |

## Acceptance Tests per Finding

| Finding | Acceptance Test |
| ------- | --------------- |
| A-01 | `start.py` imports `app` from `api.main`; no second `FastAPI()` call exists |
| A-02 | Route parity test proves all 14 routers are available in unified deployment |
| A-03 | `ServerPermissionResult.audit_id` is `null` on failure; no synthetic IDs |
| A-04 | Single `PermissionProvider` mount; deterministic test proves one load per auth transition |
| A-05 | No `allow_origin(Any)` in core/work/streaming; CORS env-driven |
| A-06 | `.gitignore` covers `*.new`, `*.temp`, `*.backup`, `node_modules_old/`, `supabase/.temp/` |
| A-07 | No hotspot file remains a single catch-all for multiple concerns |
| A-08 | Frontend unit tests >= 9, integration >= 3, Python modules >= 7 |
| A-09 | `pnpm lint:check` and `pnpm build` produce no actionable warnings |
| A-10 | Build fails if `VITE_SUPABASE_SERVICE_ROLE_KEY` is set; fallback requires `ENVIRONMENT=local` + `ALLOW_INSECURE_JWT_FALLBACK=true` |
| A-11 | No real keys in `api/INSTALL.md` or `api/env_config.txt` |
| A-12 | Legacy `auth-provider.tsx` consolidated or documented with clear ownership boundaries |
