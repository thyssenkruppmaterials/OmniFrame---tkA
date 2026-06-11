// Created and developed by Jai Singh
/**
 * Curated allowlist of Tabler icons usable as SQCDP category icons.
 *
 * Why a curated allowlist (and not "any icon name"):
 *   1. Keeps the JIT-time icon graph bounded — only the icons listed here
 *      ship in the bundle, not the entire `@tabler/icons-react` ESM tree.
 *   2. Gives curators a manageable picker (~32 options) instead of paging
 *      through 5,500+ icons looking for "the one that fits".
 *   3. Categories are stored as just `icon_name TEXT` in the DB; this map
 *      is the single source of truth for resolving that string to the
 *      React component at render time.
 *
 * Adding a new icon:
 *   1. Append the `Icon{Name}` import below.
 *   2. Append `'Icon{Name}': Icon{Name}` to `SQCDP_CATEGORY_ICONS`.
 *   3. Append the same key to `SQCDP_CATEGORY_ICON_OPTIONS` (drives the
 *      picker grid + tooltip label).
 *
 * Removing an icon: removing keeps backwards-compat because `resolveIcon`
 * falls back to `IconCircleDashed` for unknown names. But the category
 * row that referenced it would render with the fallback until a curator
 * picks a new icon — surface that in the manager UI before removing.
 */
import {
  IconActivity,
  IconAlertTriangle,
  IconAward,
  IconBolt,
  IconBriefcase,
  IconBuildingFactory,
  IconBuildingFactory2,
  IconBuildingWarehouse,
  IconBulb,
  IconCalendar,
  IconCash,
  IconCertificate,
  IconChartBar,
  IconCheck,
  IconCircleCheck,
  IconCircleDashed,
  IconClipboardCheck,
  IconClock,
  IconCoin,
  IconFlag,
  IconForklift,
  IconGauge,
  IconHammer,
  IconHeart,
  IconLeaf,
  IconLock,
  IconPackage,
  IconPackageExport,
  IconRecycle,
  IconRefresh,
  IconRocket,
  IconRoute,
  IconScale,
  IconShield,
  IconShieldCheck,
  IconSparkles,
  IconSpeakerphone,
  IconStar,
  IconTarget,
  IconTool,
  IconTrendingUp,
  IconTruck,
  IconTruckDelivery,
  IconUsers,
  type Icon,
} from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'

/**
 * Static name → icon component map. The DB column `icon_name` carries
 * the string key; the renderer looks the component up here.
 *
 * The 9 builtins (used by migration 306's seed) are at the top; the
 * extras follow in roughly category-affinity order so the picker grid
 * groups visually-related icons together.
 */
export const SQCDP_CATEGORY_ICONS: Record<string, Icon> = {
  // Builtins — keep in sync with migration 306's seed values.
  IconShield,
  IconCheck,
  IconCash,
  IconTruck,
  IconBuildingFactory2,
  IconTool,
  IconPackageExport,
  IconBulb,
  IconSpeakerphone,
  // Safety + quality extras
  IconShieldCheck,
  IconCircleCheck,
  IconClipboardCheck,
  IconAlertTriangle,
  IconCertificate,
  IconLock,
  // Cost / value
  IconCoin,
  IconChartBar,
  IconTrendingUp,
  IconScale,
  // Delivery / shipping
  IconTruckDelivery,
  IconPackage,
  IconRoute,
  IconForklift,
  // Production / maintenance
  IconBuildingFactory,
  IconBuildingWarehouse,
  IconHammer,
  IconBolt,
  IconGauge,
  IconRefresh,
  // People + ops
  IconUsers,
  IconBriefcase,
  IconCalendar,
  IconClock,
  // Ideas + culture
  IconRocket,
  IconSparkles,
  IconStar,
  IconAward,
  IconHeart,
  IconLeaf,
  IconRecycle,
  IconTarget,
  IconFlag,
  IconActivity,
  // Fallback (also exposed in the picker so curators can see it).
  IconCircleDashed,
}

/**
 * Order-preserving picker layout for the manager's icon grid. Builtins
 * intentionally lead so the most-common icons are at the top of the
 * picker.
 *
 * `label` reads as a tooltip (`title=`) on hover so curators get a
 * human-readable name without committing to one full row of text per
 * tile.
 */
export interface SqcdpCategoryIconOption {
  name: string
  label: string
}

export const SQCDP_CATEGORY_ICON_OPTIONS: readonly SqcdpCategoryIconOption[] = [
  { name: 'IconShield', label: 'Shield' },
  { name: 'IconCheck', label: 'Check' },
  { name: 'IconCash', label: 'Cash' },
  { name: 'IconTruck', label: 'Truck' },
  { name: 'IconBuildingFactory2', label: 'Factory' },
  { name: 'IconTool', label: 'Wrench / tool' },
  { name: 'IconPackageExport', label: 'Package out' },
  { name: 'IconBulb', label: 'Bulb' },
  { name: 'IconSpeakerphone', label: 'Megaphone' },
  { name: 'IconShieldCheck', label: 'Shield check' },
  { name: 'IconCircleCheck', label: 'Circle check' },
  { name: 'IconClipboardCheck', label: 'Clipboard' },
  { name: 'IconAlertTriangle', label: 'Alert' },
  { name: 'IconCertificate', label: 'Certificate' },
  { name: 'IconLock', label: 'Lock' },
  { name: 'IconCoin', label: 'Coin' },
  { name: 'IconChartBar', label: 'Bar chart' },
  { name: 'IconTrendingUp', label: 'Trending up' },
  { name: 'IconScale', label: 'Scale' },
  { name: 'IconTruckDelivery', label: 'Truck delivery' },
  { name: 'IconPackage', label: 'Package' },
  { name: 'IconRoute', label: 'Route' },
  { name: 'IconForklift', label: 'Forklift' },
  { name: 'IconBuildingFactory', label: 'Factory (alt)' },
  { name: 'IconBuildingWarehouse', label: 'Warehouse' },
  { name: 'IconHammer', label: 'Hammer' },
  { name: 'IconBolt', label: 'Bolt' },
  { name: 'IconGauge', label: 'Gauge' },
  { name: 'IconRefresh', label: 'Refresh' },
  { name: 'IconUsers', label: 'Users' },
  { name: 'IconBriefcase', label: 'Briefcase' },
  { name: 'IconCalendar', label: 'Calendar' },
  { name: 'IconClock', label: 'Clock' },
  { name: 'IconRocket', label: 'Rocket' },
  { name: 'IconSparkles', label: 'Sparkles' },
  { name: 'IconStar', label: 'Star' },
  { name: 'IconAward', label: 'Award' },
  { name: 'IconHeart', label: 'Heart' },
  { name: 'IconLeaf', label: 'Leaf' },
  { name: 'IconRecycle', label: 'Recycle' },
  { name: 'IconTarget', label: 'Target' },
  { name: 'IconFlag', label: 'Flag' },
  { name: 'IconActivity', label: 'Activity' },
  { name: 'IconCircleDashed', label: 'Generic' },
] as const

/**
 * Resolve an icon name (typically read from the DB) to its component.
 * Falls back to `IconCircleDashed` for unknown names, with a one-time
 * `console.warn` so unknown names show up in dev without spamming the
 * console at every render.
 */
const warnedIconNames = new Set<string>()

export function resolveCategoryIcon(name: string | null | undefined): Icon {
  if (!name) return IconCircleDashed
  const Icon = SQCDP_CATEGORY_ICONS[name]
  if (Icon) return Icon
  if (!warnedIconNames.has(name)) {
    warnedIconNames.add(name)
    logger.warn(
      `[sqcdp/category-icons] Unknown icon_name "${name}" — falling back to IconCircleDashed. ` +
        'Add the icon to SQCDP_CATEGORY_ICONS in src/features/.../sqcdp/lib/category-icons.ts.'
    )
  }
  return IconCircleDashed
}

/**
 * Test-only reset for the warning dedupe set.
 *
 * @internal
 */
export function _resetCategoryIconWarnCache(): void {
  warnedIconNames.clear()
}

// Created and developed by Jai Singh
