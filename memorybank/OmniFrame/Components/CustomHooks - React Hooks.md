---
tags: [type/component, status/active, domain/frontend]
created: 2026-04-10
---
# CustomHooks - React Hooks

## Purpose
Custom React hooks in `src/hooks/` provide reusable logic across the application. There are 52 hook files covering auth, RBAC, data fetching, presence, UI utilities, and domain-specific operations.

## Hook Categories

### Auth & Session Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useUnifiedAuth` | `use-unified-auth.ts` | Comprehensive auth hook composing `useAuthState`, `usePermissions`, `useAuthActions`, `useSession` from auth-provider. Adds auto-refresh, permission caching (30s local Map cache), batch permission checking, and user display info. |
| `useRBAC` | `use-rbac.tsx` | Direct Supabase RBAC with `rbacService`. Loads user permissions on mount. Also exports `usePermission(action, resource)` for single checks and `CanAccess` component for conditional rendering. |
| `useOptimizedRBAC` | `use-optimized-rbac.tsx` | Thin wrapper over `useRBAC` from `permissionStore`. Deprecated — recommends using store hooks directly. Exposes state to `window.__RBAC_STATE__` for debugging. |
| `useSessionTimeout` | `use-session-timeout.tsx` | Automatic session timeout with role-based configs. Tracks user activity (mousedown, keypress, scroll, touchstart). Shows fullscreen warning before logout. Supports configurable timeout/warning/auto-logout durations loaded from `SessionManagementService`. |
| `useIdleRecovery` | `use-idle-recovery.tsx` | Detects tab visibility changes. If user returns after 5+ min idle, validates session and triggers recovery. Delegates permission reloading to `PermissionProvider`. |
| `useTabPermissions` | `useTabPermissions.ts` | Tab-level permission checking (likely wraps store). |
| `useNavigationPermissions` | `use-navigation-permissions.tsx` | Navigation access checking. |
| `useOptimizedNavigationPermissions` | `use-optimized-navigation-permissions.tsx` | Optimized variant. |

### Routing Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useRouteTracker` | `use-route-tracker.ts` | Subscribes to TanStack Router's `onResolved` event, saves current path to `unifiedAuthStore.setLastVisitedPath`. Filters out auth/error pages. Used once in `AuthenticatedLayout`. |
| `usePathRules` | `use-path-rules.ts` | Path-based rule engine for routing logic. |
| `useTabSearchParam` | `use-tab-search-param.ts` | Manages tab state via URL search parameters. |

### UI Utility Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useDebounce<T>` | `use-debounce.ts` | Generic debounce hook with configurable delay (default 300ms). |
| `useDialogState<T>` | `use-dialog-state.tsx` | Toggle-style dialog state. Returns `[open, setOpen]` — setting same value toggles it to null. |
| `useIsMobile` | `use-mobile.tsx` | Media query hook for 768px breakpoint. |
| `usePresenceVisibility` | `use-presence-visibility.ts` | Presence panel visibility state. |

### Presence & Real-time Hooks

| Hook | File | Purpose |
|------|------|---------|
| `usePresenceTracker` | `use-presence-tracker.ts` | App-level hook (mounted once in `AuthenticatedLayout` via `PresenceProvider`). Initializes `presenceService`, manages online status, custom status text, connected state, and user list. |
| `useActiveWorkers` | `use-active-workers.ts` | Tracks active warehouse workers. |
| `useDeliveryStatus` | `use-delivery-status.ts` | Real-time delivery tracking status. |

### Domain-Specific Data Hooks (TanStack Query)

These hooks use `useQuery`/`useMutation` from TanStack Query for server state:

| Hook | File | Domain |
|------|------|--------|
| `useInboundScans` | `use-inbound-scans.ts` | Inbound scan data with pagination, realtime, import/export, CRUD mutations |
| `useWorkQueue` | `use-work-queue.ts` | Work queue from Rust service — claim, push, start, complete, release tasks |
| `useCycleCountOperations` | `use-cycle-count-operations.ts` | Cycle counting CRUD |
| `useUnifiedCycleCount` | `use-unified-cycle-count.ts` | Unified cycle count interface |
| `useCycleCountDraft` | `use-cycle-count-draft.ts` | Draft management for cycle counts |
| `useLaborManagement` | `use-labor-management.ts` | Labor/workforce tracking |
| `useKitCartData` | `use-kit-cart-data.ts` | Kitting cart data |
| `useBuildKit` | `use-build-kit.ts` | Kit building operations |
| `useInspectKit` | `use-inspect-kit.ts` | Kit inspection |
| `useKittingOptions` | `use-kitting-options.ts` | Kitting configuration |
| `usePutawayOperations` | `use-putaway-operations.ts` | Putaway workflows |
| `usePutbackLog` | `use-putback-log.ts` | Putback audit logging |
| `useOutboundToData` | `use-outbound-to-data.ts` | Outbound transfer order data |
| `useOptimizedOutboundData` | `use-optimized-outbound-data.ts` | Performance-optimized outbound |
| `useGrsGripProcessing` | `use-grs-grip-processing.ts` | GRS grip processing |
| `useGripProcessing` | `use-grip-processing.ts` | General grip processing |
| `useLx03Data` | `use-lx03-data.ts` | SAP LX03 report data |
| `useSq01Data` | `use-sq01-data.ts` | SAP SQ01 report data |
| `useMaterialMasterData` | `use-material-master-data.ts` | SAP material master |
| `useDroneScans` | `use-drone-scans.ts` | Drone scan data |
| `useCubiscan` | `use-cubiscan.ts` | Cubiscan dimensional data |
| `useInboundCarts` | `use-inbound-carts.ts` | Inbound cart tracking |
| `useSmartsheet` | `useSmartsheet.ts` | Smartsheet API integration |
| `useStandardWork` | `use-standard-work.ts` | Standard work procedures |
| `usePushedWork` | `use-pushed-work.ts` | Pushed work task management |
| `useShiftProductivitySettings` | `use-shift-productivity-settings.ts` | Shift productivity config |

### Configuration Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useWorkflowConfigs` | `use-workflow-configs.ts` | Workflow configuration loading |
| `useActivityConfig` | `use-activity-config.ts` | Activity tracking config |
| `useActivitySourceConfig` | `use-activity-source-config.ts` | Activity source config |
| `usePositionOptions` | `use-position-options.ts` | Position/role option lists |
| `useAreaOptions` | `use-area-options.ts` | Warehouse area option lists |
| `useAppUpdater` | `use-app-updater.ts` | PWA update detection |

## Common Patterns

1. **Auth hooks compose from multiple sources** — `useUnifiedAuth` composes 4 context hooks into one surface
2. **Data hooks use TanStack Query** with typed query keys, `useQuery` for reads, `useMutation` for writes
3. **Permission hooks have sync + async variants** — `hasPermission` (sync, from cache) and `checkPermission` (async, hits DB)
4. **Idle/session hooks use DOM event listeners** with throttled callbacks
5. **Most hooks are namespaced by feature domain** (`use-inbound-*`, `use-cycle-count-*`, `use-kit-*`)

## Related
- [[ZustandStores - State Management]]
- [[AppProviders - Provider Stack]]
- [[React-Query-Patterns]]
- [[State-Management-Patterns]]
- [[RBACService - Role Based Access Control]]