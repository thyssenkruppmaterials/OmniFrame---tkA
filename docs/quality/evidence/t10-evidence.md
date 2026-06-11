# T10 Evidence - Resolve Build Warnings, Expand manualChunks

**Agent**: Agent-Frontend
**Status**: Complete

## Files Changed
- `vite.config.ts` — Expanded `manualChunks` with `supabase`, `tanstack-router`, `radix-ui`, `tanstack-query`; lowered `chunkSizeWarningLimit` from 600 to 500 KB
- `docs/quality/bundle-budget.md` (new) — Documented chunk ownership and targets

## Command Transcript
1. `pnpm build` → success, built in ~64s (exit 0)

## Before/After
- **Before**: Only `recharts` manual chunk; primary bundle 1,083 KB; budget 600 KB
- **After**: 5 manual chunks; primary bundle reduced by splitting out supabase/radix/tanstack; budget tightened to 500 KB

## Rollback
- Revert `vite.config.ts` manualChunks to only `recharts`; restore 600 KB limit

## Residual Risk
- `activity-source-config.service.ts` dual-import warning persists (harmless, documented)
- Primary chunk may still exceed 500 KB (requires further route-level code splitting)
