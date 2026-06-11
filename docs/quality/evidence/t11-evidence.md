# T11 Evidence - Strengthen CI Gate Semantics

**Agent**: Agent-CI
**Status**: Complete

## Files Changed
- `.github/workflows/ci.yml` — Added summary annotations to all 4 jobs; enhanced integration lane with skip reporting; added `REQUIRE_INTEGRATION_INFRA` env var support; Python job has `TESTING=true` and zero-test guard
- `docs/quality/required-check-matrix.md` (new) — Documents required checks and branch protection expectations

## Command Transcript
1. CI workflow validated syntactically

## Before/After
- **Before**: CI could pass with 0 meaningful assertions in integration/python lanes; no summary output
- **After**: All jobs emit `$GITHUB_STEP_SUMMARY`; Python fails on 0 tests collected; integration reports executed vs. skipped

## Rollback
- Revert CI workflow to previous version

## Residual Risk
- Branch protection settings must be configured manually in GitHub (not automatable via workflow file)
