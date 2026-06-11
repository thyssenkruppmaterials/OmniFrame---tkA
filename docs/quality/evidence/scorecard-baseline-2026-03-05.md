# Scorecard Baseline

Frozen: 2026-03-05

## Current Scores

| Dimension | Score | Rationale |
| --------- | ----- | --------- |
| Architecture | 8.3/10 | Strong feature and service separation, but runtime topology is inconsistent |
| Quality Gates | 8.6/10 | Real CI and local quality gates are present and mostly green |
| Testing Depth | 7.4/10 | Good signal, but breadth remains narrow relative to repo size |
| Security / Operations | 6.9/10 | Middleware and warnings exist, but deploy path drift and permissive ingress remain |
| Maintainability | 6.8/10 | Good module-level organization, but several large hotspots and tracked artifacts remain |
| **Overall** | **7.6/10** | Strong baseline with several structural penalties |

## Target Scores (post-remediation)

| Dimension | Target |
| --------- | ------ |
| Overall | >= 8.8/10 |

## Verified Command Outputs

| Command | Result |
| ------- | ------ |
| `pnpm quality:check` | PASS |
| `pnpm test:integration` | PASS (deterministic mode: 11 passed, 26 skipped) |
| `python -m pytest -q api/tests` | PASS (12 passed) |
| `cargo test --quiet` in `rust-core-service` | PASS (23 passed, 2 ignored) |
| `cargo test --quiet` in `rust-ai-service` | PASS (3 passed) |
| `cargo test --quiet` in `rust-work-service` | PASS (16 passed across targets) |
| `cargo test --quiet` in `rust-dashboard-service` | PASS (7 passed) |
| `cargo test --quiet` in `rust-streaming-service` | PASS (14 passed) |
| `pnpm audit --prod --audit-level high` | PASS (no known vulnerabilities) |

## Test File Counts (baseline)

| Category | Count |
| -------- | ----- |
| Frontend unit test files | 5 |
| Frontend integration test files | 1 |
| Python test modules | 3 |

## Codebase Footprint

- Approximate analyzed file count: 1170
- Frontend source files: 540 .tsx, 223 .ts
- Database migrations: 139 .sql
- Rust source files: 96 .rs
- Python source files: 62 .py
- Frontend route files: 69
- Frontend feature modules: 18
- Supabase service-wrapper files: 49
