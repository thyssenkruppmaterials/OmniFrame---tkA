# Round 3 Gap Map — Non-Secret Scope (2026-02-17)

> **Scope:** Secret dev credential findings are excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).
> **Scoring Rule:** No secret-dev-credential scoring penalty applied.

## Gap Summary

| # | Finding | Severity | Category | Owner Phase | Status |
|---|---------|----------|----------|-------------|--------|
| G01 | CI integration lane does not set `INTEGRATION_MODE`; infra tests never run in required check | High | governance | p02 | Open |
| G02 | Infra-mode integration fails due to unconditional 1000-iteration perf benchmarks | Medium | reliability | p03 | Open |
| G03 | 1 moderate vulnerability (lodash via bull, GHSA-xxjr-mmjv-4gpg) | Medium | correctness | p04 | Open |
| G04 | CI audit gate uses `\|\| true` permissive fallback | Medium | governance | p04 | Open |
| G05 | `.audit-allowlist.json` schema key mismatch (`expires` vs `expiry` in CI) | Medium | governance | p04 | Open |
| G06 | Allowlist missing `owner` and `reason` fields | Low | governance | p04 | Open |
| G07 | Vite build emits chunk size warning for exceljs (937 kB exempt) | Low | performance | p05 | Open |
| G08 | Bundle exemption naming mismatch: `vendor-react-pdf` vs `vendor-pdfjs` | Medium | correctness | p05 | Open |
| G09 | 80 lint warnings remain (ratchet baseline: 79) | Medium | correctness | p06 | Open |
| G10 | Lint ratchet scope divergence: scans `src/` only vs `lint:check` scans all | Medium | governance | p06 | Open |
| G11 | Lint ratchet counts all eslint-disable directives, not just unused | Low | governance | p06 | Open |
| G12 | Python quality gates missing from required-check-matrix.md | Low | governance | p07 | Open |
| G13 | pytest third-party warning suppressions lack review dates | Low | governance | p07 | Open |
| G14 | 3 Rust services have 0 functional test coverage | Low | reliability | p07 | Open |
| G15 | Required-check matrix not yet updated for new CI jobs/lanes | Medium | governance | p08 | Open |
| G16 | Branch protection alignment requires manual GitHub verification | Low | governance | p08 | Open |

## Category Distribution

| Category | Count | Severity Breakdown |
|----------|-------|--------------------|
| governance | 9 | 1 High, 3 Medium, 5 Low |
| correctness | 3 | 0 High, 2 Medium, 1 Low |
| reliability | 2 | 0 High, 1 Medium, 1 Low |
| performance | 1 | 0 High, 0 Medium, 1 Low |

## Phase Ownership

| Phase | Gaps Owned | Key Deliverable |
|-------|------------|-----------------|
| p02 | G01 | Explicit `INTEGRATION_MODE` in CI with separate lanes |
| p03 | G02 | Perf test gating with `INTEGRATION_PROFILE` |
| p04 | G03, G04, G05, G06 | Audit gate hardening and dependency resolution |
| p05 | G07, G08 | Bundle exemption fix and warning elimination |
| p06 | G09, G10, G11 | Lint burndown and ratchet alignment |
| p07 | G12, G13, G14 | Python/Rust policy documentation |
| p08 | G15, G16 | Required-check matrix finalization |

---

*Generated: 2026-02-17*
