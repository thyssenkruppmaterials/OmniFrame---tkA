// Created and developed by Jai Singh
/**
 * OmniBelt — Settings Service
 *
 * Org-level kill-switch reader. Mirrors the read pattern in
 * [`SettingsService`](./settings-service.ts): query the `settings` table for
 * a system-wide row (`user_id IS NULL`) keyed by name, fall back to the
 * default when the row is missing or the network is unreachable.
 *
 * P1 ships read-only (the visibility hook just needs to know whether the
 * org has flipped OmniBelt off). The matching admin write path arrives in
 * P2 (`POST /api/admin/omnibelt/kill-switch` writes the same row).
 *
 * Shape of the persisted value:
 *   `system.omnibelt.enabled` -> { "enabled": boolean }
 *
 * Default policy (fail-open at the org level): when the row does not exist,
 * we treat OmniBelt as ENABLED. Rationale: first-launch dev orgs should see
 * the launcher without an admin first creating a row; admins explicitly opt
 * out by setting `{ enabled: false }`. The other kill-switch layers
 * (env disable, route exclusion, native, unauthenticated, user-hidden) are
 * unaffected by this default.
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export const OMNIBELT_ENABLED_SETTING_KEY = 'system.omnibelt.enabled'
export const OMNIBELT_ALLOW_LIST_SETTING_KEY = 'system.omnibelt.allow_list'

export type OmnibeltEnabledValue = { enabled: boolean }
export type OmnibeltAllowListValue = { tool_ids: string[] }

export class OmnibeltSettingsService {
  /**
   * Read the org-wide enabled flag. Returns `true` when no row exists
   * (fail-open) and on any unexpected error so a transient network blip
   * doesn't yank the launcher off every screen.
   */
  static async getEnabled(): Promise<boolean> {
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) return true

      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', OMNIBELT_ENABLED_SETTING_KEY)
        .is('user_id', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        logger.warn(
          '[OmniBelt] settings.system.omnibelt.enabled read failed; defaulting to enabled',
          error
        )
        return true
      }
      if (!data) return true

      const value = data.value as unknown as OmnibeltEnabledValue | null
      if (!value || typeof value.enabled !== 'boolean') return true
      return value.enabled
    } catch (err) {
      logger.warn(
        '[OmniBelt] settings.system.omnibelt.enabled threw; defaulting to enabled',
        err
      )
      return true
    }
  }

  /**
   * Read the org-wide tool allow-list. Returns `null` when no row exists
   * — callers interpret `null` as "no restriction; trust the role default".
   */
  static async getAllowList(): Promise<string[] | null> {
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session?.user) return null

      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', OMNIBELT_ALLOW_LIST_SETTING_KEY)
        .is('user_id', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        logger.warn(
          '[OmniBelt] settings.system.omnibelt.allow_list read failed; treating as unrestricted',
          error
        )
        return null
      }
      if (!data) return null

      const value = data.value as unknown as OmnibeltAllowListValue | null
      if (!value || !Array.isArray(value.tool_ids)) return null
      return value.tool_ids
    } catch (err) {
      logger.warn(
        '[OmniBelt] settings.system.omnibelt.allow_list threw; treating as unrestricted',
        err
      )
      return null
    }
  }
}

// Created and developed by Jai Singh
