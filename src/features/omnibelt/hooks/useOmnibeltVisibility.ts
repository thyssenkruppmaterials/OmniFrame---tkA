// Created and developed by Jai Singh
/**
 * OmniBelt — Visibility Hook (full kill-switch evaluator)
 *
 * Implements the six-layer kill switch from spec §13. Returns
 * `{ visible: boolean; reason?: string }`. Each early-return logs at
 * `debug` level so admins answering "why isn't OmniBelt showing up?" can
 * trace it from devtools without instrumenting the codebase.
 *
 * Evaluation order (first hit wins):
 *   1. Build-time env disable (`VITE_OMNIBELT_DISABLED`)
 *   2. Capacitor native platform exclusion
 *   3. Route exclusion regex (RF / kiosk / auth flows / error pages)
 *   4. Unauthenticated
 *   5. Org-level kill switch (settings.system.omnibelt.enabled === false)
 *   6. Per-user hide (Zustand store; persisted)
 *
 * The org-enabled lookup goes through `OmnibeltSettingsService` via
 * TanStack Query. We use `staleTime: 5 min` and `gcTime: 30 min` to match
 * the bootstrap query defaults from spec §15.2 and follow the project-wide
 * "no new setInterval / refetchInterval callsites" rule from
 * `[realtime-policy]` and the OmniBelt pattern doc — invalidation in P2
 * comes from `WsEvent::OmnibeltConfigChanged`, not polling.
 *
 * Layer 5 fails CLOSED: the launcher renders only once the org value is
 * positively confirmed `true`. `undefined` (query in flight) keeps it
 * hidden. The first paint is seeded from a `localStorage` last-known
 * value via `placeholderData`, so a previously-confirmed org decides
 * synchronously (no flash, no fade-in) while a freshly flipped switch
 * still takes effect this session. This replaces the original fail-OPEN
 * behavior, which flashed the launcher on every cold load for orgs that
 * had OmniBelt turned off (pending → shown → resolves false → removed).
 *
 * Hook ordering note: every hook call has to happen before any early
 * return so the rules-of-hooks contract holds across renders. The
 * evaluation block at the bottom is ordinary control flow over already-
 * captured values — that's why we read every layer first then branch.
 */
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { Capacitor } from '@capacitor/core'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import {
  OmnibeltSettingsService,
  OMNIBELT_ENABLED_SETTING_KEY,
} from '@/lib/services/omnibelt-settings-service'
import { logger } from '@/lib/utils/logger'
import { isOmnibeltAllowedRoute } from '../lib/routeGate'
import { useOmnibeltStore } from '../store/omnibeltStore'

export type OmnibeltVisibilityReason =
  | 'env_disabled'
  | 'native_excluded'
  | 'route_excluded'
  | 'unauthenticated'
  | 'org_disabled'
  | 'user_hidden'

export type OmnibeltVisibility = {
  visible: boolean
  reason?: OmnibeltVisibilityReason
}

/**
 * Vite inlines `import.meta.env.*` at build time, so this is a constant
 * by the time it reaches the runtime. Mirrors the
 * `PRESENCE_DISABLED_ENV` parser in `src/lib/presence/constants.ts`.
 */
const OMNIBELT_DISABLED_ENV: boolean = (() => {
  const raw = import.meta.env.VITE_OMNIBELT_DISABLED
  if (raw === undefined || raw === null) return false
  const v = String(raw).toLowerCase().trim()
  return v === 'true' || v === '1' || v === 'yes' || v === 'on'
})()

/**
 * Last-known org-enabled value, persisted across reloads so the very
 * first paint of a cold load can decide synchronously instead of
 * waiting on the network. The org kill switch is org-wide (not
 * per-user), so a single key is correct — and intentionally distinct
 * from the per-user store key so signing in as a different user in the
 * same browser still starts from the right org decision.
 *
 * Wrapped in try/catch: Safari private mode and locked-down embeds
 * throw on `localStorage` access, in which case we degrade to the
 * loading-fails-closed path (a one-frame delay, never a flash).
 */
const LAST_KNOWN_ORG_ENABLED_KEY = 'omniframe.omnibelt.org-enabled.v1'

function readLastKnownOrgEnabled(): boolean | undefined {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_ORG_ENABLED_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return undefined
  } catch {
    return undefined
  }
}

function writeLastKnownOrgEnabled(value: boolean): void {
  try {
    localStorage.setItem(LAST_KNOWN_ORG_ENABLED_KEY, value ? 'true' : 'false')
  } catch {
    /* storage unavailable — fall back to the network decision */
  }
}

export function useOmnibeltVisibility(): OmnibeltVisibility {
  // ---- Capture every signal up front (rules-of-hooks) ---------------------
  const pathname = useLocation({ select: (loc) => loc.pathname })
  const { authState } = useUnifiedAuth()
  const isAuthenticated = authState.isAuthenticated

  // Org-level enabled flag. Skipped while unauthenticated (PostgREST/RLS
  // would reject the read anyway). `staleTime` aligns with the bootstrap
  // query in spec §15.2.
  //
  // DELIBERATE redundancy — do NOT "consolidate" this into
  // `useOmnibeltBootstrap`'s `kill_switch.enabled`. They look like the
  // same datum but serve different reliability tiers:
  //   - This read goes straight to Supabase (`settings`), which stays
  //     reachable even when the FastAPI/Rust bootstrap path is down.
  //     Visibility MUST be decidable then — it gates whether the chrome
  //     mounts at all.
  //   - Bootstrap is circuit-broken (3 failures → 5-min cooldown) and
  //     its offline placeholder is fail-OPEN (`kill_switch.enabled:
  //     true`). If visibility trusted that, it could neither distinguish
  //     "loading" from "enabled" nor honor a kill switch while FastAPI is
  //     unreachable. The extra request buys that independence.
  const { data: orgEnabled, isPlaceholderData } = useQuery<boolean>({
    queryKey: ['omnibelt', 'settings', OMNIBELT_ENABLED_SETTING_KEY],
    queryFn: () => OmnibeltSettingsService.getEnabled(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // Seed the first paint from the last-known org value. We use
    // `placeholderData` (NOT `initialData`) so a real fetch still fires
    // in the background and a freshly flipped kill switch takes effect
    // this session — the seed only governs the synchronous first-frame
    // decision. Returns `undefined` on a never-seen org, which Layer 5
    // treats as "not yet confirmed → stay hidden".
    placeholderData: readLastKnownOrgEnabled,
  })

  // Persist the *real* fetched value (never the placeholder) so the
  // next cold load decides synchronously and never flashes.
  useEffect(() => {
    if (!isPlaceholderData && typeof orgEnabled === 'boolean') {
      writeLastKnownOrgEnabled(orgEnabled)
    }
  }, [isPlaceholderData, orgEnabled])

  const userHidden = useOmnibeltStore((s) => s.userHidden)

  // ---- Layer 1: env disable (build-time) ---------------------------------
  if (OMNIBELT_DISABLED_ENV) {
    logger.debug('[OmniBelt] hidden: env_disabled (VITE_OMNIBELT_DISABLED)')
    return { visible: false, reason: 'env_disabled' }
  }

  // ---- Layer 2: Capacitor native -----------------------------------------
  if (Capacitor.isNativePlatform()) {
    logger.debug('[OmniBelt] hidden: native_excluded (Capacitor native)')
    return { visible: false, reason: 'native_excluded' }
  }

  // ---- Layer 3: route exclusion ------------------------------------------
  if (!isOmnibeltAllowedRoute(pathname)) {
    logger.debug('[OmniBelt] hidden: route_excluded', pathname)
    return { visible: false, reason: 'route_excluded' }
  }

  // ---- Layer 4: unauthenticated ------------------------------------------
  if (!isAuthenticated) {
    logger.debug('[OmniBelt] hidden: unauthenticated')
    return { visible: false, reason: 'unauthenticated' }
  }

  // ---- Layer 5: org kill switch (fail-closed until confirmed) ------------
  // Render the launcher ONLY once the org value is positively confirmed
  // `true`. Any other value keeps it hidden:
  //   - `false`      → admin turned OmniBelt off (explicit kill).
  //   - `undefined`  → query still in flight on a never-seen org.
  //
  // `getEnabled` already fails OPEN at the service layer (missing row /
  // network error → `true`), so this only fails closed during the brief
  // pre-resolution window. The `placeholderData` seed above collapses
  // that window to zero on any org we've confirmed before. The previous
  // logic showed the launcher while `undefined`, which flashed it on
  // every cold load for orgs that had OmniBelt turned off.
  if (orgEnabled !== true) {
    logger.debug('[OmniBelt] hidden: org_disabled', {
      orgEnabled,
      pending: orgEnabled === undefined,
    })
    return { visible: false, reason: 'org_disabled' }
  }

  // ---- Layer 6: per-user hide --------------------------------------------
  if (userHidden) {
    logger.debug('[OmniBelt] hidden: user_hidden')
    return { visible: false, reason: 'user_hidden' }
  }

  return { visible: true }
}

// Created and developed by Jai Singh
