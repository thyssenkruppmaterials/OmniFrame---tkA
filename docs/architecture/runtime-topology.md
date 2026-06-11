# OneBox Runtime Topology

## Entry Points

| Entry Point | File | Command | App Object | Notes |
| ----------- | ---- | ------- | ---------- | ----- |
| Railway / Root Docker | start.py | python start.py | api.main.app | Thin runner; sets SERVE_FRONTEND=true when dist/ exists |
| API-only Docker | api/Dockerfile | uvicorn main:app | api.main.app | API only, no frontend |
| Local dev (API) | api/scripts/start_dev.py | uvicorn main:app | api.main.app | Hot-reload enabled |
| Local dev (Frontend) | n/a | pnpm dev | Vite dev server | Proxies /api to Python backend |

## Single App Composition

All entry points use the same `api.main.app` FastAPI object which owns:
- Full middleware stack (CORS, TrustedHost, Session, RateLimit, security headers)
- All 14 API routers
- 6 health endpoints
- Conditional frontend serving via api/frontend_static.py

## Environment Variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| SERVE_FRONTEND | No | false | Enable static frontend serving |
| FRONTEND_DIST_DIR | No | ../dist | Path to built frontend |
| CORS_ALLOWED_ORIGINS | Yes (prod) | localhost:5173,localhost:3000 | Comma-separated origin allowlist for Rust services |
| ALLOW_INSECURE_JWT_FALLBACK | No | false | Must be true (with ENVIRONMENT=local) for JWT fallback |

## Known Gaps

| Service | Gap | Impact | Recommended Fix |
| ------- | --- | ------ | --------------- |
| rust-streaming-service | No auth middleware | All camera/stream endpoints are public | Add JWT or ticket-based auth before internet-facing exposure |
| rust-work-service | WebSocket unauthenticated | /ws accepts connections without auth; events broadcast globally | Add auth on upgrade and org-scoped delivery |
| rust-streaming-service | TLS validation disabled | Exacq client uses danger_accept_invalid_certs(true) | Add EXACQ_ALLOW_INVALID_CERTS env flag defaulting to false |
