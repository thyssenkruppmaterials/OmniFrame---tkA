# Dependency Risk Acceptance Register

## xlsx (SheetJS Community Edition) — Temporary Risk Acceptance

| Field | Value |
|---|---|
| Package | `xlsx` |
| Current Version | `0.18.5` |
| Vulnerabilities | GHSA-4r6h-8v6p-xvw6 (Prototype Pollution), GHSA-5pgg-2g8v-p4x9 (ReDoS) |
| Severity | High |
| Patched Version | None available (community edition EOL) |
| Compensating Controls | 1. All spreadsheet parsing occurs on trusted server-uploaded files only (ExcelViewer.tsx). 2. Hard 10 MB file size limit enforced before parsing. 3. High-risk parse features disabled: `cellFormula`, `cellHTML`, `cellStyles`, `bookVBA`, `bookDeps` all set to `false`. 4. 30-second fetch timeout via AbortController. 5. No direct exposure of parsed data to prototype-sensitive code paths. |
| Planned Remediation | Replace `xlsx` with `ExcelJS` or equivalent browser-safe library. Target: 2026-Q2. |
| Owner | Engineering Lead |
| Accepted Date | 2026-02-15 |
| Expiry Date | 2026-06-15 (hard deadline — must replace or re-accept with justification) |
| Review Date | 2026-04-15 |

## Resolved Findings

| Package | Action | Date |
|---|---|---|
| `axios` | Upgraded from `^1.10.0` to `^1.13.5` | 2026-02-15 |
| `@capacitor/cli` (tar, brace-expansion) | Moved to devDependencies (not in production bundle) | 2026-02-15 |
| `seroval` via `@tanstack/react-router-devtools` | Devtools moved to devDependencies | 2026-02-15 |
| `package-lock.json` | Removed (dual lock file with pnpm-lock.yaml) | 2026-02-15 |
