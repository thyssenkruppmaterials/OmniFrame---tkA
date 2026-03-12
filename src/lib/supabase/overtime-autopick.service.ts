import { logger } from '@/lib/utils/logger'
import { supabase } from './client'
import {
  getSignupsForRequests,
  type OvertimeRequest,
  type OvertimeStatus,
} from './overtime.service'

export type AutoPickResult =
  | { outcome: 'selected'; userId: string; userName?: string }
  | { outcome: 'extended'; newCutoff: string }
  | { outcome: 'noop'; reason: string }

/**
 * Run auto-pick for an overtime request.
 * - If already assigned or not approved: noop
 * - If not enough signups: extend cutoff by 1 hour (up to OT start time)
 * - If enough signups: select the oldest signup as winner (placeholder for future criteria)
 */
export async function runAutoPick(requestId: string): Promise<AutoPickResult> {
  try {
    const { data: rawRequest, error: reqError } = await supabase
      .from('overtime_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (reqError || !rawRequest) {
      return { outcome: 'noop', reason: 'Overtime request not found' }
    }

    // Cast to our interface which includes the new columns
    const request = rawRequest as unknown as OvertimeRequest

    if (request.status !== 'approved') {
      return {
        outcome: 'noop',
        reason: `Request status is "${request.status}", not approved`,
      }
    }

    if (request.assigned_user_ids && request.assigned_user_ids.length > 0) {
      return { outcome: 'noop', reason: 'Position already filled' }
    }

    const signups = await getSignupsForRequests([requestId])
    const activeSignups = signups.filter((s) => s.response !== 'declined')
    const minRequired = request.min_signups_required || 1

    if (activeSignups.length < minRequired) {
      const currentCutoff = request.signup_cutoff_time
        ? new Date(request.signup_cutoff_time)
        : new Date()
      const newCutoff = new Date(currentCutoff.getTime() + 60 * 60 * 1000)

      const otDate = request.request_date
      const otStartTime = request.original_shift_end
      const otStartStr = `${otDate}T${otStartTime}`
      const otStart = new Date(otStartStr)

      if (newCutoff >= otStart) {
        return {
          outcome: 'noop',
          reason: `Only ${activeSignups.length} of ${minRequired} required signups. Cannot extend further — cutoff would exceed overtime start time.`,
        }
      }

      const { error: updateError } = await supabase
        .from('overtime_requests')
        .update({ signup_cutoff_time: newCutoff.toISOString() } as Record<
          string,
          unknown
        >)
        .eq('id', requestId)

      if (updateError) throw updateError

      return { outcome: 'extended', newCutoff: newCutoff.toISOString() }
    }

    const winner = activeSignups[0]
    if (!winner) {
      return { outcome: 'noop', reason: 'No active signups found' }
    }

    const winnerId = winner.user_id

    const { error: assignError } = await supabase
      .from('overtime_requests')
      .update({ assigned_user_ids: [winnerId] })
      .eq('id', requestId)

    if (assignError) throw assignError

    const { error: signupError } = await supabase
      .from('overtime_signups')
      .update({
        response: 'accepted',
        status: 'approved' as OvertimeStatus,
        response_time: new Date().toISOString(),
      })
      .eq('id', winner.id)

    if (signupError) throw signupError

    return {
      outcome: 'selected',
      userId: winnerId,
      userName: winner.user?.full_name,
    }
  } catch (error) {
    logger.error('Error running auto-pick:', error)
    return {
      outcome: 'noop',
      reason: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}
// Developer and Creator: Jai Singh
