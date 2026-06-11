# Lint Backlog Breakdown - 2026-02-15

> Total issues: 4429 (after baseline capture)
> Distinct rules: 18

## Rule Family Breakdown

| Priority | Rule | Count | % of Total | Batch |
|----------|------|-------|------------|-------|
| 1 | `no-console` | 2931 | 66.2% | Batch A |
| 2 | `@typescript-eslint/no-explicit-any` | 1267 | 28.6% | Batch B |
| 3 | `react-hooks/exhaustive-deps` | 78 | 1.8% | Batch C |
| 4 | `@tanstack/query/no-unstable-deps` | 35 | 0.8% | Batch C |
| 5 | `@typescript-eslint/no-unused-vars` | 30 | 0.7% | Batch D |
| 6 | `react-refresh/only-export-components` | 25 | 0.6% | Batch D |
| 7 | `no-case-declarations` | 16 | 0.4% | Batch D |
| 8 | `prefer-const` | 14 | 0.3% | Batch D |
| 9 | `react-hooks/rules-of-hooks` | 11 | 0.2% | Batch C |
| 10 | `@tanstack/query/exhaustive-deps` | 6 | 0.1% | Batch C |
| 11 | `no-useless-catch` | 4 | 0.1% | Batch D |
| 12 | `@typescript-eslint/ban-ts-comment` | 3 | 0.1% | Batch D |
| 13 | parse-error | 2 | 0.0% | Batch D |
| 14 | `no-useless-escape` | 2 | 0.0% | Batch D |
| 15 | `@typescript-eslint/no-empty-object-type` | 2 | 0.0% | Batch D |
| 16 | `@typescript-eslint/no-namespace` | 1 | 0.0% | Batch D |
| 17 | `no-prototype-builtins` | 1 | 0.0% | Batch D |
| 18 | `no-self-assign` | 1 | 0.0% | Batch D |

## Execution Batches

### Batch A: `no-console` (2931 issues - 66.2%)
- **Strategy**: Create logger abstraction, then mass-replace console calls
- **Task**: Task 3

### Batch B: `no-explicit-any` (1267 issues - 28.6%)
- **Strategy**: Introduce domain types, replace top-offender files first
- **Task**: Task 4

### Batch C: Hook violations (130 issues - 2.9%)
- **Strategy**: Fix conditional hooks, add missing deps, stabilize refs
- **Task**: Task 5

### Batch D: Structural/residual (101 issues - 2.3%)
- **Strategy**: Mostly auto-fixable or simple manual fixes
- **Task**: Task 6

## Key Insight

Batches A + B account for **94.8%** of all lint issues. Focusing on no-console and no-explicit-any first provides maximum issue reduction.
