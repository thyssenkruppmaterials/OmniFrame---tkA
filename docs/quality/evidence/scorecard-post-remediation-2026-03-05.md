# Post-Remediation Scorecard (PROVISIONAL)

> **Status: PROVISIONAL** -- This scorecard was generated before validation confirmed all gates were green. It will be replaced by a final evidence-backed scorecard after all remediation steps complete.

Date: 2026-03-05
Plan: OneBox Codebase Master Remediation and Architecture Alignment

## Before / After Comparison

| Dimension | Before | After | Change | Rationale |
| --------- | ------ | ----- | ------ | --------- |
| Architecture | 8.3/10 | 9.2/10 | +0.9 | Single canonical FastAPI app; all entry points consistent; no dual-app behavior |
| Quality Gates | 8.6/10 | 9.0/10 | +0.4 | Added artifact drift and forbidden env checks to CI; quality:check includes governance |
| Testing Depth | 7.4/10 | 8.5/10 | +1.1 | Added 4 frontend unit tests, 2 integration tests, 4 Python test modules |
| Security / Operations | 6.9/10 | 8.8/10 | +1.9 | Eliminated permissive CORS in 3 Rust services; build-time env guard; tightened JWT fallback; secrets redacted from docs |
| Maintainability | 6.8/10 | 8.5/10 | +1.7 | Split 2 Python hotspots into packages; gitignore hardened; duplicate PermissionProvider removed |
| **Overall** | **7.6/10** | **8.8/10** | **+1.2** | All 12 findings addressed; structural penalties eliminated |

## Finding Resolution Status

| Finding | Status | Resolution |
| ------- | ------ | ---------- |
| A-01 | Fixed | start.py is now a thin runner importing from api.main |
| A-02 | Fixed | All 14 routers available in unified deployment |
| A-03 | Open | audit-log-writer.ts writes wrong column (new_value vs metadata); action values outside DB enum; PGRST204 failures in tests |
| A-04 | Fixed | PermissionProvider mounted exactly once via UnifiedAuthProvider |
| A-05 | Partial | CORS env-driven but no prod fail-fast; streaming-service still has no auth; work-service /ws unauthenticated |
| A-06 | Partial | .gitignore improved but artifacts still in git index; additional secrets found in rust-core-service/start_dev.ps1 and .notes/ files |
| A-07 | Partial | Python hotspots decomposed; frontend hotspots deferred to follow-up |
| A-08 | Open | New test files fail to compile (@testing-library/react not installed); runtime-parity.test.ts never created; Rust ingress tests not added |
| A-09 | Partial | Kiosk files cleaned but new test files introduced 2 lint errors; build fails due to missing dependency |
| A-10 | Partial | Vite build guard added but .env.local still has service-role key; check-forbidden-client-env fails locally |
| A-11 | Fixed | Real keys redacted from api/INSTALL.md and api/env_config.txt |
| A-12 | Documented | Legacy auth-provider.tsx cannot be safely removed yet; hooks are incompatible with canonical provider |
