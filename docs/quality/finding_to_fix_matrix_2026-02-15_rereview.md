# Finding-to-Fix Matrix (2026-02-15 Post Re-Review)

| # | Finding | Severity | Task | Evidence | Status |
|---|---------|----------|------|----------|--------|
| 1 | Router load can silently degrade; drone router not mounted | High | T1 | `t01-evidence.md` | **CLOSED** |
| 2 | Python smoke path 400 due host-policy mismatch | High | T2 | `t02-evidence.md` | **CLOSED** |
| 3 | Root `.env` encoding brittleness blocks tests | Medium | T3 | `t03-evidence.md` | **CLOSED** |
| 4 | Integration suite can pass with all tests skipped | Medium | T7 | `t07-evidence.md` | **CLOSED** |
| 5 | Route guard conditional hook with lint suppression | Medium | T5 | `t05-evidence.md` | **CLOSED** |
| 6 | Audit logging writes `execution_time_ms` not in schema | Medium | T8 | `t08-evidence.md` | **CLOSED** |
| 7 | Quality debt: 1418 lint warnings + build warning debt | Low/Med | T9, T10 | `t09-evidence.md`, `t10-evidence.md` | **CLOSED** |
| 8 | CI Python job lacks `.env.test` setup | Low | T3, T11 | `t03-evidence.md`, `t11-evidence.md` | **CLOSED** |

## Supporting Tasks

| Task | Finding | Description | Status |
|------|---------|-------------|--------|
| T0 | — | Baseline freeze | Complete |
| T4 | 1 (related) | Redis lifecycle stability in tests | Complete |
| T6 | 4 (related) | Node integration import boundary | Complete |
| T12 | — | Evidence closure and rescore | Complete |

## Exclusions

- `excluded_by_request: ["hard_coded_dev_credentials"]` — not scored or remediated
