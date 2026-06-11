# Sustainment Controls

## Automated Gates (CI-enforced)

| Gate | Script | Blocks On |
| ---- | ------ | --------- |
| Tracked artifact check | scripts/check-tracked-artifacts.mjs | *.new, *.temp, *.backup etc. tracked in git |
| Forbidden client env | scripts/check-forbidden-client-env.mjs | VITE_SUPABASE_SERVICE_ROLE_KEY in build env |
| Lint ratchet | scripts/lint-ratchet.mjs | New lint warnings above baseline |
| Bundle budget | scripts/check-bundle-budget.mjs | Bundle size exceeds budget |
| Check matrix alignment | scripts/validate-check-matrix.mjs | CI jobs don't match required-check-matrix.md |

## Quarterly Review Checklist

- [ ] Verify start.py is still a thin runner (no FastAPI() call)
- [ ] Verify no tracked transient artifacts (run check-tracked-artifacts.mjs)
- [ ] Verify audit_logs writes return typed status (run audit-integrity tests)
- [ ] Verify CORS_ALLOWED_ORIGINS is set in all Rust service deployments
- [ ] Review hotspot file sizes for new files exceeding 1000 lines
- [ ] Verify test counts meet minimum thresholds (9 unit, 3 integration, 7 Python)
- [ ] Verify all quality gate commands pass from a clean install (pnpm quality:check green)
