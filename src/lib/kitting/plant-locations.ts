// Created and developed by Jai Singh
/**
 * Pure helpers for the operator-editable "Deliver To Plant" list backing
 * the Add Kit Build Plan dialog dropdown.
 *
 * The list lives on `kitting_workflow_settings.deliver_to_plant_locations`
 * (migration 324, TEXT[]) and is rendered as-is in the dropdown — the
 * stored string is exactly what lands on the kit row when the operator
 * selects an option. Because the value is a human-readable label
 * ("Plant A - Main Assembly") rather than a code or pattern, the
 * normaliser preserves the operator's original casing instead of
 * uppercasing the way `normaliseBinPatterns` does.
 *
 * See `memorybank/OmniFrame/Implementations/Configurable-Deliver-To-Plant-Locations.md`.
 */

/**
 * Default set of plant destinations. Mirrors the values that used to be
 * hardcoded in `add-kit-build-plan-dialog.tsx` as `PLANT_LOCATIONS`,
 * so a never-touched org keeps the exact dropdown options it had before
 * the migration shipped.
 */
export const DEFAULT_PLANT_LOCATIONS: readonly string[] = [
  'Plant A - Main Assembly',
  'Plant B - Component Shop',
  'Plant C - Engine Test',
  'Plant D - Logistics Hub',
  'Plant E - Quality Center',
  'Warehouse 1',
  'Warehouse 2',
  'Shipping Dock',
]

/**
 * Canonicalise an operator-edited plant-location list before persisting.
 *
 * Rules:
 *  - Trim whitespace on both ends of every entry.
 *  - Drop blank / whitespace-only entries.
 *  - Deduplicate case-insensitively (a kit row will compare verbatim
 *    against the saved label, so "Plant A" and "plant a" are the same
 *    destination from the operator's perspective even though they read
 *    differently).
 *  - Preserve the first-seen casing for each unique entry so the
 *    operator's intent ("Plant A - Main Assembly") survives the save.
 *  - Preserve insertion order so the dropdown reads top-to-bottom in
 *    the order the operator built it.
 *
 * Pure: no side effects, no exceptions on normal input.
 */
export function normalizePlantLocations(locations: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of locations) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/**
 * Returns `locations` with `currentValue` appended IFF `currentValue` is
 * truthy and not already present (case-insensitive). Used by the Add Kit
 * Build Plan dialog so a saved kit whose `deliver_to_plant` value has
 * since been removed from the configured list still shows the value in
 * its dropdown trigger (and is selectable) rather than rendering as an
 * empty Select. Mirrors the `withCurrentOption` pattern already used for
 * kitting dropdown options like Engine Program.
 */
export function withCurrentPlantOption(
  locations: string[],
  currentValue?: string | null
): string[] {
  if (!currentValue) return locations
  const lower = currentValue.trim().toLowerCase()
  if (!lower) return locations
  const exists = locations.some((loc) => loc.toLowerCase() === lower)
  if (exists) return locations
  return [...locations, currentValue]
}

// Created and developed by Jai Singh
