# Stability Remediation Scorecard

Date: 2026-03-06
Plan: OneBox Stability, Security, and Re-Score Plan

## Validation Matrix Results

| Command | Result |
| ------- | ------ |
| `node scripts/check-tracked-artifacts.mjs` | PASS (no forbidden artifacts) |
| `node scripts/check-forbidden-client-env.mjs` | PASS (no service-role key in env files) |
| `node scripts/validate-check-matrix.mjs` | PASS (6 documented jobs match ci.yml) |
| `pnpm lint:check` | PASS (0 errors, 5 warnings) |
| `pnpm build` | PASS |
| `pnpm test:unit` | PASS (9 files, 112 tests) |
| `pnpm test:integration` | PASS (3 files, 17 passed, 26 skipped) |
| `python -m pytest -q api/tests` | PASS (37 passed) |
| `cargo test rust-core-service` | PASS (23 passed, 2 ignored) |
| `cargo test rust-ai-service` | PASS (3 passed) |
| `cargo test rust-work-service` | PASS (16 passed) |
| `cargo test rust-dashboard-service` | PASS (7 passed) |
| `cargo test rust-streaming-service` | PASS (14 passed) |
| `pnpm audit --prod --audit-level high` | PASS (no known vulnerabilities) |

## Before / After Comparison

| Dimension | Pre-Remediation | Post-First-Remediation (provisional) | Post-Stability-Fix (this) | Change |
| --------- | --------------- | ------------------------------------- | ------------------------- | ------ |
| Architecture | 8.3/10 | 9.2 (overstated) | 8.8/10 | +0.5 |
| Quality Gates | 8.6/10 | 9.0 (broken) | 8.8/10 | +0.2 |
| Testing Depth | 7.4/10 | 8.5 (overstated) | 8.0/10 | +0.6 |
| Security / Operations | 6.9/10 | 8.8 (overstated) | 7.8/10 | +0.9 |
| Maintainability | 6.8/10 | 8.5 (overstated) | 8.2/10 | +1.4 |
| **Overall** | **7.6/10** | **8.8 (overstated)** | **8.3/10** | **+0.7** |

## Score Rationale

### Architecture: 8.8/10 (+0.5)
- Single canonical FastAPI app; `start.py` is a thin runner
- Environment-driven trusted hosts and CORS origins (Railway domains included)
- Session secret key configurable instead of random per restart
- Static serving returns proper 404s instead of falling back to index.html
- Remaining gap: `sys.path` mutation still needed; no full `create_app()` factory pattern yet

### Quality Gates: 8.8/10 (+0.2)
- All governance checks pass from clean install
- CI summaries now report actual step outcomes instead of hardcoded greens
- `quality:ci` mirrors `quality:check`
- Forbidden-env scanning covers all Vite env file variants
- pnpm caching and frozen lockfile in CI
- Remaining gap: Branch protection verification still "Pending" in required-check-matrix.md

### Testing Depth: 8.0/10 (+0.6)
- Frontend unit: 9 files, 112 tests (up from 5 files)
- Integration: 3 files, 17 deterministic tests (up from 1 file)
- Python: 7 modules, 37 tests (up from 3 modules)
- Audit integrity tests now behavioral (mock Supabase, verify column names)
- Route parity test covers 8 prefixes + health endpoint count
- Remaining gap: No runtime-parity frontend integration test; no Rust CORS/auth tests; streaming/work-service auth not testable until auth is implemented

### Security / Operations: 7.8/10 (+0.9)
- Service-role client no longer attached to normal requests
- Frontend session/user management migrated away from browser supabaseAdmin
- Audit writers use correct schema columns (metadata, not new_value/details)
- Audit actions mapped to valid enum values
- Secrets redacted from 8+ files across the repo
- Password QR codes removed from onboarding printouts
- Onboarding enforces organization ownership from authenticated actor
- CORS fail-fast warnings in production for all 3 Rust services
- Remaining gaps: streaming-service still has no auth middleware; work-service /ws still unauthenticated; audit_action enum not yet extended via migration; rbac_audit_logs types not regenerated

### Maintainability: 8.2/10 (+1.4)
- Python hotspots decomposed (admin package, smartsheet package)
- .gitignore aligned with artifact check patterns
- navigationStore role identity mismatch fixed (UUID vs name)
- CI local/remote parity enforced
- Known gaps documented in runtime-topology.md
- Remaining gap: Legacy auth-provider.tsx still coexists with canonical provider

## Finding Resolution Status (Final)

| Finding | Status | Resolution |
| ------- | ------ | ---------- |
| A-01 | Fixed | start.py is a thin runner importing from api.main |
| A-02 | Fixed | All 14 routers available in unified deployment |
| A-03 | Fixed | audit-log-writer uses correct column; actions mapped to valid enum; no synthetic IDs |
| A-04 | Fixed | PermissionProvider mounted once; role identity mismatch fixed |
| A-05 | Partial | CORS env-driven with prod warnings; streaming-service auth gap documented but not yet implemented |
| A-06 | Fixed | .gitignore covers all patterns; CI enforces artifact drift; secrets redacted from 8+ files |
| A-07 | Partial | Python hotspots decomposed; frontend hotspots deferred |
| A-08 | Fixed | Test breadth: 9 unit files, 3 integration files, 7 Python modules |
| A-09 | Fixed | 0 lint errors; kiosk any-casts and eslint-disable removed |
| A-10 | Fixed | Build guard active; .env.local cleaned; fallback requires local + explicit opt-in |
| A-11 | Fixed | Secrets redacted from docs, scripts, dev tools, and .notes files |
| A-12 | Documented | Legacy auth-provider.tsx remains; hooks incompatible with canonical provider |

## Open Items (Future Work)

1. Implement auth middleware for rust-streaming-service (camera/stream endpoints)
2. Implement auth-on-upgrade for rust-work-service WebSocket with org-scoped delivery
3. Extend audit_action DB enum via migration to include additional action types
4. Regenerate database.types.ts to include rbac_audit_logs
5. Create backend API endpoints for session termination (currently frontend-only TODO)
6. Create backend API endpoints for remaining user-management admin operations
7. Consolidate legacy auth-provider.tsx into canonical unified-auth-provider
8. Verify and record GitHub branch protection settings
9. Add Exacq TLS validation env flag (EXACQ_ALLOW_INVALID_CERTS)
10. Frontend hotspot decomposition (20+ files over 1000 lines deferred)
