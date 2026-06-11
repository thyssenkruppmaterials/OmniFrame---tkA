# Bundle Budget & Chunk Ownership

## Hard Thresholds (enforced by script)

| Metric | Limit | Rationale |
|--------|-------|-----------|
| **Per-chunk size** | 500 KB | No single first-party JS chunk may exceed this |
| **Total JS budget** | 7 500 KB | Sum of all chunks (including lazy-loaded) |
| **Chunks over limit** | 0 | Zero first-party chunks allowed over 500 KB |

**Lazy-loaded vendor exemptions:** `exceljs` and `vendor-pdfjs` are exempt from the per-chunk limit because they are dynamically imported and only download on-demand.

### Enforcement Script

```bash
# After building:
node scripts/check-bundle-budget.mjs          # human-readable table
node scripts/check-bundle-budget.mjs --json   # machine-readable for CI
```

The script reads `dist/assets/*.js`, compares against the thresholds above, and exits with code 1 if any budget is exceeded. Thresholds are configurable constants at the top of the script.

## Vite Configuration

- **`chunkSizeWarningLimit`**: 500 KB (`vite.config.ts`)
- **`autoCodeSplitting`**: `true` (TanStack Router plugin — route-level splitting)

## Manual Chunks Strategy

The `manualChunks` function in `vite.config.ts` uses a two-tier strategy:

### Vendor splits (third-party)

| Chunk | Packages | Notes |
|-------|----------|-------|
| `vendor-recharts` | `recharts`, `d3-*` | Heavy viz library (~389 KB) |
| `vendor-supabase` | `@supabase/*` | Auth/DB client stack (~168 KB) |
| `vendor-tanstack-router` | `@tanstack/react-router`, devtools | Routing framework (~74 KB) |
| `vendor-radix-ui` | All `@radix-ui/react-*` | Primitive UI components (~165 KB) |
| `vendor-tanstack-query` | `@tanstack/react-query`, devtools | Data fetching (~35 KB) |
| `vendor-framer-motion` | `framer-motion` | Animation library (~115 KB) |
| `vendor-date-fns` | `date-fns` | Date utilities (~45 KB) |
| `vendor-pdfjs` | `react-pdf`, `pdfjs-dist` | PDF viewer (~400 KB, lazy) |
| `vendor-tabler-icons` | `@tabler/icons-react` | Icon library (~48 KB) |
| `vendor-forms` | `react-hook-form`, `zod` | Form + validation (~97 KB) |

### First-party feature splits

| Chunk | Feature Path | Notes |
|-------|-------------|-------|
| `feature-admin-onboarding` | `features/admin/onboarding/` | Employee onboarding wizard |
| `feature-admin-roles` | `features/admin/roles/` | Role & permission management |
| `feature-admin-permissions` | `features/admin/permissions/`, `compliance/` | Permission & compliance UI |
| `feature-admin-security` | `features/admin/security/` | Security settings |
| `feature-admin` | `features/admin/` (remainder) | Other admin components (~465 KB) |
| `feature-shift-team` | `features/shift-productivity/team-performance/` | Team dashboard (~314 KB) |
| `feature-shift-associate` | `features/shift-productivity/associate-performance/` | Associate view |
| `feature-shift-productivity` | `features/shift-productivity/` (remainder) | Settings & shared (~294 KB) |
| `feature-camera-system` | `features/camera-system/` | Camera/security system |
| `feature-customer-portal` | `features/customer-portal/` | Customer ticketing |
| `feature-hr` | `features/hr/` | HR time tracker, reviews |
| `feature-outbound` | `features/outbound/` | Outbound operations |
| `feature-rf-interface` | `features/rf-interface/` | RF terminal (~397 KB) |

## Lazy-Loaded Vendor Exceptions

These chunks are dynamically imported (`import()`) and only load when the user reaches the relevant feature:

| Chunk | Size | Trigger |
|-------|------|---------|
| `exceljs` | ~937 KB | Opening Excel attachments in Customer Portal |
| `vendor-pdfjs` | ~400 KB | Opening PDF attachments |

They are exempt from the per-chunk limit in `check-bundle-budget.mjs`.

## CI Enforcement

The `frontend-unit` job in `.github/workflows/ci.yml` includes an automated bundle size check:

- **Runs after**: `pnpm build` (before unit tests)
- **Script**: `node scripts/check-bundle-budget.mjs`
- **Exit code 1**: Fails the CI step if any threshold is exceeded
- **Escalation**: If the budget check fails, investigate which chunk grew and either split it further or raise the budget cap with documented justification.

## Monitoring

Track top-5 chunk sizes on each build. If any exceeds budget, investigate before merging.

### Watch list (chunks near 500 KB)

- `feature-admin` — 465 KB (93% of limit)
- `vendor-pdfjs` — 400 KB (exempt, lazy)
- `feature-rf-interface` — 397 KB (79% of limit)
- `vendor-recharts` — 389 KB (78% of limit)
