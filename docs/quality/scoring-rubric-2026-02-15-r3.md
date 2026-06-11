# OneBox AI - Scoring Rubric (2026-02-15, Round 3)

> This rubric is used to calculate the quality score before and after remediation.
> Credential findings are explicitly excluded per stakeholder direction.

## Weight Distribution

| Category | Weight | Description |
|----------|--------|-------------|
| Reliability of required tests | 35% | All test suites pass with meaningful assertions |
| CI gate rigor | 20% | CI status reflects real quality signal |
| Static quality (lint/format/types) | 20% | Lint warnings, format compliance, type safety |
| Backend runtime correctness | 15% | Router loading, host policy, config safety |
| Build/release quality | 10% | Build warnings, chunk budgets, bundle health |

## Scoring Criteria

### 1. Reliability of Required Tests (35%)

| Score | Criteria |
|-------|----------|
| 10/10 | All suites pass with full assertion coverage, no vacuous passes |
| 8/10 | All suites pass, minor vacuous-pass risk (e.g., integration all-skipped but documented) |
| 6/10 | Suites pass but some have 0 meaningful assertions |
| 4/10 | Some suites fail or have unreliable results |
| 2/10 | Multiple suites fail or produce false positives |

**Baseline score**: 6/10 (integration suite vacuous, Python passes but fragile)

### 2. CI Gate Rigor (20%)

| Score | Criteria |
|-------|----------|
| 10/10 | All jobs enforce real checks, summary reporting, branch protection |
| 8/10 | Most jobs enforce real checks, some lack summary |
| 6/10 | Jobs run but some can pass vacuously |
| 4/10 | Multiple jobs can give false green |
| 2/10 | CI is unreliable signal |

**Baseline score**: 5/10 (integration can pass with all-skipped, Python lacks env setup)

### 3. Static Quality (20%)

| Score | Criteria |
|-------|----------|
| 10/10 | < 100 warnings, no suppressions in critical code |
| 8/10 | < 500 warnings, minimal suppressions |
| 6/10 | < 1000 warnings |
| 4/10 | 1000-1500 warnings |
| 2/10 | > 1500 warnings or errors present |

**Baseline score**: 4/10 (1,418 warnings, 68+ suppression files)

### 4. Backend Runtime Correctness (15%)

| Score | Criteria |
|-------|----------|
| 10/10 | All routers deterministic, fail-fast on errors, config robust |
| 8/10 | Most routers load correctly, minor edge cases |
| 6/10 | Routers load but silent degradation possible |
| 4/10 | Critical routers may not load, config fragile |
| 2/10 | Backend starts in unknown state |

**Baseline score**: 4/10 (silent router degradation, missing drone mount, host mismatch risk)

### 5. Build/Release Quality (10%)

| Score | Criteria |
|-------|----------|
| 10/10 | Zero build warnings, all chunks under budget |
| 8/10 | Minor warnings, chunks near budget |
| 6/10 | Known warnings documented, 1 chunk over budget |
| 4/10 | Multiple warnings, chunks significantly over budget |
| 2/10 | Build unstable or produces errors |

**Baseline score**: 5/10 (dual-import warning, 1,083 KB primary chunk vs 600 KB budget)

## Baseline Composite Score

| Category | Weight | Score | Weighted |
|----------|--------|-------|----------|
| Test reliability | 35% | 6/10 | 2.10 |
| CI gate rigor | 20% | 5/10 | 1.00 |
| Static quality | 20% | 4/10 | 0.80 |
| Backend correctness | 15% | 4/10 | 0.60 |
| Build/release quality | 10% | 5/10 | 0.50 |
| **Total** | **100%** | | **5.00/10 → 50/100** |

> Note: Previous review estimated 67/100. This rubric applies stricter criteria 
> to integration test vacuousness and backend silent degradation.

## Exclusion Marker

```
excluded_by_request: ["hard_coded_dev_credentials"]
```

## Timestamp

- **Created**: 2026-02-15
- **Rubric version**: R3 (post re-review)
