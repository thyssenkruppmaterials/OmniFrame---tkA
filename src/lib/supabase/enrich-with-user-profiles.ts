// Created and developed by Jai Singh
/**
 * Enrich rows with `user_profiles` lookups via a two-query pattern.
 *
 * The PostgREST embed shape:
 *
 *   .select('*, confirmed_by_user:user_profiles!confirmed_by(id, full_name, email)')
 *
 * is convenient but expensive — it expands to a `LEFT JOIN LATERAL (SELECT
 * … FROM user_profiles WHERE id = parent.confirmed_by LIMIT 1 OFFSET 0)`
 * subquery that the planner re-evaluates per row, with per-row RLS on
 * `user_profiles`. On 47k-row `rf_putaway_operations` paginated chunks this
 * pushes mean execution past 2 seconds.
 *
 * The two-query alternative this helper implements is:
 *
 *   1. Fetch the rows WITHOUT the embed (one cheap planar SELECT per chunk).
 *   2. Collect every unique UUID across the FK columns we care about.
 *   3. Issue ONE `SELECT id, full_name, email FROM user_profiles WHERE id
 *      IN (…)` against the read-replica client.
 *   4. Attach the matching profile onto each row under the requested alias.
 *
 * Even with a few hundred distinct user ids the IN-list query is a tiny
 * primary-key scan, well under 50 ms. Compared to the LATERAL embed this
 * removes roughly N × per-row RLS evaluations (where N = page size).
 *
 * See:
 *   - memorybank/OmniFrame/Debug/Performance-Review-2026-05-19-Production-Slowness.md
 *   - memorybank/OmniFrame/Debug/Fix-Slow-PostgREST-LATERAL-Embeds-2026-05-20.md
 *   - memorybank/OmniFrame/Patterns/Supabase-Read-Replica-Routing.md
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import { supabaseRead } from './client'
import type { Database } from './database.types'

export interface UserProfileSummary {
  id: string
  full_name: string | null
  email: string
}

/**
 * Fetch a `Map<id, UserProfileSummary>` for the given UUIDs.
 *
 * Defensive against:
 *  - Empty input (returns an empty map without a network call).
 *  - Large id lists (chunks the IN clause into 500-id batches to avoid
 *    PostgREST query-string length limits).
 *  - Read errors (logs + returns an empty map — callers always have a
 *    sensible fallback because user enrichment is presentation-only).
 */
export async function fetchUserProfilesByIds(
  ids: ReadonlyArray<string | null | undefined>,
  client: SupabaseClient<Database> = supabaseRead
): Promise<Map<string, UserProfileSummary>> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id): id is string => typeof id === 'string' && !!id))
  )

  const profileMap = new Map<string, UserProfileSummary>()
  if (uniqueIds.length === 0) return profileMap

  const CHUNK = 500
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const slice = uniqueIds.slice(i, i + CHUNK)
    const { data, error } = await client
      .from('user_profiles')
      .select('id, full_name, email')
      .in('id', slice)

    if (error) {
      logger.warn(
        '⚠️ enrichWithUserProfiles: lookup failed for chunk',
        i / CHUNK,
        error
      )
      continue
    }

    for (const profile of data ?? []) {
      if (profile?.id) {
        profileMap.set(profile.id, {
          id: profile.id,
          full_name: profile.full_name ?? null,
          email: profile.email,
        })
      }
    }
  }

  return profileMap
}

/**
 * Mutates `rows` in place, attaching the resolved user profile under the
 * given alias for each `[fkColumn → alias]` mapping. Returns the same
 * array (typed loosely) for fluent chaining.
 *
 * Example:
 *   await attachUserProfiles(rows, [
 *     ['confirmed_by',    'confirmed_by_user'],
 *     ['mca_processed_by', 'mca_processed_by_user'],
 *   ])
 *
 * After the call each row has shape:
 *   { …row, confirmed_by_user: { id, full_name, email } | null,
 *           mca_processed_by_user: { id, full_name, email } | null }
 */
export async function attachUserProfiles<
  T extends Record<string, unknown>,
  M extends ReadonlyArray<readonly [keyof T & string, string]>,
>(
  rows: T[],
  mapping: M,
  client: SupabaseClient<Database> = supabaseRead
): Promise<T[]> {
  if (!rows.length) return rows

  const allIds: Array<string | null | undefined> = []
  for (const row of rows) {
    for (const [fk] of mapping) {
      allIds.push(row[fk] as string | null | undefined)
    }
  }

  const profiles = await fetchUserProfilesByIds(allIds, client)

  for (const row of rows) {
    for (const [fk, alias] of mapping) {
      const id = row[fk] as string | null | undefined
      ;(row as Record<string, unknown>)[alias] = id
        ? (profiles.get(id) ?? null)
        : null
    }
  }
  return rows
}

// Created and developed by Jai Singh
