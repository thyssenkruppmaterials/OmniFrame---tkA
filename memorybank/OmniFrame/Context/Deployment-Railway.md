---
tags: [type/context, status/active, domain/infra]
created: 2026-04-10
---
# Deployment — Railway & Docker

## Purpose
Documents the production deployment architecture for OmniFrame logistics, which uses Railway with a multi-stage Docker build that packages both the React frontend and a Python/FastAPI backend into a single container.

## Docker Build (Multi-Stage)

### Stage 1: Frontend Builder (`node:20-alpine`)
- Uses **pnpm 9** with `--frozen-lockfile`
- Injects Vite environment variables as build-time ARGs:
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  - `VITE_API_URL` (defaults to `https://$RAILWAY_PUBLIC_DOMAIN`)
  - `VITE_RUST_CORE_ENABLED`, `VITE_RUST_CORE_URL`
  - `VITE_WORK_SERVICE_URL`, `VITE_WORK_SERVICE_WS_URL`
  - `VITE_STREAMING_SERVICE_URL`
- Runs `pnpm run frontend:build` (which does `tsc -b && vite build`)

### Stage 2: Runtime (`python:3.11-slim`)
- Installs system dependencies (gcc, g++, make, git)
- Configures SAP NW RFC SDK (`SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk`) — optional, gracefully disabled if absent
- Installs Python dependencies from `api/requirements.txt` with Cython pre-installed
- Attempts `pyrfc` from GitHub source — non-fatal if it fails
- Copies built frontend from Stage 1 into `/app/dist`
- Exposes port **8000**
- Health check: `GET http://localhost:8000/health` every 30s
- Start command: `python start.py`

## Railway Configuration (`railway.toml`)

```toml
[build]
builder = "DOCKERFILE"
watchPatterns = ["src/**", "api/**", "package.json", "pnpm-lock.yaml", "Dockerfile"]

[deploy]
startCommand = "python start.py"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
healthcheckPath = "/health"
healthcheckTimeout = 300

[[services]]
name = "onebox-ai-logistics"
port = 8000
```

### Key Design Decisions
- **Unified container**: Frontend static files served by FastAPI, not a separate CDN
- **Watch patterns**: Only rebuilds on src, api, package.json, lockfile, or Dockerfile changes
- **Restart policy**: ON_FAILURE with 10 max retries — no restart on clean exit
- **Health check timeout**: 300s to accommodate cold starts with SAP SDK loading

## Netlify Configuration (`netlify.toml`)

Used for **frontend-only** deployments (alternative to Railway for static hosting):

- Build: `npm run build` → publishes `dist/`
- SPA fallback: `/* → /index.html` (status 200)
- Cache headers strategy:
  - HTML / SW / build-info.json: `no-cache, must-revalidate` — always revalidate
  - Vite hashed assets (`/assets/*`): `max-age=31536000, immutable` — cache forever
  - Static images: `max-age=86400` (24h)
  - Workbox files: `no-cache, must-revalidate`
  - Manifest: `no-cache, must-revalidate`

## Rust Microservices (External)

The frontend connects to several Rust microservices on Railway:
- `rust-core-service-production.up.railway.app` — Core engine
- `rust-work-service-production.up.railway.app` — Work queue + WebSocket
- `rust-streaming-service-production.up.railway.app` — Streaming

These are separate Railway services, not part of this Docker build.

## Related
- [[Build-Configuration]] — Vite build config and chunk splitting
- [[Quality-Pipeline]] — CI/CD quality checks
- [[Infrastructure - Cache and Redis]] — Redis config used server-side
