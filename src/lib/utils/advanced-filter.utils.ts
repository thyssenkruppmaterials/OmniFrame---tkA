// Created and developed by Jai Singh
/**
 * Advanced Filter Utilities
 * Created: November 9, 2025
 *
 * Utility functions for applying advanced filters to data
 */
import type { DeliveryStatusData } from '@/lib/supabase/delivery-status.service'
import type {
  AdvancedFilterConfig,
  FilterCondition,
  FilterGroup,
  FilterPreset,
} from '@/lib/types/advanced-filter.types'
import { logger } from '@/lib/utils/logger'

/**
 * Apply advanced filters to delivery status data
 */
export function applyAdvancedFilters(
  data: DeliveryStatusData[],
  config: AdvancedFilterConfig
): DeliveryStatusData[] {
  if (!config.groups || config.groups.length === 0) {
    return data
  }

  return data.filter((item) => {
    const groupResults = config.groups.map((group) =>
      evaluateFilterGroup(item, group)
    )

    // Combine group results based on global logic
    if (config.globalCombineWith === 'AND') {
      return groupResults.every((result) => result)
    } else {
      return groupResults.some((result) => result)
    }
  })
}

/**
 * Evaluate a filter group against an item
 */
function evaluateFilterGroup(
  item: DeliveryStatusData,
  group: FilterGroup
): boolean {
  if (!group.conditions || group.conditions.length === 0) {
    return true
  }

  const conditionResults = group.conditions.map((condition) =>
    evaluateCondition(item, condition)
  )

  if (group.combineWith === 'AND') {
    return conditionResults.every((result) => result)
  } else {
    return conditionResults.some((result) => result)
  }
}

/**
 * Evaluate a single filter condition
 */
function evaluateCondition(
  item: DeliveryStatusData,
  condition: FilterCondition
): boolean {
  const fieldValue = item[condition.field]
  const filterValue = condition.value

  // Handle is_empty and is_not_empty
  if (condition.operator === 'is_empty') {
    return fieldValue === null || fieldValue === undefined || fieldValue === ''
  }
  if (condition.operator === 'is_not_empty') {
    return fieldValue !== null && fieldValue !== undefined && fieldValue !== ''
  }

  // If field value is empty and operator requires a value comparison, fail
  const isEmpty =
    fieldValue === null || fieldValue === undefined || fieldValue === ''
  if (isEmpty) {
    return false
  }

  // Convert to strings for text comparisons
  const fieldStr = String(fieldValue || '').toLowerCase()
  const filterStr = String(filterValue || '').toLowerCase()

  switch (condition.operator) {
    case 'equals':
      return fieldStr === filterStr

    case 'not_equals':
      return fieldStr !== filterStr

    case 'includes':
      return fieldStr.includes(filterStr)

    case 'not_includes':
      return !fieldStr.includes(filterStr)

    case 'starts_with':
      return fieldStr.startsWith(filterStr)

    case 'ends_with':
      return fieldStr.endsWith(filterStr)

    case 'in_list':
      if (Array.isArray(filterValue)) {
        return filterValue.some((val) => String(val).toLowerCase() === fieldStr)
      }
      return false

    case 'not_in_list':
      if (Array.isArray(filterValue)) {
        return !filterValue.some(
          (val) => String(val).toLowerCase() === fieldStr
        )
      }
      return true

    case 'greater_than': {
      const fv = Array.isArray(fieldValue) ? String(fieldValue) : fieldValue
      const flv = Array.isArray(filterValue) ? String(filterValue) : filterValue
      return compareValues(fv, flv, '>')
    }

    case 'less_than': {
      const fv = Array.isArray(fieldValue) ? String(fieldValue) : fieldValue
      const flv = Array.isArray(filterValue) ? String(filterValue) : filterValue
      return compareValues(fv, flv, '<')
    }

    case 'greater_than_or_equal': {
      const fv = Array.isArray(fieldValue) ? String(fieldValue) : fieldValue
      const flv = Array.isArray(filterValue) ? String(filterValue) : filterValue
      return compareValues(fv, flv, '>=')
    }

    case 'less_than_or_equal': {
      const fv = Array.isArray(fieldValue) ? String(fieldValue) : fieldValue
      const flv = Array.isArray(filterValue) ? String(filterValue) : filterValue
      return compareValues(fv, flv, '<=')
    }

    case 'between':
      if (condition.value2 !== undefined) {
        const fv = Array.isArray(fieldValue) ? String(fieldValue) : fieldValue
        const flv = Array.isArray(filterValue)
          ? String(filterValue)
          : filterValue
        const v2 = Array.isArray(condition.value2)
          ? String(condition.value2)
          : condition.value2
        const inRange =
          compareValues(fv, flv, '>=') && compareValues(fv, v2, '<=')
        return inRange
      }
      return false

    default:
      return true
  }
}

/**
 * Compare values with type awareness
 */
function compareValues(
  value1: string | number | boolean | null | undefined,
  value2: string | number | boolean | null | undefined,
  operator: '>' | '<' | '>=' | '<='
): boolean {
  // Handle null/undefined
  if (value1 === null || value1 === undefined) return false
  if (value2 === null || value2 === undefined) return false

  // Try numeric comparison first
  const num1 = Number(value1)
  const num2 = Number(value2)

  if (!isNaN(num1) && !isNaN(num2)) {
    switch (operator) {
      case '>':
        return num1 > num2
      case '<':
        return num1 < num2
      case '>=':
        return num1 >= num2
      case '<=':
        return num1 <= num2
    }
  }

  // Try date comparison
  const date1 = new Date(String(value1))
  const date2 = new Date(String(value2))

  if (!isNaN(date1.getTime()) && !isNaN(date2.getTime())) {
    switch (operator) {
      case '>':
        return date1 > date2
      case '<':
        return date1 < date2
      case '>=':
        return date1 >= date2
      case '<=':
        return date1 <= date2
    }
  }

  // Fall back to string comparison
  const str1 = String(value1)
  const str2 = String(value2)

  switch (operator) {
    case '>':
      return str1 > str2
    case '<':
      return str1 < str2
    case '>=':
      return str1 >= str2
    case '<=':
      return str1 <= str2
  }

  return false
}

/**
 * Save filter preset to local storage
 */
export function saveFilterPreset(preset: FilterPreset): void {
  try {
    const key = `delivery-filter-preset-${preset.id}`
    localStorage.setItem(key, JSON.stringify(preset))

    // Update preset list
    const presetsKey = 'delivery-filter-presets-list'
    const existingList = localStorage.getItem(presetsKey)
    const presetsList: string[] = existingList ? JSON.parse(existingList) : []

    if (!presetsList.includes(preset.id)) {
      presetsList.push(preset.id)
      localStorage.setItem(presetsKey, JSON.stringify(presetsList))
    }
  } catch (error) {
    logger.error('Error saving filter preset:', error)
    throw new Error('Failed to save filter preset')
  }
}

/**
 * Load filter preset from local storage
 */
export function loadFilterPreset(presetId: string): FilterPreset | null {
  try {
    const key = `delivery-filter-preset-${presetId}`
    const data = localStorage.getItem(key)

    if (!data) return null

    return JSON.parse(data) as FilterPreset
  } catch (error) {
    logger.error('Error loading filter preset:', error)
    return null
  }
}

/**
 * Get all saved filter presets
 */
export function getAllFilterPresets(): FilterPreset[] {
  try {
    const presetsKey = 'delivery-filter-presets-list'
    const listData = localStorage.getItem(presetsKey)

    if (!listData) return []

    const presetIds: string[] = JSON.parse(listData)
    const presets: FilterPreset[] = []

    for (const id of presetIds) {
      const preset = loadFilterPreset(id)
      if (preset) {
        presets.push(preset)
      }
    }

    // Sort by updated date, most recent first
    presets.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )

    return presets
  } catch (error) {
    logger.error('Error getting filter presets:', error)
    return []
  }
}

/**
 * Delete filter preset
 */
export function deleteFilterPreset(presetId: string): void {
  try {
    // Remove preset data
    const key = `delivery-filter-preset-${presetId}`
    localStorage.removeItem(key)

    // Update preset list
    const presetsKey = 'delivery-filter-presets-list'
    const listData = localStorage.getItem(presetsKey)

    if (listData) {
      const presetIds: string[] = JSON.parse(listData)
      const updatedIds = presetIds.filter((id) => id !== presetId)
      localStorage.setItem(presetsKey, JSON.stringify(updatedIds))
    }
  } catch (error) {
    logger.error('Error deleting filter preset:', error)
    throw new Error('Failed to delete filter preset')
  }
}

/**
 * Create default/empty filter config
 */
export function createEmptyFilterConfig(): AdvancedFilterConfig {
  return {
    groups: [],
    globalCombineWith: 'AND',
  }
}

/**
 * Create a new empty filter group
 */
export function createEmptyFilterGroup(): FilterGroup {
  return {
    id: generateId(),
    combineWith: 'AND',
    conditions: [],
  }
}

/**
 * Create a new empty filter condition
 */
export function createEmptyFilterCondition(
  field: keyof DeliveryStatusData = 'delivery'
): FilterCondition {
  return {
    id: generateId(),
    field,
    operator: 'includes',
    value: '',
    dataType: 'text',
  }
}

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Count active filters in config
 */
export function countActiveFilters(config: AdvancedFilterConfig): number {
  let count = 0

  for (const group of config.groups) {
    for (const condition of group.conditions) {
      // Only count conditions with actual values (or is_empty/is_not_empty)
      if (
        condition.operator === 'is_empty' ||
        condition.operator === 'is_not_empty'
      ) {
        count++
      } else if (
        condition.value !== null &&
        condition.value !== undefined &&
        condition.value !== ''
      ) {
        count++
      }
    }
  }

  return count
}

/**
 * Validate filter config
 */
export function validateFilterConfig(config: AdvancedFilterConfig): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!config.groups || config.groups.length === 0) {
    return { valid: true, errors: [] } // Empty config is valid
  }

  for (let i = 0; i < config.groups.length; i++) {
    const group = config.groups[i]

    if (!group.conditions || group.conditions.length === 0) {
      errors.push(`Group ${i + 1} has no conditions`)
      continue
    }

    for (let j = 0; j < group.conditions.length; j++) {
      const condition = group.conditions[j]

      if (!condition.field) {
        errors.push(`Group ${i + 1}, Condition ${j + 1}: Missing field`)
      }

      if (!condition.operator) {
        errors.push(`Group ${i + 1}, Condition ${j + 1}: Missing operator`)
      }

      // Check if value is required
      const requiresValue =
        condition.operator !== 'is_empty' &&
        condition.operator !== 'is_not_empty'
      if (
        requiresValue &&
        (condition.value === null ||
          condition.value === undefined ||
          condition.value === '')
      ) {
        errors.push(`Group ${i + 1}, Condition ${j + 1}: Missing value`)
      }

      // Check if second value is required for 'between'
      if (
        condition.operator === 'between' &&
        (condition.value2 === null ||
          condition.value2 === undefined ||
          condition.value2 === '')
      ) {
        errors.push(
          `Group ${i + 1}, Condition ${j + 1}: 'Between' operator requires two values`
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// Created and developed by Jai Singh
