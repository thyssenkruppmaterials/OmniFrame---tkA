// Created and developed by Jai Singh
/**
 * Shared types + parsers for the four-kind Post Composer dialog.
 *
 * The composer is parameterised by `kind` and adapts its sections, defaults,
 * and persistence target to that kind. Three of the four kinds
 * (announcement, hr_news, safety_alert) write to `production_board_posts`;
 * the `job` kind writes to `production_board_job_postings` (the schemas are
 * incompatible enough that they earn separate tables — see
 * Decisions/ADR-Board-Posts-Schema-Extension.md).
 *
 * The four-kind enum is the SOURCE OF TRUTH for the composer surface.
 * `PostScope` in `hooks/use-board-posts.ts` is the narrower three-value
 * subset that hits `production_board_posts`. They are intentionally
 * separate so the composer can branch without leaking job-only types into
 * the post hook.
 */

export type PostKind = 'announcement' | 'hr_news' | 'job' | 'safety_alert'

export type PostPriority = 'low' | 'normal' | 'high' | 'pinned'

export const POST_PRIORITIES: readonly PostPriority[] = [
  'low',
  'normal',
  'high',
  'pinned',
] as const

export type SafetySeverity = 'info' | 'success' | 'warning' | 'danger'

export const SAFETY_SEVERITIES: readonly SafetySeverity[] = [
  'info',
  'success',
  'warning',
  'danger',
] as const

export type SafetyHazardType =
  | 'spill'
  | 'electrical'
  | 'fire'
  | 'chemical'
  | 'fall'
  | 'lifting'
  | 'pinch_point'
  | 'lockout_tagout'
  | 'forklift'
  | 'ergonomic'
  | 'other'

export const SAFETY_HAZARD_TYPES: readonly SafetyHazardType[] = [
  'spill',
  'electrical',
  'fire',
  'chemical',
  'fall',
  'lifting',
  'pinch_point',
  'lockout_tagout',
  'forklift',
  'ergonomic',
  'other',
] as const

export type HrNewsCategory = 'benefits' | 'culture' | 'policy' | 'other'

export const HR_NEWS_CATEGORIES: readonly HrNewsCategory[] = [
  'benefits',
  'culture',
  'policy',
  'other',
] as const

export type JobEmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'temporary'
  | 'intern'

export const JOB_EMPLOYMENT_TYPES: readonly JobEmploymentType[] = [
  'full_time',
  'part_time',
  'contract',
  'temporary',
  'intern',
] as const

export type JobPayPeriod = 'hour' | 'week' | 'month' | 'year'

export const JOB_PAY_PERIODS: readonly JobPayPeriod[] = [
  'hour',
  'week',
  'month',
  'year',
] as const

/**
 * Attachment metadata persisted on the post / job row.
 *
 * `storage_path` is the path inside the `production-board-images` bucket
 * (uploads go to `{org_id}/{post_or_draft_id}/{uuid}.{ext}`). The board
 * card / preview hydrates the public URL via
 * `supabase.storage.from('production-board-images').getPublicUrl(path)`.
 *
 * Snake-case to match the JSONB column shape on the DB; the composer keeps
 * the same shape end-to-end to avoid a translation layer.
 */
export interface Attachment {
  id: string
  storage_path: string
  mime_type: string
  file_name: string
  caption?: string
  width?: number
  height?: number
  size_bytes: number
  display_order: number
}

/**
 * Card-variant hint persisted on `kind_data` so the bento board's
 * shell can pick the right default variant when no row exists in
 * `production_board_card_layouts` yet. The bento `<BentoGrid>` then
 * persists the actual placement (x/y/w/h + variant + variant_config)
 * to the dedicated table; the kindData hint is only consulted on
 * first paint.
 *
 * Both keys are intentionally `unknown`-tolerant in the parser
 * (`parseVariantConfig` / `parseCardVariant` narrow them) so a
 * curator-edited row can't break the editor.
 */
interface CardVariantKindHint {
  card_variant?: string
  card_variant_config?: Record<string, unknown>
}

export interface AnnouncementKindData extends CardVariantKindHint {
  marquee?: boolean
  cta_url?: string
  cta_label?: string
}

export interface HrNewsKindData extends CardVariantKindHint {
  author_name?: string
  author_avatar_url?: string
  category?: HrNewsCategory
  display_date?: string // ISO date
}

export interface SafetyAlertKindData extends CardVariantKindHint {
  hazard_type?: SafetyHazardType
  affected_area_ids?: string[]
  corrective_action?: string
}

export interface JobKindData extends CardVariantKindHint {
  employment_type?: JobEmploymentType
  pay_min?: number
  pay_max?: number
  pay_currency?: string
  pay_period?: JobPayPeriod
  hiring_manager_name?: string
  hiring_manager_email?: string
}

export type KindData =
  | AnnouncementKindData
  | HrNewsKindData
  | SafetyAlertKindData
  | JobKindData

/**
 * The composer's canonical in-memory shape. Each kind populates a subset
 * of the fields; the kind-specific bag lives under `kindData`. The hook
 * adapters at the persistence boundary map this to whichever underlying
 * table the kind writes to.
 */
export interface ComposerValues {
  kind: PostKind
  title: string
  body: string
  /** Markdown vs plain text? Today: plain with line breaks preserved. */
  bodyFormat: 'plain' | 'markdown'
  priority: PostPriority
  isPublished: boolean
  accentHex: string | null
  publishAt: string | null
  expiresAt: string | null
  attachments: Attachment[]

  /** Posts only — null for jobs. */
  severity: SafetySeverity
  /** Posts only — null for jobs (jobs use workingArea/branch instead). */
  workingAreaId: string | null
  branchId: string | null

  acknowledgmentRequired: boolean
  repromptIntervalMinutes: number | null

  kindData: KindData

  // ----- Jobs-only fields (mirrors columns on production_board_job_postings) -----
  jobDepartment: string | null
  jobRequirements: string | null
  jobApplyUrl: string | null
  jobApplyEmail: string | null
  jobIsInternal: boolean
}

export interface ComposerStatus {
  state: 'draft' | 'scheduled' | 'live' | 'expired'
  label: string
  badgeClass: string
}

/**
 * Derive the lifecycle status chip shown in the dialog header. Pure
 * function so it's unit-testable and reusable in the preview pane.
 */
export function deriveStatus(
  values: Pick<ComposerValues, 'isPublished' | 'publishAt' | 'expiresAt'>,
  now: Date = new Date()
): ComposerStatus {
  if (!values.isPublished) {
    return {
      state: 'draft',
      label: 'Draft',
      badgeClass: 'border-border/60 bg-muted text-muted-foreground',
    }
  }
  const nowMs = now.getTime()
  const publishMs = values.publishAt
    ? new Date(values.publishAt).getTime()
    : nowMs
  const expiresMs = values.expiresAt
    ? new Date(values.expiresAt).getTime()
    : Number.POSITIVE_INFINITY

  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
    return {
      state: 'expired',
      label: 'Expired',
      badgeClass:
        'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400',
    }
  }
  if (publishMs > nowMs) {
    return {
      state: 'scheduled',
      label: 'Scheduled',
      badgeClass:
        'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
    }
  }
  return {
    state: 'live',
    label: 'Live',
    badgeClass:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  }
}

/**
 * Human-readable duration descriptor: "Live for 3d 4h",
 * "Expired 1h ago", "Scheduled for Tomorrow 8:00 AM".
 *
 * Intentionally non-locale: uses the user's local timezone via toLocale*
 * but the english phrasing is hardcoded. i18n is out of scope for v1.
 */
export function describeActiveWindow(
  values: Pick<ComposerValues, 'isPublished' | 'publishAt' | 'expiresAt'>,
  now: Date = new Date()
): string {
  const status = deriveStatus(values, now)
  const nowMs = now.getTime()
  const publishMs = values.publishAt
    ? new Date(values.publishAt).getTime()
    : nowMs
  const expiresMs = values.expiresAt
    ? new Date(values.expiresAt).getTime()
    : null

  switch (status.state) {
    case 'draft':
      return 'Not yet published'
    case 'scheduled':
      return `Scheduled for ${formatAt(publishMs)}`
    case 'expired':
      return `Expired ${formatDelta(nowMs - (expiresMs ?? nowMs))} ago`
    case 'live': {
      if (expiresMs === null) return 'Live (no expiration)'
      return `Live for ${formatDelta(expiresMs - nowMs)} more`
    }
  }
}

function formatDelta(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const mins = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatAt(ms: number): string {
  const d = new Date(ms)
  const datePart = d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timePart = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${datePart} · ${timePart}`
}

export const KIND_LABEL: Record<PostKind, { singular: string; verb: string }> =
  {
    announcement: { singular: 'announcement', verb: 'Publish' },
    hr_news: { singular: 'HR news post', verb: 'Publish' },
    job: { singular: 'job posting', verb: 'Post job' },
    safety_alert: { singular: 'safety alert', verb: 'Publish alert' },
  }

export const DEFAULT_COMPOSER_VALUES: Omit<ComposerValues, 'kind'> = {
  title: '',
  body: '',
  bodyFormat: 'plain',
  priority: 'normal',
  isPublished: true,
  accentHex: null,
  publishAt: null,
  expiresAt: null,
  attachments: [],
  severity: 'info',
  workingAreaId: null,
  branchId: null,
  acknowledgmentRequired: false,
  repromptIntervalMinutes: null,
  kindData: {},
  jobDepartment: null,
  jobRequirements: null,
  jobApplyUrl: null,
  jobApplyEmail: null,
  jobIsInternal: true,
}

export function defaultsForKind(kind: PostKind): ComposerValues {
  const base: ComposerValues = { ...DEFAULT_COMPOSER_VALUES, kind }
  if (kind === 'safety_alert') {
    return {
      ...base,
      severity: 'warning',
      acknowledgmentRequired: true,
      kindData: {} satisfies SafetyAlertKindData,
    }
  }
  if (kind === 'job') {
    return {
      ...base,
      kindData: { employment_type: 'full_time' } satisfies JobKindData,
    }
  }
  if (kind === 'hr_news') {
    return {
      ...base,
      kindData: { category: 'other' } satisfies HrNewsKindData,
    }
  }
  return {
    ...base,
    kindData: {} satisfies AnnouncementKindData,
  }
}

/**
 * Parse an unknown `attachments` JSON blob into an Attachment[]. Tolerant
 * of partial / malformed rows — drops items that can't be coerced rather
 * than throwing. The display_order is filled in by index if missing.
 */
export function parseAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return []
  const out: Attachment[] = []
  raw.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return
    const r = entry as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : null
    const storage_path =
      typeof r.storage_path === 'string' ? r.storage_path : null
    const mime_type = typeof r.mime_type === 'string' ? r.mime_type : null
    const file_name = typeof r.file_name === 'string' ? r.file_name : null
    if (!id || !storage_path || !mime_type || !file_name) return
    out.push({
      id,
      storage_path,
      mime_type,
      file_name,
      caption: typeof r.caption === 'string' ? r.caption : undefined,
      width: typeof r.width === 'number' ? r.width : undefined,
      height: typeof r.height === 'number' ? r.height : undefined,
      size_bytes: typeof r.size_bytes === 'number' ? r.size_bytes : 0,
      display_order:
        typeof r.display_order === 'number' ? r.display_order : idx,
    })
  })
  return out.sort((a, b) => a.display_order - b.display_order)
}

/**
 * Variant hint helper — narrows raw `card_variant` / `card_variant_config`
 * onto any kind's data bag. Tolerant: drops unknown values.
 */
function applyVariantHint<T extends object>(
  out: T,
  r: Record<string, unknown>
): T {
  const sink = out as unknown as Record<string, unknown>
  if (typeof r.card_variant === 'string') {
    sink.card_variant = r.card_variant
  }
  if (
    r.card_variant_config &&
    typeof r.card_variant_config === 'object' &&
    !Array.isArray(r.card_variant_config)
  ) {
    sink.card_variant_config = r.card_variant_config as Record<string, unknown>
  }
  return out
}

export function parseKindData(kind: PostKind, raw: unknown): KindData {
  if (!raw || typeof raw !== 'object') {
    return defaultKindData(kind)
  }
  const r = raw as Record<string, unknown>
  switch (kind) {
    case 'announcement': {
      const out: AnnouncementKindData = {}
      if (typeof r.marquee === 'boolean') out.marquee = r.marquee
      if (typeof r.cta_url === 'string') out.cta_url = r.cta_url
      if (typeof r.cta_label === 'string') out.cta_label = r.cta_label
      return applyVariantHint(out, r)
    }
    case 'hr_news': {
      const out: HrNewsKindData = {}
      if (typeof r.author_name === 'string') out.author_name = r.author_name
      if (typeof r.author_avatar_url === 'string')
        out.author_avatar_url = r.author_avatar_url
      if (
        typeof r.category === 'string' &&
        (HR_NEWS_CATEGORIES as readonly string[]).includes(r.category)
      ) {
        out.category = r.category as HrNewsCategory
      }
      if (typeof r.display_date === 'string') out.display_date = r.display_date
      return applyVariantHint(out, r)
    }
    case 'safety_alert': {
      const out: SafetyAlertKindData = {}
      if (
        typeof r.hazard_type === 'string' &&
        (SAFETY_HAZARD_TYPES as readonly string[]).includes(r.hazard_type)
      ) {
        out.hazard_type = r.hazard_type as SafetyHazardType
      }
      if (Array.isArray(r.affected_area_ids)) {
        out.affected_area_ids = r.affected_area_ids.filter(
          (x): x is string => typeof x === 'string'
        )
      }
      if (typeof r.corrective_action === 'string')
        out.corrective_action = r.corrective_action
      return applyVariantHint(out, r)
    }
    case 'job': {
      const out: JobKindData = {}
      if (
        typeof r.employment_type === 'string' &&
        (JOB_EMPLOYMENT_TYPES as readonly string[]).includes(r.employment_type)
      ) {
        out.employment_type = r.employment_type as JobEmploymentType
      }
      if (typeof r.pay_min === 'number') out.pay_min = r.pay_min
      if (typeof r.pay_max === 'number') out.pay_max = r.pay_max
      if (typeof r.pay_currency === 'string') out.pay_currency = r.pay_currency
      if (
        typeof r.pay_period === 'string' &&
        (JOB_PAY_PERIODS as readonly string[]).includes(r.pay_period)
      ) {
        out.pay_period = r.pay_period as JobPayPeriod
      }
      if (typeof r.hiring_manager_name === 'string')
        out.hiring_manager_name = r.hiring_manager_name
      if (typeof r.hiring_manager_email === 'string')
        out.hiring_manager_email = r.hiring_manager_email
      return applyVariantHint(out, r)
    }
  }
}

export function defaultKindData(kind: PostKind): KindData {
  switch (kind) {
    case 'announcement':
      return {} satisfies AnnouncementKindData
    case 'hr_news':
      return { category: 'other' } satisfies HrNewsKindData
    case 'safety_alert':
      return {} satisfies SafetyAlertKindData
    case 'job':
      return { employment_type: 'full_time' } satisfies JobKindData
  }
}

// Created and developed by Jai Singh
