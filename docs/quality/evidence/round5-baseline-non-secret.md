# Round 5 Baseline — Non-Secret Scope (2026-02-18)

> **Scope:** Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Validation Matrix Results

| Command | Result | Status | Round 3 Comparison |
|---------|--------|--------|--------------------|
| `pnpm lint:check` | 8 warnings, 0 errors | PASS | Regression (was 5) |
| `node scripts/lint-ratchet.mjs` | 8/8 warnings, 125/125 suppressions | PASS | Ratchet updated |
| `pnpm format:check` | 109 files with issues | **FAIL** | **Regression** (was PASS) |
| `pnpm build` | Builds successfully (2 mixed import warnings) | PASS | Unchanged |
| `node scripts/check-bundle-budget.mjs` | All chunks within budget (6739 KB) | PASS | Unchanged |
| `pnpm test:unit` | 104 passed | PASS | Unchanged (was 104) |
| `pnpm audit --prod --audit-level high` | 0 findings | PASS | Unchanged |
| `pnpm audit --prod --audit-level moderate` | 0 findings | PASS | Unchanged |
| `pytest -q api/tests` | 8 passed | PASS | Unchanged |
| `cargo test (core)` | 23 passed, 2 ignored | PASS | **Improved** (was 0 passed, 2 ignored) |
| `cargo test (ai)` | 3 passed | PASS | Unchanged |
| `cargo test (work)` | 2 passed | PASS | **Improved** (was 0 passed) |
| `cargo test (dashboard)` | 7 passed | PASS | Unchanged |
| `cargo test (streaming)` | 14 passed | PASS | **Improved** (was 0 passed) |

## Finding Status Map

| ID | Finding | Round 3 State | Current State | Disposition |
|----|---------|---------------|---------------|-------------|
| R5-01 | Infra integration instability | Untested | Needs verification | VERIFY |
| R5-02 | Test harness config drift | Hardcoded Redis config | Still hardcoded | ACTIVE |
| R5-03 | Audit write path mismatch | Timer cleanup gap | Needs verification | ACTIVE |
| R5-04 | Format gate failure | PASS | **FAIL (109 files)** | **ACTIVE REGRESSION** |
| R5-05 | Build warning noise | 2 mixed imports | 2 mixed imports | ACTIVE (narrowed to role.service.ts) |
| R5-06 | Lint regression | 5 warnings | 8 warnings (+3) | **ACTIVE REGRESSION** |
| R5-07 | Python deprecation | Stable (8 passed) | Stable (8 passed) | MOSTLY DONE |
| R5-08 | Governance drift | Partial | Needs matrix validation | PARTIAL |
| R5-09 | Rust test coverage | core=0, work=0, stream=0 | core=23, work=2, stream=14 | **MOSTLY RESOLVED** (work needs 1 more) |

## Phase Ownership

| Finding | Owner Phase | Priority |
|---------|------------|----------|
| R5-04 (format) | Phase 05 | HIGH — immediate fix required |
| R5-06 (lint) | Phase 06 | HIGH — 3 new warnings to resolve |
| R5-09 (Rust work) | Phase 08b | MEDIUM — needs 1 more functional test |
| R5-02 (config) | Phase 03 | MEDIUM — shared config utility |
| R5-03 (timers) | Phase 04 | MEDIUM — timer cleanup |
| R5-05 (build) | Phase 07 | MEDIUM — normalize imports |
| R5-01 (infra) | Phase 02 | MEDIUM — verify stability |
| R5-07 (Python) | Phase 08 | LOW — verify strict mode |
| R5-08 (governance) | Phase 09 | LOW — matrix validation script |

---

*Captured: 2026-02-18*
*Secret dev credential findings excluded per scope lock.*
