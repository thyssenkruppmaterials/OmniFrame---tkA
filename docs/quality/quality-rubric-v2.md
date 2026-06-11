# OneBox AI Quality Rubric v2

> Approved: 2026-02-15 | Target: >= 8.7/10 composite score

## Dimensions (0-10 each, equally weighted)

### 1. Test Reliability (weight: 20%)

| Score | Criteria |
|-------|----------|
| 10 | 100% unit pass, >= 95% integration pass, zero infra-mismatch false failures |
| 8 | 100% unit pass, integration tests skip cleanly when infra absent |
| 6 | >= 95% unit pass, integration tests isolated but some flaky |
| 4 | Unit tests pass but integration tests have env-dependent failures |
| 2 | Multiple test failures unrelated to code changes |
| 0 | Tests do not run or are not configured |

### 2. CI Enforcement Completeness (weight: 20%)

| Score | Criteria |
|-------|----------|
| 10 | All lanes strict, no placeholders, no soft-pass, artifact uploads |
| 8 | All lanes strict, minor missing artifacts |
| 6 | Most lanes strict, one soft-pass with documented exception |
| 4 | Multiple soft-pass patterns or placeholder jobs |
| 2 | CI exists but does not block merges on failures |
| 0 | No CI configured |

### 3. Lint/Format Determinism (weight: 20%)

| Score | Criteria |
|-------|----------|
| 10 | Deterministic pass/fail, no traversal errors, check-only in CI |
| 8 | Deterministic with minor scope issues |
| 6 | Works but has EPERM or generated-file traversal risks |
| 4 | CI auto-fixes instead of check-only |
| 2 | Lint/format frequently fails due to environment issues |
| 0 | Not configured |

### 4. Backend Test Maturity (weight: 20%)

| Score | Criteria |
|-------|----------|
| 10 | Full pytest suite with markers, fixtures, coverage, CI integration |
| 8 | Smoke suite covers critical paths, CI runs real tests |
| 6 | Basic tests exist, CI runs them |
| 4 | Tests exist but CI uses placeholder |
| 2 | No tests, pytest infrastructure partially set up |
| 0 | No test infrastructure at all |

### 5. Rust Reliability and Maintainability (weight: 20%)

| Score | Criteria |
|-------|----------|
| 10 | Zero warnings, no future-incompat, CI strict, tests pass |
| 8 | <= 5 warnings, future-incompat documented/mitigated, CI strict |
| 6 | Warnings reduced >= 60% from baseline, CI strict |
| 4 | Warnings present, CI soft-pass removed but some test instability |
| 2 | Many warnings, CI soft-pass, future-incompat unaddressed |
| 0 | Does not compile |

## Thresholds for Target Score (>= 8.7)

- Unit tests: 100% pass rate
- Integration tests: >= 95% pass rate OR clean skip with preflight proof
- CI: No placeholder jobs, no `|| true` soft-pass for required suites
- Lint/format: Deterministic pass/fail without EPERM traversal failures
- Python: Real pytest suite in CI, zero accidental script collection
- Rust: Warning count reduced by >= 60% from baseline (16 -> <= 6), no unresolved future-compat blockers

## Scoring Formula

```
composite = (test_reliability + ci_enforcement + lint_format + backend_test + rust_reliability) / 5
```

## Exclusions

- Exposed development credential remediation is excluded from scoring per scope lock.
- Other Rust services (rust-work-service, rust-ai-service, rust-streaming-service, rust-dashboard-service) are excluded from this cycle.
