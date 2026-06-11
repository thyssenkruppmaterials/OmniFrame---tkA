// Created and developed by Jai Singh
/**
 * Standard Work Service
 * Comprehensive service for managing standard work checklists, templates, and submissions
 * Created: January 4, 2026
 */
import { getLocalDateString } from '@/lib/utils'
import { supabase } from './client'

// ===== TYPESCRIPT INTERFACES =====

// Schedule configuration for templates
export interface ScheduleConfig {
  days_of_week?: number[] // 0-6, Sunday = 0
  days_of_month?: number[] // 1-31
  end_of_month?: boolean
}

export interface NotificationSettings {
  remind_before_minutes?: number
  notify_on_overdue?: boolean
}

export interface StandardWorkTemplate {
  id: string
  organization_id: string
  template_name: string
  template_code?: string
  description?: string
  working_area_id?: string
  frequency:
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'shift_start'
    | 'shift_end'
    | 'as_needed'
  estimated_duration_minutes: number
  status: 'draft' | 'active' | 'archived' | 'deprecated'
  version: number
  is_active: boolean
  display_order: number
  icon: string
  color: string
  instructions?: string
  completion_notes?: string
  // New scheduling fields
  schedule_config?: ScheduleConfig
  due_time?: string // TIME format "HH:MM:SS"
  grace_period_minutes?: number
  notification_settings?: NotificationSettings
  created_by?: string
  updated_by?: string
  created_at: string
  updated_at: string
  // Joined fields
  working_area?: {
    id: string
    area_name: string
    area_code: string
  }
  items_count?: number
}

export interface StandardWorkItem {
  id: string
  organization_id: string
  template_id: string
  item_title: string
  item_description?: string
  item_type:
    | 'checkbox'
    | 'text'
    | 'number'
    | 'select'
    | 'multi_select'
    | 'date'
    | 'time'
    | 'photo'
    | 'signature'
  section_name?: string
  display_order: number
  is_required: boolean
  validation_rules: Record<string, unknown>
  options: Array<{ value: string; label: string }>
  conditional_display?: {
    depends_on: string
    condition: string
    value: string
  }
  help_text?: string
  placeholder?: string
  default_value?: string
  is_active: boolean
  created_by?: string
  updated_by?: string
  created_at: string
  updated_at: string
}

export interface StandardWorkSubmission {
  id: string
  organization_id: string
  submission_number: string
  template_id: string
  working_area_id?: string
  submitted_by: string
  submitter_name?: string
  submitter_position?: string
  status:
    | 'draft'
    | 'in_progress'
    | 'submitted'
    | 'reviewed'
    | 'approved'
    | 'rejected'
  started_at: string
  submitted_at?: string
  reviewed_at?: string
  reviewed_by?: string
  reviewer_notes?: string
  total_items: number
  completed_items: number
  required_items: number
  required_completed: number
  completion_percentage: number
  shift_date: string
  shift_type?: string
  submission_notes?: string
  attachments: Array<{ filename: string; url: string; type: string }>
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  // Joined fields
  template?: StandardWorkTemplate
  working_area?: {
    id: string
    area_name: string
    area_code: string
  }
  submitter?: {
    id: string
    full_name: string
    email: string
  }
}

export interface StandardWorkResponse {
  id: string
  organization_id: string
  submission_id: string
  item_id: string
  response_value?: string
  response_type?: string
  is_checked: boolean
  numeric_value?: number
  date_value?: string
  time_value?: string
  file_url?: string
  file_metadata: Record<string, unknown>
  responded_at: string
  response_duration_seconds?: number
  item_notes?: string
  is_valid: boolean
  validation_errors: string[]
  created_at: string
  updated_at: string
  // Joined fields
  item?: StandardWorkItem
}

export interface StandardWorkStatistics {
  total_templates: number
  active_templates: number
  total_submissions: number
  submitted_count: number
  draft_count: number
  avg_completion_rate: number
  submissions_by_area: Array<{
    area_id: string
    area_name: string
    submission_count: number
  }>
  submissions_by_date: Array<{
    date: string
    count: number
  }>
  user_completion: Array<{
    user_id: string
    full_name: string
    email: string
    avatar_url?: string
    total_assigned: number
    completed: number
    in_progress: number
    total_submissions: number
    avg_completion_rate: number
    on_time_count: number
    last_submission_date?: string
    position_title?: string
    working_area_name?: string
  }>
}

export interface UserDailyCompletion {
  user_id: string
  full_name: string
  email: string
  avatar_url?: string
  position_title?: string
  daily_data: Array<{
    date: string
    completed: number
    in_progress: number
  }>
}

// ===== SCHEDULING INTERFACES =====

export interface ScheduledTask {
  template_id: string
  template_name: string
  template_code?: string
  description?: string
  frequency: string
  due_time?: string
  due_at?: string
  grace_period_minutes?: number
  estimated_duration_minutes: number
  working_area_id?: string
  working_area_name?: string
  color: string
  items_count: number
  submission_id?: string
  submission_status?: string
  completion_percentage: number
  is_overdue: boolean
  is_completed: boolean
}

export interface UserProgressStats {
  total_assigned: number
  completed_today: number
  due_today: number
  overdue_count: number
  this_week_completed: number
  this_week_total: number
  this_month_completed: number
  this_month_total: number
  on_time_rate: number
  current_streak: number
  longest_streak: number
}

export interface UserStreak {
  id: string
  organization_id: string
  user_id: string
  template_id?: string
  current_streak: number
  longest_streak: number
  last_completion_date?: string
  streak_started_date?: string
  total_completions: number
  total_on_time: number
  total_late: number
  created_at: string
  updated_at: string
}

export interface StandardWorkTemplateAssignment {
  id: string
  organization_id: string
  template_id: string
  user_id?: string
  position_id?: string
  working_area_id?: string
  assignment_type: 'required' | 'optional' | 'recommended'
  priority: number
  is_active: boolean
  effective_from?: string
  effective_to?: string
  assigned_by?: string
  notes?: string
  created_at: string
  updated_at: string
  // Joined fields
  user?: {
    id: string
    full_name: string
    email: string
  }
  position?: {
    id: string
    position_title: string
    position_code: string
  }
  area?: {
    id: string
    area_name: string
    area_code: string
  }
  template?: {
    id: string
    template_name: string
  }
}

// ===== SERVICE CLASS =====

class StandardWorkService {
  private static instance: StandardWorkService

  private constructor() {}

  static getInstance(): StandardWorkService {
    if (!StandardWorkService.instance) {
      StandardWorkService.instance = new StandardWorkService()
    }
    return StandardWorkService.instance
  }

  // ===== TEMPLATES =====

  async getTemplates(
    organizationId: string,
    options?: {
      status?: string
      workingAreaId?: string
      includeInactive?: boolean
    }
  ): Promise<StandardWorkTemplate[]> {
    let query = (supabase as any)
      .from('standard_work_templates')
      .select(
        `
        *,
        working_area:working_areas(id, area_name, area_code),
        items_count:standard_work_items(count)
      `
      )
      .eq('organization_id', organizationId)
      .order('display_order', { ascending: true })

    if (!options?.includeInactive) {
      query = query.eq('is_active', true)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    }

    if (options?.workingAreaId) {
      query = query.eq('working_area_id', options.workingAreaId)
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []).map((t: any) => ({
      ...t,
      items_count: t.items_count?.[0]?.count || 0,
    })) as StandardWorkTemplate[]
  }

  async getTemplate(templateId: string): Promise<StandardWorkTemplate | null> {
    const { data, error } = await (supabase as any)
      .from('standard_work_templates')
      .select(
        `
        *,
        working_area:working_areas(id, area_name, area_code)
      `
      )
      .eq('id', templateId)
      .single()

    if (error) throw error
    return data as StandardWorkTemplate | null
  }

  async createTemplate(
    template: Partial<StandardWorkTemplate>
  ): Promise<StandardWorkTemplate> {
    // Sanitize empty strings to null for UUID columns
    const sanitized = {
      ...template,
      working_area_id: template.working_area_id || null,
      created_by: template.created_by || null,
      updated_by: template.updated_by || null,
    }
    const { data, error } = await (supabase as any)
      .from('standard_work_templates')
      .insert(sanitized)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkTemplate
  }

  async updateTemplate(
    templateId: string,
    updates: Partial<StandardWorkTemplate>
  ): Promise<StandardWorkTemplate> {
    // Sanitize empty strings to null for UUID columns
    const sanitized = {
      ...updates,
      updated_at: new Date().toISOString(),
      ...(updates.working_area_id !== undefined && {
        working_area_id: updates.working_area_id || null,
      }),
      ...(updates.created_by !== undefined && {
        created_by: updates.created_by || null,
      }),
      ...(updates.updated_by !== undefined && {
        updated_by: updates.updated_by || null,
      }),
    }
    const { data, error } = await (supabase as any)
      .from('standard_work_templates')
      .update(sanitized)
      .eq('id', templateId)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkTemplate
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('standard_work_templates')
      .update({ is_active: false, status: 'archived' })
      .eq('id', templateId)

    if (error) throw error
  }

  async duplicateTemplate(
    templateId: string,
    newName: string
  ): Promise<StandardWorkTemplate> {
    const original = await this.getTemplate(templateId)
    if (!original) throw new Error('Template not found')

    const items = await this.getTemplateItems(templateId)

    // Guard against the literal "undefined-copy" code if the original template
    // has no template_code; only suffix when a code actually exists.
    const duplicatedCode = original.template_code
      ? `${original.template_code}-copy`
      : undefined

    const newTemplate = await this.createTemplate({
      ...original,
      id: undefined,
      template_name: newName,
      template_code: duplicatedCode,
      status: 'draft',
      version: 1,
      created_at: undefined,
      updated_at: undefined,
    })

    for (const item of items) {
      await this.createItem({
        ...item,
        id: undefined,
        template_id: newTemplate.id,
        created_at: undefined,
        updated_at: undefined,
      })
    }

    return newTemplate
  }

  // ===== ITEMS =====

  async getTemplateItems(
    templateId: string,
    includeInactive = false
  ): Promise<StandardWorkItem[]> {
    let query = (supabase as any)
      .from('standard_work_items')
      .select('*')
      .eq('template_id', templateId)
      .order('section_name', { ascending: true, nullsFirst: true })
      .order('display_order', { ascending: true })

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) throw error
    return (data || []) as StandardWorkItem[]
  }

  async getItem(itemId: string): Promise<StandardWorkItem | null> {
    const { data, error } = await (supabase as any)
      .from('standard_work_items')
      .select('*')
      .eq('id', itemId)
      .single()

    if (error) throw error
    return data as StandardWorkItem | null
  }

  async createItem(item: Partial<StandardWorkItem>): Promise<StandardWorkItem> {
    const { data, error } = await (supabase as any)
      .from('standard_work_items')
      .insert(item)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkItem
  }

  async updateItem(
    itemId: string,
    updates: Partial<StandardWorkItem>
  ): Promise<StandardWorkItem> {
    const { data, error } = await (supabase as any)
      .from('standard_work_items')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkItem
  }

  async deleteItem(itemId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('standard_work_items')
      .update({ is_active: false })
      .eq('id', itemId)

    if (error) throw error
  }

  /**
   * Restore a previously soft-deleted item. Used by the builder's "Undo
   * delete" toast — the item keeps the same id, display_order, and
   * section_name so the row pops back exactly where it was.
   */
  async restoreItem(itemId: string): Promise<StandardWorkItem> {
    const { data, error } = await (supabase as any)
      .from('standard_work_items')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkItem
  }

  /**
   * Clone an item within the same template. The duplicate is inserted
   * directly after the source row (display_order = source + 1) and all
   * later items in the same section are shifted down to make space. This
   * matches what users expect from "Duplicate" in form builders like
   * Typeform / Google Forms.
   */
  async duplicateItem(itemId: string): Promise<StandardWorkItem> {
    const source = await this.getItem(itemId)
    if (!source) throw new Error('Item not found')

    const siblings = await this.getTemplateItems(source.template_id)
    const sameSection = siblings.filter(
      (i) => (i.section_name ?? null) === (source.section_name ?? null)
    )
    const sourceIndex = sameSection.findIndex((i) => i.id === source.id)
    const insertOrder =
      sourceIndex >= 0 ? sameSection[sourceIndex].display_order + 1 : 0

    // Shift everything below the source down by one so display_order stays
    // dense. Errors are swallowed individually but the first one is rethrown
    // so callers can surface a toast.
    const toShift = sameSection.filter(
      (i) => i.display_order >= insertOrder && i.id !== source.id
    )
    if (toShift.length > 0) {
      const shiftResults = await Promise.all(
        toShift.map((i) =>
          (supabase as any)
            .from('standard_work_items')
            .update({ display_order: i.display_order + 1 })
            .eq('id', i.id)
        )
      )
      const firstShiftError = shiftResults.find((r) => r.error)?.error
      if (firstShiftError) throw firstShiftError
    }

    const {
      id: _omitId,
      created_at: _omitCreated,
      updated_at: _omitUpdated,
      ...rest
    } = source
    const baseTitle = source.item_title?.trim() || 'Untitled item'
    const dupTitle = baseTitle.endsWith('(Copy)')
      ? baseTitle
      : `${baseTitle} (Copy)`
    return this.createItem({
      ...rest,
      item_title: dupTitle,
      display_order: insertOrder,
      is_active: true,
    })
  }

  async reorderItems(
    templateId: string,
    itemOrders: Array<{
      id: string
      display_order: number
      section_name?: string
    }>
  ): Promise<void> {
    if (itemOrders.length === 0) return

    // Run all updates in parallel to avoid the previous N sequential round
    // trips. Supabase enforces RLS per row so this is still safe; we collect
    // any errors and surface the first one to keep the call site simple.
    const results = await Promise.all(
      itemOrders.map((item) =>
        (supabase as any)
          .from('standard_work_items')
          .update({
            display_order: item.display_order,
            section_name: item.section_name,
          })
          .eq('id', item.id)
          .eq('template_id', templateId)
      )
    )

    const firstError = results.find((r) => r.error)?.error
    if (firstError) throw firstError
  }

  async bulkCreateItems(
    items: Partial<StandardWorkItem>[]
  ): Promise<StandardWorkItem[]> {
    const { data, error } = await (supabase as any)
      .from('standard_work_items')
      .insert(items)
      .select()

    if (error) throw error
    return (data || []) as StandardWorkItem[]
  }

  // ===== SUBMISSIONS =====

  async getSubmissions(
    organizationId: string,
    options?: {
      templateId?: string
      workingAreaId?: string
      submittedBy?: string
      status?: string
      startDate?: string
      endDate?: string
      limit?: number
      offset?: number
    }
  ): Promise<{ submissions: StandardWorkSubmission[]; total: number }> {
    let query = (supabase as any)
      .from('standard_work_submissions')
      .select(
        `
        *,
        template:standard_work_templates(id, template_name, template_code, frequency, icon, color),
        working_area:working_areas(id, area_name, area_code),
        submitter:user_profiles!submitted_by(id, full_name, email)
      `,
        { count: 'exact' }
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (options?.templateId) {
      query = query.eq('template_id', options.templateId)
    }

    if (options?.workingAreaId) {
      query = query.eq('working_area_id', options.workingAreaId)
    }

    if (options?.submittedBy) {
      query = query.eq('submitted_by', options.submittedBy)
    }

    if (options?.status) {
      query = query.eq('status', options.status)
    }

    if (options?.startDate) {
      query = query.gte('shift_date', options.startDate)
    }

    if (options?.endDate) {
      query = query.lte('shift_date', options.endDate)
    }

    if (options?.limit) {
      query = query.limit(options.limit)
    }

    if (options?.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 10) - 1
      )
    }

    const { data, error, count } = await query

    if (error) throw error
    return {
      submissions: (data || []) as StandardWorkSubmission[],
      total: count || 0,
    }
  }

  async getSubmission(
    submissionId: string
  ): Promise<StandardWorkSubmission | null> {
    const { data, error } = await (supabase as any)
      .from('standard_work_submissions')
      .select(
        `
        *,
        template:standard_work_templates(id, template_name, template_code, frequency, icon, color, instructions),
        working_area:working_areas(id, area_name, area_code),
        submitter:user_profiles!submitted_by(id, full_name, email)
      `
      )
      .eq('id', submissionId)
      .single()

    if (error) throw error
    return data as StandardWorkSubmission | null
  }

  async createSubmission(
    submission: Partial<StandardWorkSubmission>
  ): Promise<StandardWorkSubmission> {
    const { data, error } = await (supabase as any)
      .from('standard_work_submissions')
      .insert(submission)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkSubmission
  }

  async updateSubmission(
    submissionId: string,
    updates: Partial<StandardWorkSubmission>
  ): Promise<StandardWorkSubmission> {
    const { data, error } = await (supabase as any)
      .from('standard_work_submissions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkSubmission
  }

  async submitChecklist(submissionId: string): Promise<StandardWorkSubmission> {
    const { data, error } = await (supabase as any)
      .from('standard_work_submissions')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkSubmission
  }

  async deleteSubmission(submissionId: string): Promise<void> {
    const { error: responsesError } = await (supabase as any)
      .from('standard_work_responses')
      .delete()
      .eq('submission_id', submissionId)

    if (responsesError) throw responsesError

    const { error } = await (supabase as any)
      .from('standard_work_submissions')
      .delete()
      .eq('id', submissionId)

    if (error) throw error
  }

  // ===== RESPONSES =====

  async getSubmissionResponses(
    submissionId: string
  ): Promise<StandardWorkResponse[]> {
    const { data, error } = await (supabase as any)
      .from('standard_work_responses')
      .select(
        `
        *,
        item:standard_work_items(*)
      `
      )
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: true })

    if (error) throw error
    return (data || []) as StandardWorkResponse[]
  }

  async upsertResponse(
    response: Partial<StandardWorkResponse>
  ): Promise<StandardWorkResponse> {
    const { data, error } = await (supabase as any)
      .from('standard_work_responses')
      .upsert(
        { ...response, responded_at: new Date().toISOString() },
        { onConflict: 'submission_id,item_id' }
      )
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkResponse
  }

  async bulkUpsertResponses(
    responses: Partial<StandardWorkResponse>[]
  ): Promise<StandardWorkResponse[]> {
    const responsesWithTimestamp = responses.map((r) => ({
      ...r,
      responded_at: new Date().toISOString(),
    }))

    const { data, error } = await (supabase as any)
      .from('standard_work_responses')
      .upsert(responsesWithTimestamp, { onConflict: 'submission_id,item_id' })
      .select()

    if (error) throw error
    return (data || []) as StandardWorkResponse[]
  }

  // ===== STATISTICS =====

  async getStatistics(
    organizationId: string,
    startDate?: string,
    endDate?: string
  ): Promise<StandardWorkStatistics> {
    const { data, error } = await (supabase as any).rpc(
      'get_standard_work_statistics',
      {
        p_organization_id: organizationId,
        p_start_date:
          startDate ||
          getLocalDateString(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        p_end_date: endDate || getLocalDateString(),
      }
    )

    if (error) throw error
    return data as StandardWorkStatistics
  }

  async getUserDailyCompletion(
    organizationId: string,
    days: number = 30
  ): Promise<UserDailyCompletion[]> {
    const { data, error } = await (supabase as any).rpc(
      'get_user_daily_completion',
      {
        p_organization_id: organizationId,
        p_days: days,
      }
    )

    if (error) throw error
    return (data || []) as UserDailyCompletion[]
  }

  async getSubmissionWithResponses(submissionId: string): Promise<{
    submission: StandardWorkSubmission
    template: StandardWorkTemplate
    area: any
    submitter: any
    responses: Array<{ response: StandardWorkResponse; item: StandardWorkItem }>
  }> {
    const { data, error } = await (supabase as any).rpc(
      'get_submission_with_responses',
      { p_submission_id: submissionId }
    )

    if (error) throw error
    return data
  }

  /**
   * Single-round-trip bundle for the runner. Wraps `getSubmissionWithResponses`
   * and shapes it into the `{ submission, items[], responses[] }` form the
   * runner UI consumes, replacing three parallel queries with one RPC.
   */
  async getSubmissionBundle(submissionId: string): Promise<{
    submission: StandardWorkSubmission
    items: StandardWorkItem[]
    responses: StandardWorkResponse[]
  }> {
    const bundle = await this.getSubmissionWithResponses(submissionId)
    const items: StandardWorkItem[] = []
    const responses: StandardWorkResponse[] = []
    for (const entry of bundle.responses ?? []) {
      // Skip items that have been soft-deleted from the template since the
      // submission was started so the runner doesn't render orphans.
      if (entry?.item && entry.item.is_active !== false) {
        items.push(entry.item as StandardWorkItem)
      }
      if (entry?.response) {
        responses.push(entry.response as StandardWorkResponse)
      }
    }
    items.sort((a, b) => a.display_order - b.display_order)
    // Hydrate the submission with the joined template + area so the runner
    // header card has the same shape as the previous `getSubmission` query.
    const submission = {
      ...bundle.submission,
      template: bundle.template,
      working_area: bundle.area,
    } as StandardWorkSubmission
    return { submission, items, responses }
  }

  // ===== TEMPLATE ASSIGNMENTS =====

  async getTemplateAssignments(
    templateId: string
  ): Promise<StandardWorkTemplateAssignment[]> {
    const { data, error } = await (supabase as any)
      .from('standard_work_template_assignments')
      .select(
        `
        *,
        user:user_profiles!standard_work_template_assignments_user_id_fkey(id, full_name, email),
        position:shift_positions!standard_work_template_assignments_position_id_fkey(id, position_title, position_code),
        area:working_areas!standard_work_template_assignments_working_area_id_fkey(id, area_name, area_code)
      `
      )
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []) as StandardWorkTemplateAssignment[]
  }

  async createAssignment(
    assignment: Partial<StandardWorkTemplateAssignment>
  ): Promise<StandardWorkTemplateAssignment> {
    const sanitized = {
      ...assignment,
      user_id: assignment.user_id || null,
      position_id: assignment.position_id || null,
      working_area_id: assignment.working_area_id || null,
      assigned_by: assignment.assigned_by || null,
    }
    const { data, error } = await (supabase as any)
      .from('standard_work_template_assignments')
      .insert(sanitized)
      .select(
        `
        *,
        user:user_profiles!standard_work_template_assignments_user_id_fkey(id, full_name, email),
        position:shift_positions!standard_work_template_assignments_position_id_fkey(id, position_title, position_code),
        area:working_areas!standard_work_template_assignments_working_area_id_fkey(id, area_name, area_code)
      `
      )
      .single()

    if (error) throw error
    return data as StandardWorkTemplateAssignment
  }

  async deleteAssignment(assignmentId: string): Promise<void> {
    const { error } = await (supabase as any)
      .from('standard_work_template_assignments')
      .delete()
      .eq('id', assignmentId)

    if (error) throw error
  }

  async updateAssignment(
    assignmentId: string,
    updates: Partial<StandardWorkTemplateAssignment>
  ): Promise<StandardWorkTemplateAssignment> {
    const { data, error } = await (supabase as any)
      .from('standard_work_template_assignments')
      .update(updates)
      .eq('id', assignmentId)
      .select()
      .single()

    if (error) throw error
    return data as StandardWorkTemplateAssignment
  }

  async getAssignmentCount(templateId: string): Promise<{
    users: number
    positions: number
    areas: number
    total: number
  }> {
    const { data, error } = await (supabase as any)
      .from('standard_work_template_assignments')
      .select('id, user_id, position_id, working_area_id')
      .eq('template_id', templateId)
      .eq('is_active', true)

    if (error) throw error
    const assignments = data || []
    return {
      users: assignments.filter((a: any) => a.user_id).length,
      positions: assignments.filter((a: any) => a.position_id && !a.user_id)
        .length,
      areas: assignments.filter(
        (a: any) => a.working_area_id && !a.user_id && !a.position_id
      ).length,
      total: assignments.length,
    }
  }

  // ===== HELPER METHODS =====

  async getTemplatesForArea(
    organizationId: string,
    workingAreaId: string
  ): Promise<StandardWorkTemplate[]> {
    return this.getTemplates(organizationId, {
      workingAreaId,
      status: 'active',
    })
  }

  async getTodaySubmissions(
    organizationId: string,
    userId?: string
  ): Promise<StandardWorkSubmission[]> {
    const today = getLocalDateString()
    const { submissions } = await this.getSubmissions(organizationId, {
      startDate: today,
      endDate: today,
      submittedBy: userId,
    })
    return submissions
  }

  /**
   * Returns an existing submission for the same template + shift_date that is
   * already final (submitted/approved). Used to block double-submission of the
   * same checklist for the same day.
   */
  async checkDuplicateSubmission(
    organizationId: string,
    templateId: string,
    shiftDate: string,
    workingAreaId?: string
  ): Promise<StandardWorkSubmission | null> {
    let query = (supabase as any)
      .from('standard_work_submissions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('template_id', templateId)
      .eq('shift_date', shiftDate)
      .in('status', ['submitted', 'approved'])

    if (workingAreaId) {
      query = query.eq('working_area_id', workingAreaId)
    }

    const { data, error } = await query.limit(1).maybeSingle()

    if (error) throw error
    return data as StandardWorkSubmission | null
  }

  /**
   * Returns the user's open draft / in-progress submission for a given
   * template + day, if any. Lets the runner transparently resume rather than
   * creating parallel drafts.
   */
  async findOpenDraft(
    organizationId: string,
    templateId: string,
    submittedBy: string,
    shiftDate: string,
    workingAreaId?: string
  ): Promise<StandardWorkSubmission | null> {
    let query = (supabase as any)
      .from('standard_work_submissions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('template_id', templateId)
      .eq('submitted_by', submittedBy)
      .eq('shift_date', shiftDate)
      .in('status', ['draft', 'in_progress'])
      .order('created_at', { ascending: false })

    if (workingAreaId) {
      query = query.eq('working_area_id', workingAreaId)
    }

    const { data, error } = await query.limit(1).maybeSingle()

    if (error) throw error
    return data as StandardWorkSubmission | null
  }

  /**
   * Compute a UTC ISO `due_at` for a submission given the template's local
   * due_time ("HH:MM[:SS]") and the local shift_date ("YYYY-MM-DD"). Browser
   * timezone is used. Returns `undefined` when no due_time is set so the
   * server-side trigger can fall through to its default behavior.
   */
  private buildDueAt(
    shiftDate: string,
    dueTime?: string | null
  ): string | undefined {
    if (!dueTime) return undefined
    const [h = '00', m = '00', s = '00'] = dueTime.split(':')
    const local = new Date(shiftDate + 'T00:00:00')
    local.setHours(
      parseInt(h, 10) || 0,
      parseInt(m, 10) || 0,
      parseInt(s, 10) || 0,
      0
    )
    if (Number.isNaN(local.getTime())) return undefined
    return local.toISOString()
  }

  async startNewSubmission(
    organizationId: string,
    templateId: string,
    submittedBy: string,
    workingAreaId?: string,
    submitterInfo?: { name: string; position: string }
  ): Promise<StandardWorkSubmission> {
    const today = getLocalDateString()

    // If a final (submitted/approved) duplicate exists for today, refuse:
    // double-submission would inflate completion stats.
    const duplicate = await this.checkDuplicateSubmission(
      organizationId,
      templateId,
      today,
      workingAreaId
    )
    if (duplicate) {
      const error = new Error(
        'A submission for this checklist has already been submitted today.'
      ) as Error & { code?: string; existing?: StandardWorkSubmission }
      error.code = 'DUPLICATE_SUBMISSION'
      error.existing = duplicate
      throw error
    }

    // If an open draft exists for the user/template/day, resume it transparently
    // instead of creating a parallel draft (the dashboard already shows
    // Continue, but stale today-submissions cache could trigger a Start click).
    const existingDraft = await this.findOpenDraft(
      organizationId,
      templateId,
      submittedBy,
      today,
      workingAreaId
    )
    if (existingDraft) return existingDraft

    const template = await this.getTemplate(templateId)
    const dueAt = template
      ? this.buildDueAt(today, template.due_time)
      : undefined

    const submission = await this.createSubmission({
      organization_id: organizationId,
      template_id: templateId,
      working_area_id: workingAreaId || undefined,
      submitted_by: submittedBy,
      submitter_name: submitterInfo?.name,
      submitter_position: submitterInfo?.position,
      status: 'draft',
      shift_date: today,
      // Cast through any so we can populate columns added by migration 098 that
      // are not yet reflected in the generated row type. The DB will set the
      // column natively.
      ...((dueAt ? { due_at: dueAt } : {}) as Partial<StandardWorkSubmission>),
    } as Partial<StandardWorkSubmission>)

    const items = await this.getTemplateItems(templateId)
    const initialResponses: Partial<StandardWorkResponse>[] = items.map(
      (item) => ({
        organization_id: organizationId,
        submission_id: submission.id,
        item_id: item.id,
        response_type: item.item_type,
        is_checked: false,
        response_value: item.default_value || undefined,
      })
    )

    await this.bulkUpsertResponses(initialResponses)

    return submission
  }

  // ===== SCHEDULING METHODS =====

  /**
   * Get tasks scheduled for a specific date
   */
  async getScheduledTasks(
    organizationId: string,
    userId: string,
    date: string = getLocalDateString(),
    workingAreaId?: string
  ): Promise<ScheduledTask[]> {
    const { data, error } = await (supabase as any).rpc(
      'get_scheduled_tasks_for_date',
      {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_date: date,
        p_working_area_id: workingAreaId || null,
      }
    )

    if (error) throw error
    return (data || []) as ScheduledTask[]
  }

  /**
   * Get upcoming tasks for the next N days
   * Uses Promise.all to parallelize all date queries instead of sequential N+1
   */
  async getUpcomingTasks(
    organizationId: string,
    userId: string,
    days: number = 7,
    workingAreaId?: string
  ): Promise<{ date: string; tasks: ScheduledTask[] }[]> {
    const today = new Date()
    const dateStrings: string[] = []

    for (let i = 1; i <= days; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() + i)
      dateStrings.push(getLocalDateString(date))
    }

    // Fetch all days in parallel instead of sequentially
    const allResults = await Promise.all(
      dateStrings.map(async (dateStr) => {
        const tasks = await this.getScheduledTasks(
          organizationId,
          userId,
          dateStr,
          workingAreaId
        )
        return { date: dateStr, tasks }
      })
    )

    // Filter out days with no tasks and return in date order
    return allResults.filter(({ tasks }) => tasks.length > 0)
  }

  /**
   * Get user progress statistics
   */
  async getUserStats(
    organizationId: string,
    userId: string,
    days: number = 30
  ): Promise<UserProgressStats> {
    const { data, error } = await (supabase as any).rpc(
      'get_user_standard_work_stats',
      {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_days: days,
      }
    )

    if (error) throw error
    return data as UserProgressStats
  }

  /**
   * Get user streak for a specific template or overall
   */
  async getUserStreak(
    organizationId: string,
    userId: string,
    templateId?: string
  ): Promise<UserStreak | null> {
    let query = (supabase as any)
      .from('standard_work_user_streaks')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)

    if (templateId) {
      query = query.eq('template_id', templateId)
    } else {
      query = query.is('template_id', null)
    }

    const { data, error } = await query.maybeSingle()

    if (error) throw error
    return data as UserStreak | null
  }

  /**
   * Get all overdue submissions for a user
   */
  async getOverdueTasks(
    organizationId: string,
    userId: string
  ): Promise<StandardWorkSubmission[]> {
    const { data, error } = await (supabase as any)
      .from('standard_work_submissions')
      .select(
        `
        *,
        template:standard_work_templates(id, template_name, template_code, frequency, icon, color),
        working_area:working_areas(id, area_name, area_code)
      `
      )
      .eq('organization_id', organizationId)
      .eq('submitted_by', userId)
      .eq('is_overdue', true)
      .not('status', 'in', '("submitted","approved")')
      .order('due_at', { ascending: true })

    if (error) throw error
    return (data || []) as StandardWorkSubmission[]
  }

  /**
   * Get tasks grouped by status for dashboard
   */
  async getDashboardTasks(
    organizationId: string,
    userId: string,
    workingAreaId?: string
  ): Promise<{
    overdue: ScheduledTask[]
    dueSoon: ScheduledTask[]
    upcoming: ScheduledTask[]
    completed: ScheduledTask[]
  }> {
    const tasks = await this.getScheduledTasks(
      organizationId,
      userId,
      undefined,
      workingAreaId
    )
    const now = new Date()
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000)

    return {
      overdue: tasks.filter((t) => t.is_overdue && !t.is_completed),
      dueSoon: tasks.filter((t) => {
        if (t.is_completed || t.is_overdue) return false
        if (!t.due_at) return false
        const dueAt = new Date(t.due_at)
        return dueAt <= oneHourFromNow && dueAt > now
      }),
      upcoming: tasks.filter((t) => {
        if (t.is_completed || t.is_overdue) return false
        if (!t.due_at) return true
        const dueAt = new Date(t.due_at)
        return dueAt > oneHourFromNow
      }),
      completed: tasks.filter((t) => t.is_completed),
    }
  }

  /**
   * Create a scheduled submission with due date
   */
  async createScheduledSubmission(
    organizationId: string,
    templateId: string,
    submittedBy: string,
    scheduleDate: string,
    _dueAt?: string,
    workingAreaId?: string,
    submitterInfo?: { name: string; position: string }
  ): Promise<StandardWorkSubmission> {
    const submission = await this.createSubmission({
      organization_id: organizationId,
      template_id: templateId,
      working_area_id: workingAreaId,
      submitted_by: submittedBy,
      submitter_name: submitterInfo?.name,
      submitter_position: submitterInfo?.position,
      status: 'draft',
      shift_date: scheduleDate,
    })

    const items = await this.getTemplateItems(templateId)
    const initialResponses: Partial<StandardWorkResponse>[] = items.map(
      (item) => ({
        organization_id: organizationId,
        submission_id: submission.id,
        item_id: item.id,
        response_type: item.item_type,
        is_checked: false,
        response_value: item.default_value || undefined,
      })
    )

    await this.bulkUpsertResponses(initialResponses)

    return submission
  }

  /**
   * Update template schedule configuration
   */
  async updateTemplateSchedule(
    templateId: string,
    scheduleConfig: ScheduleConfig,
    dueTime?: string,
    gracePeriodMinutes?: number,
    notificationSettings?: NotificationSettings
  ): Promise<StandardWorkTemplate> {
    const updates: Partial<StandardWorkTemplate> = {
      schedule_config: scheduleConfig,
    }

    if (dueTime !== undefined) {
      updates.due_time = dueTime
    }

    if (gracePeriodMinutes !== undefined) {
      updates.grace_period_minutes = gracePeriodMinutes
    }

    if (notificationSettings !== undefined) {
      updates.notification_settings = notificationSettings
    }

    return this.updateTemplate(templateId, updates)
  }
}

export default StandardWorkService.getInstance()

// Created and developed by Jai Singh
