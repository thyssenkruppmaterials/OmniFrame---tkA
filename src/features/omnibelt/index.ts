// Created and developed by Jai Singh
/**
 * OmniBelt — public API surface (P1)
 *
 * P1 ships only foundation primitives — no UI yet. The host component,
 * skins, panel, tray and tool registry land in P3+. Keeping this barrel
 * scoped lets P3 add `OmniBeltHost` here without touching every callsite.
 */

export {
  isOmnibeltAllowedRoute,
  OMNIBELT_EXCLUDED_PATTERNS_FOR_TESTS,
} from './lib/routeGate'

export { routeClass, type RouteClass } from './lib/routeClass'

export {
  initOmnibeltStore,
  useOmnibeltStore,
  getOmnibeltStore,
  getOmnibeltStoreUserId,
  omnibeltStorageKeyFor,
  DEFAULT_PERSISTED_STATE,
  type AnchorName,
  type AnchorPosition,
  type ActiveJob,
  type ActiveJobType,
  type CollapseState,
  type Mach3Behavior,
  type OmnibeltActions,
  type OmnibeltPersistedState,
  type OmnibeltRuntimeState,
  type OmnibeltState,
  type Skin,
} from './store/omnibeltStore'

export {
  useOmnibeltVisibility,
  type OmnibeltVisibility,
  type OmnibeltVisibilityReason,
} from './hooks/useOmnibeltVisibility'

export {
  useOmnibeltBootstrap,
  omnibeltBootstrapQueryKey,
  OMNIBELT_BOOTSTRAP_QUERY_KEY_BASE,
  OMNIBELT_BOOTSTRAP_QUERY_KEY_KIND,
  OMNIBELT_BOOTSTRAP_PLACEHOLDER,
  __resetBootstrapCircuitBreakerForTests,
  __recordBootstrapFailureForTests,
  __isBootstrapCircuitOpenForTests,
  type OmnibeltBootstrap,
  type OmnibeltActiveJob,
  type OmnibeltRoleConfigPayload,
  type OmnibeltUserPrefsPayload,
} from './hooks/useOmnibeltBootstrap'

export {
  BootstrapAuthError,
  BootstrapNetworkError,
  BootstrapValidationError,
  classifyResponse,
  isAuthError,
  isNetworkError,
  isValidationError,
} from './lib/bootstrap-errors'

export {
  useOmnibeltConfigInvalidator,
  type OmnibeltConfigInvalidatorState,
} from './hooks/useOmnibeltConfigInvalidator'

// P3 — visible chrome
export { OmniBeltHost } from './OmniBeltHost'
export {
  HOUSE_SPRING,
  LIQUID_SPRING,
  SNAP_SPRING,
  HOUSE_EASE,
  COLLAPSE_LAYOUT_ID,
  COLLAPSE_LAYOUT_GROUP_ID,
  PILL_TO_PANEL_MS,
  PILL_TO_ORB_MS,
  ORB_TO_NUB_MS,
} from './lib/motion'
export {
  TOOL_REGISTRY,
  type ToolDef,
  type ToolAccent,
  type ToolCategory,
  type ToolBadge,
  type ToolShellProps,
  type OmnibeltIconComponent,
} from './tools/registry'
export {
  useResolvedTools,
  type ResolvedTools,
} from './tools/use-resolved-tools'
export { useOmnibeltKeyboard } from './hooks/useOmnibeltKeyboard'

// P6 — Anchor system + drag + collision
export {
  resolveAnchorPosition,
  snapToNearestAnchor,
  pickAnchorByZone,
  clampToViewport,
  ANCHOR_POSITIONS,
  USER_CORNER_ANCHORS,
  NUB_ANCHORS,
  SNAP_DEADZONE_PX,
  VIEWPORT_GUTTER_PX,
  type Offset,
  type ResolvedPosition,
} from './lib/anchors'
export {
  avoidCollisions,
  rectsOverlap,
  rectsOverlapAreaPx,
  type Rect,
} from './lib/collision'
export {
  useOmnibeltPosition,
  DEFAULT_WIDGET_SIZE,
  type UseOmnibeltPositionArgs,
  type UseOmnibeltPositionResult,
} from './hooks/useOmnibeltPosition'
export {
  useOmnibeltCollisionAvoidance,
  DEFAULT_COMPETING_SELECTORS,
  type UseOmnibeltCollisionAvoidanceArgs,
  type UseOmnibeltCollisionAvoidanceResult,
} from './hooks/useOmnibeltCollisionAvoidance'

// Created and developed by Jai Singh
