# Baseline Evidence — Non-Secret Scope (Round 3, 2026-02-17)

> **Scope:** Secret dev credential findings are excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).
> **Scoring Rule:** No secret-dev-credential scoring penalty applied.
> **Note:** This supersedes the prior Round 2 baseline. Round 2 final score: 95/100.

## Tool Versions

| Tool | Version |
|------|---------|
| Node.js | v22.15.0 |
| pnpm | 10.14.0 |
| Python | 3.13.3 |
| Rust (rustc) | 1.92.0 (ded5c06cf 2025-12-08) |
| Cargo | 1.92.0 (344c4567c 2025-10-21) |

## Round 3 Input Score

**93/100** (non-secret scoring model)

## Lint Check (`npm run lint:check`)

```
✖ 80 problems (0 errors, 80 warnings)
  0 errors and 12 warnings potentially fixable with the `--fix` option.
```

- 0 errors
- 80 warnings (ratchet baseline: 79 warnings / 108 suppressions)
- Key remaining hotspots: `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`, `react-refresh/only-export-components`, unused eslint-disable directives

## Lint Ratchet (`node scripts/lint-ratchet.mjs`)

```
Warnings:     79
Errors:       0
Suppressions: 108
PASS: Lint quality is within baseline.
```

- Ratchet scans `src/` only; `lint:check` scans all files (scope divergence noted)

## Unit Tests (`npm run test:unit`)

```
Test Files  5 passed (5)
     Tests  104 passed (104)
  Duration  9.64s
```

- 104 tests passed
- 0 failures
- 0 skipped

## Integration Tests (`npm run test:integration`, default deterministic)

```
Mode:              deterministic
Infra available:   NO
Tests  11 passed | 28 skipped (39)
```

- 11 deterministic tests passed
- 28 infra-dependent tests skipped (correct behavior in deterministic mode)
- CI governance gap: `INTEGRATION_MODE` not set in CI, defaults to deterministic silently

## Infra Integration Tests (`INTEGRATION_MODE=infra`)

- Fails under high-load/retry pressure (1000-iteration benchmarks)
- Not a core correctness failure; perf tests run unconditionally in infra mode

## Build (`npm run build`)

```
✓ built in 28.26s
(!) Some chunks are larger than 500 kB after minification.
```

- Build passes
- Largest first-party chunk: 464.74 kB (feature-admin-onboarding)
- Exempt chunk: exceljs.min at 937.00 kB (lazy-loaded)
- Vite chunking warning persists for exceljs

## Bundle Budget (`node scripts/check-bundle-budget.mjs`)

```
✓ Per-chunk limit (500 KB): All first-party chunks within budget
✓ Total JS budget (7500 KB): 6739.00 KB total
✓ PASS — Bundle budget within limits
```

- Exempt: exceljs.min (915.04 KB, dynamic import)
- Note: `vendor-react-pdf` exemption name doesn't match `vendor-pdfjs` chunk name

## Dependency Audit (`pnpm audit --prod`)

```
1 vulnerabilities found
Severity: 1 moderate
```

- **High level:** 0 findings (PASS)
- **Moderate level:** 1 finding — lodash >=4.0.0 <=4.17.22 via bull (GHSA-xxjr-mmjv-4gpg)
- `.audit-allowlist.json` is currently empty
- Schema key mismatch: schema comment uses `expires`, CI script checks `expiry`

## Python Tests (`pytest -q api/tests`)

```
8 passed
```

- 8 tests passed, 0 warnings
- `pytest.ini` promotes DeprecationWarning to errors with 2 transitive suppressions (gotrue, supabase)

## Rust Tests (`RUSTFLAGS="-D warnings"`)

| Service | Result |
|---------|--------|
| rust-core-service | 0 passed, 2 ignored |
| rust-ai-service | 3 passed |
| rust-work-service | 0 passed |
| rust-dashboard-service | 7 passed |
| rust-streaming-service | 0 passed |

- All services pass with zero warnings under `-D warnings`
- 3 services have 0 test coverage (work, streaming, core functional)

---

*Captured: 2026-02-17*
