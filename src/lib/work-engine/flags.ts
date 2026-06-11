// Created and developed by Jai Singh
/**
 * Work Engine Feature Flags (frontend)
 *
 * Resolution order (matches Rust `work_engine_feature_flag` SQL helper):
 *   1. `VITE_WORK_ENGINE_FEATURE_OVERRIDES` env (JSON string) — environment override
 *   2. Per-org row in `work_engine_settings.feature_flags` (jsonb)
 *   3. Hard-coded default below
 *
 * The `useWorkEngineFlag` hook reads from React Query so cache invalidation
 * after a settings change (Phase 0a) propagates immediately.
 */
import { supabase } from '@/lib/supabase/client'

export type WorkEngineFlagKey =
  | 'work_engine_enabled'
  | 'work_tasks_shadow_write'
  | 'work_tasks_read_shadow'
  | 'work_tasks_read_primary'
  | 'work_tasks_rollback_to_legacy'
  | 'push_preflight_zone_check'
  | 'worker_capability_required'
  | 'signed_url_photos'

/**
 * Hard defaults. Match the SQL helper's defaults in migration 256.
 * Changing these requires a coordinated frontend + Rust + migration update.
 */
export const WORK_ENGINE_FLAG_DEFAULTS: Record<WorkEngineFlagKey, boolean> = {
  work_engine_enabled: false,
  work_tasks_shadow_write: false,
  work_tasks_read_shadow: false,
  work_tasks_read_primary: false,
  work_tasks_rollback_to_legacy: false,
  push_preflight_zone_check: true,
  worker_capability_required: false,
  signed_url_photos: false,
}

let _envOverrides: Partial<Record<WorkEngineFlagKey, boolean>> | null = null
function envOverrides(): Partial<Record<WorkEngineFlagKey, boolean>> {
  if (_envOverrides !== null) return _envOverrides
  const raw = import.meta.env.VITE_WORK_ENGINE_FEATURE_OVERRIDES
  if (!raw || typeof raw !== 'string') {
    _envOverrides = {}
    return _envOverrides
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<Record<WorkEngineFlagKey, boolean>> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (k in WORK_ENGINE_FLAG_DEFAULTS && typeof v === 'boolean') {
        out[k as WorkEngineFlagKey] = v
      }
    }
    _envOverrides = out
  } catch {
    _envOverrides = {}
  }
  return _envOverrides
}

interface OrgFlagsCacheEntry {
  flags: Partial<Record<WorkEngineFlagKey, boolean>>
  expiresAt: number
}

const _orgCache = new Map<string, OrgFlagsCacheEntry>()
const ORG_CACHE_TTL_MS = 30_000

async function loadOrgFlags(
  orgId: string
): Promise<Partial<Record<WorkEngineFlagKey, boolean>>> {
  const cached = _orgCache.get(orgId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.flags
  }
  const { data, error } = await supabase
    .from('work_engine_settings')
    .select('feature_flags')
    .eq('organization_id', orgId)
    .maybeSingle()
  if (error || !data) {
    _orgCache.set(orgId, {
      flags: {},
      expiresAt: Date.now() + ORG_CACHE_TTL_MS,
    })
    return {}
  }
  const flags: Partial<Record<WorkEngineFlagKey, boolean>> = {}
  const raw = (data as { feature_flags?: Record<string, unknown> })
    .feature_flags
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (k in WORK_ENGINE_FLAG_DEFAULTS && typeof v === 'boolean') {
        flags[k as WorkEngineFlagKey] = v
      }
    }
  }
  _orgCache.set(orgId, { flags, expiresAt: Date.now() + ORG_CACHE_TTL_MS })
  return flags
}

/**
 * Synchronous resolver for callers that already loaded the org flags
 * (e.g. a service-layer batch). Uses defaults if no per-org row is cached.
 */
export function resolveWorkEngineFlagSync(
  orgFlags: Partial<Record<WorkEngineFlagKey, boolean>> | null,
  key: WorkEngineFlagKey
): boolean {
  const env = envOverrides()
  if (key in env) return env[key]!
  if (orgFlags && key in orgFlags) return orgFlags[key]!
  return WORK_ENGINE_FLAG_DEFAULTS[key]
}

/**
 * Async resolver. Loads per-org flags from Supabase the first time per
 * `ORG_CACHE_TTL_MS` window, then returns the resolved boolean.
 *
 * The `work_tasks_rollback_to_legacy` flag is checked BEFORE
 * `work_tasks_read_primary` and `work_tasks_read_shadow` by every consumer —
 * see helper {@link readModeFor}.
 */
export async function workEngineFlag(
  orgId: string | null | undefined,
  key: WorkEngineFlagKey
): Promise<boolean> {
  const env = envOverrides()
  if (key in env) return env[key]!
  if (!orgId) return WORK_ENGINE_FLAG_DEFAULTS[key]
  const flags = await loadOrgFlags(orgId)
  if (key in flags) return flags[key]!
  return WORK_ENGINE_FLAG_DEFAULTS[key]
}

/**
 * Convenience: resolve the effective read mode for an org. Honors the
 * rollback break-glass flag.
 */
export type ReadMode = 'legacy' | 'shadow' | 'primary'
export async function readModeFor(
  orgId: string | null | undefined
): Promise<ReadMode> {
  if (!orgId) return 'legacy'
  const flags = await loadOrgFlags(orgId)
  if (resolveWorkEngineFlagSync(flags, 'work_tasks_rollback_to_legacy')) {
    return 'legacy'
  }
  if (resolveWorkEngineFlagSync(flags, 'work_tasks_read_primary')) {
    return 'primary'
  }
  if (resolveWorkEngineFlagSync(flags, 'work_tasks_read_shadow')) {
    return 'shadow'
  }
  return 'legacy'
}

/**
 * Invalidate the in-memory per-org flag cache. Called after the admin
 * Configurability Surface writes a new settings row, and by the realtime
 * `work_engine_settings_changed` channel listener.
 */
export function invalidateWorkEngineFlagCache(orgId?: string) {
  if (orgId) {
    _orgCache.delete(orgId)
  } else {
    _orgCache.clear()
  }
  _envOverrides = null
}

// Created and developed by Jai Singh
