# Route Inventory Baseline

Frozen: 2026-03-05
Source: `api/main.py` lines 582-595

## Canonical Router Registration

| Router | Prefix | Tags | In `start.py`? |
| ------ | ------ | ---- | --------------- |
| `test.router` | `/api/test` | Testing | Yes |
| `analytics.router` | `/api/analytics` | Analytics | Yes |
| `reports.router` | `/api/reports` | Reports | Yes |
| `smartsheet.router` | `/api` | Smartsheet | Yes |
| `customer_tickets.router` | `/api` | Customer Tickets | NO - missing |
| `webhooks.router` | `/api` | Webhooks | NO - missing |
| `admin.router` | `/api/admin` | Admin | Yes |
| `lx03_import.router` | `/api` | LX03 Import | Yes |
| `nefab.router` | `/api` | Nefab PFC Trace | Yes |
| `sap.router` | `/api` | SAP Integration | Yes |
| `proxy.router` | `/api` | Proxy | Yes |
| `shift_productivity.router` | `/api/shift-productivity` | Shift Productivity | Yes |
| `camera.router` | `/api` | Camera | Yes |
| `drone.router` | `/api` | Drone Scanner | Yes |

## Health Endpoints (api/main.py only)

| Endpoint | Available in `start.py`? |
| -------- | ------------------------ |
| `/health` | Yes (simple version) |
| `/health/database` | NO |
| `/health/auth` | NO |
| `/health/auth/session-test` | NO |
| `/health/rust-core` | NO |
| `/health/security` | NO |

## Middleware Stack (api/main.py only)

| Middleware | Available in `start.py`? |
| ---------- | ------------------------ |
| CORSMiddleware | Yes (but `allow_origins=["*"]`) |
| TrustedHostMiddleware | NO |
| SessionMiddleware | NO |
| RateLimitMiddleware | NO |
| Security headers | NO |
| Process time header | NO |
| Request ID header | NO |
| Security monitoring | NO |

## Parity Test Contract

After Phase 01 completion, the unified runtime via `python start.py` must expose all 14 routers,
all 6 health endpoints, and all 8 middleware layers listed above.
