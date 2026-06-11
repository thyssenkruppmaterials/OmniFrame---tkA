# Round 2 Baseline Freeze (2026-02-16)

Scope: Non-secret findings only. Secret findings are excluded per project decision.

## Lint

```
✖ 298 problems (0 errors, 298 warnings)
```

- Primary warning classes: `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps`, `@tanstack/query/no-unstable-deps`, `react-refresh/only-export-components`

## Unit Tests

```
Test Files  5 passed (5)
     Tests  104 passed (104)
  Duration  11.72s
```

## Integration Tests

```
Test Files  1 passed (1)
     Tests  28 skipped (28)
  Duration  2.55s
```

- 0 tests executed; 28 skipped due to unavailable infrastructure
- CI policy: `REQUIRE_INTEGRATION_INFRA=false` (all-skip passes)

## Build

```
Build: ✓ (32.66s)
Largest chunk: dist/assets/index-DFZykPc2.js — 692.66 kB (gzip: 213.71 kB)
Chunk budget: 500 kB (exceeded by 192.66 kB)
```

Notable chunks:
- `shift-productivity` — 469.89 kB
- `react-pdf` — 421.81 kB
- `recharts` — 401.84 kB
- `xlsx` — 332.70 kB
- `index-CW7vjzFW.js` — 305.61 kB

## Dependency Audit

```
3 vulnerabilities found
Severity: 1 moderate | 2 high
```

| Advisory | Package | Severity | Patched |
|----------|---------|----------|---------|
| GHSA-4r6h-8v6p-xvw6 | xlsx (Prototype Pollution) | high | None (EOL) |
| GHSA-5pgg-2g8v-p4x9 | xlsx (ReDoS) | high | None (EOL) |

- CI uses hardcoded `KNOWN_EXCEPTIONS=2`; no `.audit-allowlist.json` file exists

## Python Tests

```
8 passed
20+ deprecation warnings
```

Deprecation categories:
- Pydantic V1 `@validator` in `smartsheet_models.py` (11 instances) and `ticket_models.py` (5 instances)
- Pydantic V1 `class Config` in `nefab_models.py`
- Pydantic V1 `min_items`/`max_items` in `delivery.py`
- `gotrue` package deprecated (use `supabase_auth`)
- Redis `close()` deprecated (use `aclose()`)

## Rust Tests

| Service | Passed | Ignored | Status |
|---------|--------|---------|--------|
| rust-core-service | 23 | 2 | ✓ |
| rust-ai-service | 3 | 0 | ✓ |
| rust-work-service | 1 | 0 | ✓ |
| rust-dashboard-service | 0 | 0 | No tests |
| rust-streaming-service | 0 | 0 | No tests |

## Score

- Non-secret scope score: **82/100**
- Target after remediation: **>= 90/100**
