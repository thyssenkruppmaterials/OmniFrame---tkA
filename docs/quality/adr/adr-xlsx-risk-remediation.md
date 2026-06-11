# ADR: xlsx High-Severity Vulnerability Remediation

| Field    | Value                                              |
| -------- | -------------------------------------------------- |
| Status   | **Accepted**                                       |
| Date     | 2026-02-16                                         |
| Owner    | Engineering team                                   |
| Expiry   | N/A (permanent fix)                                |

## Context

The `xlsx` (SheetJS community edition) library carries **two unpatched high-severity vulnerabilities** with no available fix in the open-source edition:

| Advisory                | Severity | Description                                    |
| ----------------------- | -------- | ---------------------------------------------- |
| GHSA-4r6h-8v6p-xvw6    | High     | Prototype Pollution in SheetJS                 |
| GHSA-5pgg-2g8v-p4x9    | High     | Regular Expression Denial of Service (ReDoS)   |

Both advisories list patched versions as `<0.0.0`, meaning the community edition will **never** receive a patch. The vulnerabilities were temporarily accepted via `.audit-allowlist.json` with compensating controls (file-size limits, fetch timeouts) and an expiry of 2026-06-15.

### Scope analysis

A codebase search shows `xlsx` is imported in **exactly one file**:

- `src/features/customer-portal/components/ExcelViewer.tsx`
  - `XLSX.read(arrayBuffer, { type: 'array', ... })` — parse an ArrayBuffer into a workbook
  - `XLSX.utils.sheet_to_json(worksheet, { header: 1 })` — convert a worksheet to a 2-D array

The component is **read-only**: it fetches a remote `.xlsx` file, parses it, and renders the contents in an HTML table. No write/export functionality is used.

## Decision

**Full replacement of `xlsx` with `exceljs`.**

Given the narrow blast radius (single component, read-only usage), we replace the library entirely rather than applying workarounds or waiting for a patch that will not come.

### Replacement library: `exceljs`

| Criterion              | `xlsx` (SheetJS CE)       | `exceljs`                          |
| ---------------------- | ------------------------- | ---------------------------------- |
| Maintenance            | Archived / no patches     | Actively maintained                |
| High-severity CVEs     | 2 unpatched               | 0                                  |
| Read `.xlsx` files     | Yes                       | Yes                                |
| Write `.xlsx` files    | Yes                       | Yes (not needed here)              |
| Browser support        | Yes                       | Yes (`workbook.xlsx.load()`)       |
| Bundle size            | ~300 KB                   | ~250 KB                            |

### Alternatives considered

| Alternative                  | Reason rejected                                          |
| ---------------------------- | -------------------------------------------------------- |
| `xlsx-parse-json`            | Low download count, limited maintenance signal           |
| SheetJS Pro (paid)           | License cost, vendor lock-in                             |
| Server-side parsing only     | Adds latency and API surface; overkill for read-only UI  |
| Keep xlsx + compensating     | Audit findings remain; allowlist is a temporary measure   |

## Implementation

1. `pnpm add exceljs && pnpm remove xlsx`
2. Rewrite `ExcelViewer.tsx` internals to use ExcelJS `Workbook.xlsx.load()` and row iteration.
3. Remove the `xlsx` manual chunk from `vite.config.ts`; add `exceljs` chunk.
4. Remove now-unnecessary entries from `.audit-allowlist.json`.
5. Verify `pnpm build` succeeds and `pnpm audit --prod --audit-level high` clears the xlsx findings.

## Consequences

### Positive

- Eliminates 2 high-severity audit findings permanently.
- Narrow blast radius — only 1 component changes.
- `exceljs` is actively maintained with a healthy release cadence.
- Audit allowlist shrinks, reducing exception-tracking burden.

### Negative

- Minor API differences require rewriting the parsing logic (one-time cost).
- `exceljs` bundle is comparable in size (~250 KB) but not significantly smaller.

### Risks

- ExcelJS API differences could surface edge cases in unusual spreadsheets. Mitigated by the existing file-size limit (10 MB) and by testing with representative files.
