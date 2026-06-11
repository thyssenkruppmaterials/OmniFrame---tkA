# T5 Evidence - Remove RouteGuard Conditional-Hook Violation

**Agent**: Agent-Frontend
**Status**: Complete

## Files Changed
- `src/components/auth/RouteGuard.tsx` — Moved `useEffect` to unconditional top-level; removed `eslint-disable-next-line react-hooks/rules-of-hooks` suppression

## Command Transcript
1. `pnpm lint:check` → RouteGuard.tsx no longer triggers `react-hooks/rules-of-hooks` warning
2. Only remaining warning: `react-refresh/only-export-components` (pre-existing, for `useRouteGuard` hook export)

## Before/After
- **Before**: `React.useEffect()` called inside `if (!isAuthenticated)` branch with lint suppression on line 50
- **After**: `useEffect` called unconditionally at top level; auth check happens inside the effect body

## Rollback
- Restore conditional hook pattern with suppression comment

## Residual Risk
- None — behavior is equivalent (redirect when not authenticated, no-op when authenticated)
