// Created and developed by Jai Singh
import { supabase } from '@/lib/supabase/client'

// The time_clock_entries table was created after types were generated.
const timeClockTable = () => (supabase as any).from('time_clock_entries')
const timeCardsTable = () => (supabase as any).from('time_cards')
const timeCardNotesTable = () => (supabase as any).from('time_card_notes')

// ── Types ──────────────────────────────────────────────────────────────────

export interface ClockEntryRow {
  id: string
  organization_id: string
  user_id: string
  shift_assignment_id: string | null
  badge_number: string | null
  clock_in: string
  clock_out: string | null
  clock_in_photo_url: string | null
  clock_out_photo_url: string | null
  clock_in_method: 'badge' | 'manual' | 'supervisor_entry'
  ip_address: string | null
  device_info: string | null
  status: 'active' | 'completed' | 'missed_punch' | 'void'
  is_manual_entry: boolean
  manual_entry_reason: string | null
  manual_entered_by: string | null
  break_duration_minutes: number
  notes: string | null
  created_at: string
  updated_at: string
  // joined fields
  employee_name?: string
  first_name?: string
  last_name?: string
}

export interface TimeCardRow {
  id: string
  organization_id: string
  user_id: string
  pay_period_start: string
  pay_period_end: string
  total_regular_hours: number
  total_overtime_hours: number
  total_break_hours: number
  status: 'pending' | 'submitted' | 'approved' | 'rejected' | 'needs_revision'
  submitted_at: string | null
  approved_by: string | null
  approved_at: string | null
  supervisor_notes: string | null
  employee_notes: string | null
  exceptions_count: number
  // joined
  employee_name?: string
  badge_number?: string
  department?: string
}

export interface DashboardMetrics {
  totalHours: number
  pendingApprovals: number
  activeClockIns: number
  totalEntries: number
}

// ── Clock Entries ─────────────────────────────────────────────────────────

export async function fetchClockEntries(filters?: {
  dateFrom?: string
  dateTo?: string
  status?: string
  method?: string
  search?: string
}): Promise<ClockEntryRow[]> {
  let query = timeClockTable()
    .select('*')
    .order('clock_in', { ascending: false })
    .limit(100)

  if (filters?.dateFrom) {
    query = query.gte('clock_in', `${filters.dateFrom}T00:00:00`)
  }
  if (filters?.dateTo) {
    query = query.lte('clock_in', `${filters.dateTo}T23:59:59`)
  }
  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters?.method && filters.method !== 'all') {
    query = query.eq('clock_in_method', filters.method)
  }

  const { data, error } = await query
  if (error || !data) return []

  // Enrich with user names
  const entries = data as ClockEntryRow[]
  const userIds = [...new Set(entries.map((e) => e.user_id))]

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, full_name')
      .in('id', userIds)

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))

    for (const entry of entries) {
      const profile = profileMap.get(entry.user_id) as any
      if (profile) {
        entry.employee_name =
          profile.full_name ||
          `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
        entry.first_name = profile.first_name
        entry.last_name = profile.last_name
      }
    }
  }

  // Apply search filter client-side (after join)
  if (filters?.search) {
    const q = filters.search.toLowerCase()
    return entries.filter(
      (e) =>
        (e.employee_name || '').toLowerCase().includes(q) ||
        (e.badge_number || '').toLowerCase().includes(q)
    )
  }

  return entries
}

// ── Dashboard Metrics ─────────────────────────────────────────────────────

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  // Total entries
  const { data: allEntries } = await timeClockTable().select(
    'id, clock_in, clock_out, status'
  )

  const entries = (allEntries || []) as any[]
  const activeClockIns = entries.filter(
    (e) => e.status === 'active' && !e.clock_out
  ).length

  // Calculate total hours from completed entries
  let totalHours = 0
  for (const entry of entries) {
    if (entry.clock_in && entry.clock_out) {
      const diff =
        new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()
      totalHours += diff / (1000 * 60 * 60)
    }
  }

  // Pending time card approvals
  const { data: pendingCards } = await timeCardsTable()
    .select('id')
    .in('status', ['pending', 'submitted'])

  return {
    totalHours: Math.round(totalHours * 100) / 100,
    pendingApprovals: (pendingCards || []).length,
    activeClockIns,
    totalEntries: entries.length,
  }
}

// ── Time Cards ────────────────────────────────────────────────────────────

export async function fetchTimeCards(filters?: {
  status?: string
  search?: string
}): Promise<TimeCardRow[]> {
  let query = timeCardsTable()
    .select('*')
    .order('pay_period_start', { ascending: false })
    .limit(50)

  if (filters?.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error || !data) return []

  const cards = data as TimeCardRow[]
  // Enrich with user names and badge numbers
  const userIds = [...new Set(cards.map((c) => c.user_id))]

  if (userIds.length > 0) {
    const { data: assignments } = await supabase
      .from('shift_assignments')
      .select('user_id, badge_number')
      .in('user_id', userIds)

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, first_name, last_name, full_name')
      .in('id', userIds)

    const assignMap = new Map(
      (assignments || []).map((a: any) => [a.user_id, a])
    )
    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))

    for (const card of cards) {
      const profile = profileMap.get(card.user_id) as any
      const assign = assignMap.get(card.user_id) as any
      if (profile) {
        card.employee_name =
          profile.full_name ||
          `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
      }
      if (assign) {
        card.badge_number = assign.badge_number
      }
    }
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase()
    return cards.filter(
      (c) =>
        (c.employee_name || '').toLowerCase().includes(q) ||
        (c.badge_number || '').toLowerCase().includes(q)
    )
  }

  return cards
}

// ── Mutations ─────────────────────────────────────────────────────────────

export async function approveTimeCard(
  cardId: string,
  userId: string
): Promise<boolean> {
  const { error } = await timeCardsTable()
    .update({
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', cardId)
  return !error
}

export async function rejectTimeCard(
  cardId: string,
  userId: string,
  notes?: string
): Promise<boolean> {
  const { error } = await timeCardsTable()
    .update({
      status: 'rejected',
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      supervisor_notes: notes || null,
    })
    .eq('id', cardId)
  return !error
}

export async function addTimeCardNote(
  cardId: string,
  authorId: string,
  content: string,
  noteType: string = 'general',
  relatedEntryId?: string
): Promise<boolean> {
  const { error } = await timeCardNotesTable().insert({
    time_card_id: cardId,
    author_id: authorId,
    note_type: noteType,
    content,
    related_clock_entry_id: relatedEntryId || null,
  })
  return !error
}

export async function addManualClockEntry(params: {
  organizationId: string
  userId: string
  shiftAssignmentId?: string
  badgeNumber?: string
  clockIn: string
  clockOut: string
  reason: string
  enteredBy: string
}): Promise<boolean> {
  const { error } = await timeClockTable().insert({
    organization_id: params.organizationId,
    user_id: params.userId,
    shift_assignment_id: params.shiftAssignmentId || null,
    badge_number: params.badgeNumber || null,
    clock_in: params.clockIn,
    clock_out: params.clockOut,
    clock_in_method: 'supervisor_entry',
    status: 'completed',
    is_manual_entry: true,
    manual_entry_reason: params.reason,
    manual_entered_by: params.enteredBy,
    device_info: 'Manual Entry - Time Tracker',
  })
  return !error
}

// Created and developed by Jai Singh
