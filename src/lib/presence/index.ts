// Created and developed by Jai Singh
/**
 * Presence module facade.
 *
 * The `presenceService` singleton exported here is what every consumer
 * (the React hooks, in particular `usePresenceTracker`) imports. The
 * concrete implementation is selected at MODULE LOAD by the
 * build-time env var `VITE_PRESENCE_MODE`:
 *
 *   - `'supabase'` (default) → `PresenceService` in `presence.service.ts`
 *     (the Phase A + B2 + B3 implementation against Supabase Realtime).
 *   - `'rust'`               → `PresenceServiceRust` in
 *     `presence.service.rust.ts` (Option 2 — server-side presence on
 *     `rust-work-service`). See
 *     `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`.
 *   - `'disabled'`           → still uses the Supabase implementation
 *     but the service's `disabledReason='env'` short-circuit means
 *     `initialize()` returns immediately. The Rust implementation
 *     applies the same short-circuit, so either path is correct here;
 *     we keep the default for stability.
 *
 * The two service classes have IDENTICAL public surfaces (init,
 * setStatus, setCustomStatusText, getEffectiveStatus, getManualStatus,
 * destroy, isConnected, isDisabled, disabledReasonValue). Hooks are
 * unchanged.
 *
 * Per-org rollout (the "would be nice" path in the ADR) is future
 * work — for now the env var flips the whole fleet at once.
 *
 * Both class names are re-exported (PresenceService, PresenceServiceRust)
 * for tests + tooling that wants to instantiate one explicitly.
 */
import { PRESENCE_MODE } from './constants'
import {
  PresenceService,
  presenceService as presenceServiceSupabase,
} from './presence.service'
import {
  PresenceServiceRust,
  presenceServiceRust,
} from './presence.service.rust'

export * from './types'
export * from './constants'
export { IdleDetector } from './idle-detector'
export { resolveFeature, type ResolvedFeature } from './route-features'

// Re-export both class names so consumers / tests can instantiate
// either implementation directly.
export { PresenceService, PresenceServiceRust }

/**
 * The active presence service singleton. Switches between the
 * Supabase Realtime and the Rust-WS implementations at module load.
 *
 * Type: the lowest common denominator of `PresenceService` and
 * `PresenceServiceRust` — declared as `PresenceService` because the
 * two classes share an identical public shape (verified by the type
 * checker the moment a consumer drifts).
 */
export const presenceService: PresenceService =
  PRESENCE_MODE === 'rust'
    ? (presenceServiceRust as unknown as PresenceService)
    : presenceServiceSupabase

// Created and developed by Jai Singh
