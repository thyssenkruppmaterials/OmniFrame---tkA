---
tags: [type/context, status/active, domain/infra]
created: 2026-04-10
---
# Build Configuration

## Purpose
Documents the Vite build setup, TypeScript configuration, ESLint rules, and code-splitting strategy for the OneBox frontend.

## Vite Configuration (`vite.config.ts`)

### Plugins (order matters)
1. **`forbid-service-role-key`** — Custom plugin that throws at build time if `VITE_SUPABASE_SERVICE_ROLE_KEY` is set in production. Prevents service-role secrets from leaking into the client bundle.
2. **`buildVersionPlugin`** — Generates deterministic build hash from git commit + timestamp. Writes `build-info.json` to `dist/`. Injects `__BUILD_HASH__`, `__BUILD_TIME__`, `__APP_VERSION__` as compile-time constants.
3. **`@tanstack/router-plugin`** — TanStack Router with `autoCodeSplitting: true`.
4. **`@vitejs/plugin-react-swc`** — SWC-based React compilation (faster than Babel).
5. **`@tailwindcss/vite`** — Tailwind CSS v4 Vite plugin.
6. **`VitePWA`** — Progressive Web App with Workbox. Manual registration (`injectRegister: false`). Details in [[Mobile-PWA-Configuration]].

### Dev Server Proxy
- `/api` → `http://localhost:8000` (FastAPI backend)

### Path Aliases
- `@` → `./src`
- `@tabler/icons-react` → `@tabler/icons-react/dist/esm/icons/index.mjs` (tree-shaking optimization)

### Build & Chunk Splitting

**Chunk size warning limit:** 500 KB

**External modules:** `ioredis` (server-only, excluded from browser bundle)

**Manual chunks — vendor splits (safe to split, zero React dependency):**
| Chunk | Library | Approx Size |
|---|---|---|
| `vendor-supabase` | `@supabase/*` | ~100+ KB |
| `vendor-date-fns` | `date-fns` | ~40+ KB |
| `vendor-d3` | `d3-*` | ~200+ KB |
| `vendor-pdfjs` | `pdfjs-dist` | ~250+ KB |

**NOT safe to split:** React-dependent libraries (`@radix-ui`, `recharts`, `framer-motion`, `@tanstack/react-*`, `react-pdf`, `react-hook-form`, `@tabler/icons-react`) — they call React APIs at module evaluation time.

**Feature splits (first-party):**
- `feature-admin-onboarding`, `feature-admin-roles`, `feature-admin-permissions`, `feature-admin-security`, `feature-admin-settings`, `feature-admin-work-queue`, `feature-admin-sap`, `feature-admin-perf`, `feature-admin`
- `feature-shift-team`, `feature-shift-associate`, `feature-shift-productivity`
- `feature-camera-system`, `feature-customer-portal`, `feature-hr`, `feature-outbound`, `feature-rf-interface`
- Onboarding steps are excluded from grouping (they use `React.lazy()` and split naturally)

## TypeScript Configuration

### `tsconfig.app.json` (Application)
- Target: **ES2020**
- Module: **ESNext** with **Bundler** module resolution
- JSX: **react-jsx**
- Strict mode: **enabled** (`strict: true`)
- Lint rules: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`
- Paths: `@/*` → `./src/*`
- Includes: `src/`

### `tsconfig.node.json` (Build tooling)
- Target: **ES2022** / Lib: **ES2023**
- Same strict settings as app config
- Includes: `vite.config.ts` only

## ESLint Configuration (`eslint.config.js`)

### Base Rules (all `**/*.{ts,tsx}`)
- Extends: `@eslint/js` recommended, `typescript-eslint` recommended, `@tanstack/query` flat/recommended
- ECMAScript: 2020, browser globals
- Plugins: `react-hooks`, `react-refresh`
- `no-console`: **error** (production code must use logger)
- `@typescript-eslint/no-unused-vars`: **error** (with `_` prefix ignore patterns)
- `@typescript-eslint/no-explicit-any`: **warn** (burn-down: 1274 instances as of 2026-02-15)
- `@tanstack/query/*`: **warn** (stabilization phase)
- `react-refresh/only-export-components`: **warn** (with `allowConstantExport`)

### Overrides
- **Auth/context/hooks files** (`src/lib/auth/**`, `src/components/auth/**`, `src/**/context/**`, `src/hooks/**`): `react-refresh/only-export-components` → **off** (co-located hooks pattern)
- **Test files** (`**/*.test.{ts,tsx}`, `tests/**`): `no-explicit-any` → **off** (legitimate mock usage)
- **Service files** (external API interactions): `no-explicit-any` → **off** (untyped upstream APIs)
- **Stores/workers/context/hooks**: `no-explicit-any` → **off** (generic patterns)

### Ignored Directories
`dist`, `dev-dist`, `src/components/ui`, `.pytest_cache`, `node_modules`, `api`, all `rust-*-service` dirs, `supabase/functions`, `ios`, `load_test_logs`

## Package Manager
- **pnpm** (v9) — lockfile: `pnpm-lock.yaml`
- Scripts use `pnpm` prefix throughout

## Related
- [[Quality-Pipeline]] — Lint ratchet, bundle budget, CI checks
- [[Deployment-Railway]] — How builds are triggered in production
- [[Mobile-PWA-Configuration]] — VitePWA and service worker details
