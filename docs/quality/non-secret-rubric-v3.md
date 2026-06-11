# Non-Secret Quality Rubric v3

> **Scope:** Excludes secret dev credential findings per [scope-lock-non-secret-2026-02-16.md](scope-lock-non-secret-2026-02-16.md).

## Score Summary

| Metric | Value |
|--------|-------|
| Baseline Score | 88/100 |
| Target Score | 95+/100 |
| Scoring Date | 2026-02-16 |

## Weighted Categories

| # | Category | Weight | Baseline | Target | Description |
|---|----------|--------|----------|--------|-------------|
| 1 | Test Signal Integrity | 20 | 14/20 | 19/20 | Integration tests execute deterministically, no misreporting, non-zero execution enforced |
| 2 | Dependency Risk | 15 | 8/15 | 14/15 | No unresolved high-severity audit findings without approved time-boxed exception |
| 3 | Build/Performance Health | 15 | 11/15 | 14/15 | Bundle budgets enforced, chunk warnings resolved, no advisory-only gates |
| 4 | Static Quality | 20 | 14/20 | 18/20 | Lint warnings in low two-digit range, zero in critical paths, ratchet prevents regression |
| 5 | Backend Modernization | 15 | 12/15 | 14/15 | Python/Rust deprecation warnings resolved, warning budgets enforced |
| 6 | CI Governance | 15 | 12/15 | 14/15 | Required checks aligned 1:1, all gates hard-enforced |
| | **Total** | **100** | **71/100 → 88%** | **93/100 → 95%** | |

## Hard Gates

Each category has a hard gate. **Failure of any hard gate caps that category's score at 50% of weight.**

| Category | Hard Gate | Failure Condition |
|----------|-----------|-------------------|
| Test Signal Integrity | Non-zero execution | `numPassedTests == 0 && numFailedTests == 0` in required lane |
| Dependency Risk | No expired exceptions | Any `.audit-allowlist.json` entry past expiry date |
| Build/Performance | Budget compliance | Any first-party chunk exceeds 500 kB hard limit |
| Static Quality | No regressions | Warning count exceeds `.lint-baseline.json` threshold |
| Backend Modernization | No first-party deprecations | `pytest -W error::DeprecationWarning` fails on first-party code |
| CI Governance | All checks pass | Any required check missing from branch protection or workflow |

## Scoring Method

1. Each category scored 0–weight based on evidence
2. Hard gate check: if gate fails, category capped at 50%
3. Sum all category scores for final score
4. Exclude secret dev credential findings per scope lock

## Evidence Requirements

Each category score must be supported by:
- Command output demonstrating current state
- Before/after comparison from baseline
- File diffs for code changes
- Residual risk documentation with owners

## References

- Scope Lock: `docs/quality/scope-lock-non-secret-2026-02-16.md`
- Baseline: `docs/quality/evidence/t00-baseline-non-secret.md`
- Evidence: `docs/quality/evidence/workstream-*.md`
- Required Checks: `docs/quality/required-check-matrix.md`

---

*Version: v3 — 2026-02-16*
