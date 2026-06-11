// Created and developed by Jai Singh
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'

export interface TimeAdjustmentRequest {
  id: string
  organization_id: string
  requester_user_id: string
  requester_name: string
  requester_badge: string
  request_date: string
  correction_type: 'add' | 'delete' | 'change'
  clock_code: string
  reason_code: string
  reason_other: string | null
  hours_requested: number | null
  signature_data_url: string
  department_area: string | null
  supervisor_name: string | null
  notes: string | null
  status: 'pending' | 'approved' | 'denied'
  reviewer_user_id: string | null
  reviewer_name: string | null
  reviewer_notes: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface TimeAdjustmentNoteHistory {
  id: string
  request_id: string
  note_content: string
  previous_content: string | null
  edited_by_user_id: string
  edited_by_name: string
  created_at: string
}

export interface CreateTimeAdjustmentInput {
  organization_id: string
  requester_user_id: string
  requester_name: string
  requester_badge: string
  request_date: string
  correction_type: 'add' | 'delete' | 'change'
  clock_code: string
  reason_code: string
  reason_other?: string | null
  hours_requested?: number | null
  signature_data_url: string
  department_area?: string | null
  supervisor_name?: string | null
}

export interface TimeAdjustmentFilters {
  status?: 'pending' | 'approved' | 'denied'
  from_date?: string
  to_date?: string
  search?: string
}

const timeAdjustmentTable = () =>
  (supabase as any).from('time_adjustment_requests')

const noteHistoryTable = () =>
  (supabase as any).from('time_adjustment_note_history')

export async function createTimeAdjustmentRequest(
  input: CreateTimeAdjustmentInput
): Promise<{ data: TimeAdjustmentRequest | null; error: string | null }> {
  try {
    const { data, error } = await timeAdjustmentTable()
      .insert({
        organization_id: input.organization_id,
        requester_user_id: input.requester_user_id,
        requester_name: input.requester_name,
        requester_badge: input.requester_badge,
        request_date: input.request_date,
        correction_type: input.correction_type,
        clock_code: input.clock_code,
        reason_code: input.reason_code,
        reason_other: input.reason_other || null,
        hours_requested: input.hours_requested ?? null,
        signature_data_url: input.signature_data_url,
        department_area: input.department_area || null,
        supervisor_name: input.supervisor_name || null,
        status: 'pending',
      })
      .select('*')
      .single()

    if (error) {
      logger.error('Failed to create time adjustment request:', error)
      return { data: null, error: error.message }
    }

    return { data: data as TimeAdjustmentRequest, error: null }
  } catch (err) {
    logger.error('Error creating time adjustment request:', err)
    return { data: null, error: 'An unexpected error occurred' }
  }
}

export async function getTimeAdjustmentRequests(
  organizationId: string,
  filters?: TimeAdjustmentFilters
): Promise<{ data: TimeAdjustmentRequest[]; error: string | null }> {
  try {
    let query = timeAdjustmentTable()
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (filters?.status) {
      query = query.eq('status', filters.status)
    }
    if (filters?.from_date) {
      query = query.gte('request_date', filters.from_date)
    }
    if (filters?.to_date) {
      query = query.lte('request_date', filters.to_date)
    }
    if (filters?.search) {
      query = query.ilike('requester_name', `%${filters.search}%`)
    }

    const { data, error } = await query.limit(200)

    if (error) {
      logger.error('Failed to fetch time adjustment requests:', error)
      return { data: [], error: error.message }
    }

    return { data: (data || []) as TimeAdjustmentRequest[], error: null }
  } catch (err) {
    logger.error('Error fetching time adjustment requests:', err)
    return { data: [], error: 'An unexpected error occurred' }
  }
}

export async function approveTimeAdjustmentRequest(
  id: string,
  reviewerUserId: string,
  reviewerName: string,
  notes?: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: existing, error: fetchError } = await timeAdjustmentTable()
      .select('status')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'Request not found' }
    }
    if ((existing as any).status !== 'pending') {
      return { success: false, error: 'Request has already been reviewed' }
    }

    const updatePayload: Record<string, unknown> = {
      status: 'approved',
      reviewer_user_id: reviewerUserId,
      reviewer_name: reviewerName,
      reviewer_notes: notes || null,
      reviewed_at: new Date().toISOString(),
    }
    if (notes?.trim()) updatePayload.notes = notes.trim()

    const { error } = await timeAdjustmentTable()
      .update(updatePayload)
      .eq('id', id)

    if (error) {
      logger.error('Failed to approve time adjustment request:', error)
      return { success: false, error: error.message }
    }

    return { success: true, error: null }
  } catch (err) {
    logger.error('Error approving time adjustment request:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export async function denyTimeAdjustmentRequest(
  id: string,
  reviewerUserId: string,
  reviewerName: string,
  notes?: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: existing, error: fetchError } = await timeAdjustmentTable()
      .select('status')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return { success: false, error: 'Request not found' }
    }
    if ((existing as any).status !== 'pending') {
      return { success: false, error: 'Request has already been reviewed' }
    }

    const updatePayload: Record<string, unknown> = {
      status: 'denied',
      reviewer_user_id: reviewerUserId,
      reviewer_name: reviewerName,
      reviewer_notes: notes || null,
      reviewed_at: new Date().toISOString(),
    }
    if (notes?.trim()) updatePayload.notes = notes.trim()

    const { error } = await timeAdjustmentTable()
      .update(updatePayload)
      .eq('id', id)

    if (error) {
      logger.error('Failed to deny time adjustment request:', error)
      return { success: false, error: error.message }
    }

    return { success: true, error: null }
  } catch (err) {
    logger.error('Error denying time adjustment request:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export async function updateTimeAdjustmentNotes(
  requestId: string,
  newNotes: string,
  previousNotes: string | null,
  editorUserId: string,
  editorName: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { error: historyError } = await noteHistoryTable().insert({
      request_id: requestId,
      note_content: newNotes,
      previous_content: previousNotes || null,
      edited_by_user_id: editorUserId,
      edited_by_name: editorName,
    })

    if (historyError) {
      logger.error('Failed to insert note history:', historyError)
      return { success: false, error: historyError.message }
    }

    const { error: updateError } = await timeAdjustmentTable()
      .update({ notes: newNotes })
      .eq('id', requestId)

    if (updateError) {
      logger.error('Failed to update notes on request:', updateError)
      return { success: false, error: updateError.message }
    }

    return { success: true, error: null }
  } catch (err) {
    logger.error('Error updating time adjustment notes:', err)
    return { success: false, error: 'An unexpected error occurred' }
  }
}

export async function getTimeAdjustmentNoteHistory(
  requestId: string
): Promise<{ data: TimeAdjustmentNoteHistory[]; error: string | null }> {
  try {
    const { data, error } = await noteHistoryTable()
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Failed to fetch note history:', error)
      return { data: [], error: error.message }
    }

    return { data: (data || []) as TimeAdjustmentNoteHistory[], error: null }
  } catch (err) {
    logger.error('Error fetching note history:', err)
    return { data: [], error: 'An unexpected error occurred' }
  }
}

// Created and developed by Jai Singh
