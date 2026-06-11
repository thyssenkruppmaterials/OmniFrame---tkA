# Quality Scoring Rubric v3

> Effective: 2026-02-15
> Exclusion: `excluded_by_request: ["hard_coded_credentials"]`

## Scoring Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Test reliability | 30% | All test suites execute, assert behavior, pass deterministically |
| Code quality gates | 25% | Lint and format gates exit 0 with no bypasses |
| CI enforcement rigor | 20% | All quality lanes mandatory, no continue-on-error |
| Backend reliability | 15% | Python and Rust services build, test, and start cleanly |
| Build/release robustness | 10% | No bundling hazards, chunk budgets met, clean warnings |

## Scoring Scale (per dimension)

| Score | Criteria |
|-------|----------|
| 10 | Gate fully green, zero issues, enforced in CI |
| 9 | Gate green, minor non-blocking warnings documented |
| 8 | Gate green with justified exceptions (< 5) |
| 7 | Gate mostly green, small residual backlog with owner |
| 6 | Gate fails but root cause identified and fix in progress |
| 5 | Gate fails, partial fix, significant backlog remains |
| < 5 | Gate fails, no clear path to resolution |

## Baseline Score (2026-02-15)

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Test reliability | 4.5 | Unit pass, integration crash, Rust abort; 2/4 suites failing |
| Code quality gates | 2.0 | 4434 lint errors, 612 format failures; both gates red |
| CI enforcement rigor | 5.0 | CI exists but integration is optional (continue-on-error) |
| Backend reliability | 7.0 | Python passes with deprecation warnings; Rust check passes |
| Build/release robustness | 6.0 | Build succeeds but emits chunk warnings, ioredis externalization |

**Weighted baseline score**: (4.5×0.30) + (2.0×0.25) + (5.0×0.20) + (7.0×0.15) + (6.0×0.10) = 1.35 + 0.50 + 1.00 + 1.05 + 0.60 = **4.50 / 10.0**

## Target Score

**>= 9.0 / 10.0** (credential findings excluded by request)

## Excluded Findings

| Finding | Exclusion Reason |
|---------|-----------------|
| Hard-coded credentials | Excluded by stakeholder request |
