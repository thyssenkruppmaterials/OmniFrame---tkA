# Workstream C: Dependency Risk Elimination — Evidence

> Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Before State

- `xlsx ^0.18.5` in production dependencies
- 2 high-severity CVEs: GHSA-4r6h-8v6p-xvw6 (Prototype Pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS)
- `pnpm audit --prod --audit-level high` exits with code 1 (FAIL)
- Total: 3 vulnerabilities (2 high + 1 moderate)
- Allowlist entries expiring 2026-06-15

**Baseline audit:** 2 high + 1 moderate

## After State

- xlsx fully removed from dependency graph
- Replaced with `exceljs 4.4.0` (lazy-loaded via dynamic import)
- `pnpm audit --prod --audit-level high` exits with code 0 (PASS)
- Total: 1 vulnerability (1 moderate — lodash via bull)
- xlsx allowlist entries removed from `.audit-allowlist.json`
- ADR documenting decision: `docs/quality/adr/adr-xlsx-risk-remediation.md`

**Post-change audit:** 0 high, 1 moderate

## Files Changed

| File | Change |
|------|--------|
| `src/features/customer-portal/components/ExcelViewer.tsx` | Replaced xlsx with exceljs, dynamic import, `resolveCellValue()` helper |
| `package.json` | Removed xlsx, added exceljs 4.4.0 |
| `vite.config.ts` | Updated manualChunks (xlsx → exceljs) |
| `.audit-allowlist.json` | Removed xlsx exception entries |
| `docs/quality/adr/adr-xlsx-risk-remediation.md` | Created — ADR documenting full replacement decision |
| `docs/quality/dependency-audit-policy.md` | Created — audit gate policy documentation |

## Residual Risks

- 1 moderate vulnerability (lodash via bull) remains — not in high-severity scope
- exceljs chunk is 937 kB but lazy-loaded (only downloads when ExcelViewer renders)

---

*Date: 2026-02-16*
