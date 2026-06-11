// Created and developed by Jai Singh
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

/**
 * Phase A3: centralised audit logger for SAP automation outcomes.
 *
 * Every mutation completion (success / error / warning) calls
 * `logSapAudit()` from the authenticated browser. RLS policies on
 * `sap_audit_log` enforce org-scoping so the agent does not need its
 * own Supabase token to participate in auditing.
 *
 * Failures are intentionally swallowed — auditing should never block
 * the user-visible operation. Errors are logged to the console for
 * post-mortem.
 */
export interface SapAuditEntry {
  /** Transaction code, e.g. 'LT12', 'LS02N', 'MM02', 'LT01', 'LS01N'. */
  transactionCode: string
  /** Handler name, e.g. 'confirm_transfer_order', 'material_master_bin'. */
  action: string
  /** Sanitised input payload (DO NOT log secrets). */
  payload?: Record<string, unknown> | object
  /** Whatever the agent returned. Accepts any object shape — the field
   *  is stored as JSONB on the row. */
  result?: Record<string, unknown> | object
  /** 'success' | 'error' | 'warning'. */
  status: 'success' | 'error' | 'warning'
  /** Step name on partial failures (e.g. 'org_levels_popup'). */
  step?: string | null
  /** Status-bar message returned by SAP, when present. */
  sapMessage?: string | null
  /** SAP message type, if extracted ('S' / 'E' / 'A' / 'W'). */
  sapMessageType?: string | null
  /** Agent semantic version (e.g. '1.4.0') from /health. */
  agentVersion?: string | null
  /** Wall-clock duration of the agent call. */
  durationMs?: number | null
  /** Optional link back to a sap_agent_jobs row. */
  jobId?: string | null
  /**
   * Phase D #15 — pre-mutation snapshot of the fields the reversal
   * engine needs to invert this action. Populated from the dry-run
   * preview when one ran before the mutation; left undefined / null
   * for legacy call sites and the engine flags those rows as
   * "cannot reverse — no prev_state captured".
   *
   * Examples:
   *   material_master_bin           → { storage_bin: 'OLD-BIN-A-01' }
   *   material_master_storage_types → { removal_storage_type: '010', placement_storage_type: '020' }
   *   set_bin_blocks                → { putaway_block: false, stock_removal_block: true }
   */
  prevState?: Record<string, unknown> | object | null
  /**
   * Phase D #15 — reversal lifecycle marker on this row:
   *   - 'original'        — a normal mutation, never reversed
   *   - 'reversal'        — this row is itself the reversal of another row
   *                         (set by the reversal engine; pair with `reversesAuditId`)
   *   - 'cannot_reverse'  — the action is irreversible (e.g. LT12 confirm)
   *   - undefined         — leave the column NULL (legacy / unknown)
   *
   * The 'reversed' state lives on the *original* row and is set by the
   * `mark_audit_row_reversed` SECURITY DEFINER RPC, not by this helper.
   */
  reversalStatus?: 'original' | 'reversal' | 'cannot_reverse' | null
  /** Phase D #15 — when this row is a reversal, the id of the original
   *  audit row it reverses. */
  reversesAuditId?: string | null
}

interface UserOrgContext {
  userId: string | null
  organizationId: string | null
}

let _orgCache: UserOrgContext | null = null
let _orgPromise: Promise<UserOrgContext> | null = null

/**
 * Resolve and cache the current user + their organization_id once per
 * page load. Reused for every audit insert so we don't hit the network
 * on each mutation.
 */
async function resolveOrgContext(): Promise<UserOrgContext> {
  if (_orgCache) return _orgCache
  if (_orgPromise) return _orgPromise
  _orgPromise = (async () => {
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id ?? null
    if (!userId) {
      _orgCache = { userId: null, organizationId: null }
      return _orgCache
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle()
    _orgCache = {
      userId,
      organizationId: (profile?.organization_id as string | undefined) ?? null,
    }
    return _orgCache
  })()
  try {
    return await _orgPromise
  } finally {
    _orgPromise = null
  }
}

/** Allow callers (e.g. on auth change) to refetch the cached profile. */
export function clearSapAuditOrgCache() {
  _orgCache = null
}

export async function logSapAudit(entry: SapAuditEntry): Promise<void> {
  try {
    const ctx = await resolveOrgContext()
    if (!ctx.organizationId) {
      // Not signed in or profile missing — auditing is a no-op for
      // anonymous sessions to avoid RLS rejections cluttering logs.
      return
    }
    const row: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      user_id: ctx.userId,
      transaction_code: entry.transactionCode,
      action: entry.action,
      payload: entry.payload ?? null,
      result: entry.result ?? null,
      status: entry.status,
      step: entry.step ?? null,
      sap_message: entry.sapMessage ?? null,
      sap_message_type: entry.sapMessageType ?? null,
      agent_version: entry.agentVersion ?? null,
      duration_ms: entry.durationMs ?? null,
      job_id: entry.jobId ?? null,
    }
    // Phase D #15 — only include reversal columns when supplied so we
    // don't write empty JSONB / nulls for rows that don't care.
    if (entry.prevState !== undefined && entry.prevState !== null) {
      row.prev_state = entry.prevState
    }
    if (entry.reversalStatus !== undefined && entry.reversalStatus !== null) {
      row.reversal_status = entry.reversalStatus
    }
    if (entry.reversesAuditId !== undefined && entry.reversesAuditId !== null) {
      row.reverses_audit_id = entry.reversesAuditId
    }
    // The generated supabase types don't yet include sap_audit_log
    // (added in migration 246). Cast the client to bypass the typed
    // overload until the next `npx supabase gen types` regeneration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any
    const { error } = await client.from('sap_audit_log').insert(row)
    if (error) {
      logger.warn('[sap-audit] insert failed (non-fatal):', error.message)
    }
  } catch (err) {
    logger.warn('[sap-audit] unexpected exception (non-fatal):', err)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase D #15 — reversal-engine helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Insert an audit row for a reversal action and return the new row's
 * id. The reversal engine needs the id so it can chain a follow-up
 * `mark_audit_row_reversed` RPC against the original row.
 *
 * This is `logSapAudit` + `.select('id').single()`; we keep it as a
 * separate function because the fire-and-forget happy path of
 * `logSapAudit` returns void and most callers don't want to await an
 * extra round-trip.
 */
export async function insertReversalAuditRow(
  entry: SapAuditEntry & { reversesAuditId: string }
): Promise<string | null> {
  try {
    const ctx = await resolveOrgContext()
    if (!ctx.organizationId) return null
    const row: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      user_id: ctx.userId,
      transaction_code: entry.transactionCode,
      action: entry.action,
      payload: entry.payload ?? null,
      result: entry.result ?? null,
      status: entry.status,
      step: entry.step ?? null,
      sap_message: entry.sapMessage ?? null,
      sap_message_type: entry.sapMessageType ?? null,
      agent_version: entry.agentVersion ?? null,
      duration_ms: entry.durationMs ?? null,
      job_id: entry.jobId ?? null,
      prev_state: entry.prevState ?? null,
      reversal_status: entry.reversalStatus ?? 'reversal',
      reverses_audit_id: entry.reversesAuditId,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any
    const { data, error } = await client
      .from('sap_audit_log')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      logger.warn(
        '[sap-audit] reversal insert failed (non-fatal):',
        error.message
      )
      return null
    }
    return (data?.id as string | undefined) ?? null
  } catch (err) {
    logger.warn('[sap-audit] insertReversalAuditRow unexpected exception:', err)
    return null
  }
}

/**
 * Flip the original row's `reversal_status` from 'original' → 'reversed'
 * via the org-scoped, state-checked SECURITY DEFINER RPC introduced in
 * migration 249. Returns the boolean the function returned (true on
 * success, false if the precondition check failed).
 */
export async function markAuditRowReversed(
  originalAuditId: string,
  reversalAuditId: string
): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any
    const { data, error } = await client.rpc('mark_audit_row_reversed', {
      p_original_id: originalAuditId,
      p_reversal_id: reversalAuditId,
    })
    if (error) {
      logger.warn(
        '[sap-audit] mark_audit_row_reversed RPC failed:',
        error.message
      )
      return false
    }
    return Boolean(data)
  } catch (err) {
    logger.warn('[sap-audit] markAuditRowReversed exception:', err)
    return false
  }
}

// Created and developed by Jai Singh
