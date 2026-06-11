// Created and developed by Jai Singh
/**
 * Production Boards — Associate skills derivation (v1, Branch B).
 *
 * No `associate_skills` schema exists yet, so the v1 board derives a
 * practical skills picture from existing data:
 *
 * - `primarySkill` is mapped from `shift_positions.position_title` via a
 *   case-insensitive partial-match lookup.
 * - `demonstratedSkills` is a Set of canonical skill ids derived from the
 *   `event_type` strings observed for the associate today.
 *
 * The matrix tile order, the position → skill mapper, and the event_type
 * → skill mapper all live here so the rest of the feature consumes one
 * source of truth and unit tests can pin behaviour at this seam.
 *
 * Follow-up: introduce a real `associate_skills` table backed by HR
 * cross-training records, then swap the derivation in
 * `useHourlyProductivity` without changing this module's public API.
 */

/** Canonical skill ids — order is the rendering order in the matrix. */
export type SkillId =
  | 'picker'
  | 'packer'
  | 'shipper'
  | 'putaway'
  | 'receiver'
  | 'cycle_count'
  | 'rf'
  | 'lead'

/** Primary-skill labels that are NOT rendered as matrix tiles. */
export type FallbackSkillId = 'coordinator' | 'warehouse'

/** Per-cell visual state for the SkillsMatrix. */
export type SkillState = 'primary' | 'demonstrated' | 'none'

/**
 * Definition of one canonical skill rendered as a matrix tile.
 *   `code` is the 1–2 char monogram displayed inside the tile. We pick
 *   single letters where possible and disambiguate collisions
 *   (Picker = P, Packer = K) so the matrix stays compact.
 */
export interface SkillDef {
  id: SkillId
  label: string
  code: string
}

/**
 * Canonical list rendered by the SkillsMatrix. Fixed order — keeping it
 * stable lets operators learn to scan the row at a glance.
 *
 * P  picker
 * K  packer
 * S  shipper
 * U  putaway
 * R  receiver
 * C  cycle count
 * F  RF
 * L  lead
 */
export const CANONICAL_SKILLS: readonly SkillDef[] = [
  { id: 'picker', label: 'Picker', code: 'P' },
  { id: 'packer', label: 'Packer', code: 'K' },
  { id: 'shipper', label: 'Shipper', code: 'S' },
  { id: 'putaway', label: 'Putaway', code: 'U' },
  { id: 'receiver', label: 'Receiver', code: 'R' },
  { id: 'cycle_count', label: 'Cycle Count', code: 'C' },
  { id: 'rf', label: 'RF', code: 'F' },
  { id: 'lead', label: 'Lead', code: 'L' },
] as const

const CANONICAL_IDS: ReadonlySet<SkillId> = new Set(
  CANONICAL_SKILLS.map((s) => s.id)
)

/**
 * Per-associate skill picture consumed by AssociateIdCard / SkillsMatrix.
 * `primarySkill` is the position-driven role label (always set; falls
 * back to `'warehouse'` when no rule matches). `demonstratedSkills` is
 * derived from today's event stream.
 */
export interface AssociateSkills {
  primarySkill: SkillId | FallbackSkillId
  demonstratedSkills: Set<SkillId>
}

/**
 * Map a `shift_positions.position_title` to a canonical skill id.
 * Matching is case-insensitive substring containment, evaluated in the
 * order documented below — the first hit wins so leadership terms
 * like "Lead" / "Supervisor" win over generic "Warehouse Associate".
 *
 * Order matters:
 *   1. lead/supervisor   (catch leadership before generic operator words)
 *   2. coordinator       (operations/logistics coordinator titles)
 *   3. picker / selector
 *   4. packer
 *   5. shipper / shipping  (also catches "Shipping Clerk")
 *   6. putaway / stocker
 *   7. receiver / receiving / inbound
 *   8. cycle / count / auditor
 *   9. rf / radio frequency
 *   10. fallback        → 'warehouse'
 */
export function mapPositionToSkill(
  positionTitle: string | null | undefined
): SkillId | FallbackSkillId {
  if (!positionTitle) return 'warehouse'
  const t = positionTitle.toLowerCase()

  if (/(^|\W)(lead|supervisor)(\W|$)/.test(t)) return 'lead'
  if (/coordinator/.test(t)) return 'coordinator'
  if (/(picker|selector)/.test(t)) return 'picker'
  if (/packer/.test(t)) return 'packer'
  if (/(shipper|shipping)/.test(t)) return 'shipper'
  if (/(putaway|stocker)/.test(t)) return 'putaway'
  if (/(receiv|inbound)/.test(t)) return 'receiver'
  if (/(cycle|count|auditor)/.test(t)) return 'cycle_count'
  if (/(\brf\b|radio frequency)/.test(t)) return 'rf'

  return 'warehouse'
}

/**
 * Map an activity `event_type` (e.g. `picking`, `putaway_confirm`,
 * `inbound_scan`, `cart_stow`, `final_pack`) to a canonical skill id, or
 * null for activity types that don't map to any tile.
 *
 * Demonstration is "did this associate do any of this kind of work today",
 * so any positive count flips that tile from `'none'` → `'demonstrated'`.
 */
export function mapEventTypeToSkill(eventType: string): SkillId | null {
  if (!eventType) return null
  const t = eventType.toLowerCase()
  // Order matters where prefixes overlap (e.g. final_pack vs picking).
  if (t.startsWith('inbound')) return 'receiver'
  if (t.startsWith('putaway') || t === 'put_aways' || t === 'putback') {
    return 'putaway'
  }
  if (t === 'cart_stow') return 'putaway'
  if (t.startsWith('pick')) return 'picker'
  if (t === 'kit_picking') return 'picker'
  if (t === 'final_pack' || t.startsWith('pack')) return 'packer'
  if (t.startsWith('ship')) return 'shipper'
  if (t.startsWith('cycle') || t === 'count') return 'cycle_count'
  return null
}

/**
 * Pure lookup: state for a single (associate, canonical-skill) cell.
 *
 *   primary       → assigned position resolves to this skill
 *   demonstrated  → activity events show this skill today (and not primary)
 *   none          → neither
 *
 * Note: when the associate's primary is a non-canonical fallback
 * (`warehouse` / `coordinator`), every canonical tile is either
 * `demonstrated` or `none` — no tile is shaded as primary.
 */
export function getSkillState(
  skills: AssociateSkills,
  skillId: SkillId
): SkillState {
  if (skills.primarySkill === skillId) return 'primary'
  if (skills.demonstratedSkills.has(skillId)) return 'demonstrated'
  return 'none'
}

/** Human-readable label for a skill id (canonical OR fallback). */
export function getSkillLabel(id: SkillId | FallbackSkillId): string {
  const canonical = CANONICAL_SKILLS.find((s) => s.id === id)
  if (canonical) return canonical.label
  if (id === 'coordinator') return 'Coordinator'
  return 'Warehouse'
}

/** Short uppercase code shown in the primary pill (3–4 chars). */
export function getPrimarySkillPillCode(id: SkillId | FallbackSkillId): string {
  switch (id) {
    case 'picker':
      return 'PICK'
    case 'packer':
      return 'PACK'
    case 'shipper':
      return 'SHIP'
    case 'putaway':
      return 'PUT'
    case 'receiver':
      return 'RCV'
    case 'cycle_count':
      return 'CYCLE'
    case 'rf':
      return 'RF'
    case 'lead':
      return 'LEAD'
    case 'coordinator':
      return 'COORD'
    case 'warehouse':
    default:
      return 'WHS'
  }
}

/* -------------------------------------------------------------------- */
/* Area-color derivation                                                */
/* -------------------------------------------------------------------- */

/**
 * Curated palette for area-derived ID-card accents. Picked for clear
 * separation in both light and dark mode, with no reliance on a hue that
 * conflicts with the heatmap's emerald ramp at first glance.
 */
export const AREA_COLOR_KEYS = [
  'emerald',
  'sky',
  'amber',
  'violet',
  'rose',
  'cyan',
  'lime',
  'fuchsia',
] as const

export type AreaColorKey = (typeof AREA_COLOR_KEYS)[number]

/**
 * Stable, deterministic colour per area code. Same `area_code` always
 * resolves to the same colour across renders / sessions (hash-based,
 * not order-based) so an operator memorises "Outbound = sky" once.
 *
 * Returns 'slate'-like fallback ('emerald') for null/empty input — the
 * heatmap palette already biases toward emerald so this matches the
 * default visual language.
 */
export function deriveAreaColor(
  areaCode: string | null | undefined
): AreaColorKey {
  if (!areaCode) return 'emerald'
  // Tiny FNV-1a hash. Stable across JS engines, fast, no deps.
  let hash = 0x811c9dc5
  for (let i = 0; i < areaCode.length; i++) {
    hash ^= areaCode.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AREA_COLOR_KEYS[hash % AREA_COLOR_KEYS.length]
}

/* -------------------------------------------------------------------- */
/* Tailwind class lookup                                                */
/* -------------------------------------------------------------------- */

/**
 * Static Tailwind class table per area colour. We can't compose
 * `bg-${color}-500/30` strings at runtime — the JIT scanner only picks
 * up literal class names, so we list each variant explicitly here.
 */
export interface AreaColorClasses {
  /** Avatar block — gradient + ring + text. */
  avatarGradient: string
  avatarRing: string
  avatarText: string
  /** Primary-skill pill colour. */
  pillBg: string
  pillBorder: string
  pillText: string
  /** Card outline tint for active rows. */
  cardActiveBorder: string
  cardActiveRing: string
}

export const AREA_COLOR_CLASSES: Record<AreaColorKey, AreaColorClasses> = {
  emerald: {
    avatarGradient: 'bg-gradient-to-br from-emerald-500/30 to-emerald-500/10',
    avatarRing: 'ring-emerald-500/30',
    avatarText: 'text-emerald-700 dark:text-emerald-300',
    pillBg: 'bg-emerald-500/15',
    pillBorder: 'border-emerald-500/25',
    pillText: 'text-emerald-700 dark:text-emerald-300',
    cardActiveBorder: 'border-emerald-500/40',
    cardActiveRing: 'ring-emerald-500/20',
  },
  sky: {
    avatarGradient: 'bg-gradient-to-br from-sky-500/30 to-sky-500/10',
    avatarRing: 'ring-sky-500/30',
    avatarText: 'text-sky-700 dark:text-sky-300',
    pillBg: 'bg-sky-500/15',
    pillBorder: 'border-sky-500/25',
    pillText: 'text-sky-700 dark:text-sky-300',
    cardActiveBorder: 'border-sky-500/40',
    cardActiveRing: 'ring-sky-500/20',
  },
  amber: {
    avatarGradient: 'bg-gradient-to-br from-amber-500/30 to-amber-500/10',
    avatarRing: 'ring-amber-500/30',
    avatarText: 'text-amber-700 dark:text-amber-300',
    pillBg: 'bg-amber-500/15',
    pillBorder: 'border-amber-500/25',
    pillText: 'text-amber-700 dark:text-amber-300',
    cardActiveBorder: 'border-amber-500/40',
    cardActiveRing: 'ring-amber-500/20',
  },
  violet: {
    avatarGradient: 'bg-gradient-to-br from-violet-500/30 to-violet-500/10',
    avatarRing: 'ring-violet-500/30',
    avatarText: 'text-violet-700 dark:text-violet-300',
    pillBg: 'bg-violet-500/15',
    pillBorder: 'border-violet-500/25',
    pillText: 'text-violet-700 dark:text-violet-300',
    cardActiveBorder: 'border-violet-500/40',
    cardActiveRing: 'ring-violet-500/20',
  },
  rose: {
    avatarGradient: 'bg-gradient-to-br from-rose-500/30 to-rose-500/10',
    avatarRing: 'ring-rose-500/30',
    avatarText: 'text-rose-700 dark:text-rose-300',
    pillBg: 'bg-rose-500/15',
    pillBorder: 'border-rose-500/25',
    pillText: 'text-rose-700 dark:text-rose-300',
    cardActiveBorder: 'border-rose-500/40',
    cardActiveRing: 'ring-rose-500/20',
  },
  cyan: {
    avatarGradient: 'bg-gradient-to-br from-cyan-500/30 to-cyan-500/10',
    avatarRing: 'ring-cyan-500/30',
    avatarText: 'text-cyan-700 dark:text-cyan-300',
    pillBg: 'bg-cyan-500/15',
    pillBorder: 'border-cyan-500/25',
    pillText: 'text-cyan-700 dark:text-cyan-300',
    cardActiveBorder: 'border-cyan-500/40',
    cardActiveRing: 'ring-cyan-500/20',
  },
  lime: {
    avatarGradient: 'bg-gradient-to-br from-lime-500/30 to-lime-500/10',
    avatarRing: 'ring-lime-500/30',
    avatarText: 'text-lime-700 dark:text-lime-300',
    pillBg: 'bg-lime-500/15',
    pillBorder: 'border-lime-500/25',
    pillText: 'text-lime-700 dark:text-lime-300',
    cardActiveBorder: 'border-lime-500/40',
    cardActiveRing: 'ring-lime-500/20',
  },
  fuchsia: {
    avatarGradient: 'bg-gradient-to-br from-fuchsia-500/30 to-fuchsia-500/10',
    avatarRing: 'ring-fuchsia-500/30',
    avatarText: 'text-fuchsia-700 dark:text-fuchsia-300',
    pillBg: 'bg-fuchsia-500/15',
    pillBorder: 'border-fuchsia-500/25',
    pillText: 'text-fuchsia-700 dark:text-fuchsia-300',
    cardActiveBorder: 'border-fuchsia-500/40',
    cardActiveRing: 'ring-fuchsia-500/20',
  },
}

/** Get the static class bundle for an area colour. Always defined. */
export function getAreaColorClasses(color: AreaColorKey): AreaColorClasses {
  return AREA_COLOR_CLASSES[color]
}

/* -------------------------------------------------------------------- */
/* Helpers used by tests + hook                                         */
/* -------------------------------------------------------------------- */

/**
 * Test-friendly factory: derive `demonstratedSkills` from a flat list of
 * event_type strings (e.g. extracted from a single user's bucketed
 * `byType` keys). Pure, framework-free.
 */
export function deriveDemonstratedSkills(
  eventTypes: Iterable<string>
): Set<SkillId> {
  const out = new Set<SkillId>()
  for (const t of eventTypes) {
    const skill = mapEventTypeToSkill(t)
    if (skill && CANONICAL_IDS.has(skill)) out.add(skill)
  }
  return out
}

// Created and developed by Jai Singh
