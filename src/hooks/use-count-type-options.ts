// Created and developed by Jai Singh
import { useMemo } from 'react'
import { useWorkflowConfigs } from './use-workflow-configs'

export interface CountTypeOption {
  value: string
  label: string
  description?: string
}

/**
 * Built-in default count types. Kept as a safety net so the UI still has
 * sensible options before `useWorkflowConfigs` has loaded or if the
 * organization has no configs at all.
 */
export const BUILT_IN_COUNT_TYPE_OPTIONS: CountTypeOption[] = [
  {
    value: 'quantity_check',
    label: 'Quantity Check',
    description: 'Standard quantity verification',
  },
  {
    value: 'cycle_count',
    label: 'Cycle Count',
    description: 'Standard cycle count workflow',
  },
  {
    value: 'physical_count',
    label: 'Physical Count',
    description: 'Full physical inventory count',
  },
  {
    value: 'spot_count',
    label: 'Spot Count',
    description: 'Random spot check',
  },
  {
    value: 'part_verification',
    label: 'Part Verification',
    description: 'Verify part numbers match location',
  },
  { value: 're_count', label: 'Re-Count', description: 'General recount' },
  {
    value: 'second_count',
    label: 'Second Count',
    description: 'Second counter verification',
  },
  {
    value: 'third_count',
    label: 'Third Count',
    description: 'Third counter verification (tiebreaker)',
  },
  {
    value: '999_count',
    label: '999 Count',
    description: '999 variance investigation count',
  },
  {
    value: 'empty_location_check',
    label: 'Empty Location Check',
    description: 'Verify location is empty',
  },
  {
    value: 'found_part_transfer',
    label: 'Found Part Transfer',
    description:
      'Move a misplaced part into the task’s location and record the new total',
  },
]

const BUILT_IN_LABELS: Record<string, string> = Object.fromEntries(
  BUILT_IN_COUNT_TYPE_OPTIONS.map((o) => [o.value, o.label])
)

/** Prettify an unknown slug (e.g. `daily_bin_sweep` -> `Daily Bin Sweep`). */
function prettifySlug(slug: string): string {
  return slug
    .split('_')
    .filter(Boolean)
    .map((part) =>
      part.length <= 1 ? part : part[0].toUpperCase() + part.slice(1)
    )
    .join(' ')
}

/** Look up a display label for a count type slug, across the whole app. */
export function resolveCountTypeLabel(
  slug: string | null | undefined,
  options?: CountTypeOption[]
): string {
  if (!slug) return ''
  const match = options?.find((o) => o.value === slug)
  if (match) return match.label
  if (BUILT_IN_LABELS[slug]) return BUILT_IN_LABELS[slug]
  return prettifySlug(slug)
}

/**
 * Live count type options sourced from the organization's workflow_configs,
 * unioned with the built-in defaults. Use this wherever the UI needs a picker
 * of count types that stays in sync with what admins have configured in the
 * Count Settings panel.
 */
export function useCountTypeOptions(): {
  options: CountTypeOption[]
  isLoading: boolean
} {
  const { configs, isLoading } = useWorkflowConfigs()

  const options = useMemo<CountTypeOption[]>(() => {
    const seen = new Map<string, CountTypeOption>()

    // Built-ins first so they appear even when configs haven't loaded yet.
    for (const opt of BUILT_IN_COUNT_TYPE_OPTIONS) seen.set(opt.value, opt)

    // Live configs override labels/descriptions and add custom types.
    for (const cfg of configs) {
      if (!cfg.is_active) continue
      seen.set(cfg.count_type, {
        value: cfg.count_type,
        label: cfg.display_name,
        description: cfg.description ?? undefined,
      })
    }

    return Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    )
  }, [configs])

  return { options, isLoading }
}

// Created and developed by Jai Singh
