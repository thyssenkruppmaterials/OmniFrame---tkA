// Created and developed by Jai Singh
/**
 * Route → feature-name resolver for supervisor-visible presence surfaces.
 *
 * # Purpose
 *
 * Maps `location.pathname` strings to human-readable feature labels so
 * supervisor surfaces can render "Sarah Chen — RF: Cycle Count"
 * instead of the raw URL "/rf-interface/cycle-count/abc-123". The
 * label is the user-facing text; the raw pathname is kept on the
 * resolved result for tooltips / debugging.
 *
 * # Where this is consumed
 *
 * - `<LiveOperatorStatus>` (`src/components/live-operator-status.tsx`)
 *   inside the Inventory Counts tab. Gated by the
 *   `view inventory_apps` permission on the route. See
 *   `memorybank/OmniFrame/Decisions/ADR-Scoped-CurrentPage-In-ActiveOperators.md`.
 *
 * Adding a new consumer? Confirm the surface is RBAC-gated AND link
 * the new ADR; the privacy contract on `PresencePayload.current_page`
 * forbids exposing it on the org-wide `<OnlineUsersPanel>` /
 * `<StatusSelector>` / `<PresenceAvatar>` surfaces.
 *
 * # Why labels (not raw URLs) get rendered
 *
 * - UX — operators don't read URLs.
 * - Privacy in depth — the label collapses entity IDs in the path
 *   (e.g. `/rf-interface/cycle-count/abc-123` → "RF: Cycle Count").
 *   The raw pathname is still BROADCAST (so the panel can derive a
 *   richer label later if it wants), but the panel only renders the
 *   resolved label by default. The raw pathname is exposed as a
 *   tooltip behind a hover affordance.
 *
 * # Pattern note
 *
 * This is the canonical place to add a new feature-area mapping. Order
 * matters — the first regex to match wins, so put MORE-SPECIFIC
 * patterns BEFORE more general ones (e.g. `/admin/sap-testing` must
 * appear before `/admin/`). See
 * `memorybank/OmniFrame/Patterns/Route-To-Feature-Name-Mapping.md`
 * for the broader pattern (in case a sibling supervisor surface
 * needs the same resolver later).
 *
 * URL shape note: TanStack Router strips layout-group segments
 * (`_authenticated`, `(auth)`, `(errors)`) from `location.pathname`,
 * so URLs the user sees and that we map against look like
 * `/apps/inventory`, NOT `/_authenticated/apps/inventory`.
 */

/** Single entry in the mapping table. */
interface RouteFeature {
  /**
   * Regex tested against `location.pathname`. Anchored with `^` so
   * partial-prefix collisions don't cross-match.
   */
  pattern: RegExp
  /**
   * Human-readable feature label. Short enough to fit in a card row;
   * mirror what the user would call it in conversation.
   */
  label: string
  /**
   * Optional sub-label for nested context (e.g. "Editing" vs
   * "Viewing"). Reserved for future use.
   */
  sublabel?: string
  /**
   * Optional Lucide icon name (e.g. `Boxes`, `Truck`). The consumer
   * surface decides how to resolve the icon string to a component.
   * Plain strings here (rather than icon component imports) keep this
   * module dependency-free and tree-shakeable.
   */
  icon?: string
}

/**
 * Mapping table. ORDER MATTERS — first match wins. Add the most
 * specific patterns first; broad catch-alls last.
 *
 * Coverage policy: enumerate every top-level route group + the
 * notable nested surfaces. The fall-through `{ label: 'Unknown', … }`
 * in `resolveFeature()` keeps the renderer safe if a new route ships
 * before this table is updated.
 */
const ROUTE_FEATURES: readonly RouteFeature[] = [
  // ---- App routes (`/apps/*`) — most specific first within group ----------
  {
    pattern: /^\/apps\/customer-portal/,
    label: 'Customer Portal',
    icon: 'Headset',
  },
  { pattern: /^\/apps\/inventory/, label: 'Inventory', icon: 'Boxes' },
  { pattern: /^\/apps\/inbound/, label: 'Inbound', icon: 'TruckIcon' },
  { pattern: /^\/apps\/outbound/, label: 'Outbound', icon: 'Truck' },
  { pattern: /^\/apps\/kitting/, label: 'Kitting', icon: 'Package' },
  { pattern: /^\/apps\/quality/, label: 'Quality', icon: 'ShieldCheck' },
  { pattern: /^\/apps\/grs/, label: 'GRS', icon: 'PackageCheck' },
  { pattern: /^\/apps\/unit-pack/, label: 'Unit Pack', icon: 'PackagePlus' },
  { pattern: /^\/apps\/data-manager/, label: 'Data Manager', icon: 'Database' },
  {
    pattern: /^\/apps\/tka-data-manager/,
    label: 'TKA Data Manager',
    icon: 'Database',
  },
  {
    pattern: /^\/apps\/my-productivity/,
    label: 'My Productivity',
    icon: 'BarChart3',
  },
  {
    pattern: /^\/apps\/shift-productivity/,
    label: 'Shift Productivity',
    icon: 'BarChart',
  },
  {
    pattern: /^\/apps\/standard-work/,
    label: 'Standard Work',
    icon: 'Workflow',
  },
  {
    pattern: /^\/apps\/smartsheet-integrations/,
    label: 'Smartsheet',
    icon: 'Sheet',
  },

  // ---- Admin routes (`/admin/*`) — most specific first --------------------
  { pattern: /^\/admin\/sap-testing/, label: 'SAP Testing', icon: 'TestTube' },
  { pattern: /^\/admin\/work-engine/, label: 'Work Engine', icon: 'Cog' },
  { pattern: /^\/admin\/work-queue/, label: 'Work Queue', icon: 'ListTodo' },
  {
    pattern: /^\/admin\/user-management/,
    label: 'User Management',
    icon: 'Users',
  },
  { pattern: /^\/admin\/permissions/, label: 'Permissions', icon: 'KeyRound' },
  { pattern: /^\/admin\/roles/, label: 'Roles', icon: 'ShieldUser' },
  { pattern: /^\/admin\/onboarding/, label: 'Onboarding', icon: 'UserPlus' },
  {
    pattern: /^\/admin\/session-management/,
    label: 'Session Management',
    icon: 'KeyRound',
  },
  {
    pattern: /^\/admin\/system-settings/,
    label: 'System Settings',
    icon: 'Settings',
  },
  {
    pattern: /^\/admin\/device-manager/,
    label: 'Device Manager',
    icon: 'Smartphone',
  },
  {
    pattern: /^\/admin\/performance-monitor/,
    label: 'Performance Monitor',
    icon: 'Activity',
  },
  {
    pattern: /^\/admin\/tab-permissions-debug/,
    label: 'Tab Perms Debug',
    icon: 'Bug',
  },
  { pattern: /^\/admin/, label: 'Admin', icon: 'Settings' },

  // ---- Business routes (`/business/*`) ------------------------------------
  { pattern: /^\/business\/warehouse/, label: 'Warehouse', icon: 'Warehouse' },
  {
    pattern: /^\/business\/transportation/,
    label: 'Transportation',
    icon: 'Truck',
  },
  {
    pattern: /^\/business\/supply-chain/,
    label: 'Supply Chain',
    icon: 'Network',
  },
  { pattern: /^\/business\/logistics/, label: 'Logistics', icon: 'TruckIcon' },
  {
    pattern: /^\/business\/inventory/,
    label: 'Business Inventory',
    icon: 'Boxes',
  },
  { pattern: /^\/business\/engineering/, label: 'Engineering', icon: 'Wrench' },
  {
    pattern: /^\/business\/customer-service/,
    label: 'Customer Service',
    icon: 'Headset',
  },

  // ---- Facility routes (`/facility/*`) ------------------------------------
  {
    pattern: /^\/facility\/it-services/,
    label: 'IT Services',
    icon: 'MonitorCog',
  },
  { pattern: /^\/facility\/maintenance/, label: 'Maintenance', icon: 'Wrench' },
  { pattern: /^\/facility\/security/, label: 'Security', icon: 'Shield' },
  {
    pattern: /^\/facility\/vendor-management/,
    label: 'Vendor Management',
    icon: 'Building2',
  },

  // ---- HR routes (`/hr/*`) ------------------------------------------------
  { pattern: /^\/hr\/time-tracker/, label: 'Time Tracker', icon: 'Clock' },
  {
    pattern: /^\/hr\/employee-reviews/,
    label: 'Employee Reviews',
    icon: 'ClipboardList',
  },

  // ---- Intelligence routes (`/intelligence/*`) ----------------------------
  { pattern: /^\/intelligence\/ai-chat/, label: 'AI Chat', icon: 'Sparkles' },
  {
    pattern: /^\/intelligence\/drone-control/,
    label: 'Drone Control',
    icon: 'Plane',
  },

  // ---- Settings routes (`/settings/*`) ------------------------------------
  {
    pattern: /^\/settings\/account/,
    label: 'Settings: Account',
    icon: 'UserCog',
  },
  {
    pattern: /^\/settings\/appearance/,
    label: 'Settings: Appearance',
    icon: 'Palette',
  },
  {
    pattern: /^\/settings\/cache/,
    label: 'Settings: Cache',
    icon: 'HardDrive',
  },
  {
    pattern: /^\/settings\/display/,
    label: 'Settings: Display',
    icon: 'Monitor',
  },
  {
    pattern: /^\/settings\/notifications/,
    label: 'Settings: Notifications',
    icon: 'Bell',
  },
  {
    pattern: /^\/settings\/organization/,
    label: 'Settings: Org',
    icon: 'Building2',
  },
  { pattern: /^\/settings/, label: 'Settings', icon: 'Settings' },

  // ---- Top-level pages ----------------------------------------------------
  { pattern: /^\/tasks/, label: 'Tasks', icon: 'ListTodo' },
  { pattern: /^\/help-center/, label: 'Help Center', icon: 'LifeBuoy' },

  // ---- Device-class kiosk routes ------------------------------------------
  // These are typically opt-out of presence (see PRESENCE_KIOSK_ROUTE_PATTERNS),
  // so they should rarely appear here, but the supervisor panel still
  // needs labels for the brief windows where a user transitions in/out.
  {
    pattern: /^\/rf-interface\/cycle-count/,
    label: 'RF: Cycle Count',
    icon: 'Smartphone',
  },
  {
    pattern: /^\/rf-interface\/putaway/,
    label: 'RF: Putaway',
    icon: 'Smartphone',
  },
  {
    pattern: /^\/rf-interface\/picking/,
    label: 'RF: Picking',
    icon: 'Smartphone',
  },
  { pattern: /^\/rf-interface/, label: 'RF Terminal', icon: 'Smartphone' },
  { pattern: /^\/rf-signin/, label: 'RF Sign-in', icon: 'LogIn' },
  { pattern: /^\/timeclock(app)?/, label: 'Time Clock', icon: 'Clock' },
  {
    pattern: /^\/customer-portal/,
    label: 'Customer Portal (public)',
    icon: 'Headset',
  },

  // ---- Auth + error routes ------------------------------------------------
  { pattern: /^\/sign-in/, label: 'Sign In', icon: 'LogIn' },
  { pattern: /^\/sign-up/, label: 'Sign Up', icon: 'UserPlus' },
  { pattern: /^\/forgot-password/, label: 'Forgot Password', icon: 'KeyRound' },
  { pattern: /^\/otp/, label: 'OTP', icon: 'KeyRound' },
  { pattern: /^\/intro/, label: 'Intro', icon: 'BookOpen' },
  { pattern: /^\/prototype/, label: 'Prototype', icon: 'Sparkles' },
  {
    pattern: /^\/(401|403|404|500|503)$/,
    label: 'Error Page',
    icon: 'AlertTriangle',
  },

  // ---- Catch-all for the authenticated index route ------------------------
  { pattern: /^\/$/, label: 'Home', icon: 'Home' },
] as const

/**
 * Result of resolving a pathname. Always returns the raw input under
 * `raw` so the consumer can render a tooltip with the literal URL for
 * supervisors debugging "where exactly was Sarah?".
 */
export interface ResolvedFeature {
  /** Human-readable label, e.g. "Inventory" or "RF: Cycle Count". */
  label: string
  /** Optional sub-label (reserved for future "Editing" vs "Viewing"). */
  sublabel?: string
  /** Lucide icon name (string). The consumer maps to a component. */
  icon?: string
  /** The raw pathname input — useful for tooltips + debugging. */
  raw: string
}

/**
 * Resolve a `location.pathname` to a feature label.
 *
 * - `null` / `undefined` / empty input → `null` (caller renders nothing).
 * - Unknown pathname → `{ label: 'Unknown', raw: pathname, icon: 'HelpCircle' }`
 *   so the panel still shows SOMETHING (and a missing entry in
 *   `ROUTE_FEATURES` becomes visible to whoever is reading the panel,
 *   instead of silently vanishing).
 * - Known pathname → matching `RouteFeature` entry's label/icon plus
 *   the raw input for tooltip rendering.
 *
 * Stable + pure — same input always produces the same output. Safe to
 * call inside React render passes; no side effects, no allocations
 * beyond the result object.
 */
export function resolveFeature(
  pathname: string | null | undefined
): ResolvedFeature | null {
  if (!pathname) return null
  for (const f of ROUTE_FEATURES) {
    if (f.pattern.test(pathname)) {
      return {
        label: f.label,
        sublabel: f.sublabel,
        icon: f.icon,
        raw: pathname,
      }
    }
  }
  return { label: 'Unknown', raw: pathname, icon: 'HelpCircle' }
}

// Created and developed by Jai Singh
